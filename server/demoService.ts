import type { Server as SocketIOServer } from 'socket.io';
import { hashPassword } from './auth.js';
import {
  acceptDriverRequest,
  createPendingBooking,
  handleRequestExpiration,
  rejectDriverRequest,
} from './bookingService.js';
import { activateSosEmergency } from './sosService.js';
import { store } from './store.js';
import {
  DemoScenarioState,
  DriverRecord,
  EmergencyCategory,
  UserRole,
} from '../src/types/ridenexa.js';

const DEMO_PASSENGER_ID = 'demo-judge-passenger';
const DEMO_DRIVER_IDS = ['demo-drv-a', 'demo-drv-b', 'demo-drv-c'] as const;

export function getDemoScenarioState(): DemoScenarioState {
  const allDrivers = store.getDrivers().filter((d) => d.isDemoScenario);
  const demoRides = store
    .getRides()
    .filter((r) => r.isDemoScenario)
    .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  const activeBooking = demoRides[0] || null;
  const requests = activeBooking
    ? store.getDriverRequestsByBooking(activeBooking.id)
    : store.getDriverRequests().filter((r) => r.isDemoScenario);
  const rankings = activeBooking
    ? store.getAllocationRankings(activeBooking.id)
    : store.getAllocationRankings().filter((r) => r.isDemoScenario);
  const events = activeBooking
    ? store.getRideEvents(activeBooking.id)
    : store.getRideEvents().filter((e) => e.isDemoScenario);
  const sosIncident =
    store
      .getEmergencyIncidents({ includeDemo: true })
      .find((i) => i.isDemoScenario) || null;

  return {
    active: allDrivers.length > 0,
    loadedAt: allDrivers[0]?.lastUpdatedAt,
    passengerId: allDrivers.length > 0 ? DEMO_PASSENGER_ID : undefined,
    booking: activeBooking,
    sosIncident,
    drivers: allDrivers,
    requests,
    rankings,
    events,
    settings: store.getSettings(),
  };
}

export async function loadDemoScenario(io: SocketIOServer): Promise<DemoScenarioState> {
  await store.removeDemoScenarioData();
  const now = new Date().toISOString();
  const pwHash = await hashPassword('JudgeDemoPass#2026');

  await store.upsertDemoUser({
    id: DEMO_PASSENGER_ID,
    name: 'Diya Nair (Judge Demo)',
    email: 'demo.passenger@ridenexa.local',
    passwordHash: pwHash,
    role: 'PASSENGER',
    phone: '+91 98450 90001',
    createdAt: now,
  });

  const demoDrivers: DriverRecord[] = [
    {
      id: DEMO_DRIVER_IDS[0],
      userId: 'demo-judge-drv-a',
      name: 'Vikram Sethi (Driver A · Closest Busy)',
      vehicleModel: 'Tata Nexon EV',
      vehicleTier: 'EV_COMFORT',
      plateNumber: 'KA-01-DM-1001',
      vehicleCapacity: 4,
      licenseNumber: 'KA01-2019-990001',
      licenseExpiry: '2031-08-30',
      verificationStatus: 'APPROVED',
      verifiedAt: now,
      verifiedBy: 'judge-demo-seed',
      rating: 4.78,
      isOnline: true,
      isAvailable: true,
      coordinates: { lat: 12.9762, lng: 77.6085 }, // ~0.35 km from MG Road
      areaName: 'MG Road Central (0.3 km)',
      ridesCompletedToday: 12,
      totalRidesCompleted: 1840,
      dailyEarnings: 2450,
      minutesSinceLastRide: 4,
      acceptanceRate: 0.9,
      allocationOpportunities: 14,
      acceptedCount: 12,
      rejectedCount: 2,
      timedOutCount: 0,
      isSimulatedLocation: true,
      isDemoScenario: true,
      lastUpdatedAt: now,
    },
    {
      id: DEMO_DRIVER_IDS[1],
      userId: 'demo-judge-drv-b',
      name: 'Ananya Sharma (Driver B · Fair Match)',
      vehicleModel: 'MG ZS EV',
      vehicleTier: 'EV_COMFORT',
      plateNumber: 'KA-03-DM-2002',
      vehicleCapacity: 4,
      licenseNumber: 'KA03-2021-990002',
      licenseExpiry: '2032-11-15',
      verificationStatus: 'APPROVED',
      verifiedAt: now,
      verifiedBy: 'judge-demo-seed',
      rating: 4.96,
      isOnline: true,
      isAvailable: true,
      coordinates: { lat: 12.9718, lng: 77.6145 }, // ~1.1 km from MG Road
      areaName: 'Richmond Circle (1.1 km)',
      ridesCompletedToday: 2,
      totalRidesCompleted: 690,
      dailyEarnings: 420,
      minutesSinceLastRide: 48,
      acceptanceRate: 0.99,
      allocationOpportunities: 2,
      acceptedCount: 2,
      rejectedCount: 0,
      timedOutCount: 0,
      isSimulatedLocation: true,
      isDemoScenario: true,
      lastUpdatedAt: now,
    },
    {
      id: DEMO_DRIVER_IDS[2],
      userId: 'demo-judge-drv-c',
      name: 'Kabir Deshmukh (Driver C · Backup)',
      vehicleModel: 'BYD Atto 3 EV',
      vehicleTier: 'EV_COMFORT',
      plateNumber: 'KA-05-DM-3003',
      vehicleCapacity: 4,
      licenseNumber: 'KA05-2020-990003',
      licenseExpiry: '2031-03-20',
      verificationStatus: 'APPROVED',
      verifiedAt: now,
      verifiedBy: 'judge-demo-seed',
      rating: 4.89,
      isOnline: true,
      isAvailable: true,
      coordinates: { lat: 12.9825, lng: 77.621 }, // ~1.9 km from MG Road
      areaName: 'Ulsoor Lake Sector (1.9 km)',
      ridesCompletedToday: 5,
      totalRidesCompleted: 980,
      dailyEarnings: 980,
      minutesSinceLastRide: 29,
      acceptanceRate: 0.95,
      allocationOpportunities: 6,
      acceptedCount: 5,
      rejectedCount: 1,
      timedOutCount: 0,
      isSimulatedLocation: true,
      isDemoScenario: true,
      lastUpdatedAt: now,
    },
  ];

  for (const drv of demoDrivers) {
    await store.upsertDemoUser({
      id: drv.userId!,
      name: drv.name,
      email: `${drv.id}@ridenexa.local`,
      passwordHash: pwHash,
      role: 'DRIVER',
      phone: '+91 98450 90010',
      createdAt: now,
    });
    await store.upsertDriver(drv);
  }

  const state = getDemoScenarioState();
  io.to('role:ADMIN').emit('admin:demo-updated', state);
  return state;
}

