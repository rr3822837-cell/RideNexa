import crypto from 'crypto';
import type { Server as SocketIOServer } from 'socket.io';
import {
  AdminPaymentRow,
  AdminPaymentSummary,
  FareBreakdown,
  GatewayMode,
  PaymentMethod,
  PaymentRecord,
  PaymentStatus,
  RideRecord,
  UserRole,
} from '../src/types/ridenexa.js';
import { calculateDetailedFare, haversineKm } from './algorithms.js';
import { getJwtSecret } from './auth.js';
import { store } from './store.js';

export function isPaymentPaid(status?: string): boolean {
  return status === 'PAID' || status === 'SUCCESS';
}

export function hasRazorpayCredentials(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim()
  );
}

function getSandboxHmacSecret(): string {
  return process.env.SANDBOX_PAYMENT_SECRET?.trim() || `${getJwtSecret()}:ridenexa-sandbox-pay`;
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function signSandboxPayload(payload: string): string {
  return crypto.createHmac('sha256', getSandboxHmacSecret()).update(payload).digest('hex');
}

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return timingSafeHexEqual(expected, signature);
}

export function verifySandboxSignature(
  orderId: string,
  paymentId: string,
  rideId: string,
  amount: number,
  signature: string
): boolean {
  const expected = signSandboxPayload(`${orderId}|${paymentId}|${rideId}|${amount}`);
  return timingSafeHexEqual(expected, signature);
}

export function assertNoSensitiveCredentials(body: Record<string, unknown>): void {
  const forbiddenKeys = [
    'cardNumber',
    'card_number',
    'pan',
    'cvv',
    'cvc',
    'cardCvv',
    'upiPin',
    'upi_pin',
    'pin',
    'mpin',
  ];
  for (const key of forbiddenKeys) {
    if (key in body && body[key] !== undefined && body[key] !== '') {
      throw new Error(
        'Sensitive financial credentials (full card number, CVV, or UPI PIN) must never be collected, transmitted, or stored.'
      );
    }
  }
}

function emitPaymentEvents(
  io: SocketIOServer,
  booking: RideRecord,
  payment: PaymentRecord,
  primaryEvent:
    | 'payment:created'
    | 'payment:processing'
    | 'payment:success'
    | 'payment:failed'
    | 'payment:cash-confirmed'
) {
  const payload = {
    rideId: booking.id,
    bookingId: booking.id,
    booking,
    payment,
    paymentStatus: payment.paymentStatus,
    paymentMethod: payment.paymentMethod,
  };

  const emitToAllTargets = (evt: string) => {
    io.to(`booking:${booking.id}`).emit(evt, payload);
    io.to(`user:${booking.passengerId}`).emit(evt, payload);
    if (booking.driverId) {
      io.to(`driver:${booking.driverId}`).emit(evt, payload);
      const drv = store.getDriverByUserIdOrId(booking.driverId);
      if (drv?.userId) {
        io.to(`user:${drv.userId}`).emit(evt, payload);
      }
    }
    io.to('role:ADMIN').emit(evt, payload);
  };

  emitToAllTargets(primaryEvent);
  if (primaryEvent === 'payment:cash-confirmed') {
    emitToAllTargets('payment:success');
  }
  emitToAllTargets('payment:status-updated');
  io.to('role:ADMIN').emit('admin:payment-updated', payload);
  io.emit('ride:updated', booking);
}

