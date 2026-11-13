import type { Server as SocketIOServer } from 'socket.io';
import {
  calculateDetailedFare,
  calculateZoneSurge,
  getOsrmRouteDistanceEta,
  haversineKm,
  normalizeCoordinates,
  runFairDriverAllocationWithOsrm,
  runRouteOptimizationWithOsrm,
} from './algorithms.js';
import { finalizeRidePaymentOnCompletion, isPaymentPaid } from './paymentService.js';
import { store } from './store.js';
import {
  AllocationRankingRecord,
  Coordinates,
  DriverRecord,
  DriverRequestRecord,
  PaymentMethod,
  PaymentRecord,
  RideEventRecord,
  RideRecord,
  RideStatus,
  SearchStage,
  UserRole,
  VehicleTier,
} from '../src/types/ridenexa.js';

export function getActiveTimeoutSec(): number {
  return Math.max(5, store.getSettings().driverResponseTimeoutSec || 30);
}

export function getSearchIntervalMs(): number {
  const sec = store.getSettings().driverSearchIntervalSec ?? Number(process.env.DRIVER_SEARCH_INTERVAL_SEC || 4);
  return Math.max(2000, Number(sec || 4) * 1000);
}

export function getMaxBookingWaitSec(): number {
  const sec = store.getSettings().maxBookingWaitSec ?? Number(process.env.MAX_BOOKING_WAIT_SEC || 180);
  return Math.max(30, Number(sec || 180));
}

export function getInitialWaitGraceSec(): number {
  const envVal = process.env.INITIAL_DRIVER_WAIT_GRACE_SEC;
  if (envVal !== undefined && envVal.trim() !== '' && Number.isFinite(Number(envVal))) {
    return Math.max(0, Math.min(getMaxBookingWaitSec(), Number(envVal)));
  }
  return Math.min(20, Math.max(8, Math.floor(getMaxBookingWaitSec() / 3)));
}

const ACTIVE_TRIP_STATUSES = new Set([
  'ACCEPTED',
  'CONFIRMED',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'TRIP_STARTED',
  'ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
]);

export function getDeliveryWaitTimeoutMs(): number {
  const rawEnv = process.env.DRIVER_DELIVERY_TIMEOUT_MS;
  if (rawEnv !== undefined && rawEnv.trim() !== '') {
    const envVal = Number(rawEnv);
    if (Number.isFinite(envVal) && envVal >= 1000) return envVal;
  }
  return Math.max(5000, getActiveTimeoutSec() * 1000);
}

export function isRequestStillLive(r: DriverRequestRecord, nowMs = Date.now()): boolean {
  if (r.status !== 'PENDING') return false;
  if (r.deliveryStatus !== 'DELIVERED' || !r.expiresAt) return true;
  const expMs = new Date(r.expiresAt).getTime();
  return Number.isFinite(expMs) && expMs > nowMs;
}

export function getLiveBusyDriverIds(excludeBookingId?: string): {
  activeTripDriverIds: Set<string>;
  busyDriverIdsInPending: Set<string>;
} {
  const nowMs = Date.now();
  const busyDriverIdsInPending = new Set(
    store
      .getPendingDriverRequests()
      .filter((r) => r.bookingId !== excludeBookingId && isRequestStillLive(r, nowMs))
      .map((r) => r.driverId)
  );

  const activeTripDriverIds = new Set(
    store
      .getRides()
      .filter(
        (r) =>
          r.id !== excludeBookingId &&
          r.driverId &&
          !r.isSimulatedDemo &&
          ACTIVE_TRIP_STATUSES.has(r.status)
      )
      .map((r) => r.driverId!)
  );

  return { activeTripDriverIds, busyDriverIdsInPending };
}

const pendingRequestTimers = new Map<string, NodeJS.Timeout>();
const deliveryWaitTimers = new Map<string, NodeJS.Timeout>();
let searchLoopTimer: NodeJS.Timeout | null = null;
let searchLoopInFlight = false;

function clearRequestTimer(requestId?: string) {
  if (!requestId) return;
  const existing = pendingRequestTimers.get(requestId);
  if (existing) {
    clearTimeout(existing);
    pendingRequestTimers.delete(requestId);
  }
  const deliveryTimer = deliveryWaitTimers.get(requestId);
  if (deliveryTimer) {
    clearTimeout(deliveryTimer);
    deliveryWaitTimers.delete(requestId);
  }
}

function maskPhone(phone?: string): string {
  if (!phone) return '+91 98•••-•4500';
  const cleaned = phone.trim();
  if (cleaned.length < 6) return cleaned;
  return `${cleaned.slice(0, Math.max(4, cleaned.length - 6))}••••${cleaned.slice(-3)}`;
}

export async function logRideEvent(params: {
  bookingId: string;
  eventType: string;
  actorId: string;
  actorRole: UserRole | 'SYSTEM';
  message: string;
  status?: string;
  metadata?: Record<string, string | number | boolean | null>;
  isDemoScenario?: boolean;
}): Promise<RideEventRecord> {
  const evt: RideEventRecord = {
    id: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    bookingId: params.bookingId,
    eventType: params.eventType,
    actorId: params.actorId,
    actorRole: params.actorRole,
    status: params.status,
    message: params.message,
    metadata: params.metadata,
    isDemoScenario: params.isDemoScenario,
    timestamp: new Date().toISOString(),
  };
  return store.createRideEvent(evt);
}

function emitToBookingParticipants(
  io: SocketIOServer,
  booking: RideRecord,
  event: string,
  payload: unknown
) {
  io.to(`booking:${booking.id}`).emit(event, payload);
  io.to(`user:${booking.passengerId}`).emit(event, payload);
  io.to('role:ADMIN').emit(event, payload);
}

function scheduleRequestExpiration(io: SocketIOServer, reqRecord: DriverRequestRecord) {
  clearRequestTimer(reqRecord.id);
  if (!reqRecord.expiresAt) return;
  const expMs = new Date(reqRecord.expiresAt).getTime();
  if (!Number.isFinite(expMs)) return;
  const msRemaining = Math.max(250, expMs - Date.now());
  const timer = setTimeout(() => {
    pendingRequestTimers.delete(reqRecord.id);
    handleRequestExpiration(io, reqRecord.id).catch((err) => {
      console.error('[RideNexa] Request expiration handler error:', err);
    });
  }, msRemaining);
  pendingRequestTimers.set(reqRecord.id, timer);
}

function scheduleDeliveryWaitTimeout(io: SocketIOServer, reqRecord: DriverRequestRecord) {
  clearRequestTimer(reqRecord.id);
  const waitMs = getDeliveryWaitTimeoutMs();
  const createdMs = new Date(reqRecord.createdAt).getTime();
  const elapsedMs = Number.isFinite(createdMs) ? Math.max(0, Date.now() - createdMs) : 0;
  const msRemaining = Math.max(250, waitMs - elapsedMs);
  const timer = setTimeout(() => {
    deliveryWaitTimers.delete(reqRecord.id);
    handleRequestExpiration(io, reqRecord.id, { isDeliveryTimeout: true }).catch((err) => {
      console.error('[RideNexa] Delivery timeout handler error:', err);
    });
  }, msRemaining);
  deliveryWaitTimers.set(reqRecord.id, timer);
}

export async function markDriverRequestDelivered(
  io: SocketIOServer,
  requestId: string,
  actorIdOrDriverId?: string
): Promise<DriverRequestRecord | null> {
  const initial = store.getDriverRequestById(requestId);
  if (!initial || initial.status !== 'PENDING') return initial || null;

  if (actorIdOrDriverId) {
    const resolvedDrv = store.getDriverByUserIdOrId(actorIdOrDriverId);
    const matchesTarget =
      actorIdOrDriverId === initial.driverId ||
      actorIdOrDriverId === initial.driverUserId ||
      (resolvedDrv && resolvedDrv.id === initial.driverId);
    if (!matchesTarget) {
      throw new Error('FORBIDDEN: This ride request belongs to another driver.');
    }
  }

  if (initial.deliveryStatus === 'DELIVERED' && initial.expiresAt) {
    return initial;
  }

  return store.withBookingLock(initial.bookingId, async () => {
    const reqRecord = store.getDriverRequestById(requestId);
    if (!reqRecord || reqRecord.status !== 'PENDING') return reqRecord || null;
    if (reqRecord.deliveryStatus === 'DELIVERED' && reqRecord.expiresAt) {
      return reqRecord;
    }

    clearRequestTimer(reqRecord.id);
    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const timeoutSec = getActiveTimeoutSec();
    const expiresAt = new Date(nowDate.getTime() + timeoutSec * 1000).toISOString();

    const updatedReq = (await store.updateDriverRequest(reqRecord.id, {
      deliveryStatus: 'DELIVERED',
      deliveredAt: nowIso,
      timerStartedAt: nowIso,
      expiresAt,
    }))!;

    scheduleRequestExpiration(io, updatedReq);

    await logRideEvent({
      bookingId: updatedReq.bookingId,
      eventType: 'DRIVER_REQUEST_DELIVERED',
      actorId: updatedReq.driverId,
      actorRole: 'DRIVER',
      isDemoScenario: updatedReq.isDemoScenario,
      message: `Ride request delivered to ${updatedReq.driverName}'s dashboard. ${timeoutSec}s acceptance timer started.`,
      metadata: {
        requestId: updatedReq.id,
        driverId: updatedReq.driverId,
        deliveredAt: nowIso,
        expiresAt,
        timeoutSec,
      },
    });

    const payload = { request: updatedReq, timeoutSec };
    io.to(`driver:${updatedReq.driverId}`).emit('driver:request-updated', payload);
    io.to(`driver:${updatedReq.driverId}`).emit('driver:request-delivered', payload);
    if (updatedReq.driverUserId) {
      io.to(`user:${updatedReq.driverUserId}`).emit('driver:request-updated', payload);
      io.to(`user:${updatedReq.driverUserId}`).emit('driver:request-delivered', payload);
    }

    const booking = store.getRideById(updatedReq.bookingId);
    if (booking) {
      io.to('role:ADMIN').emit('admin:allocation-updated', {
        booking,
        request: updatedReq,
        reason: 'DRIVER_REQUEST_DELIVERED',
      });
    }

    return updatedReq;
  });
}