export async function resetDemoScenario(io: SocketIOServer): Promise<DemoScenarioState> {
  await store.removeDemoScenarioData();
  const state = getDemoScenarioState();
  io.to('role:ADMIN').emit('admin:demo-updated', state);
  return state;
}

export async function startDemoScenarioBooking(
  io: SocketIOServer,
  _actor: { id: string; role: UserRole }
): Promise<DemoScenarioState> {
  let state = getDemoScenarioState();
  if (!state.active || state.booking) {
    state = await loadDemoScenario(io);
  }

  await createPendingBooking(io, {
    passengerId: DEMO_PASSENGER_ID,
    passengerName: 'Diya Nair (Judge Demo)',
    pickupAddress: 'MG Road Transit Hub',
    destinationAddress: 'Whitefield Tech Corridor',
    pickupCoords: { lat: 12.9756, lng: 77.6066 },
    destinationCoords: { lat: 12.9698, lng: 77.7499 },
    vehicleTier: 'EV_COMFORT',
    paymentMethod: 'UPI',
    poolingOptIn: true,
    isDemoScenario: true,
  });

  const updated = getDemoScenarioState();
  io.to('role:ADMIN').emit('admin:demo-updated', updated);
  return updated;
}

export async function simulateDemoDriverAction(
  io: SocketIOServer,
  action: 'ACCEPT' | 'REJECT' | 'TIMEOUT',
  actor: { id: string; role: UserRole }
): Promise<DemoScenarioState> {
  const state = getDemoScenarioState();
  if (!state.active || !state.booking) {
    throw new Error('Demo scenario booking has not been started yet. Click "Start Demo" first.');
  }

  const pendingReq = state.requests.find((r) => r.status === 'PENDING');
  if (!pendingReq) {
    throw new Error('No pending driver request exists on the active demo booking.');
  }

  if (action === 'ACCEPT') {
    await acceptDriverRequest(io, {
      requestId: pendingReq.id,
      actorId: actor.id,
      actorRole: actor.role,
    });
  } else if (action === 'REJECT') {
    await rejectDriverRequest(io, {
      requestId: pendingReq.id,
      actorId: actor.id,
      actorRole: actor.role,
    });
  } else {
    await handleRequestExpiration(io, pendingReq.id);
  }

  const updated = getDemoScenarioState();
  io.to('role:ADMIN').emit('admin:demo-updated', updated);
  return updated;
}

export async function triggerDemoSosScenario(
  io: SocketIOServer,
  actor: { id: string; role: UserRole; name?: string },
  options?: {
    emergencyCategory?: EmergencyCategory;
    emergencyDescription?: string;
    gpsAvailable?: boolean;
  }
): Promise<DemoScenarioState> {
  let state = getDemoScenarioState();
  if (!state.active || !state.booking) {
    state = await startDemoScenarioBooking(io, actor);
  }

  // Ensure a demo driver is accepted so ride/vehicle/driver details are populated realistically
  const pendingReq = state.requests.find((r) => r.status === 'PENDING');
  if (pendingReq && !state.booking?.driverId) {
    await acceptDriverRequest(io, {
      requestId: pendingReq.id,
      actorId: actor.id,
      actorRole: actor.role,
    });
    state = getDemoScenarioState();
  }

  const booking = state.booking!;
  const useGps = options?.gpsAvailable !== false;
  const demoCoords = booking.pickupCoords || { lat: 12.9756, lng: 77.6066 };

  await activateSosEmergency(io, {
    actorId: actor.id,
    actorRole: actor.role,
    actorName: booking.passengerName || actor.name || 'Diya Nair (Judge Demo)',
    rideId: booking.id,
    emergencyCategory: options?.emergencyCategory || 'UNSAFE_DRIVING',
    emergencyDescription:
      options?.emergencyDescription?.trim() ||
      'Judge Demo Simulation: Passenger triggered SOS verification check on MG Road → Whitefield corridor.',
    latitude: useGps ? demoCoords.lat : undefined,
    longitude: useGps ? demoCoords.lng : undefined,
    locationAccuracy: useGps ? 12 : undefined,
    isDemoScenario: true,
  });

  const updated = getDemoScenarioState();
  io.to('role:ADMIN').emit('admin:demo-updated', updated);
  return updated;
}