async function logPaymentEvent(params: {
  bookingId: string;
  eventType: string;
  actorId: string;
  actorRole: UserRole | 'SYSTEM';
  status: string;
  message: string;
  isDemoScenario?: boolean;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  return store.createRideEvent({
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
  });
}

export function computeActualRideMetrics(
  booking: RideRecord,
  completedAtIso: string
): {
  actualDistanceKm: number;
  actualDurationMin: number;
  distanceSource: 'ACTUAL_GPS_TRACKED' | 'ROUTE_BASED_ESTIMATE';
  durationSource: 'ACTUAL_TIMED' | 'ROUTE_BASED_ESTIMATE';
} {
  let actualDistanceKm = booking.distanceKm;
  let distanceSource: 'ACTUAL_GPS_TRACKED' | 'ROUTE_BASED_ESTIMATE' = 'ROUTE_BASED_ESTIMATE';

  const startMs = booking.startedAt ? new Date(booking.startedAt).getTime() : 0;
  const endMs = new Date(completedAtIso).getTime();

  const history = store
    .getLocationHistory(booking.driverId, booking.id)
    .filter((pt) => {
      const ts = new Date(pt.timestamp).getTime();
      if (startMs && ts < startMs) return false;
      if (ts > endMs) return false;
      return true;
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (history.length >= 2) {
    let tracked = 0;
    for (let i = 1; i < history.length; i++) {
      tracked += haversineKm(history[i - 1].coordinates, history[i].coordinates);
    }
    if (tracked >= 0.2) {
      actualDistanceKm = Number(tracked.toFixed(2));
      distanceSource = 'ACTUAL_GPS_TRACKED';
    }
  }

  let actualDurationMin = booking.durationMin;
  let durationSource: 'ACTUAL_TIMED' | 'ROUTE_BASED_ESTIMATE' = 'ROUTE_BASED_ESTIMATE';
  if (startMs > 0 && endMs > startMs) {
    const elapsedSec = (endMs - startMs) / 1000;
    if (elapsedSec >= 60) {
      actualDurationMin = Math.max(1, Math.round(elapsedSec / 60));
      durationSource = 'ACTUAL_TIMED';
    }
  }

  return { actualDistanceKm, actualDurationMin, distanceSource, durationSource };
}

export async function finalizeRidePaymentOnCompletion(
  io: SocketIOServer,
  booking: RideRecord,
  completedAtIso: string,
  actorId: string,
  actorRole: UserRole
): Promise<{ booking: RideRecord; payment: PaymentRecord; finalFare: number; breakdown: FareBreakdown }> {
  const settings = store.getSettings();
  const metrics = computeActualRideMetrics(booking, completedAtIso);
  const { totalFare: finalFare, breakdown } = calculateDetailedFare({
    distanceKm: metrics.actualDistanceKm,
    durationMin: metrics.actualDurationMin,
    tier: booking.vehicleTier,
    surgeMultiplier: booking.surgeMultiplier ?? 1,
    poolingOptIn: booking.poolingOptIn,
    pricingConfig: settings.pricingConfig,
    distanceSource: metrics.distanceSource,
    durationSource: metrics.durationSource,
  });

  const method: PaymentMethod = booking.paymentMethod || 'CASH';
  const gatewayMode: GatewayMode =
    method === 'CASH'
      ? 'CASH_SETTLEMENT'
      : hasRazorpayCredentials()
      ? 'RAZORPAY_LIVE'
      : 'SANDBOX_DEMO';

  const now = completedAtIso;
  const existingPayment = store.getPaymentByRideId(booking.id);

  let payment: PaymentRecord;
  if (existingPayment) {
    // Keep idempotent if record existed, never auto-mark as PAID on ride completion
    const nextStatus: PaymentStatus = isPaymentPaid(existingPayment.paymentStatus)
      ? 'PAID'
      : 'PENDING';
    payment = (await store.updatePayment(existingPayment.id, {
      driverId: booking.driverId,
      estimatedFare: booking.estimatedFare,
      finalFare,
      amount: finalFare,
      paymentMethod: method,
      method,
      paymentStatus: nextStatus,
      status: nextStatus,
      gatewayMode,
      fareBreakdown: breakdown,
    }))!;
  } else {
    const paymentId =
      booking.paymentId ||
      `PAY-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    payment = await store.createPayment({
      id: paymentId,
      rideId: booking.id,
      bookingId: booking.id,
      passengerId: booking.passengerId,
      driverId: booking.driverId,
      estimatedFare: booking.estimatedFare,
      finalFare,
      amount: finalFare,
      currency: 'INR',
      paymentMethod: method,
      method,
      paymentStatus: 'PENDING',
      status: 'PENDING',
      transactionReference: `DUE-${paymentId}`,
      gatewayMode,
      fareBreakdown: breakdown,
      createdAt: now,
      updatedAt: now,
    });
  }

  const updatedBooking = (await store.updateRide(booking.id, {
    status: 'COMPLETED',
    completedAt: now,
    actualDistanceKm: metrics.actualDistanceKm,
    actualDurationMin: metrics.actualDurationMin,
    finalFare,
    finalFareBreakdown: breakdown,
    paymentId: payment.id,
    paymentMethod: method,
    paymentStatus: payment.paymentStatus,
  }))!;

  await logPaymentEvent({
    bookingId: booking.id,
    eventType: 'PAYMENT_CREATED',
    actorId,
    actorRole,
    status: payment.paymentStatus,
    isDemoScenario: booking.isDemoScenario,
    message: `Ride completed. Final fare calculated at ₹${finalFare} (${method}). Payment status set to ${payment.paymentStatus}.`,
    metadata: {
      paymentId: payment.id,
      estimatedFare: booking.estimatedFare,
      finalFare,
      paymentMethod: method,
      distanceSource: metrics.distanceSource,
      durationSource: metrics.durationSource,
    },
  });

  emitPaymentEvents(io, updatedBooking, payment, 'payment:created');

  return { booking: updatedBooking, payment, finalFare, breakdown };
}

export async function initiateDigitalPayment(
  io: SocketIOServer,
  params: {
    rideId: string;
    actorId: string;
    actorRole: UserRole;
    paymentMethod?: PaymentMethod;
    accountLabel?: string;
  }
): Promise<{
  payment: PaymentRecord;
  booking: RideRecord;
  gatewayMode: GatewayMode;
  gatewayOrderId: string;
  amount: number;
  currency: 'INR';
  razorpayKeyId?: string;
  sandboxPaymentId?: string;
  sandboxSignature?: string;
  sandboxDisclaimer?: string;
}> {
  return store.withBookingLock(params.rideId, async () => {
    const booking = store.getRideById(params.rideId);
    if (!booking) {
      throw new Error('NOT_FOUND: Ride booking not found.');
    }
    if (params.actorRole === 'PASSENGER' && booking.passengerId !== params.actorId) {
      throw new Error('FORBIDDEN: Only the passenger associated with this ride can initiate payment.');
    }
    if (params.actorRole === 'DRIVER') {
      throw new Error('FORBIDDEN: Drivers cannot initiate passenger digital payments.');
    }
    if (booking.status !== 'COMPLETED') {
      throw new Error(
        `CONFLICT: Payment can only be initiated after the ride is completed (current status: ${booking.status}).`
      );
    }

    const method: PaymentMethod = params.paymentMethod || booking.paymentMethod || 'UPI';
    if (method !== 'UPI' && method !== 'CARD') {
      throw new Error('Only UPI and Card digital payments can be initiated via the online payment gateway.');
    }

    let payment = store.getPaymentByRideId(booking.id);
    if (!payment) {
      const now = new Date().toISOString();
      const amount = booking.finalFare ?? booking.estimatedFare;
      payment = await store.createPayment({
        id: booking.paymentId || `PAY-${Date.now().toString(36).toUpperCase()}`,
        rideId: booking.id,
        bookingId: booking.id,
        passengerId: booking.passengerId,
        driverId: booking.driverId,
        estimatedFare: booking.estimatedFare,
        finalFare: amount,
        amount,
        currency: 'INR',
        paymentMethod: method,
        method,
        paymentStatus: 'PENDING',
        status: 'PENDING',
        transactionReference: `DUE-${booking.id}`,
        gatewayMode: hasRazorpayCredentials() ? 'RAZORPAY_LIVE' : 'SANDBOX_DEMO',
        fareBreakdown: booking.finalFareBreakdown || booking.estimatedFareBreakdown,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (isPaymentPaid(payment.paymentStatus)) {
      throw new Error('CONFLICT: This ride has already been paid. Duplicate payment is not allowed.');
    }

    const amount = payment.finalFare ?? booking.finalFare ?? booking.estimatedFare;
    const useRazorpay = hasRazorpayCredentials();
    let gatewayOrderId = '';
    let gatewayMode: GatewayMode = useRazorpay ? 'RAZORPAY_LIVE' : 'SANDBOX_DEMO';
    let sandboxPaymentId: string | undefined;
    let sandboxSignature: string | undefined;

    if (useRazorpay) {
      const keyId = process.env.RAZORPAY_KEY_ID!.trim();
      const keySecret = process.env.RAZORPAY_KEY_SECRET!.trim();
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const resp = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: Math.round(amount * 100), // paise
          currency: 'INR',
          receipt: booking.id,
          notes: {
            rideId: booking.id,
            passengerId: booking.passengerId,
            paymentMethod: method,
          },
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Payment gateway order creation failed: ${errText.slice(0, 180)}`);
      }
      const orderJson = (await resp.json()) as { id: string };
      gatewayOrderId = orderJson.id;
    } else {
      gatewayMode = 'SANDBOX_DEMO';
      gatewayOrderId = `order_sbx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      sandboxPaymentId = `pay_sbx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      sandboxSignature = signSandboxPayload(
        `${gatewayOrderId}|${sandboxPaymentId}|${booking.id}|${amount}`
      );
    }

    const updatedPayment = (await store.updatePayment(payment.id, {
      paymentMethod: method,
      method,
      paymentStatus: 'PROCESSING',
      status: 'PROCESSING',
      gatewayMode,
      gatewayOrderId,
      accountLabel: params.accountLabel?.trim() || (method === 'UPI' ? 'UPI Checkout' : 'Card Checkout'),
      failureReason: undefined,
    }))!;

    const updatedBooking = (await store.updateRide(booking.id, {
      paymentId: updatedPayment.id,
      paymentMethod: method,
      paymentStatus: 'PROCESSING',
    }))!;

    await logPaymentEvent({
      bookingId: booking.id,
      eventType: 'PAYMENT_PROCESSING',
      actorId: params.actorId,
      actorRole: params.actorRole,
      status: 'PROCESSING',
      isDemoScenario: booking.isDemoScenario,
      message: `Passenger initiated ${method} payment of ₹${amount} (${gatewayMode}, Order: ${gatewayOrderId}).`,
      metadata: {
        paymentId: updatedPayment.id,
        gatewayOrderId,
        gatewayMode,
        amount,
      },
    });

    emitPaymentEvents(io, updatedBooking, updatedPayment, 'payment:processing');

    return {
      payment: updatedPayment,
      booking: updatedBooking,
      gatewayMode,
      gatewayOrderId,
      amount,
      currency: 'INR',
      razorpayKeyId: useRazorpay ? process.env.RAZORPAY_KEY_ID!.trim() : undefined,
      sandboxPaymentId,
      sandboxSignature,
      sandboxDisclaimer: useRazorpay
        ? undefined
        : 'SANDBOX / DEMO GATEWAY: No real money is transferred. Server verifies HMAC signature before marking Paid.',
    };
  });
}

