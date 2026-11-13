import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import {
  Coordinates,
  DemoScenarioState,
  DriverRecord,
  DriverRequestRecord,
  EmergencyIncidentRecord,
  PaymentRecord,
  RideRecord,
  SearchStage,
} from '../types/ridenexa';

export interface SosSocketNotification {
  event: string;
  incident?: EmergencyIncidentRecord;
  isDemoScenario?: boolean;
  ts: number;
}

export interface PaymentSocketNotification {
  event: string;
  rideId: string;
  booking?: RideRecord;
  payment?: PaymentRecord;
  paymentStatus?: string;
  ts: number;
}

export interface BookingSocketNotification {
  event: string;
  booking?: RideRecord;
  stage?: SearchStage;
  driverName?: string;
  message?: string;
  attemptNumber?: number;
  ts: number;
}

export interface DriverRequestNotification {
  event: 'new-request' | 'request-updated' | 'request-expired' | 'request-cancelled';
  request?: DriverRequestRecord;
  requestId?: string;
  bookingId?: string;
  timeoutSec?: number;
  ts: number;
}

interface SocketContextValue {
  connected: boolean;
  reconnectCount: number;
  drivers: DriverRecord[];
  isSimulatedFleet: boolean;
  lastRideEvent: { type: 'created' | 'updated'; ride: RideRecord; ts: number } | null;
  lastBookingEvent: BookingSocketNotification | null;
  lastPaymentEvent: PaymentSocketNotification | null;
  lastDriverRequestEvent: DriverRequestNotification | null;
  lastVerificationEvent: { driver: DriverRecord; ts: number } | null;
  lastAdminEvent: { event: string; payload?: unknown; ts: number } | null;
  lastDemoState: DemoScenarioState | null;
  lastSosEvent: SosSocketNotification | null;
  refreshFleet: () => Promise<void>;
  joinBookingRoom: (bookingId: string) => void;
  joinDriverRoom: (driverId?: string) => void;
  ackDriverRequestDelivery: (requestId: string) => void;
  emitDriverLocation: (
    driverId: string,
    coordinates: Coordinates,
    areaName?: string,
    bookingId?: string
  ) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const hasConnectedOnceRef = useRef(false);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [isSimulatedFleet, setIsSimulatedFleet] = useState(true);
  const [lastRideEvent, setLastRideEvent] = useState<{
    type: 'created' | 'updated';
    ride: RideRecord;
    ts: number;
  } | null>(null);
  const [lastBookingEvent, setLastBookingEvent] = useState<BookingSocketNotification | null>(null);
  const [lastPaymentEvent, setLastPaymentEvent] = useState<PaymentSocketNotification | null>(null);
  const [lastDriverRequestEvent, setLastDriverRequestEvent] =
    useState<DriverRequestNotification | null>(null);
  const [lastVerificationEvent, setLastVerificationEvent] = useState<{
    driver: DriverRecord;
    ts: number;
  } | null>(null);
  const [lastAdminEvent, setLastAdminEvent] = useState<{
    event: string;
    payload?: unknown;
    ts: number;
  } | null>(null);
  const [lastDemoState, setLastDemoState] = useState<DemoScenarioState | null>(null);
  const [lastSosEvent, setLastSosEvent] = useState<SosSocketNotification | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const refreshFleet = useCallback(async () => {
    try {
      const res = await fetch('/api/fleet/drivers');
      if (res.ok) {
        const data = (await res.json()) as { drivers: DriverRecord[]; isSimulatedFleet: boolean };
        setDrivers(data.drivers);
        setIsSimulatedFleet(data.isSimulatedFleet);
      }
    } catch {
      // Ignore network hiccup
    }
  }, []);

