import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  History,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  Receipt,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  X,
  XCircle,
} from 'lucide-react';
import { BookingTimelineModal } from '../components/BookingTimelineModal';
import { CityMap } from '../components/CityMap';
import { SosEmergencyPanel } from '../components/SosEmergencyPanel';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { AppRoute, PRESET_LANDMARKS } from '../data/navigation';
import {
  Coordinates,
  FairAllocationResponse,
  FareBreakdown,
  GatewayMode,
  PaymentMethod,
  PaymentRecord,
  PaymentStatus,
  PricingConfig,
  RideRecord,
  RouteOptimizationResponse,
  VehicleTier,
} from '../types/ridenexa';

interface PassengerDashboardProps {
  onNavigate: (route: AppRoute) => void;
}

interface EstimatePayload {
  route: RouteOptimizationResponse;
  allocation: FairAllocationResponse;
  faresByTier: Record<VehicleTier, number>;
  fareBreakdownsByTier?: Record<VehicleTier, FareBreakdown>;
  estimatedDistanceKm: number;
  estimatedDurationMin: number;
  estimatedPickupMin: number;
  surgeMultiplier?: number;
  surgeDisclosure?: string;
  routeSolverType?: 'EXTERNAL_ROUTING' | 'PROTOTYPE_GRAPH_ROUTER';
  pricingConfig?: PricingConfig;
  estimateDisclaimer?: string;
}

interface PassengerPaymentHistoryRow extends PaymentRecord {
  pickupAddress?: string;
  destinationAddress?: string;
  rideStatus?: string;
  vehicleTier?: VehicleTier;
  driverName?: string;
  distanceKm?: number;
  actualDistanceKm?: number;
  durationMin?: number;
  actualDurationMin?: number;
  completedAt?: string;
}

interface InitiatedCheckoutSession {
  ride: RideRecord;
  payment: PaymentRecord;
  gatewayMode: GatewayMode;
  gatewayOrderId: string;
  amount: number;
  currency: 'INR';
  razorpayKeyId?: string;
  sandboxPaymentId?: string;
  sandboxSignature?: string;
  sandboxDisclaimer?: string;
  selectedMethod: 'UPI' | 'CARD';
}

const VEHICLE_TIERS: { id: VehicleTier; name: string; seats: string; desc: string }[] = [
  { id: 'ECO_HATCH', name: 'Eco Hatch', seats: '4 seats', desc: 'Compact urban trips' },
  { id: 'CITY_SEDAN', name: 'City Sedan', seats: '4 seats', desc: 'Comfortable daily commute' },
  { id: 'EV_COMFORT', name: 'EV Comfort', seats: '4 seats', desc: 'Zero-emission electric fleet' },
  { id: 'POOL_SHARE', name: 'Pool Share', seats: '1–2 seats', desc: 'Shared corridor savings' },
];

const PAYMENT_METHODS: {
  id: PaymentMethod;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
}[] = [
  {
    id: 'CASH',
    label: 'Cash',
    subtitle: 'Pay driver after reaching destination',
    icon: <Banknote className="h-4 w-4" />,
  },
  {
    id: 'UPI',
    label: 'UPI',
    subtitle: 'Pay online via UPI after ride',
    icon: <Smartphone className="h-4 w-4" />,
  },
  {
    id: 'CARD',
    label: 'Card',
    subtitle: 'Credit / Debit card after ride',
    icon: <CreditCard className="h-4 w-4" />,
  },
];

function isPaid(status?: string): boolean {
  return status === 'PAID' || status === 'SUCCESS';
}