async function creditDriverEarningsOnce(
  io: SocketIOServer,
  booking: RideRecord,
  amount: number
): Promise<void> {
  if (!booking.driverId) return;
  const drv = store.getDriverByUserIdOrId(booking.driverId);
  if (!drv) return;
  const updatedDrv = await store.updateDriver(drv.id, {
    dailyEarnings: (drv.dailyEarnings || 0) + Math.round(amount),
  });
  if (updatedDrv) {
    io.emit('driver:updated', updatedDrv);
  }
}

export async function verifyDigitalPayment(
  io: SocketIOServer,
  params: {
    rideId: string;
    actorId: string;
    actorRole: UserRole;
    paymentMethod?: PaymentMethod;
    gatewayOrderId?: string;
    gatewayPaymentId?: string;
    gatewaySignature?: string;
    simulateOutcome?: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
    accountLabel?: string;
  }
): Promise<{
  verified: boolean;
  alreadyPaid?: boolean;
  booking: RideRecord;
  payment: PaymentRecord;
}> {
  return store.withBookingLock(params.rideId, async () => {
    const booking = store.getRideById(params.rideId);
    if (!booking) {
      throw new Error('NOT_FOUND: Ride booking not found.');
    }
    if (params.actorRole === 'PASSENGER' && booking.passengerId !== params.actorId) {
      throw new Error('FORBIDDEN: You are not authorized to verify payment for this ride.');
    }
    if (params.actorRole === 'DRIVER') {
      throw new Error('FORBIDDEN: Drivers cannot manually verify or mark digital payments as paid.');
    }
    if (booking.status !== 'COMPLETED') {
      throw new Error('CONFLICT: Ride must be completed before settling final payment.');
    }

    const payment = store.getPaymentByRideId(booking.id);
    if (!payment) {
      throw new Error('NOT_FOUND: Payment record not found for this completed ride.');
    }

    // Idempotent guard: never pay twice
    if (isPaymentPaid(payment.paymentStatus)) {
      return { verified: true, alreadyPaid: true, booking, payment };
    }

    const method: PaymentMethod = params.paymentMethod || payment.paymentMethod || booking.paymentMethod || 'UPI';
    if (method === 'CASH') {
      throw new Error('Cash payments must be confirmed by the assigned driver after receiving cash.');
    }

    const amount = payment.finalFare ?? booking.finalFare ?? booking.estimatedFare;

    // Handle explicit sandbox simulation failures / timeouts
    if (
      !hasRazorpayCredentials() &&
      (params.simulateOutcome === 'FAILED' || params.simulateOutcome === 'TIMEOUT')
    ) {
      const reason =
        params.simulateOutcome === 'TIMEOUT'
          ? 'Payment gateway timed out before confirmation. Please retry payment.'
          : `Sandbox ${method} authorization declined by simulated bank/UPI provider.`;
      const failedRef = `TXN-FAIL-${Date.now().toString(36).toUpperCase()}`;

      const failedPayment = (await store.updatePayment(payment.id, {
        paymentMethod: method,
        method,
        paymentStatus: 'FAILED',
        status: 'FAILED',
        transactionId: failedRef,
        transactionReference: failedRef,
        failureReason: reason,
        accountLabel: params.accountLabel?.trim() || payment.accountLabel,
      }))!;

      const updatedBooking = (await store.updateRide(booking.id, {
        paymentStatus: 'FAILED',
        paymentReference: failedRef,
      }))!;

      await logPaymentEvent({
        bookingId: booking.id,
        eventType: 'PAYMENT_FAILED',
        actorId: params.actorId,
        actorRole: params.actorRole,
        status: 'FAILED',
        isDemoScenario: booking.isDemoScenario,
        message: `${method} payment verification failed: ${reason}`,
        metadata: {
          paymentId: failedPayment.id,
          outcome: params.simulateOutcome,
        },
      });

      emitPaymentEvents(io, updatedBooking, failedPayment, 'payment:failed');
      return { verified: false, booking: updatedBooking, payment: failedPayment };
    }

    // Verify order ID & server-side cryptographic signature
    const orderId = params.gatewayOrderId || payment.gatewayOrderId || '';
    const gatewayPaymentId = params.gatewayPaymentId || '';
    const signature = params.gatewaySignature || '';

    if (!orderId || (payment.gatewayOrderId && orderId !== payment.gatewayOrderId)) {
      throw new Error('Invalid or mismatched gatewayOrderId. Initiate payment first.');
    }

    const validSignature = hasRazorpayCredentials()
      ? verifyRazorpaySignature(orderId, gatewayPaymentId, signature)
      : verifySandboxSignature(orderId, gatewayPaymentId, booking.id, amount, signature);

    if (!validSignature) {
      const failedPayment = (await store.updatePayment(payment.id, {
        paymentStatus: 'FAILED',
        status: 'FAILED',
        failureReason: 'Server-side cryptographic signature verification failed.',
      }))!;
      const updatedBooking = (await store.updateRide(booking.id, {
        paymentStatus: 'FAILED',
      }))!;

      await logPaymentEvent({
        bookingId: booking.id,
        eventType: 'PAYMENT_VERIFICATION_REJECTED',
        actorId: params.actorId,
        actorRole: params.actorRole,
        status: 'FAILED',
        isDemoScenario: booking.isDemoScenario,
        message: 'Payment verification rejected due to invalid gateway signature.',
      });

      emitPaymentEvents(io, updatedBooking, failedPayment, 'payment:failed');
      throw new Error('Payment signature verification failed. Payment was NOT marked as Paid.');
    }

    const paidAt = new Date().toISOString();
    const txnId = `TXN-RN-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 5)
      .toUpperCase()}`;

    const verifiedPayment = (await store.updatePayment(payment.id, {
      paymentMethod: method,
      method,
      paymentStatus: 'PAID',
      status: 'PAID',
      transactionId: txnId,
      transactionReference: txnId,
      gatewayOrderId: orderId,
      gatewayPaymentId,
      gatewayReference: gatewayPaymentId || orderId,
      accountLabel: params.accountLabel?.trim() || payment.accountLabel || `${method} Verified`,
      paidAt,
      failureReason: undefined,
    }))!;

    const updatedBooking = (await store.updateRide(booking.id, {
      paymentId: verifiedPayment.id,
      paymentMethod: method,
      paymentStatus: 'PAID',
      paymentReference: txnId,
    }))!;

    await creditDriverEarningsOnce(io, updatedBooking, amount);

    await logPaymentEvent({
      bookingId: booking.id,
      eventType: 'PAYMENT_VERIFIED',
      actorId: params.actorId,
      actorRole: params.actorRole,
      status: 'PAID',
      isDemoScenario: booking.isDemoScenario,
      message: `Verified ₹${amount} ${method} payment (${verifiedPayment.gatewayMode}). Transaction ID: ${txnId}.`,
      metadata: {
        paymentId: verifiedPayment.id,
        transactionId: txnId,
        gatewayOrderId: orderId,
        gatewayPaymentId,
        amount,
      },
    });

    emitPaymentEvents(io, updatedBooking, verifiedPayment, 'payment:success');
    return { verified: true, booking: updatedBooking, payment: verifiedPayment };
  });
}