  useEffect(() => {
    refreshFleet();

    const socket = io({
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 15,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (hasConnectedOnceRef.current) {
        setReconnectCount((c) => c + 1);
      } else {
        hasConnectedOnceRef.current = true;
      }
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('fleet:sync', (payload: { drivers: DriverRecord[]; isSimulatedFleet: boolean }) => {
      setDrivers(payload.drivers);
      setIsSimulatedFleet(payload.isSimulatedFleet);
    });

    socket.on(
      'fleet:positions',
      (payload: { drivers: { id: string; coordinates: Coordinates; isSimulatedLocation: boolean }[] }) => {
        setDrivers((prev) =>
          prev.map((d) => {
            const match = payload.drivers.find((u) => u.id === d.id);
            return match
              ? { ...d, coordinates: match.coordinates, isSimulatedLocation: match.isSimulatedLocation }
              : d;
          })
        );
      }
    );

    socket.on('driver:updated', (updated: DriverRecord) => {
      setDrivers((prev) => {
        if (updated.isDemoScenario || updated.verificationStatus !== 'APPROVED') {
          return prev.filter((d) => d.id !== updated.id);
        }
        const exists = prev.some((d) => d.id === updated.id);
        return exists ? prev.map((d) => (d.id === updated.id ? updated : d)) : [...prev, updated];
      });
    });

    socket.on('driver:verification-updated', (payload: { driver: DriverRecord }) => {
      if (payload?.driver) {
        setLastVerificationEvent({ driver: payload.driver, ts: Date.now() });
      }
    });

    socket.on('ride:created', (ride: RideRecord) => {
      setLastRideEvent({ type: 'created', ride, ts: Date.now() });
    });

    socket.on('ride:updated', (ride: RideRecord) => {
      setLastRideEvent({ type: 'updated', ride, ts: Date.now() });
    });

    const handleBookingNotification =
      (event: string) =>
      (payload: {
        booking?: RideRecord;
        stage?: SearchStage;
        driverName?: string;
        message?: string;
        attemptNumber?: number;
      }) => {
        setLastBookingEvent({
          event,
          booking: payload?.booking,
          stage: payload?.stage,
          driverName: payload?.driverName,
          message: payload?.message,
          attemptNumber: payload?.attemptNumber,
          ts: Date.now(),
        });
      };

    socket.on('booking:confirmed', handleBookingNotification('booking:confirmed'));
    socket.on('booking:checking-drivers', handleBookingNotification('booking:checking-drivers'));
    socket.on('booking:request-sent', handleBookingNotification('booking:request-sent'));
    socket.on('booking:reassigned', handleBookingNotification('booking:reassigned'));
    socket.on('booking:searching-driver', handleBookingNotification('booking:searching-driver'));
    socket.on('booking:driver-assigned', handleBookingNotification('booking:driver-assigned'));
    socket.on('booking:max-wait-reached', handleBookingNotification('booking:max-wait-reached'));
    socket.on(
      'booking:no-drivers-available',
      handleBookingNotification('booking:no-drivers-available')
    );
    socket.on('booking:status-updated', handleBookingNotification('booking:status-updated'));
    socket.on('booking:completed', handleBookingNotification('booking:completed'));

    const handlePaymentNotification =
      (event: string) =>
      (payload: {
        rideId?: string;
        bookingId?: string;
        booking?: RideRecord;
        payment?: PaymentRecord;
        paymentStatus?: string;
      }) => {
        setLastPaymentEvent({
          event,
          rideId: payload?.rideId || payload?.bookingId || payload?.booking?.id || '',
          booking: payload?.booking,
          payment: payload?.payment,
          paymentStatus: payload?.paymentStatus || payload?.payment?.paymentStatus,
          ts: Date.now(),
        });
      };

    [
      'payment:created',
      'payment:processing',
      'payment:success',
      'payment:failed',
      'payment:cash-confirmed',
      'payment:status-updated',
    ].forEach((evt) => {
      socket.on(evt, handlePaymentNotification(evt));
    });

    const handleNewDriverRequest = (payload: {
      request: DriverRequestRecord;
      timeoutSec?: number;
    }) => {
      setLastDriverRequestEvent({
        event: 'new-request',
        request: payload.request,
        timeoutSec: payload.timeoutSec,
        ts: Date.now(),
      });
    };

    socket.on('driver:new-request', handleNewDriverRequest);
    socket.on('driver:ride-request', handleNewDriverRequest);

    const handleUpdatedDriverRequest = (payload: {
      request: DriverRequestRecord;
      timeoutSec?: number;
    }) => {
      setLastDriverRequestEvent({
        event: 'request-updated',
        request: payload.request,
        timeoutSec: payload.timeoutSec,
        ts: Date.now(),
      });
    };

    socket.on('driver:request-updated', handleUpdatedDriverRequest);
    socket.on('driver:request-delivered', handleUpdatedDriverRequest);

    socket.on('driver:request-expired', (payload: { request: DriverRequestRecord }) => {
      setLastDriverRequestEvent({
        event: 'request-expired',
        request: payload.request,
        ts: Date.now(),
      });
    });

    socket.on('driver:request-cancelled', (payload: { requestId: string; bookingId: string }) => {
      setLastDriverRequestEvent({
        event: 'request-cancelled',
        requestId: payload.requestId,
        bookingId: payload.bookingId,
        ts: Date.now(),
      });
    });

    const handleAdminNotification = (event: string) => (payload?: unknown) => {
      setLastAdminEvent({ event, payload, ts: Date.now() });
    };

    [
      'admin:new-booking',
      'admin:payment-updated',
      'admin:driver-response',
      'admin:allocation-updated',
      'admin:ride-completed',
      'admin:driver-registered',
      'admin:driver-documents-updated',
      'admin:driver-verified',
      'admin:allocation-started',
      'admin:allocation-ranked',
      'admin:assignment-created',
      'admin:assignment-accepted',
      'admin:driver-rejected',
      'admin:driver-timeout',
      'admin:driver-available',
      'admin:settings-updated',
    ].forEach((evt) => {
      socket.on(evt, handleAdminNotification(evt));
    });

    socket.on('admin:demo-updated', (state: DemoScenarioState) => {
      setLastDemoState(state);
      setLastAdminEvent({ event: 'admin:demo-updated', payload: state, ts: Date.now() });
    });

    const handleSosNotification =
      (event: string) =>
      (payload: { incident?: EmergencyIncidentRecord; isDemoScenario?: boolean }) => {
        setLastSosEvent({
          event,
          incident: payload?.incident,
          isDemoScenario: payload?.isDemoScenario,
          ts: Date.now(),
        });
      };

    [
      'sos:activated',
      'sos:location-updated',
      'sos:admin-notified',
      'sos:police-notification-submitted',
      'sos:police-notification-acknowledged',
      'sos:status-updated',
      'sos:incident-resolved',
    ].forEach((evt) => {
      socket.on(evt, handleSosNotification(evt));
    });

    return () => {
      socket.disconnect();
    };
  }, [token, refreshFleet]);

  const joinBookingRoom = useCallback((bookingId: string) => {
    if (bookingId) {
      socketRef.current?.emit('booking:join', bookingId);
    }
  }, []);

  const joinDriverRoom = useCallback((driverId?: string) => {
    socketRef.current?.emit('driver:join', driverId);
  }, []);

  const ackDriverRequestDelivery = useCallback((requestId: string) => {
    if (requestId) {
      socketRef.current?.emit('driver:request-delivered', { requestId });
    }
  }, []);

  const emitDriverLocation = useCallback(
    (driverId: string, coordinates: Coordinates, areaName?: string, bookingId?: string) => {
      socketRef.current?.emit('driver:location-update', {
        driverId,
        coordinates,
        areaName,
        bookingId,
      });
    },
    []
  );

  return (
    <SocketContext.Provider
      value={{
        connected,
        reconnectCount,
        drivers,
        isSimulatedFleet,
        lastRideEvent,
        lastBookingEvent,
        lastPaymentEvent,
        lastDriverRequestEvent,
        lastVerificationEvent,
        lastAdminEvent,
        lastDemoState,
        lastSosEvent,
        refreshFleet,
        joinBookingRoom,
        joinDriverRoom,
        ackDriverRequestDelivery,
        emitDriverLocation,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used inside SocketProvider');
  return ctx;
}