export async function _allocateNextDriverUnlocked(
  io: SocketIOServer,
  bookingId: string,
  triggerReason: string
): Promise<{ booking: RideRecord; request: DriverRequestRecord | null }> {
  const booking = store.getRideById(bookingId);
  if (!booking) {
    throw new Error('Booking not found.');
  }

  if (
    booking.status === 'PENDING_PAYMENT' ||
    booking.status === 'CANCELLED' ||
    booking.status === 'COMPLETED' ||
    booking.driverId
  ) {
    return { booking, request: null };
  }

  // Prevent duplicate active requests for the same ride
  if (booking.activeRequestId) {
    const existingPending = store.getDriverRequestById(booking.activeRequestId);
    if (existingPending && isRequestStillLive(existingPending)) {
      return { booking, request: existingPending };
    }
    clearRequestTimer(booking.activeRequestId);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const settings = store.getSettings();
  const timeoutSec = getActiveTimeoutSec();
  const maxWaitSec = getMaxBookingWaitSec();
  const searchStartedAt = booking.searchStartedAt || booking.confirmedAt || booking.requestedAt || nowIso;
  const waitDeadlineAt =
    booking.waitDeadlineAt ||
    new Date(new Date(searchStartedAt).getTime() + maxWaitSec * 1000).toISOString();

  // Enforce configurable maximum booking waiting period cleanly without leaving the ride stuck
  if (!booking.isDemoScenario && now.getTime() > new Date(waitDeadlineAt).getTime()) {
    const wasAlreadyMaxWait = booking.allocationStatus === 'MAX_WAIT_REACHED';
    const updatedBooking = (await store.updateRide(booking.id, {
      status: 'SEARCHING_DRIVER',
      allocationStatus: 'MAX_WAIT_REACHED',
      searchStage: 'MAX_WAIT_REACHED',
      activeRequestId: undefined,
      searchStartedAt,
      lastSearchAt: nowIso,
      waitDeadlineAt,
      allocationReason: `Maximum waiting window (${Math.round(maxWaitSec / 60)} min) reached. Passenger can continue waiting or cancel without charge.`,
    }))!;

    if (!wasAlreadyMaxWait) {
      await logRideEvent({
        bookingId: booking.id,
        eventType: 'SEARCH_MAX_WAIT_REACHED',
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        status: updatedBooking.status,
        isDemoScenario: booking.isDemoScenario,
        message: `Continuous driver search reached configured waiting window (${maxWaitSec}s). Waiting for passenger to continue or cancel.`,
      });

      emitToBookingParticipants(io, updatedBooking, 'booking:max-wait-reached', {
        booking: updatedBooking,
        stage: 'MAX_WAIT_REACHED',
        message: 'Still finding your best available driver. You can continue waiting or cancel without charge.',
      });
      emitToBookingParticipants(io, updatedBooking, 'booking:status-updated', {
        booking: updatedBooking,
        stage: 'MAX_WAIT_REACHED',
        message: 'Maximum waiting period reached. Choose Continue Waiting or Cancel Ride.',
      });
      io.to('role:ADMIN').emit('admin:allocation-updated', {
        booking: updatedBooking,
        reason: 'MAX_WAIT_REACHED',
      });
      io.emit('ride:updated', updatedBooking);
    }
    return { booking: updatedBooking, request: null };
  }

  const currentAttempts = booking.allocationAttempts || 0;
  const attemptNumber = currentAttempts + 1;

  io.to('role:ADMIN').emit('admin:allocation-started', {
    bookingId: booking.id,
    attemptNumber,
    triggerReason,
  });

  emitToBookingParticipants(io, booking, 'booking:checking-drivers', {
    booking,
    stage: 'CHECKING_DRIVERS' as SearchStage,
    attemptNumber,
    message: 'Checking available approved drivers near your pickup...',
  });

  const resetMs = booking.exclusionsResetAt
    ? new Date(booking.exclusionsResetAt).getTime()
    : 0;
  const priorRequestDriverIds = store
    .getDriverRequestsByBooking(booking.id)
    .filter(
      (r) =>
        r.status !== 'CANCELLED' &&
        (!resetMs || new Date(r.createdAt).getTime() >= resetMs)
    )
    .map((r) => r.driverId);
  const excludedIds = new Set([...(booking.excludedDriverIds || []), ...priorRequestDriverIds]);
  const { activeTripDriverIds, busyDriverIdsInPending } = getLiveBusyDriverIds(booking.id);

  // Isolate Judge Demo Scenario drivers and ensure live bookings only target real user-backed drivers
  const scopedFleet = store.getDrivers().filter((d) => {
    if (booking.isDemoScenario) return Boolean(d.isDemoScenario);
    return !d.isDemoScenario && Boolean(d.userId);
  });

  // Pre-filter drivers already on an active trip, holding a live pending request, or marked BUSY (isAvailable === false).
  // Never clear an explicit isAvailable: false flag on an online driver during allocation.
  const fleetWithBusyState: DriverRecord[] = [];
  for (const d of scopedFleet) {
    const isBusy = busyDriverIdsInPending.has(d.id) || activeTripDriverIds.has(d.id) || !d.isAvailable;
    if (isBusy) {
      fleetWithBusyState.push({ ...d, isAvailable: false });
    } else {
      fleetWithBusyState.push(d);
    }
  }

  const prioritizeNearest =
    !booking.isDemoScenario && (settings.dispatchStrategy ?? 'NEAREST_FIRST') === 'NEAREST_FIRST';

  const allocation = await runFairDriverAllocationWithOsrm({
    pickup: booking.pickupCoords,
    drivers: fleetWithBusyState,
    preferredTier: booking.vehicleTier,
    weights: settings.allocationWeights,
    maxPickupEtaMin: settings.maxPickupEtaMin,
    excludedDriverIds: Array.from(excludedIds),
    strictTierMatch: false,
    strictVerification: true,
    prioritizeNearest,
    enableOsrmRouting: settings.enableOsrmRouting,
  });

  console.log(
    `[RideNexa Dispatch] booking=${booking.id} attempt=#${attemptNumber} trigger=${triggerReason} fleet=${scopedFleet.length} online=${fleetWithBusyState.filter((d) => d.isOnline).length} eligible=${allocation.candidates.length} excluded=${excludedIds.size} selected=${allocation.selectedDriver?.driverId || 'NONE'}`
  );

  const rankingRecord: AllocationRankingRecord = {
    id: `rank-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    bookingId: booking.id,
    attemptNumber,
    triggerReason,
    pickup: booking.pickupCoords,
    weightsUsed: allocation.weightsUsed || settings.allocationWeights,
    totalFleetCount: scopedFleet.length,
    eligibleCount: allocation.candidates.length,
    excludedCount: excludedIds.size,
    selectedDriverId: allocation.selectedDriver?.driverId,
    selectedDriverName: allocation.selectedDriver?.driverName,
    greedyDriverId: allocation.nearestGreedyDriver?.driverId,
    greedyDriverName: allocation.nearestGreedyDriver?.driverName,
    greedyEtaMin: allocation.nearestGreedyDriver?.etaMinutes,
    candidates: allocation.candidates,
    explanation: allocation.explanation,
    createdAt: nowIso,
    isDemoScenario: booking.isDemoScenario,
  };

  // Persist ranking whenever a driver is evaluated or state changed meaningfully (avoid flooding identical 0-candidate rows on periodic ticks)
  const previousRankings = store.getAllocationRankings(booking.id);
  const lastRanking = previousRankings[0];
  const shouldStoreRanking =
    Boolean(allocation.selectedDriver) ||
    triggerReason !== 'PERIODIC_AVAILABILITY_CHECK' ||
    !lastRanking ||
    lastRanking.eligibleCount > 0;

  if (shouldStoreRanking) {
    await store.createAllocationRanking(rankingRecord);
    io.to('role:ADMIN').emit('admin:allocation-ranked', {
      bookingId: booking.id,
      ranking: rankingRecord,
    });
  }

  if (!allocation.selectedDriver) {
    const elapsedWaitMs = Math.max(0, now.getTime() - new Date(searchStartedAt).getTime());
    const initialGraceMs = getInitialWaitGraceSec() * 1000;
    const withinInitialGrace =
      !booking.isDemoScenario && excludedIds.size === 0 && elapsedWaitMs < initialGraceMs;

    if (withinInitialGrace) {
      const waitMsg =
        'Searching for online drivers near your pickup... We are monitoring live fleet availability and will assign a driver as soon as one comes online.';
      const transitioningIntoWaiting =
        booking.allocationStatus !== 'WAITING_FOR_DRIVER' ||
        booking.searchStage !== 'WAITING_FOR_DRIVER';

      const updatedBooking = (await store.updateRide(booking.id, {
        status: 'SEARCHING_DRIVER',
        allocationStatus: 'WAITING_FOR_DRIVER',
        searchStage: 'WAITING_FOR_DRIVER',
        activeRequestId: undefined,
        searchStartedAt,
        lastSearchAt: nowIso,
        waitDeadlineAt,
        excludedDriverIds: Array.from(excludedIds),
        allocationReason: waitMsg,
      }))!;

      if (transitioningIntoWaiting) {
        await logRideEvent({
          bookingId: booking.id,
          eventType: 'WAITING_FOR_ONLINE_DRIVER',
          actorId: 'SYSTEM',
          actorRole: 'SYSTEM',
          status: updatedBooking.status,
          isDemoScenario: booking.isDemoScenario,
          message: waitMsg,
          metadata: {
            triggerReason,
            graceSec: getInitialWaitGraceSec(),
            onlineCount: fleetWithBusyState.filter((d) => d.isOnline).length,
          },
        });
      }

      emitToBookingParticipants(io, updatedBooking, 'booking:searching-driver', {
        booking: updatedBooking,
        stage: 'WAITING_FOR_DRIVER' as SearchStage,
        attemptNumber: booking.allocationAttempts || 0,
        message: waitMsg,
      });
      io.to('role:ADMIN').emit('admin:allocation-updated', {
        booking: updatedBooking,
        reason: 'WAITING_FOR_DRIVER',
      });
      io.emit('ride:updated', updatedBooking);
      return { booking: updatedBooking, request: null };
    }

    const allTriedOrRejected = excludedIds.size > 0;
    const noDriversMessage = allTriedOrRejected
      ? 'No drivers are currently available — all nearby available drivers rejected or did not respond. Please try booking again.'
      : 'No online drivers are currently available near your pickup location. We will keep checking for newly available drivers.';
    const transitioningIntoUnavailable =
      booking.allocationStatus !== 'NO_DRIVERS_AVAILABLE' ||
      booking.searchStage !== 'NO_DRIVERS_AVAILABLE';

    const updatedBooking = (await store.updateRide(booking.id, {
      status: 'SEARCHING_DRIVER',
      allocationStatus: 'NO_DRIVERS_AVAILABLE',
      searchStage: 'NO_DRIVERS_AVAILABLE',
      activeRequestId: undefined,
      searchStartedAt,
      lastSearchAt: nowIso,
      waitDeadlineAt,
      excludedDriverIds: Array.from(excludedIds),
      allocationReason: noDriversMessage,
    }))!;

    if (transitioningIntoUnavailable) {
      await logRideEvent({
        bookingId: booking.id,
        eventType: 'NO_DRIVERS_AVAILABLE',
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        status: updatedBooking.status,
        isDemoScenario: booking.isDemoScenario,
        message: noDriversMessage,
        metadata: {
          triggerReason,
          attempts: booking.allocationAttempts || 0,
          excludedCount: excludedIds.size,
        },
      });
    }

    emitToBookingParticipants(io, updatedBooking, 'booking:no-drivers-available', {
      booking: updatedBooking,
      stage: 'NO_DRIVERS_AVAILABLE' as SearchStage,
      attemptNumber: booking.allocationAttempts || 0,
      allTriedOrRejected,
      message: noDriversMessage,
    });
    emitToBookingParticipants(io, updatedBooking, 'booking:status-updated', {
      booking: updatedBooking,
      stage: 'NO_DRIVERS_AVAILABLE' as SearchStage,
      message: noDriversMessage,
    });
    io.to('role:ADMIN').emit('admin:allocation-updated', {
      booking: updatedBooking,
      reason: 'NO_DRIVERS_AVAILABLE',
    });
    io.emit('ride:updated', updatedBooking);
    return { booking: updatedBooking, request: null };
  }

  const targetDriver = store.getDriverByUserIdOrId(allocation.selectedDriver.driverId);
  if (!targetDriver) {
    throw new Error('Allocated driver record could not be resolved.');
  }

  // Increment driver dispatch opportunity counter for fairness tracking
  const updatedOpportunityDriver = await store.updateDriver(targetDriver.id, {
    allocationOpportunities: (targetDriver.allocationOpportunities ?? 0) + 1,
  });
  if (updatedOpportunityDriver) {
    io.emit('driver:updated', updatedOpportunityDriver);
  }

  const immediateDelivery = Boolean(booking.isDemoScenario);
  const expiresAt = immediateDelivery
    ? new Date(now.getTime() + timeoutSec * 1000).toISOString()
    : '';

  const passengerUser = store.findUserById(booking.passengerId);
  const reqRecord: DriverRequestRecord = {
    id: `dreq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    bookingId: booking.id,
    driverId: targetDriver.id,
    driverUserId: targetDriver.userId,
    driverName: targetDriver.name,
    passengerId: booking.passengerId,
    passengerName: booking.passengerName,
    passengerPhone: passengerUser?.phone ? maskPhone(passengerUser.phone) : undefined,
    pickupAddress: booking.pickupAddress,
    pickupCoords: booking.pickupCoords,
    destinationAddress: booking.destinationAddress,
    destinationCoords: booking.destinationCoords,
    distanceKm: booking.distanceKm,
    durationMin: booking.durationMin,
    estimatedFare: booking.estimatedFare,
    driverEarnings: Math.round(booking.estimatedFare * 0.8),
    vehicleTier: booking.vehicleTier,
    attemptNumber,
    allocationScore: allocation.selectedDriver.totalAllocationScore,
    allocationReason: allocation.explanation,
    pickupDistanceKm: allocation.selectedDriver.distanceKm,
    pickupEtaMin: allocation.selectedDriver.etaMinutes,
    status: 'PENDING',
    deliveryStatus: immediateDelivery ? 'DELIVERED' : 'PENDING_DELIVERY',
    deliveredAt: immediateDelivery ? nowIso : undefined,
    timerStartedAt: immediateDelivery ? nowIso : undefined,
    expiresAt,
    createdAt: nowIso,
    isDemoScenario: booking.isDemoScenario,
  };

  const createdReq = await store.createDriverRequest(reqRecord);
  const nextStage: SearchStage = 'REQUEST_SENT';

  const updatedBooking = (await store.updateRide(booking.id, {
    status: 'SEARCHING_DRIVER',
    allocationStatus: 'SEARCHING_DRIVER',
    searchStage: nextStage,
    activeRequestId: createdReq.id,
    allocationAttempts: attemptNumber,
    reassignmentCount: booking.reassignmentCount || 0,
    excludedDriverIds: Array.from(excludedIds),
    searchStartedAt,
    lastSearchAt: nowIso,
    waitDeadlineAt,
    allocationReason: allocation.explanation,
    allocationScore: allocation.selectedDriver.totalAllocationScore,
  }))!;

  await logRideEvent({
    bookingId: booking.id,
    eventType: 'DRIVER_REQUEST_SENT',
    actorId: 'SYSTEM',
    actorRole: 'SYSTEM',
    status: updatedBooking.status,
    isDemoScenario: booking.isDemoScenario,
    message: `Attempt #${attemptNumber}: dispatched to ${targetDriver.name} (${allocation.selectedDriver.distanceKm} km, ETA ${allocation.selectedDriver.etaMinutes}m).`,
    metadata: {
      requestId: createdReq.id,
      driverId: targetDriver.id,
      attemptNumber,
      triggerReason,
      timeoutSec,
      deliveryStatus: createdReq.deliveryStatus || 'PENDING_DELIVERY',
    },
  });

  if (immediateDelivery) {
    scheduleRequestExpiration(io, createdReq);
  } else {
    scheduleDeliveryWaitTimeout(io, createdReq);
  }

  const driverPayload = { request: createdReq, timeoutSec };
  io.to(`driver:${targetDriver.id}`).emit('driver:new-request', driverPayload);
  io.to(`driver:${targetDriver.id}`).emit('driver:ride-request', driverPayload);
  if (targetDriver.userId) {
    io.to(`user:${targetDriver.userId}`).emit('driver:new-request', driverPayload);
    io.to(`user:${targetDriver.userId}`).emit('driver:ride-request', driverPayload);
  }

  emitToBookingParticipants(io, updatedBooking, 'booking:request-sent', {
    booking: updatedBooking,
    stage: nextStage,
    attemptNumber,
    driverName: targetDriver.name,
    timeoutSec,
    message: `Driver request sent to ${targetDriver.name}. Awaiting response...`,
  });

  emitToBookingParticipants(io, updatedBooking, 'booking:searching-driver', {
    booking: updatedBooking,
    stage: nextStage,
    attemptNumber,
    driverName: targetDriver.name,
    timeoutSec,
    message: 'Driver request sent. Finding your best available driver...',
  });

  io.to('role:ADMIN').emit('admin:assignment-created', {
    booking: updatedBooking,
    request: createdReq,
    ranking: rankingRecord,
  });
  io.to('role:ADMIN').emit('admin:allocation-updated', {
    booking: updatedBooking,
    request: createdReq,
    reason: triggerReason,
  });
  io.emit('ride:updated', updatedBooking);

  return { booking: updatedBooking, request: createdReq };
}

export async function triggerSearchForAvailableDrivers(
  io: SocketIOServer,
  reason: string,
  newlyAvailableDriverId?: string
): Promise<number> {
  const nowMs = Date.now();
  const hasLivePendingRequest = (booking: RideRecord): boolean => {
    if (!booking.activeRequestId) return false;
    const req = store.getDriverRequestById(booking.activeRequestId);
    return Boolean(req && isRequestStillLive(req, nowMs));
  };

  const waitingBookings = store
    .getRides()
    .filter(
      (b) =>
        !b.isSimulatedDemo &&
        !b.isDemoScenario &&
        !b.driverId &&
        (b.status === 'CONFIRMED' || b.status === 'SEARCHING_DRIVER') &&
        b.allocationStatus !== 'MAX_WAIT_REACHED' &&
        !hasLivePendingRequest(b)
    )
    .sort(
      (a, b) =>
        new Date(a.searchStartedAt || a.requestedAt).getTime() -
        new Date(b.searchStartedAt || b.requestedAt).getTime()
    );

  if (waitingBookings.length === 0) return 0;

  let availableDrv: DriverRecord | undefined;
  if (newlyAvailableDriverId) {
    availableDrv = store.getDriverByUserIdOrId(newlyAvailableDriverId);
    const verification = String(availableDrv?.verificationStatus || '').trim().toUpperCase();
    if (
      !availableDrv ||
      availableDrv.isDemoScenario ||
      !availableDrv.userId ||
      verification !== 'APPROVED' ||
      !availableDrv.isOnline ||
      !availableDrv.isAvailable
    ) {
      return 0;
    }

    io.to('role:ADMIN').emit('admin:driver-available', {
      driverId: availableDrv.id,
      driverName: availableDrv.name,
      reason,
      waitingBookingsCount: waitingBookings.length,
    });
  }

  let triggeredCount = 0;
  for (const b of waitingBookings) {
    if (availableDrv && (b.excludedDriverIds || []).includes(availableDrv.id)) {
      continue;
    }
    try {
      await store.withBookingLock(b.id, async () => {
        const fresh = store.getRideById(b.id);
        if (
          !fresh ||
          fresh.driverId ||
          hasLivePendingRequest(fresh) ||
          fresh.status === 'CANCELLED' ||
          fresh.status === 'COMPLETED' ||
          fresh.allocationStatus === 'MAX_WAIT_REACHED'
        ) {
          return;
        }
        await _allocateNextDriverUnlocked(io, fresh.id, reason);
        triggeredCount += 1;
      });
    } catch (err) {
      console.error(`[RideNexa] Search re-evaluation failed for ${b.id}:`, err);
    }
  }
  return triggeredCount;
}

export async function createPendingBooking(
  io: SocketIOServer,
  params: {
    passengerId: string;
    passengerName: string;
    pickupAddress: string;
    destinationAddress: string;
    pickupCoords: Coordinates;
    destinationCoords: Coordinates;
    vehicleTier: VehicleTier;
    paymentMethod?: PaymentMethod;
    poolingOptIn?: boolean;
    idempotencyKey?: string;
    isDemoScenario?: boolean;
  }
): Promise<{ booking: RideRecord; payment: PaymentRecord | null; deduplicated: boolean }> {
  const normPickup = normalizeCoordinates(params.pickupCoords);
  const normDest = normalizeCoordinates(params.destinationCoords);
  if (!normPickup || !normDest) {
    throw new Error('Valid pickup and destination latitude/longitude coordinates are required.');
  }

  if (params.idempotencyKey) {
    const existing = store.findRideByIdempotencyKey(params.passengerId, params.idempotencyKey);
    if (existing) {
      const existingPayment = store.getPaymentByRideId(existing.id) || null;
      return { booking: existing, payment: existingPayment, deduplicated: true };
    }
  }

  if (haversineKm(normPickup, normDest) < 0.2) {
    throw new Error('Pickup and destination must be at least 200 meters apart.');
  }

  const settings = store.getSettings();
  const tier: VehicleTier = params.vehicleTier || 'EV_COMFORT';
  const method: PaymentMethod = params.paymentMethod || 'CASH';
  if (!['CASH', 'UPI', 'CARD', 'WALLET'].includes(method)) {
    throw new Error('Unsupported payment method. Choose Cash, UPI, or Card.');
  }

  const surgeInfo = calculateZoneSurge({
    pickupCoords: normPickup,
    drivers: store.getDrivers(),
    settings,
  });

  const route = await runRouteOptimizationWithOsrm({
    pickupName: params.pickupAddress,
    destinationName: params.destinationAddress,
    pickupCoords: normPickup,
    destinationCoords: normDest,
    tier,
    surgeMultiplier: surgeInfo.surgeMultiplier,
    enableOsrmRouting: settings.enableOsrmRouting,
  });

  const poolingOptIn = Boolean(params.poolingOptIn || tier === 'POOL_SHARE');
  const { totalFare: estimatedFare, breakdown: estimatedFareBreakdown } = calculateDetailedFare({
    distanceKm: route.recommendedRoute.distanceKm,
    durationMin: route.recommendedRoute.durationMin,
    tier,
    surgeMultiplier: surgeInfo.surgeMultiplier,
    poolingOptIn,
    pricingConfig: settings.pricingConfig,
    distanceSource: 'ROUTE_BASED_ESTIMATE',
    durationSource: 'ROUTE_BASED_ESTIMATE',
  });
  const pooledFare = Math.round(estimatedFare * (poolingOptIn ? 1 : 0.72));

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const waitDeadlineAt = new Date(
    nowDate.getTime() + getMaxBookingWaitSec() * 1000
  ).toISOString();
  const bookingId = `${params.isDemoScenario ? 'DEMO-' : 'BK-'}${Date.now()
    .toString(36)
    .toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

  const booking: RideRecord = {
    id: bookingId,
    passengerId: params.passengerId,
    passengerName: params.passengerName,
    vehicleTier: tier,
    pickupAddress: params.pickupAddress.trim(),
    pickupCoords: normPickup,
    destinationAddress: params.destinationAddress.trim(),
    destinationCoords: normDest,
    distanceKm: route.recommendedRoute.distanceKm,
    durationMin: route.recommendedRoute.durationMin,
    estimatedFare,
    estimatedFareBreakdown,
    pooledDiscountFare: pooledFare,
    poolingOptIn,
    surgeMultiplier: surgeInfo.surgeMultiplier,
    surgeDisclosure: surgeInfo.surgeDisclosure,
    routeSolverType: route.solverType,
    status: 'SEARCHING_DRIVER',
    allocationStatus: 'SEARCHING_DRIVER',
    searchStage: 'SEARCHING',
    paymentMethod: method,
    paymentStatus: 'PENDING',
    excludedDriverIds: [],
    allocationAttempts: 0,
    reassignmentCount: 0,
    rejectedDriverCount: 0,
    timedOutDriverCount: 0,
    idempotencyKey: params.idempotencyKey,
    routePath: route.recommendedRoute.waypoints,
    requestedAt: now,
    confirmedAt: now,
    searchStartedAt: now,
    lastSearchAt: now,
    waitDeadlineAt,
    isSimulatedDemo: false,
    isDemoScenario: Boolean(params.isDemoScenario),
  };

  await store.createRide(booking);

  await logRideEvent({
    bookingId: booking.id,
    eventType: 'BOOKING_CREATED',
    actorId: params.passengerId,
    actorRole: 'PASSENGER',
    status: booking.status,
    isDemoScenario: booking.isDemoScenario,
    message: `Booking ${booking.id} confirmed with estimated fare ₹${estimatedFare} (${method}, Payment: Pending until ride completion${surgeInfo.surgeMultiplier > 1 ? `, ${surgeInfo.surgeMultiplier}x surge disclosed` : ''}${poolingOptIn ? ', pooling opt-in' : ''}). Dispatching fair driver allocation.`,
    metadata: {
      paymentMethod: method,
      paymentStatus: 'PENDING',
      estimatedFare,
      vehicleTier: tier,
      surgeMultiplier: surgeInfo.surgeMultiplier,
      poolingOptIn,
    },
  });

  io.to('role:ADMIN').emit('admin:new-booking', { booking, payment: null });
  io.emit('ride:created', booking);
  emitToBookingParticipants(io, booking, 'booking:confirmed', {
    booking,
    stage: 'SEARCHING' as SearchStage,
    payment: null,
    message: `Booking confirmed (${method} — paid after ride completion). Finding your best available driver...`,
  });

  const allocated = await store.withBookingLock(booking.id, () =>
    _allocateNextDriverUnlocked(io, booking.id, 'BOOKING_CONFIRMED')
  );

  return { booking: allocated.booking, payment: null, deduplicated: false };
}

function computeNextAcceptanceRate(
  driver: DriverRecord,
  outcome: 'ACCEPTED' | 'REJECTED' | 'TIMED_OUT' | 'EXPIRED'
): {
  acceptedCount: number;
  rejectedCount: number;
  timedOutCount: number;
  acceptanceRate: number;
} {
  const acceptedCount = (driver.acceptedCount ?? 0) + (outcome === 'ACCEPTED' ? 1 : 0);
  const rejectedCount = (driver.rejectedCount ?? 0) + (outcome === 'REJECTED' ? 1 : 0);
  const timedOutCount =
    (driver.timedOutCount ?? 0) + (outcome === 'TIMED_OUT' || outcome === 'EXPIRED' ? 1 : 0);
  const totalResponses = acceptedCount + rejectedCount + timedOutCount;
  const acceptanceRate =
    totalResponses > 0
      ? Number(Math.max(0.3, Math.min(1, acceptedCount / totalResponses)).toFixed(2))
      : driver.acceptanceRate;
  return { acceptedCount, rejectedCount, timedOutCount, acceptanceRate };
}

export async function acceptDriverRequest(
  io: SocketIOServer,
  params: {
    requestId: string;
    actorId: string;
    actorRole: UserRole;
  }
): Promise<{ booking: RideRecord; request: DriverRequestRecord; driver: DriverRecord }> {
  const initialReq = store.getDriverRequestById(params.requestId);
  if (!initialReq) {
    throw new Error('NOT_FOUND: Driver request not found.');
  }

  return store.withBookingLock(initialReq.bookingId, async () => {
    const reqRecord = store.getDriverRequestById(params.requestId);
    if (!reqRecord) {
      throw new Error('NOT_FOUND: Driver request not found.');
    }

    const actingDriver =
      params.actorRole === 'DRIVER'
        ? store.getDriverByUserIdOrId(params.actorId)
        : store.getDriverByUserIdOrId(reqRecord.driverId);

    if (!actingDriver) {
      throw new Error('NOT_FOUND: Driver profile not found.');
    }

    if (params.actorRole === 'DRIVER' && reqRecord.driverId !== actingDriver.id) {
      throw new Error('FORBIDDEN: This ride request belongs to another driver.');
    }

    if (actingDriver.verificationStatus !== 'APPROVED') {
      throw new Error('FORBIDDEN: Only verified and approved drivers may accept rides.');
    }

    if (reqRecord.status !== 'PENDING') {
      throw new Error(`CONFLICT: Request is already ${reqRecord.status.toLowerCase()}.`);
    }

    const booking = store.getRideById(reqRecord.bookingId);
    if (!booking) {
      throw new Error('NOT_FOUND: Booking not found.');
    }

    const hasDeliveredTimer = reqRecord.deliveryStatus === 'DELIVERED' && Boolean(reqRecord.expiresAt);
    if (hasDeliveredTimer && Date.now() > new Date(reqRecord.expiresAt).getTime()) {
      clearRequestTimer(reqRecord.id);
      const expiredIso = new Date().toISOString();
      const metrics = computeNextAcceptanceRate(actingDriver, 'TIMED_OUT');
      const releasedDriver = await store.updateDriver(actingDriver.id, {
        isAvailable: actingDriver.isOnline,
        ...metrics,
      });
      if (releasedDriver) io.emit('driver:updated', releasedDriver);

      const expiredReq = (await store.updateDriverRequest(reqRecord.id, {
        status: 'TIMED_OUT',
        respondedAt: expiredIso,
        timedOutAt: expiredIso,
      }))!;

      const nextExcluded = Array.from(new Set([...(booking.excludedDriverIds || []), reqRecord.driverId]));
      const settings = store.getSettings();
      const maxReassignments = Math.max(1, settings.maxReassignmentAttempts || 10);
      const canReassign = (booking.reassignmentCount || 0) < maxReassignments;

      const updatedBooking = (await store.updateRide(booking.id, {
        excludedDriverIds: nextExcluded,
        timedOutDriverCount: (booking.timedOutDriverCount || 0) + 1,
        lastTimeoutAt: expiredIso,
        reassignmentCount: canReassign ? (booking.reassignmentCount || 0) + 1 : booking.reassignmentCount || 0,
        allocationStatus: 'SEARCHING_DRIVER',
        searchStage: canReassign ? ('REASSIGNING' as SearchStage) : ('NO_DRIVERS_AVAILABLE' as SearchStage),
        activeRequestId: undefined,
      }))!;

      await logRideEvent({
        bookingId: booking.id,
        eventType: 'DRIVER_REQUEST_EXPIRED',
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        isDemoScenario: booking.isDemoScenario,
        message: `Request ${reqRecord.id} for ${reqRecord.driverName} expired before acceptance. Reassigning to next nearest driver.`,
      });

      io.to(`driver:${reqRecord.driverId}`).emit('driver:request-expired', { request: expiredReq });
      if (reqRecord.driverUserId) {
        io.to(`user:${reqRecord.driverUserId}`).emit('driver:request-expired', { request: expiredReq });
      }

      if (canReassign) {
        emitToBookingParticipants(io, updatedBooking, 'booking:reassigned', {
          booking: updatedBooking,
          stage: 'REASSIGNING' as SearchStage,
          attemptNumber: updatedBooking.allocationAttempts || 0,
          message: 'Previous driver timed out. Reassigning to the next nearest available driver...',
        });
        await _allocateNextDriverUnlocked(io, booking.id, 'REQUEST_EXPIRED_ON_ACCEPT_REASSIGN');
      }
      throw new Error('CONFLICT: Driver request has expired.');
    }

    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
      throw new Error(`CONFLICT: Booking is already ${booking.status.toLowerCase()}.`);
    }

    if (booking.driverId) {
      throw new Error('CONFLICT: Another driver has already been assigned to this booking.');
    }

    const driverHasAnotherActiveTrip = store.getRides().some(
      (r) =>
        r.id !== booking.id &&
        r.driverId === actingDriver.id &&
        !r.isSimulatedDemo &&
        [
          'DRIVER_ASSIGNED',
          'DRIVER_ARRIVING',
          'DRIVER_ARRIVED',
          'TRIP_STARTED',
          'ASSIGNED',
          'EN_ROUTE',
          'IN_PROGRESS',
        ].includes(r.status)
    );

    if (!actingDriver.isOnline || !actingDriver.isAvailable || driverHasAnotherActiveTrip) {
      throw new Error('CONFLICT: Driver is currently offline or busy on another trip.');
    }

    clearRequestTimer(reqRecord.id);
    const now = new Date().toISOString();

    const acceptedRequest = (await store.updateDriverRequest(reqRecord.id, {
      status: 'ACCEPTED',
      deliveryStatus: 'DELIVERED',
      deliveredAt: reqRecord.deliveredAt || now,
      timerStartedAt: reqRecord.timerStartedAt || now,
      respondedAt: now,
    }))!;

    for (const other of store.getDriverRequestsByBooking(booking.id)) {
      if (other.id !== acceptedRequest.id && other.status === 'PENDING') {
        clearRequestTimer(other.id);
        await store.updateDriverRequest(other.id, { status: 'CANCELLED', respondedAt: now });
        io.to(`driver:${other.driverId}`).emit('driver:request-cancelled', {
          requestId: other.id,
          bookingId: booking.id,
        });
      }
    }

    const metrics = computeNextAcceptanceRate(actingDriver, 'ACCEPTED');
    const updatedDriver = (await store.updateDriver(actingDriver.id, {
      isAvailable: false,
      ...metrics,
    }))!;

    const driverUser = actingDriver.userId ? store.findUserById(actingDriver.userId) : undefined;
    const osrmEta = await getOsrmRouteDistanceEta({
      from: updatedDriver.coordinates,
      to: booking.pickupCoords,
      enableOsrmRouting: store.getSettings().enableOsrmRouting,
    });
    const driverEtaMin = osrmEta.etaMinutes;

    const updatedBooking = (await store.updateRide(booking.id, {
      status: 'DRIVER_ASSIGNED',
      allocationStatus: 'DRIVER_ASSIGNED',
      searchStage: 'ASSIGNED',
      driverId: updatedDriver.id,
      driverName: updatedDriver.name,
      driverPhone: maskPhone(driverUser?.phone),
      driverRating: updatedDriver.rating,
      driverEtaMin,
      vehicleModel: updatedDriver.vehicleModel,
      plateNumber: updatedDriver.plateNumber,
      assignedAt: now,
      activeRequestId: undefined,
    }))!;

    await logRideEvent({
      bookingId: booking.id,
      eventType: 'DRIVER_ACCEPTED',
      actorId: params.actorId,
      actorRole: params.actorRole,
      status: 'DRIVER_ASSIGNED',
      isDemoScenario: booking.isDemoScenario,
      message: `${updatedDriver.name} (${updatedDriver.vehicleModel}, ${updatedDriver.plateNumber}) accepted booking ${booking.id}. ETA ${driverEtaMin} min.`,
      metadata: {
        requestId: acceptedRequest.id,
        driverId: updatedDriver.id,
        attemptNumber: acceptedRequest.attemptNumber,
      },
    });

    emitToBookingParticipants(io, updatedBooking, 'booking:driver-assigned', {
      booking: updatedBooking,
      driver: updatedDriver,
      request: acceptedRequest,
      stage: 'ASSIGNED' as SearchStage,
      driverName: updatedDriver.name,
      message: `Driver Assigned: ${updatedDriver.name} (${updatedDriver.vehicleModel} · ${updatedDriver.plateNumber}) is on the way! ETA ${driverEtaMin} min.`,
    });
    io.to('role:ADMIN').emit('admin:assignment-accepted', {
      booking: updatedBooking,
      driver: updatedDriver,
      request: acceptedRequest,
    });
    io.to('role:ADMIN').emit('admin:driver-response', {
      booking: updatedBooking,
      request: acceptedRequest,
      response: 'ACCEPTED',
    });
    io.to('role:ADMIN').emit('admin:allocation-updated', {
      booking: updatedBooking,
      driver: updatedDriver,
      reason: 'DRIVER_ACCEPTED',
    });
    io.emit('driver:updated', updatedDriver);
    io.emit('ride:updated', updatedBooking);

    return { booking: updatedBooking, request: acceptedRequest, driver: updatedDriver };
  });
}

export async function rejectDriverRequest(
  io: SocketIOServer,
  params: {
    requestId: string;
    actorId: string;
    actorRole: UserRole;
  }
): Promise<{ booking: RideRecord; request: DriverRequestRecord }> {
  const initialReq = store.getDriverRequestById(params.requestId);
  if (!initialReq) {
    throw new Error('NOT_FOUND: Driver request not found.');
  }

  return store.withBookingLock(initialReq.bookingId, async () => {
    const reqRecord = store.getDriverRequestById(params.requestId);
    if (!reqRecord) {
      throw new Error('NOT_FOUND: Driver request not found.');
    }

    const actingDriver =
      params.actorRole === 'DRIVER'
        ? store.getDriverByUserIdOrId(params.actorId)
        : store.getDriverByUserIdOrId(reqRecord.driverId);

    if (!actingDriver) {
      throw new Error('NOT_FOUND: Driver profile not found.');
    }
    if (params.actorRole === 'DRIVER' && reqRecord.driverId !== actingDriver.id) {
      throw new Error('FORBIDDEN: This ride request belongs to another driver.');
    }
    if (reqRecord.status !== 'PENDING') {
      throw new Error(`CONFLICT: Request is already ${reqRecord.status.toLowerCase()}.`);
    }

    clearRequestTimer(reqRecord.id);
    const now = new Date().toISOString();

    const rejectedRequest = (await store.updateDriverRequest(reqRecord.id, {
      status: 'REJECTED',
      respondedAt: now,
      rejectedAt: now,
    }))!;

    // Rejecting driver remains online and available for other bookings
    const metrics = computeNextAcceptanceRate(actingDriver, 'REJECTED');
    const updatedDriver = (await store.updateDriver(actingDriver.id, {
      isAvailable: actingDriver.isOnline,
      ...metrics,
    }))!;

    const booking = store.getRideById(reqRecord.bookingId);
    if (!booking) {
      throw new Error('NOT_FOUND: Booking not found.');
    }

    const nextExcluded = Array.from(
      new Set([...(booking.excludedDriverIds || []), actingDriver.id])
    );
    const settings = store.getSettings();
    const maxReassignments = Math.max(1, settings.maxReassignmentAttempts || 10);
    const canReassign =
      !booking.driverId &&
      booking.status !== 'CANCELLED' &&
      booking.status !== 'COMPLETED' &&
      (booking.reassignmentCount || 0) < maxReassignments;

    const updatedAfterReject = (await store.updateRide(booking.id, {
      status: 'SEARCHING_DRIVER',
      allocationStatus: 'SEARCHING_DRIVER',
      searchStage: canReassign ? ('REASSIGNING' as SearchStage) : ('NO_DRIVERS_AVAILABLE' as SearchStage),
      excludedDriverIds: nextExcluded,
      rejectedDriverCount: (booking.rejectedDriverCount || 0) + 1,
      reassignmentCount: canReassign ? (booking.reassignmentCount || 0) + 1 : booking.reassignmentCount || 0,
      lastRejectedAt: now,
      activeRequestId: undefined,
      allocationReason: `${actingDriver.name} declined request #${reqRecord.attemptNumber}. Reassigning to next nearest available driver.`,
    }))!;

    await logRideEvent({
      bookingId: booking.id,
      eventType: 'DRIVER_REJECTED',
      actorId: params.actorId,
      actorRole: params.actorRole,
      status: updatedAfterReject.status,
      isDemoScenario: booking.isDemoScenario,
      message: `${actingDriver.name} rejected request #${reqRecord.attemptNumber}.`,
      metadata: {
        requestId: rejectedRequest.id,
        driverId: actingDriver.id,
        rejectedAt: now,
      },
    });

    io.to('role:ADMIN').emit('admin:driver-rejected', {
      booking: updatedAfterReject,
      request: rejectedRequest,
      driver: updatedDriver,
    });
    io.to('role:ADMIN').emit('admin:driver-response', {
      booking: updatedAfterReject,
      request: rejectedRequest,
      response: 'REJECTED',
    });
    io.to('role:ADMIN').emit('admin:allocation-updated', {
      booking: updatedAfterReject,
      reason: 'DRIVER_REJECTED',
    });
    io.emit('driver:updated', updatedDriver);

    let finalBooking = updatedAfterReject;
    if (canReassign) {
      emitToBookingParticipants(io, updatedAfterReject, 'booking:reassigned', {
        booking: updatedAfterReject,
        stage: 'REASSIGNING' as SearchStage,
        attemptNumber: updatedAfterReject.allocationAttempts || 0,
        message: 'Driver declined request. Reassigning to the next nearest available driver...',
      });
      emitToBookingParticipants(io, updatedAfterReject, 'booking:searching-driver', {
        booking: updatedAfterReject,
        stage: 'REASSIGNING' as SearchStage,
        attemptNumber: updatedAfterReject.allocationAttempts || 0,
        message: 'Sending ride request to the next nearest available driver...',
      });
      const reassigned = await _allocateNextDriverUnlocked(io, booking.id, 'DRIVER_REJECTED_REASSIGN');
      finalBooking = reassigned.booking;
    } else {
      io.emit('ride:updated', updatedAfterReject);
    }

    if (!booking.isDemoScenario && updatedDriver.isOnline && updatedDriver.isAvailable) {
      setImmediate(() => {
        triggerSearchForAvailableDrivers(io, 'DRIVER_REJECTED_OTHER_RIDE', updatedDriver.id).catch(
          (err) => console.error('[RideNexa] Trigger after reject error:', err)
        );
      });
    }

    return {
      booking: finalBooking,
      request: rejectedRequest,
    };
  });
}