export async function handleGatewayWebhook(
  io: SocketIOServer,
  params: {
    rawBody: string;
    signatureHeader?: string;
    event: string;
    gatewayOrderId?: string;
    gatewayPaymentId?: string;
    failureReason?: string;
  }
): Promise<{ processed: boolean; status?: string }> {
  const webhookSecret =
    process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || getSandboxHmacSecret();
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(params.rawBody)
    .digest('hex');

  if (!timingSafeHexEqual(expected, params.signatureHeader || '')) {
    throw new Error('FORBIDDEN: Invalid webhook signature.');
  }

  if (!params.gatewayOrderId) {
    return { processed: false };
  }

  const existing = store.getPaymentByGatewayOrderId(params.gatewayOrderId);
  if (!existing) {
    return { processed: false };
  }

  return store.withBookingLock(existing.rideId, async () => {
    const payment = store.getPaymentById(existing.id);
    const booking = store.getRideById(existing.rideId);
    if (!payment || !booking) return { processed: false };

    if (isPaymentPaid(payment.paymentStatus)) {
      return { processed: true, status: 'PAID' };
    }

    if (params.event === 'payment.captured' || params.event === 'order.paid') {
      const paidAt = new Date().toISOString();
      const txnId = `TXN-WH-${Date.now().toString(36).toUpperCase()}`;
      const updatedPayment = (await store.updatePayment(payment.id, {
        paymentStatus: 'PAID',
        status: 'PAID',
        transactionId: txnId,
        transactionReference: txnId,
        gatewayPaymentId: params.gatewayPaymentId,
        gatewayReference: params.gatewayPaymentId || params.gatewayOrderId,
        paidAt,
        failureReason: undefined,
      }))!;
      const updatedBooking = (await store.updateRide(booking.id, {
        paymentStatus: 'PAID',
        paymentReference: txnId,
      }))!;
      await creditDriverEarningsOnce(
        io,
        updatedBooking,
        updatedPayment.finalFare ?? booking.finalFare ?? booking.estimatedFare
      );
      await logPaymentEvent({
        bookingId: booking.id,
        eventType: 'PAYMENT_WEBHOOK_VERIFIED',
        actorId: 'GATEWAY_WEBHOOK',
        actorRole: 'SYSTEM',
        status: 'PAID',
        message: `Webhook verified payment capture (${txnId}).`,
      });
      emitPaymentEvents(io, updatedBooking, updatedPayment, 'payment:success');
      return { processed: true, status: 'PAID' };
    }

    if (params.event === 'payment.failed') {
      const updatedPayment = (await store.updatePayment(payment.id, {
        paymentStatus: 'FAILED',
        status: 'FAILED',
        failureReason: params.failureReason || 'Payment failed via gateway webhook.',
      }))!;
      const updatedBooking = (await store.updateRide(booking.id, {
        paymentStatus: 'FAILED',
      }))!;
      await logPaymentEvent({
        bookingId: booking.id,
        eventType: 'PAYMENT_WEBHOOK_FAILED',
        actorId: 'GATEWAY_WEBHOOK',
        actorRole: 'SYSTEM',
        status: 'FAILED',
        message: updatedPayment.failureReason || 'Payment failed via webhook.',
      });
      emitPaymentEvents(io, updatedBooking, updatedPayment, 'payment:failed');
      return { processed: true, status: 'FAILED' };
    }

    return { processed: false };
  });
}