function formatPaymentBadge(status?: PaymentStatus | string): {
  label: string;
  cls: string;
} {
  if (isPaid(status)) {
    return { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }
  if (status === 'PROCESSING') {
    return { label: 'Processing', cls: 'bg-sky-50 text-sky-700 border-sky-200' };
  }
  if (status === 'FAILED') {
    return { label: 'Failed', cls: 'bg-red-50 text-red-700 border-red-200' };
  }
  if (status === 'REFUNDED') {
    return { label: 'Refunded', cls: 'bg-amber-50 text-amber-800 border-amber-200' };
  }
  return { label: 'Pending', cls: 'bg-amber-50 text-amber-800 border-amber-200' };
}

function formatRideStageLabel(status: string): string {
  if (status === 'TRIP_STARTED' || status === 'IN_PROGRESS') return 'In Progress';
  if (status === 'DRIVER_ARRIVED') return 'Driver Arrived';
  if (status === 'DRIVER_ARRIVING' || status === 'EN_ROUTE') return 'Driver Arriving';
  if (status === 'DRIVER_ASSIGNED' || status === 'ASSIGNED') return 'Driver Assigned';
  if (status === 'SEARCHING_DRIVER') return 'Searching for Driver';
  if (status === 'CONFIRMED') return 'Confirmed';
  return status.replace(/_/g, ' ');
}

const FareBreakdownPanel: React.FC<{
  breakdown?: FareBreakdown;
  isEstimate?: boolean;
}> = ({ breakdown, isEstimate }) => {
  if (!breakdown) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-200">
        <span className="font-semibold text-[#0B1220]">
          {isEstimate ? 'Estimated Fare Breakdown' : 'Final Fare Breakdown'}
        </span>
        <span className="font-mono text-[10px] text-slate-500">
          {breakdown.distanceSource === 'ACTUAL_GPS_TRACKED'
            ? 'GPS Tracked Dist'
            : 'Route-Based Dist'}{' '}
          ·{' '}
          {breakdown.durationSource === 'ACTUAL_TIMED'
            ? 'Timed Duration'
            : 'Route-Based Time'}
        </span>
      </div>
      <div className="flex justify-between text-slate-600">
        <span>Base Fare</span>
        <span className="font-mono text-[#0B1220]">₹{breakdown.baseFare}</span>
      </div>
      <div className="flex justify-between text-slate-600">
        <span>
          Distance ({breakdown.distanceKm} km × ₹{breakdown.perKmRate}/km)
        </span>
        <span className="font-mono text-[#0B1220]">₹{breakdown.distanceCharge}</span>
      </div>
      <div className="flex justify-between text-slate-600">
        <span>
          Time ({breakdown.durationMin} min × ₹{breakdown.perMinRate}/min)
        </span>
        <span className="font-mono text-[#0B1220]">₹{breakdown.timeCharge}</span>
      </div>
      {breakdown.surgeCharge > 0 && (
        <div className="flex justify-between text-amber-800">
          <span>Surge Adjustment ({breakdown.surgeMultiplier}x)</span>
          <span className="font-mono">+₹{breakdown.surgeCharge}</span>
        </div>
      )}
      {breakdown.poolingDiscount > 0 && (
        <div className="flex justify-between text-emerald-700">
          <span>Ride Pooling Savings</span>
          <span className="font-mono">-₹{breakdown.poolingDiscount}</span>
        </div>
      )}
      {breakdown.additionalCharges > 0 && (
        <div className="flex justify-between text-slate-600">
          <span>Platform & Service Fee</span>
          <span className="font-mono text-[#0B1220]">₹{breakdown.additionalCharges}</span>
        </div>
      )}
      {breakdown.minimumFareApplied && (
        <div className="text-[11px] text-slate-500">
          Minimum tier fare floor applied.
        </div>
      )}
      <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold text-[#0B1220]">
        <span>{isEstimate ? 'Estimated Total' : 'Final Fare Due'}</span>
        <span className="font-mono text-sm text-[#009F95]">₹{breakdown.totalFare}</span>
      </div>
    </div>
  );
};

export const PassengerDashboard: React.FC<PassengerDashboardProps> = ({ onNavigate }) => {
  const { user, token, apiFetch } = useAuth();
  const {
    reconnectCount,
    drivers,
    isSimulatedFleet,
    lastRideEvent,
    lastBookingEvent,
    lastPaymentEvent,
    joinBookingRoom,
  } = useSocket();

  const [pickupName, setPickupName] = useState(PRESET_LANDMARKS[0].name);
  const [pickupCoords, setPickupCoords] = useState<Coordinates>(PRESET_LANDMARKS[0].coordinates);
  const [destName, setDestName] = useState(PRESET_LANDMARKS[3].name);
  const [destCoords, setDestCoords] = useState<Coordinates>(PRESET_LANDMARKS[3].coordinates);
  const [mapClickTarget, setMapClickTarget] = useState<'NONE' | 'PICKUP' | 'DESTINATION'>('NONE');

  const [selectedTier, setSelectedTier] = useState<VehicleTier>('EV_COMFORT');
  const [poolingOptIn, setPoolingOptIn] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [estimate, setEstimate] = useState<EstimatePayload | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [confirmingBooking, setConfirmingBooking] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(
    () => `idem-${Date.now().toString(36)}`
  );

  const [bookings, setBookings] = useState<RideRecord[]>([]);
  const [payments, setPayments] = useState<PassengerPaymentHistoryRow[]>([]);
  const [loadingRides, setLoadingRides] = useState(true);
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'COMPLETED' | 'CANCELLED'>('ALL');
  const [historyQuery, setHistoryQuery] = useState('');
  const [timelineBookingId, setTimelineBookingId] = useState<string | null>(null);
  const [receiptRideId, setReceiptRideId] = useState<string | null>(null);

  // Post-Ride Digital Checkout State
  const [checkoutSession, setCheckoutSession] = useState<InitiatedCheckoutSession | null>(null);
  const [checkoutAccountLabel, setCheckoutAccountLabel] = useState('');
  const [initiatingRideId, setInitiatingRideId] = useState<string | null>(null);
  const [verifyingPayment, setVerifyingPayment] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    if (!user) return;
    try {
      const [passengerData, allRidesData, paymentHistoryData] = await Promise.all([
        apiFetch<{ bookings: RideRecord[]; activeBooking: RideRecord | null; payments: PaymentRecord[] }>(
          '/api/passenger/bookings'
        ),
        apiFetch<{ rides: RideRecord[] }>('/api/rides'),
        apiFetch<{ payments: PassengerPaymentHistoryRow[] }>('/api/payments/history'),
      ]);
      const liveIds = new Set(passengerData.bookings.map((b) => b.id));
      const demoFallback = allRidesData.rides.filter((r) => r.isSimulatedDemo && !liveIds.has(r.id));
      setBookings([...passengerData.bookings, ...demoFallback]);
      setPayments(paymentHistoryData.payments || passengerData.payments || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingRides(false);
    }
  }, [apiFetch, user]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    if (reconnectCount > 0) {
      loadBookings();
    }
  }, [reconnectCount, loadBookings]);

  useEffect(() => {
    if (lastRideEvent || lastBookingEvent || lastPaymentEvent) {
      const incomingRide =
        lastBookingEvent?.booking || lastPaymentEvent?.booking || lastRideEvent?.ride;
      if (incomingRide) {
        setBookings((prev) => {
          const exists = prev.some((b) => b.id === incomingRide.id);
          return exists
            ? prev.map((b) => (b.id === incomingRide.id ? incomingRide : b))
            : [incomingRide, ...prev];
        });
      }

      if (
        lastBookingEvent?.event === 'booking:checking-drivers' ||
        lastBookingEvent?.event === 'booking:request-sent' ||
        lastBookingEvent?.event === 'booking:reassigned' ||
        lastBookingEvent?.event === 'booking:searching-driver'
      ) {
        setNotice('Sending ride request...');
      } else if (lastBookingEvent?.event === 'booking:no-drivers-available') {
        setNotice(null);
      } else if (lastBookingEvent?.event === 'booking:max-wait-reached') {
        setNotice(null);
      } else if (lastBookingEvent?.event === 'booking:driver-assigned') {
        setNotice('Driver found! Your ride is confirmed.');
      } else if (lastBookingEvent?.event === 'booking:completed') {
        setNotice('Ride completed! Final fare has been calculated. Complete post-ride payment below.');
      } else if (lastPaymentEvent?.event === 'payment:cash-confirmed') {
        setNotice('Driver confirmed cash payment received. Receipt marked as Paid!');
      } else if (lastPaymentEvent?.event === 'payment:success') {
        setNotice('Payment verified and marked as Paid!');
      } else if (lastPaymentEvent?.event === 'payment:failed') {
        setError(lastPaymentEvent.payment?.failureReason || 'Payment failed. You can retry below.');
      }
      loadBookings();
    }
  }, [lastRideEvent, lastBookingEvent, lastPaymentEvent, loadBookings]);

  const activeBooking = useMemo(
    () =>
      bookings.find(
        (r) =>
          !r.isSimulatedDemo &&
          r.status !== 'COMPLETED' &&
          r.status !== 'CANCELLED'
      ) || null,
    [bookings]
  );

  // Completed ride requiring post-ride settlement (Pending / Processing / Failed)
  const pendingSettlementBooking = useMemo(
    () =>
      bookings.find(
        (r) =>
          !r.isSimulatedDemo &&
          r.status === 'COMPLETED' &&
          !isPaid(r.paymentStatus) &&
          r.paymentStatus !== 'REFUNDED'
      ) || null,
    [bookings]
  );

  useEffect(() => {
    if (activeBooking?.id) {
      joinBookingRoom(activeBooking.id);
    }
    if (pendingSettlementBooking?.id) {
      joinBookingRoom(pendingSettlementBooking.id);
    }
  }, [activeBooking?.id, pendingSettlementBooking?.id, joinBookingRoom]);

  const paymentByRideId = useMemo(() => {
    const map = new Map<string, PassengerPaymentHistoryRow>();
    for (const p of payments) {
      map.set(p.rideId || p.bookingId, p);
    }
    return map;
  }, [payments]);

  const filteredHistory = useMemo(() => {
    return bookings.filter((r) => {
      if (historyFilter !== 'ALL' && r.status !== historyFilter) return false;
      if (historyQuery.trim()) {
        const q = historyQuery.toLowerCase();
        return (
          r.id.toLowerCase().includes(q) ||
          r.pickupAddress.toLowerCase().includes(q) ||
          r.destinationAddress.toLowerCase().includes(q) ||
          (r.driverName || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [bookings, historyFilter, historyQuery]);

  const handleFindRide = async () => {
    setError(null);
    setNotice(null);
    setEstimating(true);
    try {
      const res = await apiFetch<EstimatePayload>('/api/rides/estimate', {
        method: 'POST',
        body: JSON.stringify({
          pickupAddress: pickupName,
          destinationAddress: destName,
          pickupCoords,
          destinationCoords: destCoords,
          vehicleTier: selectedTier,
          efficiencyWeight: 0.55,
          poolingOptIn,
        }),
      });
      setEstimate(res);
      setIdempotencyKey(`idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEstimating(false);
    }
  };

  const handleConfirmBooking = async () => {
    setError(null);
    setNotice(null);
    setConfirmingBooking(true);
    try {
      const res = await apiFetch<{ booking: RideRecord }>('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          pickupAddress: pickupName,
          destinationAddress: destName,
          pickupCoords,
          destinationCoords: destCoords,
          vehicleTier: selectedTier,
          paymentMethod,
          poolingOptIn,
          idempotencyKey,
        }),
      });
      setEstimate(null);
      setBookings((prev) => {
        const exists = prev.some((b) => b.id === res.booking.id);
        return exists
          ? prev.map((b) => (b.id === res.booking.id ? res.booking : b))
          : [res.booking, ...prev];
      });
      joinBookingRoom(res.booking.id);
      setNotice(
        res.booking.driverId
          ? 'Driver found! Your ride is confirmed.'
          : 'Sending ride request...'
      );
      await loadBookings();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirmingBooking(false);
    }
  };

  const handleInitiatePostRidePayment = async (
    ride: RideRecord,
    methodOverride?: 'UPI' | 'CARD'
  ) => {
    const selectedMethod: 'UPI' | 'CARD' =
      methodOverride || (ride.paymentMethod === 'CARD' ? 'CARD' : 'UPI');
    setError(null);
    setNotice(null);
    setInitiatingRideId(ride.id);
    try {
      const res = await apiFetch<{
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
      }>('/api/payments/initiate', {
        method: 'POST',
        body: JSON.stringify({
          rideId: ride.id,
          paymentMethod: selectedMethod,
        }),
      });

      setCheckoutAccountLabel(
        selectedMethod === 'UPI' ? 'passenger@okaxis' : 'Visa •••• Tokenized'
      );

      // If real Razorpay key is present & Checkout SDK is loaded/loadable, support Razorpay modal
      if (res.gatewayMode === 'RAZORPAY_LIVE' && res.razorpayKeyId) {
        const razorpayWin = window as unknown as {
          Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
        };
        if (!razorpayWin.Razorpay) {
          await new Promise<void>((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => resolve();
            document.body.appendChild(script);
          });
        }
        if (razorpayWin.Razorpay) {
          const rzp = new razorpayWin.Razorpay({
            key: res.razorpayKeyId,
            amount: Math.round(res.amount * 100),
            currency: res.currency,
            name: 'RideNexa Mobility',
            description: `Post-ride fare settlement for ${ride.id}`,
            order_id: res.gatewayOrderId,
            handler: async (response: {
              razorpay_payment_id: string;
              razorpay_order_id: string;
              razorpay_signature: string;
            }) => {
              await handleVerifyPostRidePayment(ride.id, selectedMethod, 'SUCCESS', {
                gatewayOrderId: response.razorpay_order_id,
                gatewayPaymentId: response.razorpay_payment_id,
                gatewaySignature: response.razorpay_signature,
              });
            },
          });
          rzp.open();
          await loadBookings();
          return;
        }
      }

      setCheckoutSession({
        ride: res.booking,
        payment: res.payment,
        gatewayMode: res.gatewayMode,
        gatewayOrderId: res.gatewayOrderId,
        amount: res.amount,
        currency: res.currency,
        razorpayKeyId: res.razorpayKeyId,
        sandboxPaymentId: res.sandboxPaymentId,
        sandboxSignature: res.sandboxSignature,
        sandboxDisclaimer: res.sandboxDisclaimer,
        selectedMethod,
      });
      await loadBookings();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInitiatingRideId(null);
    }
  };

  const handleVerifyPostRidePayment = async (
    rideId: string,
    method: 'UPI' | 'CARD',
    simulateOutcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT',
    overrideTokens?: {
      gatewayOrderId: string;
      gatewayPaymentId: string;
      gatewaySignature: string;
    }
  ) => {
    setError(null);
    setNotice(null);
    setVerifyingPayment(true);
    try {
      const payload = {
        rideId,
        paymentMethod: method,
        simulateOutcome,
        gatewayOrderId: overrideTokens?.gatewayOrderId || checkoutSession?.gatewayOrderId,
        gatewayPaymentId: overrideTokens?.gatewayPaymentId || checkoutSession?.sandboxPaymentId,
        gatewaySignature: overrideTokens?.gatewaySignature || checkoutSession?.sandboxSignature,
        accountLabel: checkoutAccountLabel.trim() || `${method} Verified`,
      };

      const authToken =
        (typeof window !== 'undefined' &&
          (window.sessionStorage.getItem('ridenexa_jwt_token') ||
            window.localStorage.getItem('ridenexa_jwt_token'))) ||
        token ||
        '';
      const res = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402 && data.payment) {
          setError(data.payment.failureReason || 'Payment failed. Please retry.');
          setCheckoutSession(null);
          await loadBookings();
          return;
        }
        throw new Error(data.error || 'Payment verification failed.');
      }

      setCheckoutSession(null);
      setNotice(
        `Payment verified! ₹${data.payment?.finalFare ?? data.payment?.amount} paid via ${method} (Txn: ${data.payment?.transactionId || 'Verified'}).`
      );
      await loadBookings();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setVerifyingPayment(false);
    }
  };

  const handleContinueWaiting = async (bookingId: string) => {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/bookings/${bookingId}/continue-waiting`, {
        method: 'POST',
        body: JSON.stringify({ resetExclusions: false }),
      });
      setNotice('Continuing automatic driver search for newly available drivers...');
      await loadBookings();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCancelBooking = async (bookingId: string, customNotice?: string) => {
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ booking: RideRecord; payment: PaymentRecord | null }>(
        `/api/bookings/${bookingId}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: 'Cancelled by passenger from workspace' }),
        }
      );
      setNotice(
        customNotice ||
          (res.booking.paymentStatus === 'REFUNDED'
            ? `Booking ${bookingId} cancelled and refund (${res.payment?.refundReference || 'processed'}) issued.`
            : `Booking ${bookingId} cancelled cleanly without charge.`)
      );
      await loadBookings();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleMapClick = (coords: Coordinates) => {
    if (mapClickTarget === 'PICKUP') {
      setPickupCoords(coords);
      setPickupName(`Map Pin (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`);
      setMapClickTarget('NONE');
      setEstimate(null);
    } else if (mapClickTarget === 'DESTINATION') {
      setDestCoords(coords);
      setDestName(`Map Pin (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`);
      setMapClickTarget('NONE');
      setEstimate(null);
    }
  };

  const availableDriversCount = drivers.filter((d) => d.isOnline && d.isAvailable).length;

  const isSearchingDriver = Boolean(
    activeBooking &&
      (activeBooking.status === 'CONFIRMED' || activeBooking.status === 'SEARCHING_DRIVER')
  );

  // Fallback polling while actively searching/waiting for a driver so newly online drivers & timeouts reflect promptly
  useEffect(() => {
    if (!isSearchingDriver) return;
    const poll = setInterval(() => {
      loadBookings();
    }, 2500);
    return () => clearInterval(poll);
  }, [isSearchingDriver, loadBookings]);

  const handleUsePickupGps = () => {
    setError(null);
    if (!navigator.geolocation) {
      setError('Browser geolocation is unavailable on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: Number(pos.coords.latitude.toFixed(5)),
          lng: Number(pos.coords.longitude.toFixed(5)),
        };
        setPickupCoords(coords);
        setPickupName(`Live GPS (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`);
        setMapClickTarget('NONE');
        setEstimate(null);
        setNotice('Pickup location updated from browser GPS.');
      },
      () => {
        setError('Unable to access browser GPS location. Please select a city landmark or pick on map.');
      }
    );
  };

  const isDriverAssigned =
    activeBooking &&
    [
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVING',
      'DRIVER_ARRIVED',
      'TRIP_STARTED',
      'ASSIGNED',
      'EN_ROUTE',
      'IN_PROGRESS',
    ].includes(activeBooking.status);

  const canPassengerCancel =
    activeBooking &&
    activeBooking.status !== 'TRIP_STARTED' &&
    activeBooking.status !== 'IN_PROGRESS' &&
    activeBooking.status !== 'COMPLETED' &&
    activeBooking.status !== 'CANCELLED';

  const receiptRide = receiptRideId
    ? bookings.find((b) => b.id === receiptRideId) || null
    : null;
  const receiptPayment = receiptRideId ? paymentByRideId.get(receiptRideId) || null : null;

  return (
    <div className="space-y-6">
      {/* Header Summary */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0B1220]">
            Passenger Ride Workspace
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Book rides with upfront fare estimates, intelligent fair-driver allocation, and secure post-ride settlement.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 font-mono tabular-nums">
          <span>{availableDriversCount} available vehicles</span>
          <span aria-hidden="true">·</span>
          <span>{isSimulatedFleet ? 'Simulated fleet locations (Demo)' : 'Live GPS fleet'}</span>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('ridenexa:open-sos'))}
            aria-label="Emergency SOS Assistance"
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 font-sans text-xs font-bold text-white shadow-sm hover:bg-red-700"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>EMERGENCY SOS</span>
          </button>
        </div>
      </div>

      <SosEmergencyPanel
        role="PASSENGER"
        activeRide={activeBooking}
        fallbackCoords={activeBooking?.pickupCoords || pickupCoords}
      />

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* POST-RIDE SETTLEMENT BANNER (when a ride is Completed & Payment is Pending / Processing / Failed) */}
      {pendingSettlementBooking && (
        <div className="rounded-xl border-2 border-[#009F95] bg-white p-6 shadow-sm space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-[#009F95]">
                  POST-RIDE PAYMENT DUE · {pendingSettlementBooking.id}
                </span>
                <span
                  className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                    formatPaymentBadge(pendingSettlementBooking.paymentStatus).cls
                  }`}
                >
                  {formatPaymentBadge(pendingSettlementBooking.paymentStatus).label}
                </span>
              </div>
              <h2 className="mt-1 font-display text-xl font-bold text-[#0B1220]">
                {pendingSettlementBooking.pickupAddress} →{' '}
                {pendingSettlementBooking.destinationAddress}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Completed with {pendingSettlementBooking.driverName || 'Assigned Driver'} · Est.
                Fare ₹{pendingSettlementBooking.estimatedFare} →{' '}
                <strong className="text-[#0B1220]">
                  Final Fare ₹
                  {pendingSettlementBooking.finalFare ?? pendingSettlementBooking.estimatedFare}
                </strong>
              </p>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-xs text-slate-500">Final Fare Due</div>
              <div className="font-mono text-3xl font-bold text-[#009F95] tabular-nums">
                ₹{pendingSettlementBooking.finalFare ?? pendingSettlementBooking.estimatedFare}
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                Selected Method: {pendingSettlementBooking.paymentMethod || 'CASH'}
              </div>
            </div>
          </div>

          <FareBreakdownPanel
            breakdown={
              pendingSettlementBooking.finalFareBreakdown ||
              paymentByRideId.get(pendingSettlementBooking.id)?.fareBreakdown ||
              pendingSettlementBooking.estimatedFareBreakdown
            }
          />

          {pendingSettlementBooking.paymentMethod === 'CASH' ? (
            <div className="flex flex-col justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">
              <div className="flex items-start gap-2.5 text-xs text-amber-950">
                <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div>
                  <div className="text-sm font-bold">Please pay the driver in cash.</div>
                  <div className="mt-0.5 text-amber-900">
                    Hand ₹
                    {pendingSettlementBooking.finalFare ?? pendingSettlementBooking.estimatedFare} to{' '}
                    <strong>{pendingSettlementBooking.driverName || 'your driver'}</strong>. Your
                    receipt will mark as <strong>Paid</strong> once the driver confirms cash
                    received.
                  </div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3.5 py-2 font-mono text-xs font-bold text-amber-800 shrink-0">
                <Clock className="h-3.5 w-3.5" />
                <span>Awaiting Cash Payment</span>
              </span>
            </div>
          ) : (
            <div className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
              <div className="text-xs text-slate-700">
                <div className="font-semibold text-[#0B1220]">
                  Ready for {pendingSettlementBooking.paymentMethod === 'CARD' ? 'Card' : 'UPI'}{' '}
                  Settlement
                </div>
                <p className="mt-0.5 text-slate-500">
                  {pendingSettlementBooking.paymentStatus === 'FAILED'
                    ? paymentByRideId.get(pendingSettlementBooking.id)?.failureReason ||
                      'Previous attempt failed. Retry securely below.'
                    : 'Your final fare is ready. Click Pay Now to verify payment through the backend gateway.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={initiatingRideId === pendingSettlementBooking.id}
                  onClick={() => handleInitiatePostRidePayment(pendingSettlementBooking)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#009F95] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#00867d] disabled:opacity-60"
                >
                  {initiatingRideId === pendingSettlementBooking.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  <span>
                    {pendingSettlementBooking.paymentStatus === 'FAILED'
                      ? `Retry Payment (₹${pendingSettlementBooking.finalFare ?? pendingSettlementBooking.estimatedFare})`
                      : `Pay Now (₹${pendingSettlementBooking.finalFare ?? pendingSettlementBooking.estimatedFare})`}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Booking & Live Map Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5 space-y-5">
          {isSearchingDriver && activeBooking ? (
            /* STATE B: CLEAN PASSENGER REQUEST / CONFIRMATION STATUS */
            (() => {
              const showUnavailableState =
                !confirmingBooking &&
                activeBooking.allocationStatus === 'NO_DRIVERS_AVAILABLE' &&
                activeBooking.searchStage === 'NO_DRIVERS_AVAILABLE';
              const showMaxWaitState =
                !confirmingBooking &&
                activeBooking.allocationStatus === 'MAX_WAIT_REACHED';

              return (
                <div className="rounded-xl border border-[#009F95] bg-white p-6 space-y-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      {!showUnavailableState && !showMaxWaitState ? (
                        <Loader2 className="h-5 w-5 animate-spin text-[#009F95] shrink-0" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                      )}
                      <h2 className="font-display text-lg font-bold text-[#0B1220]">
                        {showUnavailableState || showMaxWaitState
                          ? 'No drivers available right now. Please try again.'
                          : 'Sending ride request...'}
                      </h2>
                    </div>
                    <span className="font-mono text-xs text-slate-500 shrink-0">
                      {activeBooking.id}
                    </span>
                  </div>

                  <div className="space-y-2 border-t border-slate-100 pt-4 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Pickup</span>
                      <span className="font-medium text-right text-[#0B1220]">
                        {activeBooking.pickupAddress}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Destination</span>
                      <span className="font-medium text-right text-[#0B1220]">
                        {activeBooking.destinationAddress}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2 font-mono text-xs tabular-nums">
                      <span className="font-sans text-sm text-slate-500">Estimated Fare</span>
                      <span className="font-semibold text-[#0B1220]">
                        ₹{activeBooking.estimatedFare} · {activeBooking.paymentMethod || 'CASH'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    {(showUnavailableState || showMaxWaitState) && (
                      <button
                        type="button"
                        onClick={() =>
                          handleCancelBooking(
                            activeBooking.id,
                            'Please select your trip and try booking again.'
                          )
                        }
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#009F95] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#00867d]"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Try Again</span>
                      </button>
                    )}
                    {showMaxWaitState && (
                      <button
                        type="button"
                        onClick={() => handleContinueWaiting(activeBooking.id)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-[#0B1220] hover:bg-slate-50"
                      >
                        <span>Continue Waiting</span>
                      </button>
                    )}
                    {!showUnavailableState && !showMaxWaitState && (
                      <button
                        type="button"
                        onClick={() => handleCancelBooking(activeBooking.id)}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3.5 py-2.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Cancel Booking</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })()
          ) : isDriverAssigned && activeBooking ? (
            /* STATE C: DRIVER ASSIGNED & LIVE TRACKING (DURING RIDE — PAYMENT REMAINS PENDING) */
            <div className="rounded-xl border border-[#009F95] bg-white p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-[#009F95]">
                    {activeBooking.status === 'DRIVER_ASSIGNED' || activeBooking.status === 'ASSIGNED'
                      ? 'Driver found! Your ride is confirmed.'
                      : 'Active Trip'}
                  </div>
                  <h2 className="mt-0.5 font-display text-xl font-bold text-[#0B1220]">
                    {activeBooking.status === 'DRIVER_ASSIGNED' || activeBooking.status === 'ASSIGNED'
                      ? 'Driver found! Your ride is confirmed.'
                      : formatRideStageLabel(activeBooking.status)}
                  </h2>
                </div>
                <span className="font-mono text-xs text-slate-500">{activeBooking.id}</span>
              </div>

              {/* 5-Stage Ride Stepper */}
              <div className="grid grid-cols-5 gap-1.5 text-center text-[10px] font-medium">
                {(
                  [
                    { id: 'CONFIRMED', label: 'Confirmed' },
                    { id: 'DRIVER_ASSIGNED', label: 'Assigned' },
                    { id: 'DRIVER_ARRIVING', label: 'Arriving' },
                    { id: 'DRIVER_ARRIVED', label: 'Arrived' },
                    { id: 'TRIP_STARTED', label: 'In Progress' },
                  ] as const
                ).map((step, idx) => {
                  const normalizedStatus =
                    activeBooking.status === 'ASSIGNED'
                      ? 'DRIVER_ASSIGNED'
                      : activeBooking.status === 'EN_ROUTE'
                      ? 'DRIVER_ARRIVING'
                      : activeBooking.status === 'IN_PROGRESS'
                      ? 'TRIP_STARTED'
                      : activeBooking.status;
                  const order = [
                    'CONFIRMED',
                    'DRIVER_ASSIGNED',
                    'DRIVER_ARRIVING',
                    'DRIVER_ARRIVED',
                    'TRIP_STARTED',
                    'COMPLETED',
                  ];
                  const reached = order.indexOf(normalizedStatus) >= idx;
                  return (
                    <div key={step.id} className="space-y-1.5">
                      <div
                        className={`h-1.5 rounded-full ${
                          reached ? 'bg-[#009F95]' : 'bg-slate-200'
                        }`}
                      />
                      <div className={reached ? 'text-[#0B1220] font-semibold' : 'text-slate-400'}>
                        {step.label}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Assigned Driver Card */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-[#0B1220]">
                      {activeBooking.driverName}
                    </div>
                    <div className="text-slate-600">
                      {activeBooking.vehicleModel} ·{' '}
                      <span className="font-mono font-semibold text-[#0B1220]">
                        {activeBooking.plateNumber}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="inline-flex items-center gap-1 font-mono font-bold text-[#0B1220]">
                      <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                      <span>{(activeBooking.driverRating ?? 4.9).toFixed(2)}</span>
                    </div>
                    <div className="font-mono text-[#009F95] font-semibold">
                      ETA {activeBooking.driverEtaMin ?? 4} min
                    </div>
                  </div>
                </div>
                {activeBooking.driverPhone && (
                  <div className="flex items-center gap-1.5 text-slate-600 pt-1 border-t border-slate-200">
                    <Phone className="h-3.5 w-3.5 text-[#009F95]" />
                    <span>Protected contact: {activeBooking.driverPhone}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Pickup</span>
                  <span className="font-medium text-right text-[#0B1220]">
                    {activeBooking.pickupAddress}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Destination</span>
                  <span className="font-medium text-right text-[#0B1220]">
                    {activeBooking.destinationAddress}
                  </span>
                </div>
                <div className="flex justify-between gap-2 font-mono tabular-nums text-xs">
                  <span className="font-sans text-sm text-slate-500">Estimated Fare</span>
                  <span className="font-semibold text-[#0B1220]">
                    ₹{activeBooking.estimatedFare} · {activeBooking.paymentMethod || 'CASH'}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <strong>Post-Ride Payment:</strong> Payment status is{' '}
                  <span className="font-mono font-semibold text-amber-700">Pending</span>. Final
                  fare is calculated and settled after you reach your destination.
                </div>
              </div>

              {activeBooking.allocationReason && (
                <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                  <strong className="text-[#0B1220]">Fair Dispatch Note:</strong>{' '}
                  {activeBooking.allocationReason}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setTimelineBookingId(activeBooking.id)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-[#0B1220] hover:bg-slate-50"
                >
                  <History className="h-3.5 w-3.5" />
                  <span>View Trip Timeline</span>
                </button>
                {canPassengerCancel && (
                  <button
                    type="button"
                    onClick={() => handleCancelBooking(activeBooking.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2.5 text-xs font-semibold text-red-700 hover:bg-red-50 whitespace-nowrap"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Cancel Ride</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('ridenexa:open-sos'))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-700 whitespace-nowrap"
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>SOS</span>
                </button>
              </div>
            </div>
          ) : (
            /* STATE D: PLAN TRIP, VIEW FARE ESTIMATE, CHOOSE PAYMENT METHOD & CONFIRM BOOKING */
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
              <h2 className="font-display text-lg font-bold text-[#0B1220]">Plan Your Trip</h2>

              {/* Pickup Input */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">Pickup Location</label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleUsePickupGps}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#009F95] hover:text-[#00867d]"
                    >
                      <LocateFixed className="h-3 w-3" />
                      <span>Use GPS</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMapClickTarget(mapClickTarget === 'PICKUP' ? 'NONE' : 'PICKUP')}
                      className={`text-xs font-semibold ${
                        mapClickTarget === 'PICKUP'
                          ? 'text-[#009F95]'
                          : 'text-slate-500 hover:text-[#0B1220]'
                      }`}
                    >
                      {mapClickTarget === 'PICKUP' ? 'Click on map now...' : 'Pick on map'}
                    </button>
                  </div>
                </div>
                <select
                  value={PRESET_LANDMARKS.some((l) => l.name === pickupName) ? pickupName : 'CUSTOM'}
                  onChange={(e) => {
                    const lm = PRESET_LANDMARKS.find((l) => l.name === e.target.value);
                    if (lm) {
                      setPickupName(lm.name);
                      setPickupCoords(lm.coordinates);
                      setEstimate(null);
                    }
                  }}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#009F95] focus:outline-none"
                >
                  {PRESET_LANDMARKS.map((lm) => (
                    <option key={lm.id} value={lm.name}>
                      {lm.name} ({lm.area})
                    </option>
                  ))}
                  {!PRESET_LANDMARKS.some((l) => l.name === pickupName) && (
                    <option value="CUSTOM">{pickupName}</option>
                  )}
                </select>
              </div>

              {/* Destination Input */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">Destination</label>
                  <button
                    type="button"
                    onClick={() =>
                      setMapClickTarget(mapClickTarget === 'DESTINATION' ? 'NONE' : 'DESTINATION')
                    }
                    className={`text-xs font-semibold ${
                      mapClickTarget === 'DESTINATION'
                        ? 'text-[#009F95]'
                        : 'text-slate-500 hover:text-[#0B1220]'
                    }`}
                  >
                    {mapClickTarget === 'DESTINATION' ? 'Click on map now...' : 'Pick on map'}
                  </button>
                </div>
                <select
                  value={PRESET_LANDMARKS.some((l) => l.name === destName) ? destName : 'CUSTOM'}
                  onChange={(e) => {
                    const lm = PRESET_LANDMARKS.find((l) => l.name === e.target.value);
                    if (lm) {
                      setDestName(lm.name);
                      setDestCoords(lm.coordinates);
                      setEstimate(null);
                    }
                  }}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#009F95] focus:outline-none"
                >
                  {PRESET_LANDMARKS.map((lm) => (
                    <option key={lm.id} value={lm.name}>
                      {lm.name} ({lm.area})
                    </option>
                  ))}
                  {!PRESET_LANDMARKS.some((l) => l.name === destName) && (
                    <option value="CUSTOM">{destName}</option>
                  )}
                </select>
              </div>

              {/* Vehicle Selection */}
              <div>
                <label className="text-xs font-semibold text-slate-700">Ride Type</label>
                <div className="mt-2 grid grid-cols-2 gap-2.5">
                  {VEHICLE_TIERS.map((tier) => {
                    const tierFare = estimate?.faresByTier[tier.id];
                    const active = selectedTier === tier.id;
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => setSelectedTier(tier.id)}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          active
                            ? 'border-[#009F95] bg-[#009F95]/10'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#0B1220]">{tier.name}</span>
                          {tierFare !== undefined && (
                            <span className="font-mono text-xs font-bold text-[#009F95] tabular-nums">
                              ~₹{tierFare}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {tier.seats} · {tier.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Smart Ride Pooling Opt-In */}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                <input
                  type="checkbox"
                  checked={poolingOptIn}
                  onChange={(e) => {
                    setPoolingOptIn(e.target.checked);
                    setEstimate(null);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#009F95] focus:ring-[#009F95]"
                />
                <div>
                  <div className="font-semibold text-[#0B1220]">
                    Smart Ride Pooling Opt-In (15% corridor discount)
                  </div>
                  <div className="mt-0.5 text-slate-500">
                    Share overlapping city corridors with directionally aligned riders for lower fare & emissions.
                  </div>
                </div>
              </label>

              <button
                type="button"
                onClick={handleFindRide}
                disabled={estimating}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0B1220] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
              >
                <Navigation className="h-4 w-4" />
                <span>{estimating ? 'Calculating Route & Estimate...' : 'Estimate Fare & Find Ride'}</span>
              </button>

              {/* Step 1: Review Estimate, Select Post-Ride Payment Method & Confirm Booking */}
              {estimate && (
                <div className="space-y-4 border-t border-slate-200 pt-5">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg bg-slate-50 p-2.5">
                      <div className="text-[11px] text-slate-500">Est. Distance</div>
                      <div className="font-mono text-sm font-bold text-[#0B1220] tabular-nums">
                        {estimate.estimatedDistanceKm} km
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2.5">
                      <div className="text-[11px] text-slate-500">Est. Time / ETA</div>
                      <div className="font-mono text-sm font-bold text-[#0B1220] tabular-nums">
                        {estimate.estimatedDurationMin}m ({estimate.estimatedPickupMin}m ETA)
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2.5">
                      <div className="text-[11px] text-slate-500">Estimated Fare</div>
                      <div className="font-mono text-sm font-bold text-[#009F95] tabular-nums">
                        ₹{estimate.faresByTier[selectedTier]}
                      </div>
                    </div>
                  </div>

                  {estimate.surgeDisclosure && (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        (estimate.surgeMultiplier || 1) > 1
                          ? 'border-amber-200 bg-amber-50 text-amber-900'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <span className="font-mono font-bold mr-1.5">
                        {estimate.surgeMultiplier ?? 1}x
                      </span>
                      <span>{estimate.surgeDisclosure}</span>
                    </div>
                  )}

                  <FareBreakdownPanel
                    breakdown={estimate.fareBreakdownsByTier?.[selectedTier]}
                    isEstimate
                  />

                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-950">
                    <strong>Estimate Notice:</strong>{' '}
                    {estimate.estimateDisclaimer ||
                      'This amount is an estimate. Full payment is NOT collected now—the final fare may adjust based on completed ride distance & duration and is settled after drop-off.'}
                  </div>

                  {/* Select Payment Method Before Booking */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Select Payment Method (Settled After Ride)
                    </label>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {PAYMENT_METHODS.map((pm) => {
                        const selected = paymentMethod === pm.id;
                        return (
                          <button
                            key={pm.id}
                            type="button"
                            onClick={() => setPaymentMethod(pm.id)}
                            className={`flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-colors ${
                              selected
                                ? 'border-[#009F95] bg-[#009F95]/10'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-[#009F95]">
                              {pm.icon}
                              <span className="text-xs font-bold text-[#0B1220]">{pm.label}</span>
                            </div>
                            <div className="text-[10px] text-slate-500 leading-tight">
                              {pm.subtitle}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleConfirmBooking}
                    disabled={confirmingBooking}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#009F95] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#00867d] disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      {confirmingBooking
                        ? 'Sending ride request...'
                        : `Book Ride · ${paymentMethod} (Pay After Ride)`}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Interactive City Map */}
        <div className="lg:col-span-7 flex flex-col">
          <CityMap
            heightClass="h-[440px] lg:h-full lg:min-h-[540px]"
            drivers={drivers}
            selectedDriverId={activeBooking?.driverId}
            pickup={{
              coordinates: activeBooking ? activeBooking.pickupCoords : pickupCoords,
              label: activeBooking ? activeBooking.pickupAddress : pickupName,
            }}
            destination={{
              coordinates: activeBooking ? activeBooking.destinationCoords : destCoords,
              label: activeBooking ? activeBooking.destinationAddress : destName,
            }}
            routes={
              activeBooking
                ? [
                    {
                      waypoints: activeBooking.routePath,
                      color: '#009F95',
                      weight: 4,
                      label: 'Active Booking Route',
                    },
                  ]
                : estimate
                ? [
                    {
                      waypoints: estimate.route.recommendedRoute.waypoints,
                      color: '#009F95',
                      weight: 4,
                      label: estimate.route.recommendedRoute.name,
                    },
                  ]
                : []
            }
            onMapClick={handleMapClick}
            fitToOverlays={Boolean(estimate || activeBooking)}
          />
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {mapClickTarget !== 'NONE'
                ? `Click anywhere on the map to set ${mapClickTarget.toLowerCase()} point.`
                : 'OpenStreetMap live driver view · Simulated fleet markers update via Socket.IO.'}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('/intelligence')}
              className="inline-flex items-center gap-1 font-semibold text-[#009F95] hover:text-[#00867d]"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Explore Intelligence Hub</span>
            </button>
          </div>
        </div>
      </div>

      {/* PASSENGER PAYMENTS & RECEIPTS SECTION (Section 3) */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#0B1220]">
              Post-Ride Payments & Receipts
            </h2>
            <p className="text-xs text-slate-500">
              View estimated vs final fares, payment statuses (Pending, Processing, Paid, Failed, Refunded), transaction IDs, and itemized breakdowns.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {payments.length} payment record(s)
          </span>
        </div>

        {payments.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-500">
            Payment records are generated automatically when a ride is completed.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 pr-4">Ride ID & Route</th>
                  <th className="py-2.5 pr-4 text-right">Estimated</th>
                  <th className="py-2.5 pr-4 text-right">Final Fare</th>
                  <th className="py-2.5 pr-4">Method</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 pr-4">Transaction ID & Date</th>
                  <th className="py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => {
                  const rideId = p.rideId || p.bookingId;
                  const badge = formatPaymentBadge(p.paymentStatus);
                  const method = p.paymentMethod || p.method;
                  const matchingRide = bookings.find((b) => b.id === rideId);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="py-3 pr-4">
                        <div className="font-mono text-[11px] font-semibold text-[#0B1220]">
                          {rideId}
                        </div>
                        <div className="text-xs text-slate-600 truncate max-w-[240px]">
                          {p.pickupAddress || matchingRide?.pickupAddress || 'Trip'} →{' '}
                          {p.destinationAddress || matchingRide?.destinationAddress || 'Destination'}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-slate-500">
                        ₹{p.estimatedFare ?? matchingRide?.estimatedFare ?? p.amount}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono font-bold tabular-nums text-[#0B1220]">
                        ₹{p.finalFare ?? p.amount}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">{method}</td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-block rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3 pr-4 font-mono text-[11px] text-slate-600">
                        <div>{p.transactionId || p.transactionReference}</div>
                        <div className="text-slate-400">
                          {p.paidAt
                            ? new Date(p.paidAt).toLocaleString()
                            : `Created ${new Date(p.createdAt).toLocaleTimeString()}`}
                        </div>
                      </td>
                      <td className="py-3 text-right whitespace-nowrap space-x-2">
                        {!isPaid(p.paymentStatus) && p.paymentStatus !== 'REFUNDED' && (
                          <>
                            {method === 'CASH' ? (
                              <span className="text-[11px] font-medium text-amber-800">
                                Awaiting Cash Payment
                              </span>
                            ) : (
                              matchingRide && (
                                <button
                                  type="button"
                                  disabled={initiatingRideId === rideId}
                                  onClick={() => handleInitiatePostRidePayment(matchingRide)}
                                  className="rounded-md bg-[#009F95] px-3 py-1 text-xs font-semibold text-white hover:bg-[#00867d] disabled:opacity-60"
                                >
                                  {p.paymentStatus === 'FAILED' ? 'Retry' : 'Pay Now'}
                                </button>
                              )
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setReceiptRideId(rideId)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#0B1220] hover:bg-slate-100"
                        >
                          <Receipt className="h-3 w-3" />
                          <span>Receipt</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Persistent Booking & Trip History Table */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#0B1220]">
              Booking & Ride History
            </h2>
            <p className="text-xs text-slate-500">
              Persistent ride bookings, driver allocation attempts, and complete audit logs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Search booking, route, driver..."
                className="rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-xs focus:border-[#009F95] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(['ALL', 'COMPLETED', 'CANCELLED'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setHistoryFilter(status)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    historyFilter === status
                      ? 'bg-white text-[#0B1220] shadow-sm'
                      : 'text-slate-600 hover:text-[#0B1220]'
                  }`}
                >
                  {status === 'ALL' ? 'All' : status.charAt(0) + status.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loadingRides ? (
          <div className="mt-6 space-y-2">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-slate-200 py-10 text-center">
            <MapPin className="mx-auto h-6 w-6 text-slate-400" />
            <div className="mt-2 text-sm font-semibold text-[#0B1220]">No matching trips found</div>
            <p className="mt-1 text-xs text-slate-500">
              Adjust your search filter or plan a new ride above.
            </p>
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 pr-4">Booking & Route</th>
                  <th className="py-3 pr-4">Driver & Vehicle</th>
                  <th className="py-3 pr-4">Payment</th>
                  <th className="py-3 pr-4">Ride Status</th>
                  <th className="py-3 pr-4 text-right">Fare</th>
                  <th className="py-3 pr-4 text-right">Requested</th>
                  <th className="py-3 text-right">Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                {filteredHistory.map((ride) => {
                  const pBadge = formatPaymentBadge(ride.paymentStatus);
                  return (
                    <tr key={ride.id} className="hover:bg-slate-50/80">
                      <td className="py-3 pr-4">
                        <div className="font-mono text-[11px] text-slate-500">{ride.id}</div>
                        <div className="font-semibold text-[#0B1220]">
                          {ride.pickupAddress} → {ride.destinationAddress}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {ride.isSimulatedDemo
                            ? 'Demo seed record'
                            : `${ride.actualDistanceKm ?? ride.distanceKm} km · ${ride.allocationAttempts ?? 0} allocation attempt(s)`}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-slate-700">
                        {ride.driverName
                          ? `${ride.driverName} · ${ride.vehicleModel || ride.vehicleTier}`
                          : ride.isSimulatedDemo
                          ? 'Simulated Queue'
                          : 'Pending Driver Acceptance'}
                      </td>
                      <td className="py-3 pr-4">
                        {ride.paymentStatus ? (
                          <div className="font-mono text-xs">
                            <span
                              className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${pBadge.cls}`}
                            >
                              {pBadge.label}
                            </span>
                            <div className="mt-0.5 text-[11px] text-slate-400">
                              {ride.paymentMethod || 'CASH'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-medium">
                        <span
                          className={
                            ride.status === 'COMPLETED'
                              ? 'text-emerald-700'
                              : ride.status === 'CANCELLED'
                              ? 'text-red-700'
                              : 'text-[#009F95]'
                          }
                        >
                          {formatRideStageLabel(ride.status)}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right font-mono font-semibold tabular-nums text-[#0B1220]">
                        ₹{ride.finalFare ?? ride.estimatedFare}
                        {ride.finalFare !== undefined && ride.finalFare !== ride.estimatedFare && (
                          <div className="text-[10px] font-normal text-slate-400">
                            Est ₹{ride.estimatedFare}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(ride.requestedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setTimelineBookingId(ride.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#0B1220] hover:bg-slate-100"
                        >
                          <History className="h-3 w-3" />
                          <span>Timeline</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DIGITAL CHECKOUT MODAL (SANDBOX / RAZORPAY VERIFICATION) */}
      {checkoutSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1220]/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-[11px] font-bold text-[#009F95]">
                  {checkoutSession.gatewayMode === 'RAZORPAY_LIVE'
                    ? 'RAZORPAY GATEWAY CHECKOUT'
                    : 'SANDBOX / DEMO GATEWAY CHECKOUT'}
                </div>
                <h3 className="mt-0.5 font-display text-lg font-bold text-[#0B1220]">
                  Complete Post-Ride {checkoutSession.selectedMethod} Payment
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutSession(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-[#0B1220]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {checkoutSession.sandboxDisclaimer && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                <strong>SANDBOX / DEMO MODE:</strong> {checkoutSession.sandboxDisclaimer}
              </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Ride ID</span>
                <span className="font-mono font-semibold text-[#0B1220]">
                  {checkoutSession.ride.id}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Gateway Order ID</span>
                <span className="font-mono text-[11px] text-[#0B1220]">
                  {checkoutSession.gatewayOrderId}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5">
                <span className="font-semibold text-[#0B1220]">Final Fare Payable</span>
                <span className="font-mono text-base font-bold text-[#009F95]">
                  ₹{checkoutSession.amount}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                {checkoutSession.selectedMethod === 'UPI'
                  ? 'UPI Handle / App Label (No UPI PIN collected)'
                  : 'Tokenized Card Label (No card number or CVV collected)'}
              </label>
              <input
                type="text"
                value={checkoutAccountLabel}
                onChange={(e) => setCheckoutAccountLabel(e.target.value)}
                placeholder={
                  checkoutSession.selectedMethod === 'UPI'
                    ? 'e.g. passenger@okaxis'
                    : 'e.g. HDFC Visa •••• 4242'
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#009F95] focus:outline-none"
              />
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={verifyingPayment}
                onClick={() =>
                  handleVerifyPostRidePayment(
                    checkoutSession.ride.id,
                    checkoutSession.selectedMethod,
                    'SUCCESS'
                  )
                }
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#009F95] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#00867d] disabled:opacity-60"
              >
                {verifyingPayment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                <span>
                  {verifyingPayment
                    ? 'Verifying Gateway Signature...'
                    : `Authorize & Pay ₹${checkoutSession.amount}`}
                </span>
              </button>

              {checkoutSession.gatewayMode === 'SANDBOX_DEMO' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={verifyingPayment}
                    onClick={() =>
                      handleVerifyPostRidePayment(
                        checkoutSession.ride.id,
                        checkoutSession.selectedMethod,
                        'FAILED'
                      )
                    }
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
                  >
                    Simulate Failure
                  </button>
                  <button
                    type="button"
                    disabled={verifyingPayment}
                    onClick={() =>
                      handleVerifyPostRidePayment(
                        checkoutSession.ride.id,
                        checkoutSession.selectedMethod,
                        'TIMEOUT'
                      )
                    }
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                  >
                    Simulate Timeout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RECEIPT & BREAKDOWN MODAL */}
      {receiptRideId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1220]/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-xs font-semibold text-[#009F95]">
                  RideNexa Official Fare Receipt
                </div>
                <h3 className="font-display text-lg font-bold text-[#0B1220] font-mono">
                  {receiptRideId}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReceiptRideId(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-[#0B1220]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {receiptPayment && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
                <div>
                  <div className="text-slate-500">Payment Status</div>
                  <div className="mt-0.5 font-mono font-bold text-[#0B1220]">
                    {formatPaymentBadge(receiptPayment.paymentStatus).label} (
                    {receiptPayment.paymentMethod || receiptPayment.method})
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Gateway Mode</div>
                  <div className="mt-0.5 font-mono text-[#0B1220]">
                    {receiptPayment.gatewayMode}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Transaction ID</div>
                  <div className="mt-0.5 font-mono text-[11px] break-all text-[#0B1220]">
                    {receiptPayment.transactionId || receiptPayment.transactionReference}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Confirmation Time</div>
                  <div className="mt-0.5 font-mono text-[11px] text-[#0B1220]">
                    {receiptPayment.paidAt
                      ? new Date(receiptPayment.paidAt).toLocaleString()
                      : 'Not yet settled'}
                  </div>
                </div>
              </div>
            )}

            <FareBreakdownPanel
              breakdown={
                receiptPayment?.fareBreakdown ||
                receiptRide?.finalFareBreakdown ||
                receiptRide?.estimatedFareBreakdown
              }
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setReceiptRideId(null)}
                className="rounded-lg bg-[#0B1220] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Close Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      <BookingTimelineModal
        bookingId={timelineBookingId}
        onClose={() => setTimelineBookingId(null)}
      />
    </div>
  );
};