export async function handleRequestExpiration(
  io: SocketIOServer,
  requestId: string,
  options?: { isDeliveryTimeout?: boolean }
): Promise<void> {
  const initialReq = store.getDriverRequestById(requestId);
  if (!initialReq || initialReq.status !== 'PENDING') return;

  await store.withBookingLock(initialReq.bookingId, async () => {
    const reqRecord = store.getDriverRequestById(requestId);
    if (!reqRecord || reqRecord.status !== 'PENDING') return;

    clearRequestTimer(reqRecord.id);
    const now = new Date().toISOString();
    const expiredReq = (await store.updateDriverRequest(reqRecord.id, {
      status: 'TIMED_OUT',
      respondedAt: now,
      timedOutAt: now,
    }))!;

    let updatedDrv: DriverRecord | null = null;
    const drv = store.getDriverByUserIdOrId(reqRecord.driverId);
    if (drv) {
      const metrics = computeNextAcceptanceRate(drv, 'TIMED_OUT');
      updatedDrv = await store.updateDriver(drv.id, {
        isAvailable: drv.isOnline,
        ...metrics,
      });
      if (updatedDrv) io.emit('driver:updated', updatedDrv);
    }

    const booking = store.getRideById(reqRecord.bookingId);
    if (!booking || booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || booking.driverId) {
      return;
    }

    const nextExcluded = Array.from(
      new Set([...(booking.excludedDriverIds || []), reqRecord.driverId])
    );
    const settings = store.getSettings();
    const maxReassignments = Math.max(1, settings.maxReassignmentAttempts || 10);
    const canReassign = (booking.reassignmentCount || 0) < maxReassignments;
    const isDeliveryTimeout = Boolean(options?.isDeliveryTimeout);

    const updatedAfterTimeout = (await store.updateRide(booking.id, {
      status: 'SEARCHING_DRIVER',
      allocationStatus: 'SEARCHING_DRIVER',
      searchStage: canReassign ? ('REASSIGNING' as SearchStage) : ('NO_DRIVERS_AVAILABLE' as SearchStage),
      excludedDriverIds: nextExcluded,
      timedOutDriverCount: (booking.timedOutDriverCount || 0) + 1,
      reassignmentCount: canReassign ? (booking.reassignmentCount || 0) + 1 : booking.reassignmentCount || 0,
      lastTimeoutAt: now,
      activeRequestId: undefined,
      allocationReason: isDeliveryTimeout
        ? `Request was not delivered to ${reqRecord.driverName}'s dashboard in time. Reassigning to next nearest available driver.`
        : `Driver ${reqRecord.driverName} timed out without responding. Reassigning to next nearest available driver.`,
    }))!;

    await logRideEvent({
      bookingId: booking.id,
      eventType: isDeliveryTimeout ? 'DRIVER_DELIVERY_TIMEOUT' : 'DRIVER_REQUEST_EXPIRED',
      actorId: 'SYSTEM',
      actorRole: 'SYSTEM',
      status: updatedAfterTimeout.status,
      isDemoScenario: booking.isDemoScenario,
      message: isDeliveryTimeout
        ? `Driver ${reqRecord.driverName}'s dashboard did not acknowledge delivery within ${Math.round(getDeliveryWaitTimeoutMs() / 1000)}s.`
        : `Driver ${reqRecord.driverName} timed out without responding.`,
      metadata: {
        requestId: expiredReq.id,
        driverId: reqRecord.driverId,
        attemptNumber: expiredReq.attemptNumber,
        timedOutAt: now,
        isDeliveryTimeout,
      },
    });

    io.to(`driver:${reqRecord.driverId}`).emit('driver:request-expired', {
      request: expiredReq,
    });
    if (reqRecord.driverUserId) {
      io.to(`user:${reqRecord.driverUserId}`).emit('driver:request-expired', {
        request: expiredReq,
      });
    }

    io.to('role:ADMIN').emit('admin:driver-timeout', {
      booking: updatedAfterTimeout,
      request: expiredReq,
    });
    io.to('role:ADMIN').emit('admin:driver-response', {
      booking: updatedAfterTimeout,
      request: expiredReq,
      response: 'TIMED_OUT',
    });
    io.to('role:ADMIN').emit('admin:allocation-updated', {
      booking: updatedAfterTimeout,
      reason: isDeliveryTimeout ? 'DRIVER_DELIVERY_TIMEOUT' : 'REQUEST_EXPIRED',
    });

    if (canReassign) {
      emitToBookingParticipants(io, updatedAfterTimeout, 'booking:reassigned', {
        booking: updatedAfterTimeout,
        stage: 'REASSIGNING' as SearchStage,
        attemptNumber: updatedAfterTimeout.allocationAttempts || 0,
        message: 'Driver did not respond in time. Sending request to the next nearest available driver...',
      });
      emitToBookingParticipants(io, updatedAfterTimeout, 'booking:searching-driver', {
        booking: updatedAfterTimeout,
        stage: 'REASSIGNING' as SearchStage,
        attemptNumber: updatedAfterTimeout.allocationAttempts || 0,
        message: 'Sending ride request to the next nearest available driver...',
      });
      await _allocateNextDriverUnlocked(
        io,
        booking.id,
        isDeliveryTimeout ? 'DRIVER_DELIVERY_TIMEOUT_REASSIGN' : 'REQUEST_EXPIRED_REASSIGN'
      );
    } else {
      io.emit('ride:updated', updatedAfterTimeout);
    }

    if (!booking.isDemoScenario && !isDeliveryTimeout && updatedDrv && updatedDrv.isOnline && updatedDrv.isAvailable) {
      const releasedId = updatedDrv.id;
      setImmediate(() => {
        triggerSearchForAvailableDrivers(io, 'DRIVER_TIMEOUT_OTHER_RIDE', releasedId).catch((err) =>
          console.error('[RideNexa] Trigger after timeout error:', err)
        );
      });
    }
  });
}