export async function confirmCashPayment(
  io: SocketIOServer,
  params: {
    rideId: string;
    actorId: string;
    actorRole: UserRole;
  }
): Promise<{ booking: RideRecord; payment: PaymentRecord; alreadyConfirmed?: boolean }> {
  return store.withBookingLock(params.rideId, async () => {
    const booking = store.getRideById(params.rideId);
    if (!booking) {
      throw new Error('NOT_FOUND: Ride booking not found.');
    }

    if (params.actorRole !== 'DRIVER') {
      throw new Error('FORBIDDEN: Only the assigned driver can confirm cash payment receipt.');
    }

    const driver = store.getDriverByUserIdOrId(params.actorId);
    if (!driver || booking.driverId !== driver.id) {
      throw new Error('FORBIDDEN: You are not the assigned driver for this ride.');
    }

    if (booking.status !== 'COMPLETED') {
      throw new Error('CONFLICT: Cash payment can only be confirmed after the ride is completed.');
    }

    if (booking.paymentMethod !== 'CASH') {
      throw new Error(
        `CONFLICT: This ride's payment method is ${booking.paymentMethod || 'digital'}, not Cash.`
      );
    }

    let payment = store.getPaymentByRideId(booking.id);
    if (!payment) {
      const now = new Date().toISOString();
      const amount = booking.finalFare ?? booking.estimatedFare;
      payment = await store.createPayment({
        id: booking.paymentId || `PAY-${Date.now().toString(36).toUpperCase()}`,
        rideId: booking.id,
        bookingId: booking.id,
        passengerId: booking.passengerId,
        driverId: driver.id,
        estimatedFare: booking.estimatedFare,
        finalFare: amount,
        amount,
        currency: 'INR',
        paymentMethod: 'CASH',
        method: 'CASH',
        paymentStatus: 'PENDING',
        status: 'PENDING',
        transactionReference: `DUE-${booking.id}`,
        gatewayMode: 'CASH_SETTLEMENT',
        fareBreakdown: booking.finalFareBreakdown,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Idempotent duplicate confirmation protection
    if (isPaymentPaid(payment.paymentStatus)) {
      return { booking, payment, alreadyConfirmed: true };
    }

    const now = new Date().toISOString();
    const txnId = `TXN-CASH-${Date.now().toString(36).toUpperCase()}`;
    const amount = payment.finalFare ?? booking.finalFare ?? booking.estimatedFare;

    const confirmedPayment = (await store.updatePayment(payment.id, {
      paymentMethod: 'CASH',
      method: 'CASH',
      paymentStatus: 'PAID',
      status: 'PAID',
      transactionId: txnId,
      transactionReference: txnId,
      gatewayMode: 'CASH_SETTLEMENT',
      gatewayReference: `CASH-${driver.id}`,
      paidAt: now,
      cashConfirmedAt: now,
      cashConfirmedBy: driver.id,
      failureReason: undefined,
    }))!;

    const updatedBooking = (await store.updateRide(booking.id, {
      paymentId: confirmedPayment.id,
      paymentMethod: 'CASH',
      paymentStatus: 'PAID',
      paymentReference: txnId,
    }))!;

    await creditDriverEarningsOnce(io, updatedBooking, amount);

    await logPaymentEvent({
      bookingId: booking.id,
      eventType: 'PAYMENT_CASH_CONFIRMED',
      actorId: params.actorId,
      actorRole: 'DRIVER',
      status: 'PAID',
      isDemoScenario: booking.isDemoScenario,
      message: `Driver ${driver.name} confirmed ₹${amount} cash received from passenger. Ref: ${txnId}.`,
      metadata: {
        paymentId: confirmedPayment.id,
        driverId: driver.id,
        amount,
        transactionId: txnId,
      },
    });

    emitPaymentEvents(io, updatedBooking, confirmedPayment, 'payment:cash-confirmed');
    return { booking: updatedBooking, payment: confirmedPayment };
  });
}

export function getAdminPaymentsData(filters?: {
  query?: string;
  method?: string;
  status?: string;
}): { summary: AdminPaymentSummary; payments: AdminPaymentRow[] } {
  const rides = store.getRides().filter((r) => !r.isSimulatedDemo && !r.isDemoScenario);
  const rideMap = new Map(rides.map((r) => [r.id, r]));
  const allPayments = store.getPayments().filter((p) => {
    const ride = rideMap.get(p.rideId || p.bookingId);
    return Boolean(ride);
  });

  const completedRides = rides.filter((r) => r.status === 'COMPLETED');
  const totalCompletedRideFares = completedRides.reduce(
    (sum, r) => sum + (r.finalFare ?? r.estimatedFare ?? 0),
    0
  );

  const paidPayments = allPayments.filter((p) => isPaymentPaid(p.paymentStatus));
  const pendingPayments = allPayments.filter(
    (p) => p.paymentStatus === 'PENDING' || p.paymentStatus === 'PROCESSING'
  );
  const failedPayments = allPayments.filter((p) => p.paymentStatus === 'FAILED');
  const refundedPayments = allPayments.filter((p) => p.paymentStatus === 'REFUNDED');

  const sumAmount = (list: PaymentRecord[]) =>
    list.reduce((sum, p) => sum + (p.finalFare ?? p.amount ?? p.estimatedFare ?? 0), 0);

  const byMethod = {
    CASH: {
      count: allPayments.filter((p) => p.paymentMethod === 'CASH').length,
      collectedAmount: sumAmount(
        paidPayments.filter((p) => p.paymentMethod === 'CASH')
      ),
      pendingAmount: sumAmount(
        pendingPayments.filter((p) => p.paymentMethod === 'CASH')
      ),
    },
    UPI: {
      count: allPayments.filter((p) => p.paymentMethod === 'UPI').length,
      collectedAmount: sumAmount(
        paidPayments.filter((p) => p.paymentMethod === 'UPI')
      ),
      pendingAmount: sumAmount(
        pendingPayments.filter((p) => p.paymentMethod === 'UPI')
      ),
      failedAmount: sumAmount(
        failedPayments.filter((p) => p.paymentMethod === 'UPI')
      ),
    },
    CARD: {
      count: allPayments.filter((p) => p.paymentMethod === 'CARD').length,
      collectedAmount: sumAmount(
        paidPayments.filter((p) => p.paymentMethod === 'CARD')
      ),
      pendingAmount: sumAmount(
        pendingPayments.filter((p) => p.paymentMethod === 'CARD')
      ),
      failedAmount: sumAmount(
        failedPayments.filter((p) => p.paymentMethod === 'CARD')
      ),
    },
  };

  const summary: AdminPaymentSummary = {
    totalCompletedRideFares,
    totalCollectedAmount: sumAmount(paidPayments),
    pendingPaymentsCount: pendingPayments.length,
    pendingPaymentsAmount: sumAmount(pendingPayments),
    failedPaymentsCount: failedPayments.length,
    failedPaymentsAmount: sumAmount(failedPayments),
    refundedPaymentsCount: refundedPayments.length,
    refundedPaymentsAmount: sumAmount(refundedPayments),
    paidCount: paidPayments.length,
    processingCount: allPayments.filter((p) => p.paymentStatus === 'PROCESSING').length,
    byMethod,
  };

  const rows: AdminPaymentRow[] = allPayments.map((p) => {
    const ride = rideMap.get(p.rideId || p.bookingId)!;
    const passengerUser = store.findUserById(p.passengerId);
    return {
      ...p,
      passengerName: passengerUser?.name || ride.passengerName,
      passengerEmail: passengerUser?.email,
      driverName: ride.driverName,
      pickupAddress: ride.pickupAddress,
      destinationAddress: ride.destinationAddress,
      rideStatus: ride.status,
      rideCompletedAt: ride.completedAt,
    };
  });

  const filtered = rows.filter((row) => {
    if (filters?.method && filters.method !== 'ALL' && row.paymentMethod !== filters.method) {
      return false;
    }
    if (filters?.status && filters.status !== 'ALL') {
      if (filters.status === 'PAID' && !isPaymentPaid(row.paymentStatus)) return false;
      else if (filters.status !== 'PAID' && row.paymentStatus !== filters.status) return false;
    }
    if (filters?.query?.trim()) {
      const q = filters.query.trim().toLowerCase();
      return (
        row.rideId.toLowerCase().includes(q) ||
        row.id.toLowerCase().includes(q) ||
        row.passengerName.toLowerCase().includes(q) ||
        (row.passengerEmail || '').toLowerCase().includes(q) ||
        (row.transactionId || '').toLowerCase().includes(q) ||
        (row.driverName || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return { summary, payments: filtered };
}