export async function expirePendingRequestsForOfflineDriver(
  io: SocketIOServer,
  driverId: string,
  reason = 'DRIVER_WENT_OFFLINE'
): Promise<number> {
  const pendingForDriver = store.getPendingDriverRequestsForDriver(driverId);
  if (pendingForDriver.length === 0) return 0;

  let expiredCount = 0;
  for (const pending of pendingForDriver) {
    await store.withBookingLock(pending.bookingId, async () => {
      const freshReq = store.getDriverRequestById(pending.id);
      if (!freshReq || freshReq.status !== 'PENDING') return;

      clearRequestTimer(freshReq.id);
      const now = new Date().toISOString();
      const expiredReq = (await store.updateDriverRequest(freshReq.id, {
        status: 'TIMED_OUT',
        respondedAt: now,
        timedOutAt: now,
      }))!;

      const booking = store.getRideById(freshReq.bookingId);
      if (!booking || booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || booking.driverId) {
        return;
      }

      const nextExcluded = Array.from(
        new Set([...(booking.excludedDriverIds || []), freshReq.driverId])
      );
      const settings = store.getSettings();
      const maxReassignments = Math.max(1, settings.maxReassignmentAttempts || 10);
      const canReassign = (booking.reassignmentCount || 0) < maxReassignments;
      const offlineMsg = 'Selected driver went offline. Reassigning to the next nearest available driver...';
      const updatedBooking = (await store.updateRide(booking.id, {
        status: 'SEARCHING_DRIVER',
        allocationStatus: 'SEARCHING_DRIVER',
        searchStage: canReassign ? ('REASSIGNING' as SearchStage) : ('NO_DRIVERS_AVAILABLE' as SearchStage),
        excludedDriverIds: nextExcluded,
        timedOutDriverCount: (booking.timedOutDriverCount || 0) + 1,
        reassignmentCount: canReassign ? (booking.reassignmentCount || 0) + 1 : booking.reassignmentCount || 0,
        lastTimeoutAt: now,
        activeRequestId: undefined,
        allocationReason: offlineMsg,
      }))!;

      await logRideEvent({
        bookingId: booking.id,
        eventType: 'DRIVER_WENT_OFFLINE',
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
        status: updatedBooking.status,
        isDemoScenario: booking.isDemoScenario,
        message: `Driver ${freshReq.driverName} went offline before responding.`,
        metadata: {
          requestId: expiredReq.id,
          driverId: freshReq.driverId,
          reason,
        },
      });

      io.to(`driver:${freshReq.driverId}`).emit('driver:request-expired', {
        request: expiredReq,
      });
      if (freshReq.driverUserId) {
        io.to(`user:${freshReq.driverUserId}`).emit('driver:request-expired', {
          request: expiredReq,
        });
      }

      io.to('role:ADMIN').emit('admin:allocation-updated', {
        booking: updatedBooking,
        reason: 'DRIVER_WENT_OFFLINE',
      });

      if (canReassign) {
        emitToBookingParticipants(io, updatedBooking, 'booking:reassigned', {
          booking: updatedBooking,
          stage: 'REASSIGNING' as SearchStage,
          attemptNumber: updatedBooking.allocationAttempts || 0,
          message: offlineMsg,
        });
        emitToBookingParticipants(io, updatedBooking, 'booking:searching-driver', {
          booking: updatedBooking,
          stage: 'REASSIGNING' as SearchStage,
          attemptNumber: updatedBooking.allocationAttempts || 0,
          message: offlineMsg,
        });
        await _allocateNextDriverUnlocked(io, booking.id, 'DRIVER_WENT_OFFLINE_REASSIGN');
      } else {
        io.emit('ride:updated', updatedBooking);
      }

      expiredCount += 1;
    });
  }
  return expiredCount;
}

export async function continueWaitingBooking(
  io: SocketIOServer,
  params: {
    bookingId: string;
    actorId: string;
    actorRole: UserRole;
    resetExclusions?: boolean;
  }
): Promise<{ booking: RideRecord; request: DriverRequestRecord | null }> {
  return store.withBookingLock(params.bookingId, async () => {
    const booking = store.getRideById(params.bookingId);
    if (!booking) {
      throw new Error('NOT_FOUND: Booking not found.');
    }
    if (params.actorRole === 'PASSENGER' && booking.passengerId !== params.actorId) {
      throw new Error('FORBIDDEN: You can only extend search for your own booking.');
    }
    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED' || booking.driverId) {
      throw new Error('CONFLICT: This booking is no longer searching for a driver.');
    }

    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const waitDeadlineAt = new Date(
      nowDate.getTime() + getMaxBookingWaitSec() * 1000
    ).toISOString();

    await store.updateRide(booking.id, {
      status: 'SEARCHING_DRIVER',
      allocationStatus: 'SEARCHING_DRIVER',
      searchStage: 'SEARCHING',
      searchStartedAt: nowIso,
      lastSearchAt: nowIso,
      waitDeadlineAt,
      exclusionsResetAt: params.resetExclusions ? nowIso : booking.exclusionsResetAt,
      excludedDriverIds: params.resetExclusions ? [] : booking.excludedDriverIds || [],
    });

    await logRideEvent({
      bookingId: booking.id,
      eventType: 'SEARCH_EXTENDED',
      actorId: params.actorId,
      actorRole: params.actorRole,
      status: 'SEARCHING_DRIVER',
      isDemoScenario: booking.isDemoScenario,
      message: `${params.actorRole} extended driver search wait window.`,
    });

    return _allocateNextDriverUnlocked(io, booking.id, 'PASSENGER_CONTINUE_WAITING');
  });
}

const VALID_LIFECYCLE_NEXT: Record<string, RideStatus[]> = {
  DRIVER_ASSIGNED: ['DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'TRIP_STARTED'],
  ASSIGNED: ['DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'TRIP_STARTED', 'EN_ROUTE', 'IN_PROGRESS'],
  DRIVER_ARRIVING: ['DRIVER_ARRIVED', 'TRIP_STARTED'],
  EN_ROUTE: ['DRIVER_ARRIVED', 'TRIP_STARTED', 'IN_PROGRESS'],
  DRIVER_ARRIVED: ['TRIP_STARTED'],
  TRIP_STARTED: ['COMPLETED'],
  IN_PROGRESS: ['COMPLETED'],
};

function normalizeTargetStatus(raw: string): RideStatus {
  if (raw === 'EN_ROUTE') return 'DRIVER_ARRIVING';
  if (raw === 'IN_PROGRESS') return 'TRIP_STARTED';
  return raw as RideStatus;
}

export async function updateBookingLifecycleStatus(
  io: SocketIOServer,
  params: {
    bookingId: string;
    nextStatus: RideStatus;
    actorId: string;
    actorRole: UserRole;
  }
): Promise<RideRecord> {
  return store.withBookingLock(params.bookingId, async () => {
    const booking = store.getRideById(params.bookingId);
    if (!booking) {
      throw new Error('NOT_FOUND: Booking not found.');
    }

    if (params.actorRole === 'DRIVER') {
      const drv = store.getDriverByUserIdOrId(params.actorId);
      if (!drv || booking.driverId !== drv.id) {
        throw new Error('FORBIDDEN: Only the assigned driver can update this trip status.');
      }
    } else if (params.actorRole === 'PASSENGER') {
      throw new Error('FORBIDDEN: Passengers cannot directly advance driver trip stages.');
    }

    const targetStatus = normalizeTargetStatus(params.nextStatus);
    if (booking.status === 'COMPLETED' && targetStatus === 'COMPLETED') {
      throw new Error('CONFLICT: Ride has already been completed.');
    }

    const allowedNext = VALID_LIFECYCLE_NEXT[booking.status] || [];
    if (!allowedNext.includes(targetStatus) && !allowedNext.includes(params.nextStatus)) {
      throw new Error(
        targetStatus === 'COMPLETED'
          ? `CONFLICT: Ride can only be completed while in progress (current status: ${booking.status}).`
          : `CONFLICT: Invalid transition from ${booking.status} to ${targetStatus}.`
      );
    }

    const now = new Date().toISOString();

    if (targetStatus === 'COMPLETED') {
      let newlyIdleDriverId: string | undefined;
      if (booking.driverId) {
        const drv = store.getDriverByUserIdOrId(booking.driverId);
        if (drv) {
          const updatedDrv = await store.updateDriver(drv.id, {
            isAvailable: drv.isOnline,
            ridesCompletedToday: drv.ridesCompletedToday + 1,
            totalRidesCompleted: drv.totalRidesCompleted + 1,
            minutesSinceLastRide: 0,
          });
          if (updatedDrv) {
            io.emit('driver:updated', updatedDrv);
            if (updatedDrv.isOnline && updatedDrv.isAvailable && !updatedDrv.isDemoScenario) {
              newlyIdleDriverId = updatedDrv.id;
            }
          }
        }
      }

      const finalized = await finalizeRidePaymentOnCompletion(
        io,
        booking,
        now,
        params.actorId,
        params.actorRole
      );

      await logRideEvent({
        bookingId: booking.id,
        eventType: 'RIDE_COMPLETED',
        actorId: params.actorId,
        actorRole: params.actorRole,
        status: 'COMPLETED',
        isDemoScenario: booking.isDemoScenario,
        message: `Ride completed. Final fare: ₹${finalized.finalFare} (${finalized.payment.paymentMethod}, Payment: ${finalized.payment.paymentStatus}).`,
        metadata: {
          finalFare: finalized.finalFare,
          paymentId: finalized.payment.id,
          paymentStatus: finalized.payment.paymentStatus,
        },
      });

      emitToBookingParticipants(io, finalized.booking, 'booking:status-updated', {
        booking: finalized.booking,
        payment: finalized.payment,
      });
      emitToBookingParticipants(io, finalized.booking, 'booking:completed', {
        booking: finalized.booking,
        payment: finalized.payment,
      });
      io.to('role:ADMIN').emit('admin:ride-completed', {
        booking: finalized.booking,
        payment: finalized.payment,
      });
      io.emit('ride:updated', finalized.booking);

      // Immediately evaluate waiting rides when the driver finishes a ride and becomes idle
      if (newlyIdleDriverId) {
        setImmediate(() => {
          triggerSearchForAvailableDrivers(io, 'DRIVER_COMPLETED_RIDE', newlyIdleDriverId).catch(
            (err) => console.error('[RideNexa] Trigger after completion error:', err)
          );
        });
      }

      return finalized.booking;
    }

    const patch: Partial<RideRecord> = { status: targetStatus };
    if (targetStatus === 'DRIVER_ARRIVED') patch.arrivedAt = now;
    if (targetStatus === 'TRIP_STARTED') patch.startedAt = now;

    const updated = (await store.updateRide(booking.id, patch))!;

    await logRideEvent({
      bookingId: booking.id,
      eventType: 'BOOKING_STATUS_UPDATED',
      actorId: params.actorId,
      actorRole: params.actorRole,
      status: targetStatus,
      isDemoScenario: booking.isDemoScenario,
      message: `Trip status transitioned from ${booking.status} to ${targetStatus}.`,
    });

    emitToBookingParticipants(io, updated, 'booking:status-updated', { booking: updated });
    io.emit('ride:updated', updated);

    return updated;
  });
}

export async function cancelBooking(
  io: SocketIOServer,
  params: {
    bookingId: string;
    actorId: string;
    actorRole: UserRole;
    reason?: string;
  }
): Promise<{ booking: RideRecord; payment: PaymentRecord | null }> {
  return store.withBookingLock(params.bookingId, async () => {
    const booking = store.getRideById(params.bookingId);
    if (!booking) {
      throw new Error('NOT_FOUND: Booking not found.');
    }
    if (params.actorRole === 'PASSENGER' && booking.passengerId !== params.actorId) {
      throw new Error('FORBIDDEN: You can only cancel your own booking.');
    }
    if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
      throw new Error(`CONFLICT: Booking is already ${booking.status.toLowerCase()}.`);
    }

    const now = new Date().toISOString();

    for (const r of store.getDriverRequestsByBooking(booking.id)) {
      if (r.status === 'PENDING') {
        clearRequestTimer(r.id);
        await store.updateDriverRequest(r.id, { status: 'CANCELLED', respondedAt: now });
        io.to(`driver:${r.driverId}`).emit('driver:request-cancelled', {
          requestId: r.id,
          bookingId: booking.id,
        });
      }
    }

    let releasedDriverId: string | undefined;
    if (booking.driverId) {
      const drv = store.getDriverByUserIdOrId(booking.driverId);
      if (drv) {
        const updatedDrv = await store.updateDriver(drv.id, { isAvailable: drv.isOnline });
        if (updatedDrv) {
          io.emit('driver:updated', updatedDrv);
          if (updatedDrv.isOnline && updatedDrv.isAvailable && !updatedDrv.isDemoScenario) {
            releasedDriverId = updatedDrv.id;
          }
        }
      }
    }

    let updatedPayment = store.getPaymentByRideId(booking.id) || null;
    let nextPaymentStatus = booking.paymentStatus;
    if (updatedPayment && isPaymentPaid(updatedPayment.paymentStatus)) {
      if (updatedPayment.paymentMethod !== 'CASH') {
        const refundRef = `REF-RN-${Date.now().toString(36).toUpperCase()}`;
        updatedPayment = await store.updatePayment(updatedPayment.id, {
          paymentStatus: 'REFUNDED',
          status: 'REFUNDED',
          refundReference: refundRef,
        });
        nextPaymentStatus = 'REFUNDED';
      }
    }

    const updatedBooking = (await store.updateRide(booking.id, {
      status: 'CANCELLED',
      allocationStatus: 'CANCELLED',
      paymentStatus: nextPaymentStatus,
      cancelledAt: now,
      cancellationReason: params.reason?.trim() || `Cancelled by ${params.actorRole.toLowerCase()}`,
      activeRequestId: undefined,
    }))!;

    await logRideEvent({
      bookingId: booking.id,
      eventType: nextPaymentStatus === 'REFUNDED' ? 'BOOKING_CANCELLED_AND_REFUNDED' : 'BOOKING_CANCELLED',
      actorId: params.actorId,
      actorRole: params.actorRole,
      status: 'CANCELLED',
      isDemoScenario: booking.isDemoScenario,
      message:
        nextPaymentStatus === 'REFUNDED'
          ? `Booking cancelled by ${params.actorRole.toLowerCase()} and demo refund (${updatedPayment?.refundReference}) issued.`
          : `Booking cancelled by ${params.actorRole.toLowerCase()} without charge.`,
    });

    emitToBookingParticipants(io, updatedBooking, 'booking:status-updated', {
      booking: updatedBooking,
      payment: updatedPayment,
    });
    if (updatedPayment) {
      io.to('role:ADMIN').emit('admin:payment-updated', {
        booking: updatedBooking,
        payment: updatedPayment,
      });
    }
    io.to('role:ADMIN').emit('admin:allocation-updated', {
      booking: updatedBooking,
      reason: 'BOOKING_CANCELLED',
    });
    io.emit('ride:updated', updatedBooking);

    if (releasedDriverId) {
      setImmediate(() => {
        triggerSearchForAvailableDrivers(io, 'BOOKING_CANCELLED_DRIVER_RELEASED', releasedDriverId).catch(
          (err) => console.error('[RideNexa] Trigger after cancel error:', err)
        );
      });
    }

    return { booking: updatedBooking, payment: updatedPayment };
  });
}

async function runPeriodicSearchSweep(io: SocketIOServer): Promise<void> {
  if (searchLoopInFlight) return;
  searchLoopInFlight = true;
  try {
    const nowMs = Date.now();
    const intervalMs = getSearchIntervalMs();
    const deliveryWaitMs = getDeliveryWaitTimeoutMs();

    // Expire any delivered requests whose acceptance timeout passed, or undelivered requests past delivery window
    for (const pendingReq of store.getPendingDriverRequests()) {
      if (pendingReq.deliveryStatus === 'DELIVERED' && pendingReq.expiresAt) {
        const expMs = new Date(pendingReq.expiresAt).getTime();
        if (Number.isFinite(expMs) && expMs <= nowMs) {
          await handleRequestExpiration(io, pendingReq.id);
        }
      } else if (!pendingReq.isDemoScenario) {
        const createdMs = new Date(pendingReq.createdAt).getTime();
        if (Number.isFinite(createdMs) && nowMs - createdMs > deliveryWaitMs) {
          await handleRequestExpiration(io, pendingReq.id, { isDeliveryTimeout: true });
        }
      }
    }

    const searchingBookings = store
      .getRides()
      .filter(
        (b) =>
          !b.isSimulatedDemo &&
          !b.isDemoScenario &&
          !b.driverId &&
          (b.status === 'CONFIRMED' || b.status === 'SEARCHING_DRIVER') &&
          b.allocationStatus !== 'MAX_WAIT_REACHED'
      )
      .sort(
        (a, b) =>
          new Date(a.searchStartedAt || a.requestedAt).getTime() -
          new Date(b.searchStartedAt || b.requestedAt).getTime()
      );

    for (const b of searchingBookings) {
      if (b.activeRequestId) {
        const reqRecord = store.getDriverRequestById(b.activeRequestId);
        if (reqRecord && isRequestStillLive(reqRecord, nowMs)) {
          continue;
        }
      }

      const deadlinePassed = Boolean(b.waitDeadlineAt && nowMs > new Date(b.waitDeadlineAt).getTime());

      if (b.allocationStatus === 'NO_DRIVERS_AVAILABLE' && !deadlinePassed) {
        const excluded = new Set(b.excludedDriverIds || []);
        const { activeTripDriverIds, busyDriverIdsInPending } = getLiveBusyDriverIds(b.id);
        const hasFreshCandidate = store
          .getDrivers()
          .some((d) => {
            const verification = String(d.verificationStatus || 'APPROVED').trim().toUpperCase();
            return (
              !d.isDemoScenario &&
              Boolean(d.userId) &&
              verification === 'APPROVED' &&
              d.isOnline &&
              !excluded.has(d.id) &&
              !busyDriverIdsInPending.has(d.id) &&
              !activeTripDriverIds.has(d.id)
            );
          });
        if (!hasFreshCandidate) {
          continue;
        }
      }

      const lastMs = b.lastSearchAt ? new Date(b.lastSearchAt).getTime() : 0;
      const shouldCheckNow =
        deadlinePassed ||
        b.allocationStatus === 'WAITING_FOR_DRIVER' ||
        nowMs - lastMs >= intervalMs - 250;

      if (shouldCheckNow && nowMs - lastMs >= intervalMs - 250) {
        await store.withBookingLock(b.id, async () => {
          const fresh = store.getRideById(b.id);
          if (
            !fresh ||
            fresh.driverId ||
            fresh.status === 'CANCELLED' ||
            fresh.status === 'COMPLETED' ||
            fresh.allocationStatus === 'MAX_WAIT_REACHED'
          ) {
            return;
          }
          if (fresh.activeRequestId) {
            const activeReq = store.getDriverRequestById(fresh.activeRequestId);
            if (activeReq && isRequestStillLive(activeReq)) {
              return;
            }
          }
          await _allocateNextDriverUnlocked(io, fresh.id, 'PERIODIC_AVAILABILITY_CHECK');
        });
      }
    }
  } catch (err) {
    console.error('[RideNexa] Continuous search sweep error:', err);
  } finally {
    searchLoopInFlight = false;
  }
}

export function startContinuousDriverSearchLoop(io: SocketIOServer): void {
  if (searchLoopTimer) {
    clearTimeout(searchLoopTimer);
    searchLoopTimer = null;
  }

  const scheduleNextTick = () => {
    searchLoopTimer = setTimeout(async () => {
      await runPeriodicSearchSweep(io);
      scheduleNextTick();
    }, getSearchIntervalMs());
  };

  scheduleNextTick();
}

export async function recoverPendingAllocationsOnStartup(io: SocketIOServer): Promise<void> {
  const pendingReqs = store.getPendingDriverRequests();
  const deliveryWaitMs = getDeliveryWaitTimeoutMs();
  for (const reqRecord of pendingReqs) {
    if (reqRecord.deliveryStatus === 'DELIVERED' && reqRecord.expiresAt) {
      const msLeft = new Date(reqRecord.expiresAt).getTime() - Date.now();
      if (msLeft <= 0) {
        await handleRequestExpiration(io, reqRecord.id);
      } else {
        scheduleRequestExpiration(io, reqRecord);
      }
    } else if (reqRecord.isDemoScenario) {
      await markDriverRequestDelivered(io, reqRecord.id);
    } else {
      const createdMs = new Date(reqRecord.createdAt).getTime();
      if (Number.isFinite(createdMs) && Date.now() - createdMs > deliveryWaitMs) {
        await handleRequestExpiration(io, reqRecord.id, { isDeliveryTimeout: true });
      } else {
        scheduleDeliveryWaitTimeout(io, reqRecord);
      }
    }
  }

  const strandedBookings = store
    .getRides()
    .filter(
      (b) =>
        !b.isSimulatedDemo &&
        !b.isDemoScenario &&
        !b.driverId &&
        (b.status === 'CONFIRMED' || b.status === 'SEARCHING_DRIVER') &&
        b.allocationStatus !== 'MAX_WAIT_REACHED'
    );

  for (const b of strandedBookings) {
    const hasPending = store
      .getDriverRequestsByBooking(b.id)
      .some((r) => isRequestStillLive(r));
    if (!hasPending) {
      await store.withBookingLock(b.id, () =>
        _allocateNextDriverUnlocked(io, b.id, 'SERVER_RESTART_RECOVERY')
      );
    }
  }

  startContinuousDriverSearchLoop(io);
}
