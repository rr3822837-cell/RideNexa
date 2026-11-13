import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Car,
  Cpu,
  CreditCard,
  Eye,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import { AdminAllocationInspector, AdminDemoCenter } from '../components/AdminDemoCenter';
import { AdminEmergencyMonitor } from '../components/AdminEmergencyMonitor';
import { AdminPaymentManagementView } from '../components/AdminPaymentManagementView';
import {
  AdminDriverManagementView,
  AdminDriverRow,
  AdminDriverVerificationView,
  AdminPassengerManagementView,
  AdminPassengerRow,
  AdminSettingsView,
} from '../components/AdminVerificationViews';
import { BookingTimelineModal } from '../components/BookingTimelineModal';
import { ActivityBarChart, DemandForecastChart } from '../components/Charts';
import { CityMap } from '../components/CityMap';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { AppRoute } from '../data/navigation';
import {
  AdminAnalyticsResponse,
  AdminOperationsSummary,
  AllocationRankingRecord,
  DemoScenarioState,
  DemandForecastResponse,
  DriverRequestRecord,
  PaymentRecord,
  RideEventRecord,
  RidePoolingResponse,
  RideRecord,
  SystemSettingsRecord,
} from '../types/ridenexa';

type AdminSection =
  | 'OVERVIEW'
  | 'VERIFICATION'
  | 'DRIVERS'
  | 'PASSENGERS'
  | 'LIVE_RIDES'
  | 'PAYMENTS'
  | 'EMERGENCY_SOS'
  | 'ALLOCATION'
  | 'DEMO_CENTER'
  | 'DEMAND'
  | 'ZONES'
  | 'POOLING'
  | 'HISTORY'
  | 'ANALYTICS'
  | 'SETTINGS';

interface AdminBookingsResponse {
  bookings: RideRecord[];
  payments: PaymentRecord[];
  driverRequests: DriverRequestRecord[];
  events: RideEventRecord[];
  summary: AdminOperationsSummary;
}

interface AdminOverviewResponse {
  databaseMode: 'MONGODB' | 'LOCAL_DEMO_STORE';
  summary: AdminOperationsSummary;
  driverVerificationCounts: {
    total: number;
    pending: number;
    resubmissionRequired: number;
    approved: number;
    rejected: number;
    suspended: number;
  };
  passengerCount: number;
  pendingVerifications: AdminDriverRow[];
  settings: SystemSettingsRecord;
  demoActive: boolean;
}

interface AdminDashboardProps {
  onNavigate?: (route: AppRoute, options?: { replace?: boolean }) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate }) => {
  const { user, logout, apiFetch } = useAuth();
  const { drivers, lastRideEvent, lastPaymentEvent, lastAdminEvent, lastDemoState, lastSosEvent } =
    useSocket();

  const [section, setSection] = useState<AdminSection>('OVERVIEW');
  const [activeSosCount, setActiveSosCount] = useState(0);
  const [liveSosBanner, setLiveSosBanner] = useState<{
    incidentId: string;
    activatedByName: string;
    activatedByRole: string;
    isDemoScenario?: boolean;
  } | null>(null);
  const [dateFilter, setDateFilter] = useState<'TODAY' | '7_DAYS' | '30_DAYS'>('TODAY');
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalyticsResponse | null>(null);
  const [opsData, setOpsData] = useState<AdminBookingsResponse | null>(null);
  const [adminDrivers, setAdminDrivers] = useState<AdminDriverRow[]>([]);
  const [passengers, setPassengers] = useState<AdminPassengerRow[]>([]);
  const [rankings, setRankings] = useState<AllocationRankingRecord[]>([]);
  const [settings, setSettings] = useState<SystemSettingsRecord | null>(null);
  const [demoState, setDemoState] = useState<DemoScenarioState | null>(null);

  // Intelligence Module Views inside Admin
  const [forecastHorizon, setForecastHorizon] = useState<
    'NOW' | '+1H' | '+3H' | 'MORNING_PEAK' | 'EVENING_PEAK'
  >('+1H');
  const [forecastDayType, setForecastDayType] = useState<'WEEKDAY' | 'WEEKEND'>('WEEKDAY');
  const [forecastWeather, setForecastWeather] = useState<'CLEAR' | 'RAINY'>('CLEAR');
  const [demandForecast, setDemandForecast] = useState<DemandForecastResponse | null>(null);

  const [poolRadiusKm, setPoolRadiusKm] = useState(2.5);
  const [poolMaxDetourPct, setPoolMaxDetourPct] = useState(25);
  const [ridePooling, setRidePooling] = useState<RidePoolingResponse | null>(null);

  // Filters & Modals
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'ACTIVE' | 'SEARCHING' | 'COMPLETED' | 'CANCELLED'
  >('ALL');
  const [historyQuery, setHistoryQuery] = useState('');
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCoreAdminData = useCallback(async () => {
    if (!user || user.role !== 'ADMIN') {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [
        overviewRes,
        analyticsRes,
        bookingsRes,
        driversRes,
        passengersRes,
        allocRes,
        demoRes,
      ] = await Promise.all([
        apiFetch<AdminOverviewResponse>('/api/admin/overview'),
        apiFetch<AdminAnalyticsResponse>(`/api/admin/analytics?dateFilter=${dateFilter}`),
        apiFetch<AdminBookingsResponse>('/api/admin/bookings'),
        apiFetch<{ drivers: AdminDriverRow[] }>('/api/admin/drivers'),
        apiFetch<{ passengers: AdminPassengerRow[] }>('/api/admin/passengers'),
        apiFetch<{
          rankings: AllocationRankingRecord[];
          settings: SystemSettingsRecord;
        }>('/api/admin/allocations'),
        apiFetch<DemoScenarioState>('/api/admin/demo/state'),
      ]);

      const sosRes = await apiFetch<{ activeCount: number }>(
        '/api/admin/emergency-incidents?includeDemo=true'
      ).catch(() => ({ activeCount: 0 }));

      setOverview(overviewRes);
      setAnalytics(analyticsRes);
      setOpsData(bookingsRes);
      setAdminDrivers(driversRes.drivers);
      setPassengers(passengersRes.passengers);
      setRankings(allocRes.rankings);
      setSettings(allocRes.settings);
      setDemoState(demoRes);
      setActiveSosCount(sosRes.activeCount);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, dateFilter, user]);

  const loadForecastAndZones = useCallback(async () => {
    try {
      const res = await apiFetch<DemandForecastResponse>('/api/intelligence/demand-forecast', {
        method: 'POST',
        body: JSON.stringify({
          horizon: forecastHorizon,
          dayType: forecastDayType,
          weather: forecastWeather,
        }),
      });
      setDemandForecast(res);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [apiFetch, forecastHorizon, forecastDayType, forecastWeather]);

  const loadPooling = useCallback(async () => {
    try {
      const res = await apiFetch<RidePoolingResponse>('/api/intelligence/ride-pooling', {
        method: 'POST',
        body: JSON.stringify({
          maxPickupRadiusKm: poolRadiusKm,
          maxDetourPct: poolMaxDetourPct,
        }),
      });
      setRidePooling(res);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [apiFetch, poolRadiusKm, poolMaxDetourPct]);

  useEffect(() => {
    loadCoreAdminData();
  }, [loadCoreAdminData]);

  useEffect(() => {
    if (section === 'DEMAND' || section === 'ZONES') {
      loadForecastAndZones();
    } else if (section === 'POOLING') {
      loadPooling();
    }
  }, [section, loadForecastAndZones, loadPooling]);

  useEffect(() => {
    if (lastRideEvent || lastPaymentEvent || lastAdminEvent) {
      if (lastAdminEvent?.event === 'admin:driver-available') {
        const p = lastAdminEvent.payload as {
          driverName?: string;
          reason?: string;
          waitingBookingsCount?: number;
        } | null;
        if (p?.driverName) {
          setActionNotice(
            `Newly available driver detected: ${p.driverName} (${(p.reason || 'AVAILABLE').replace(/_/g, ' ').toLowerCase()}) — re-evaluating ${p.waitingBookingsCount ?? 1} waiting ride(s).`
          );
        }
      }
      loadCoreAdminData();
    }
  }, [lastRideEvent, lastPaymentEvent, lastAdminEvent, loadCoreAdminData]);

  useEffect(() => {
    if (lastDemoState) {
      setDemoState(lastDemoState);
    }
  }, [lastDemoState]);

  useEffect(() => {
    if (!lastSosEvent?.incident) return;
    if (lastSosEvent.event === 'sos:activated') {
      setLiveSosBanner({
        incidentId: lastSosEvent.incident.incidentId,
        activatedByName: lastSosEvent.incident.activatedByName,
        activatedByRole: lastSosEvent.incident.activatedByRole,
        isDemoScenario: lastSosEvent.incident.isDemoScenario,
      });
    }
    loadCoreAdminData();
  }, [lastSosEvent, loadCoreAdminData]);

  const handleVerifyAction = async (
    driverId: string,
    action: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION' | 'SUSPEND' | 'REACTIVATE',
    reason?: string
  ) => {
    setError(null);
    setActionNotice(null);
    try {
      const res = await apiFetch<{ driver: AdminDriverRow; action: string }>(
        `/api/admin/drivers/${driverId}/verify`,
        {
          method: 'POST',
          body: JSON.stringify({ action, reason }),
        }
      );
      setActionNotice(
        `Driver ${res.driver.name} updated: ${res.driver.verificationStatus.replace(/_/g, ' ')}.`
      );
      await loadCoreAdminData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSaveSettings = async (payload: Partial<SystemSettingsRecord>) => {
    setError(null);
    setActionNotice(null);
    try {
      const res = await apiFetch<{ settings: SystemSettingsRecord }>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setSettings(res.settings);
      setActionNotice('Allocation weights & dispatch settings saved and applied live.');
      await loadCoreAdminData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDemoAction = async (
    endpoint:
      | 'load'
      | 'start'
      | 'simulate-accept'
      | 'simulate-reject'
      | 'simulate-timeout'
      | 'sos-trigger'
      | 'reset'
  ) => {
    setDemoBusy(endpoint);
    setError(null);
    setActionNotice(null);
    try {
      const next = await apiFetch<DemoScenarioState>(`/api/admin/demo/${endpoint}`, {
        method: 'POST',
      });
      setDemoState(next);
      setActionNotice(`Judge Demo action "${endpoint}" executed.`);
      await loadCoreAdminData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDemoBusy(null);
    }
  };

  const filteredBookings = useMemo(() => {
    const list = (opsData?.bookings || []).filter((b) => !b.isDemoScenario);
    const byStatus =
      statusFilter === 'ALL'
        ? list
        : statusFilter === 'SEARCHING'
        ? list.filter(
            (b) =>
              b.status === 'SEARCHING_DRIVER' ||
              b.status === 'CONFIRMED' ||
              b.allocationStatus === 'WAITING_FOR_DRIVER' ||
              b.allocationStatus === 'NO_DRIVERS_AVAILABLE' ||
              b.allocationStatus === 'MAX_WAIT_REACHED'
          )
        : statusFilter === 'ACTIVE'
        ? list.filter((b) =>
            [
              'DRIVER_ASSIGNED',
              'DRIVER_ARRIVING',
              'DRIVER_ARRIVED',
              'TRIP_STARTED',
              'ASSIGNED',
              'EN_ROUTE',
              'IN_PROGRESS',
            ].includes(b.status)
          )
        : statusFilter === 'COMPLETED'
        ? list.filter((b) => b.status === 'COMPLETED')
        : list.filter((b) => b.status === 'CANCELLED');

    const q = historyQuery.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter(
      (b) =>
        b.id.toLowerCase().includes(q) ||
        b.passengerName.toLowerCase().includes(q) ||
        (b.driverName || '').toLowerCase().includes(q) ||
        b.pickupAddress.toLowerCase().includes(q) ||
        b.destinationAddress.toLowerCase().includes(q)
    );
  }, [opsData, statusFilter, historyQuery]);

  if (!user || user.role !== 'ADMIN') {
    return null;
  }

  const ops = opsData?.summary || overview?.summary || analytics?.operationsSummary;
  const pendingVerCount =
    (overview?.driverVerificationCounts.pending || 0) +
    (overview?.driverVerificationCounts.resubmissionRequired || 0);

  const navItems: {
    id: AdminSection;
    label: string;
    icon: React.ReactNode;
    badge?: number | string;
  }[] = [
    { id: 'OVERVIEW', label: 'Overview', icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
    {
      id: 'VERIFICATION',
      label: 'Driver Verification',
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      badge: pendingVerCount > 0 ? pendingVerCount : undefined,
    },
    { id: 'DRIVERS', label: 'Driver Management', icon: <Car className="h-3.5 w-3.5" /> },
    { id: 'PASSENGERS', label: 'Passenger Management', icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'LIVE_RIDES', label: 'Live Ride Monitoring', icon: <Activity className="h-3.5 w-3.5" /> },
    {
      id: 'PAYMENTS',
      label: 'Payment Management',
      icon: <CreditCard className="h-3.5 w-3.5" />,
      badge: ops?.paymentPendingCount ? ops.paymentPendingCount : undefined,
    },
    {
      id: 'EMERGENCY_SOS',
      label: 'Emergency & Safety',
      icon: <ShieldAlert className="h-3.5 w-3.5 text-red-600" />,
      badge: activeSosCount > 0 ? activeSosCount : undefined,
    },
    { id: 'ALLOCATION', label: 'Intelligent Allocation', icon: <Cpu className="h-3.5 w-3.5" /> },
    { id: 'DEMO_CENTER', label: 'Live Demo Center', icon: <Play className="h-3.5 w-3.5" /> },
    { id: 'DEMAND', label: 'Demand Forecasting', icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { id: 'ZONES', label: 'Zone Intelligence', icon: <MapPin className="h-3.5 w-3.5" /> },
    { id: 'POOLING', label: 'Ride Pooling', icon: <Users className="h-3.5 w-3.5" /> },
    { id: 'HISTORY', label: 'Ride History', icon: <History className="h-3.5 w-3.5" /> },
    { id: 'ANALYTICS', label: 'Analytics', icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { id: 'SETTINGS', label: 'Settings', icon: <Settings className="h-3.5 w-3.5" /> },
  ];

  const renderBookingMonitorTable = (title: string, subtitle: string) => (
    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div>
          <h2 className="font-display text-lg font-bold text-[#0B1220]">{title}</h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="Search booking, rider, driver..."
              className="rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-[#009F95] focus:outline-none"
            />
          </div>
          <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'ALL', label: 'All' },
                { id: 'SEARCHING', label: 'Searching' },
                { id: 'ACTIVE', label: 'Active' },
                { id: 'COMPLETED', label: 'Completed' },
                { id: 'CANCELLED', label: 'Cancelled' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  statusFilter === f.id
                    ? 'bg-white text-[#0B1220] shadow-sm'
                    : 'text-slate-600 hover:text-[#0B1220]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {ops && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-mono tabular-nums">
          <div>
            <div className="text-[10px] text-slate-500 font-sans">Searching Rides</div>
            <div className="font-bold text-[#009F95]">{ops.pendingAllocations}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-sans">Available Drivers</div>
            <div className="font-bold text-[#0B1220]">{ops.availableDrivers} free</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-sans">Busy Drivers</div>
            <div className="font-bold text-amber-700">{ops.busyDrivers} on trip</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-sans">Rejected Offers</div>
            <div className="font-bold text-red-700">{ops.driverRejections}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-sans">Timed-Out Offers</div>
            <div className="font-bold text-amber-800">{ops.driverExpirations}</div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
              <th className="py-2.5 pr-3">Booking</th>
              <th className="py-2.5 pr-3">Passenger & Options</th>
              <th className="py-2.5 pr-3">Route</th>
              <th className="py-2.5 pr-3">Payment & Surge</th>
              <th className="py-2.5 pr-3">Driver / Attempts</th>
              <th className="py-2.5 pr-3">Status</th>
              <th className="py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredBookings.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-xs text-slate-500">
                  No bookings match the selected filter.
                </td>
              </tr>
            ) : (
              filteredBookings.slice(0, 30).map((b) => {
                const displayFare = b.finalFare ?? b.estimatedFare;
                const pStatus = b.paymentStatus || 'PENDING';
                const isPaidStatus = pStatus === 'PAID' || pStatus === 'SUCCESS';
                return (
                  <tr key={b.id} className="hover:bg-slate-50/70 align-top">
                    <td className="py-3 pr-3 font-mono text-xs font-semibold text-[#0B1220]">
                      <div>{b.id}</div>
                      <div className="text-[11px] font-normal text-slate-400">
                        {new Date(b.requestedAt).toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-[#0B1220]">{b.passengerName}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {b.vehicleTier.replace('_', ' ')}
                        {b.poolingOptIn ? ' · Pooled' : ''}
                      </div>
                    </td>
                    <td className="py-3 pr-3 max-w-[220px]">
                      <div className="truncate font-medium text-[#0B1220]">{b.pickupAddress}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        → {b.destinationAddress}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-mono font-semibold text-[#0B1220] tabular-nums">
                        ₹{displayFare}{' '}
                        {(b.surgeMultiplier || 1) > 1 && (
                          <span className="text-[11px] text-amber-700">
                            ({b.surgeMultiplier}x)
                          </span>
                        )}
                      </div>
                      {b.finalFare !== undefined && b.finalFare !== b.estimatedFare && (
                        <div className="text-[10px] font-mono text-slate-400">
                          Est ₹{b.estimatedFare}
                        </div>
                      )}
                      <div className="text-[11px] font-mono text-slate-500">
                        {b.paymentMethod || 'N/A'} ·{' '}
                        <span
                          className={
                            isPaidStatus
                              ? 'text-emerald-700 font-semibold'
                              : pStatus === 'FAILED'
                              ? 'text-red-600 font-semibold'
                              : pStatus === 'PROCESSING'
                              ? 'text-sky-700 font-semibold'
                              : pStatus === 'REFUNDED'
                              ? 'text-amber-700 font-semibold'
                              : 'text-amber-700 font-semibold'
                          }
                        >
                          {pStatus === 'SUCCESS' ? 'PAID' : pStatus}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-medium text-[#0B1220]">
                        {b.driverName || <span className="text-slate-400 italic">Searching fleet...</span>}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                        Attempts: {b.allocationAttempts ?? 0}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 tabular-nums">
                        Rej {b.rejectedDriverCount ?? 0} · Exp {b.timedOutDriverCount ?? 0} · Excl{' '}
                        {b.excludedDriverIds?.length ?? 0}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${
                          b.status === 'COMPLETED'
                            ? 'bg-emerald-50 text-emerald-700'
                            : b.status === 'CANCELLED'
                            ? 'bg-red-50 text-red-700'
                            : b.allocationStatus === 'NO_DRIVERS_AVAILABLE'
                            ? 'bg-red-50 text-red-700'
                            : b.allocationStatus === 'MAX_WAIT_REACHED'
                            ? 'bg-amber-100 text-amber-800'
                            : b.allocationStatus === 'WAITING_FOR_DRIVER'
                            ? 'bg-sky-50 text-sky-800'
                            : b.status === 'SEARCHING_DRIVER' || b.status === 'CONFIRMED'
                            ? 'bg-teal-50 text-[#009F95]'
                            : 'bg-slate-100 text-[#0B1220]'
                        }`}
                      >
                        {b.allocationStatus === 'NO_DRIVERS_AVAILABLE'
                          ? 'NO DRIVERS AVAILABLE'
                          : b.allocationStatus === 'MAX_WAIT_REACHED'
                          ? 'MAX WAIT PROMPT'
                          : b.allocationStatus === 'WAITING_FOR_DRIVER'
                          ? 'WAITING FOR DRIVER'
                          : b.status.replace(/_/g, ' ')}
                      </span>
                      {b.lastSearchAt && !b.driverId && b.status !== 'CANCELLED' && (
                        <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                          Last check: {new Date(b.lastSearchAt).toLocaleTimeString()}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap space-x-2">
                      <button
                        type="button"
                        onClick={() => setSelectedBookingId(b.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Timeline</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0B1220]">
            Admin Command Centre
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Driver verification, 4-factor intelligent allocation, 6-panel Judge Demo Mode, and live urban analytics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadCoreAdminData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => {
              logout();
              onNavigate?.('/login', { replace: true });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-red-50 hover:text-red-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </div>

      {/* 13 Section Navigation Tabs (+ Logout above) */}
      <div className="rounded-xl border border-slate-200 bg-white p-2">
        <div className="flex flex-wrap gap-1.5">
          {navItems.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#0B1220] text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-[#0B1220]'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={`ml-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      active ? 'bg-[#009F95] text-white' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {liveSosBanner && (
        <div className="flex flex-col justify-between gap-3 rounded-xl border-2 border-red-600 bg-red-50 px-5 py-3.5 text-xs sm:flex-row sm:items-center">
          <div className="flex items-center gap-2.5 text-red-950">
            <ShieldAlert className="h-5 w-5 shrink-0 text-red-600" />
            <div>
              <strong>
                {liveSosBanner.isDemoScenario ? 'DEMO SOS TRIGGERED' : 'LIVE EMERGENCY SOS ALERT'} ·{' '}
                {liveSosBanner.incidentId}:
              </strong>{' '}
              {liveSosBanner.activatedByName} ({liveSosBanner.activatedByRole}) activated SOS assistance.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSection('EMERGENCY_SOS');
                setLiveSosBanner(null);
              }}
              className="rounded-lg bg-red-600 px-3.5 py-1.5 font-bold text-white hover:bg-red-700"
            >
              Open Emergency Console
            </button>
            <button
              type="button"
              onClick={() => setLiveSosBanner(null)}
              className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 font-semibold text-red-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {actionNotice && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-[#0B1220]">
          {actionNotice}
        </div>
      )}

      {loading && !analytics ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-white border border-slate-200" />
          ))}
        </div>
      ) : (
        <>
          {section === 'OVERVIEW' && analytics && (
            <div className="space-y-6">
              {pendingVerCount > 0 && (
                <div className="flex flex-col justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-xs sm:flex-row sm:items-center">
                  <div className="text-amber-950">
                    <strong>{pendingVerCount} driver application(s)</strong> await document verification
                    before they can go online.
                  </div>
                  <button
                    type="button"
                    onClick={() => setSection('VERIFICATION')}
                    className="rounded-lg bg-[#0B1220] px-3.5 py-1.5 font-semibold text-white hover:bg-slate-800 self-start sm:self-auto"
                  >
                    Review Verification Queue
                  </button>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong className="text-[#0B1220]">Data Transparency:</strong>{' '}
                  {analytics.dataSourceSummary.liveDatabaseRides} live ride records from{' '}
                  <span className="font-mono font-semibold text-[#0B1220]">
                    {analytics.dataSourceSummary.databaseMode === 'MONGODB'
                      ? 'MongoDB (Mongoose)'
                      : 'Persistent Local Store (.data/ridenexa-db.json)'}
                  </span>{' '}
                  alongside {analytics.dataSourceSummary.simulatedBaselineRides} simulated historical
                  baseline rides. Judge Demo Mode records are isolated and excluded from live analytics.
                </div>
              </div>

              {/* Top KPI Strip */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="text-xs font-medium text-slate-500">Total Rides (incl. Baseline)</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-[#0B1220] tabular-nums">
                    {analytics.kpis.totalRides.toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 tabular-nums">
                    {analytics.kpis.completedRides.toLocaleString()} completed
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="text-xs font-medium text-slate-500">Approved Fleet (Free / Online)</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-[#0B1220] tabular-nums">
                    {analytics.kpis.availableDrivers} / {analytics.kpis.onlineDrivers}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {overview?.driverVerificationCounts.approved ?? analytics.kpis.onlineDrivers} approved
                    drivers
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="text-xs font-medium text-slate-500">Avg Wait & Utilization</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-[#009F95] tabular-nums">
                    {analytics.kpis.avgWaitTimeMin} min
                  </div>
                  <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                    {analytics.kpis.driverUtilizationPct}% utilization
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="text-xs font-medium text-slate-500">Completion Rate</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-[#0B1220] tabular-nums">
                    {analytics.kpis.completionRatePct}%
                  </div>
                  <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                    +{analytics.kpis.fairnessGiniImprovementPct}% equity index
                  </div>
                </div>
              </div>

              {ops && (
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <h2 className="font-display text-base font-bold text-[#0B1220] mb-3">
                    Live Booking & Payment Telemetry
                  </h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Live Bookings</div>
                      <div className="mt-0.5 font-mono text-lg font-bold text-[#0B1220] tabular-nums">
                        {ops.totalBookings}
                      </div>
                      <div className="text-[11px] text-slate-500">{ops.confirmedBookings} confirmed</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Pending Dispatch</div>
                      <div className="mt-0.5 font-mono text-lg font-bold text-amber-600 tabular-nums">
                        {ops.pendingAllocations}
                      </div>
                      <div className="text-[11px] text-slate-500">{ops.assignedRides} active</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Completed / Cancelled</div>
                      <div className="mt-0.5 font-mono text-lg font-bold text-[#0B1220] tabular-nums">
                        {ops.completedRidesCount} / {ops.cancelledRidesCount}
                      </div>
                      <div className="text-[11px] text-slate-500">Live DB rides</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Payments</div>
                      <div className="mt-0.5 font-mono text-lg font-bold text-[#009F95] tabular-nums">
                        {ops.paymentSuccessCount} Paid
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {ops.paymentPendingCount ?? 0} pend · {ops.paymentFailedCount} fail · ₹
                        {(ops.collectedRevenue ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Fleet Readiness</div>
                      <div className="mt-0.5 font-mono text-lg font-bold text-[#0B1220] tabular-nums">
                        {ops.availableDrivers} Free
                      </div>
                      <div className="text-[11px] text-slate-500">{ops.busyDrivers} busy</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium text-slate-500">Rejections & Timeouts</div>
                      <div className="mt-0.5 font-mono text-lg font-bold text-[#0B1220] tabular-nums">
                        {ops.driverRejections + ops.driverExpirations}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {ops.driverRejections} rej · {ops.driverExpirations} exp
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6">
                  <h2 className="font-display text-lg font-bold text-[#0B1220]">
                    Recent Platform Bookings
                  </h2>
                  <p className="mb-4 text-xs text-slate-500">
                    Click any booking to audit payment verification, dispatch rankings, and timeline events.
                  </p>
                  <div className="space-y-2.5">
                    {filteredBookings.slice(0, 6).map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-[#0B1220] truncate">
                            {b.passengerName} · {b.pickupAddress} → {b.destinationAddress}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {b.id} · {b.driverName || 'Unassigned'} · ₹
                            {b.finalFare ?? b.estimatedFare} ({b.paymentMethod || 'N/A'} ·{' '}
                            {b.paymentStatus === 'SUCCESS' ? 'PAID' : b.paymentStatus || 'PENDING'})
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedBookingId(b.id)}
                          className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-[#0B1220] hover:bg-slate-100 shrink-0"
                        >
                          Inspect
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 flex flex-col">
                  <h2 className="font-display text-lg font-bold text-[#0B1220]">Live Fleet Map</h2>
                  <p className="mb-3 text-xs text-slate-500">
                    Approved online vehicles updated in real time via Socket.IO.
                  </p>
                  <div className="flex-1 min-h-[280px]">
                    <CityMap heightClass="h-full min-h-[280px]" drivers={drivers} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === 'VERIFICATION' && (
            <AdminDriverVerificationView
              drivers={adminDrivers}
              onVerifyAction={handleVerifyAction}
            />
          )}

          {section === 'DRIVERS' && (
            <AdminDriverManagementView
              drivers={adminDrivers}
              onVerifyAction={handleVerifyAction}
            />
          )}

          {section === 'PASSENGERS' && <AdminPassengerManagementView passengers={passengers} />}

          {section === 'LIVE_RIDES' &&
            renderBookingMonitorTable(
              'Live Ride Monitoring',
              'Real-time status tracking across active, searching, and payment-pending trips.'
            )}

          {section === 'PAYMENTS' && <AdminPaymentManagementView />}

          {section === 'EMERGENCY_SOS' && (
            <AdminEmergencyMonitor onIncidentsUpdated={loadCoreAdminData} />
          )}

          {section === 'ALLOCATION' && (
            <AdminAllocationInspector rankings={rankings} settings={settings} />
          )}

          {section === 'DEMO_CENTER' && (
            <AdminDemoCenter
              demoState={demoState}
              demoBusy={demoBusy}
              onDemoAction={handleDemoAction}
            />
          )}

          {section === 'DEMAND' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-[#0B1220]">
                    AI Demand Forecasting
                  </h2>
                  <p className="text-xs text-slate-500">
                    {demandForecast?.modelType === 'EXTERNAL_ML_SERVICE'
                      ? 'Connected to External FastAPI ML Service'
                      : 'Prototype Spatio-Temporal Demand Forecaster'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={forecastHorizon}
                    onChange={(e) =>
                      setForecastHorizon(
                        e.target.value as 'NOW' | '+1H' | '+3H' | 'MORNING_PEAK' | 'EVENING_PEAK'
                      )
                    }
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold"
                  >
                    <option value="NOW">Now</option>
                    <option value="+1H">+1 Hour</option>
                    <option value="+3H">+3 Hours</option>
                    <option value="MORNING_PEAK">Morning Peak</option>
                    <option value="EVENING_PEAK">Evening Peak</option>
                  </select>
                  <select
                    value={forecastDayType}
                    onChange={(e) => setForecastDayType(e.target.value as 'WEEKDAY' | 'WEEKEND')}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold"
                  >
                    <option value="WEEKDAY">Weekday</option>
                    <option value="WEEKEND">Weekend</option>
                  </select>
                  <select
                    value={forecastWeather}
                    onChange={(e) => setForecastWeather(e.target.value as 'CLEAR' | 'RAINY')}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold"
                  >
                    <option value="CLEAR">Clear Weather</option>
                    <option value="RAINY">Rainy Surge</option>
                  </select>
                </div>
              </div>

              {demandForecast && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6">
                    <h3 className="font-display text-base font-bold text-[#0B1220] mb-3">
                      Hourly Demand vs Supply Curve
                    </h3>
                    <DemandForecastChart data={demandForecast.hourlySeries} />
                    <p className="mt-3 text-xs text-slate-600">{demandForecast.summary}</p>
                  </div>
                  <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6">
                    <h3 className="font-display text-base font-bold text-[#0B1220] mb-3">
                      Hotspot Intensity Overlay
                    </h3>
                    <CityMap
                      heightClass="h-[280px]"
                      drivers={drivers}
                      heatmapZones={demandForecast.zones}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {section === 'ZONES' && demandForecast && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-[#0B1220]">
                    Zone Demand / Supply Intelligence & Surge Thresholds
                  </h2>
                  <p className="text-xs text-slate-500">
                    Surge threshold: {settings?.surgeDemandRatioThreshold ?? 1.4}x demand/supply ratio ·
                    Cap: {settings?.surgeMultiplierCap ?? 1.8}x
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 font-semibold text-slate-500">
                        <th className="py-2.5 pr-3">City Zone</th>
                        <th className="py-2.5 pr-3 text-right">Predicted Req/hr</th>
                        <th className="py-2.5 pr-3 text-right">Active Drivers</th>
                        <th className="py-2.5 pr-3 text-right">Supply Gap</th>
                        <th className="py-2.5 pr-3 text-right">Surge</th>
                        <th className="py-2.5 text-right">Pressure</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                      {demandForecast.zones.map((z) => (
                        <tr key={z.zoneId}>
                          <td className="py-2.5 pr-3 font-sans">
                            <div className="font-semibold text-[#0B1220]">{z.zoneName}</div>
                            <div className="text-[11px] text-slate-500">{z.area}</div>
                          </td>
                          <td className="py-2.5 pr-3 text-right">{z.predictedDemand}</td>
                          <td className="py-2.5 pr-3 text-right">{z.activeDrivers}</td>
                          <td className="py-2.5 pr-3 text-right text-amber-700 font-semibold">
                            +{z.supplyGap}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-bold text-[#009F95]">
                            {z.surgeMultiplier}x
                          </td>
                          <td className="py-2.5 text-right">
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                                z.intensity === 'CRITICAL'
                                  ? 'bg-red-50 text-red-700'
                                  : z.intensity === 'HIGH'
                                  ? 'bg-amber-50 text-amber-800'
                                  : 'bg-teal-50 text-[#009F95]'
                              }`}
                            >
                              {z.intensity}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6">
                <h3 className="font-display text-base font-bold text-[#0B1220] mb-3">
                  Live Spatial Supply Deficit Map
                </h3>
                <CityMap
                  heightClass="h-[380px]"
                  drivers={drivers}
                  heatmapZones={demandForecast.zones}
                />
              </div>
            </div>
          )}

          {section === 'POOLING' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-[#0B1220]">
                    Smart Ride Pooling Clusters
                  </h2>
                  <p className="text-xs text-slate-500">
                    Combines directionally aligned passenger bookings within bounded pickup proximity and detour limits.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <span className="font-semibold text-slate-600">Radius (km):</span>
                    <input
                      type="number"
                      step={0.5}
                      min={1}
                      max={6}
                      value={poolRadiusKm}
                      onChange={(e) => setPoolRadiusKm(Number(e.target.value) || 2.5)}
                      className="w-16 rounded border border-slate-300 px-2 py-1 font-mono"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="font-semibold text-slate-600">Max Detour (%):</span>
                    <input
                      type="number"
                      step={5}
                      min={10}
                      max={45}
                      value={poolMaxDetourPct}
                      onChange={(e) => setPoolMaxDetourPct(Number(e.target.value) || 25)}
                      className="w-16 rounded border border-slate-300 px-2 py-1 font-mono"
                    />
                  </label>
                </div>
              </div>

              {ridePooling && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  <div className="lg:col-span-6 space-y-3">
                    {ridePooling.groups.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                        No compatible pooled pairs within current constraints.
                      </div>
                    ) : (
                      ridePooling.groups.map((grp) => (
                        <div
                          key={grp.groupId}
                          className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-[#009F95]">
                              {grp.groupId} · {grp.compatibilityScore}% Match
                            </span>
                            <span className="font-mono font-semibold text-[#0B1220]">
                              Save {grp.perRiderSavingsPct}% · {grp.co2SavedKg} kg CO2 avoided
                            </span>
                          </div>
                          <div className="space-y-1 text-slate-700">
                            {grp.riders.map((r) => (
                              <div key={r.id}>
                                <strong>{r.passengerName}</strong>: {r.pickupName} → {r.destinationName}{' '}
                                ({r.isLiveDbRequest ? 'Live DB' : 'Demo Pool'})
                              </div>
                            ))}
                          </div>
                          <div className="text-[11px] text-slate-500">{grp.explanation}</div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6">
                    <h3 className="font-display text-base font-bold text-[#0B1220] mb-3">
                      Shared Corridor Map
                    </h3>
                    <CityMap
                      heightClass="h-[340px]"
                      drivers={drivers}
                      routes={ridePooling.groups.map((g) => ({
                        waypoints: g.routeWaypoints,
                        color: '#009F95',
                        weight: 4,
                        label: g.groupId,
                      }))}
                      fitToOverlays={ridePooling.groups.length > 0}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {section === 'HISTORY' &&
            renderBookingMonitorTable(
              'Persistent Ride & Payment Audit History',
              'Searchable history of bookings, verified transactions, driver dispatch attempts, and refunds.'
            )}

          {section === 'ANALYTICS' && analytics && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-semibold text-[#0B1220]">
                  Time Window Selection
                </div>
                <div className="inline-flex rounded-lg bg-slate-100 p-1">
                  {(
                    [
                      { id: 'TODAY', label: 'Today' },
                      { id: '7_DAYS', label: '7 Days' },
                      { id: '30_DAYS', label: '30 Days' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDateFilter(tab.id)}
                      className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                        dateFilter === tab.id
                          ? 'bg-white text-[#0B1220] shadow-sm'
                          : 'text-slate-600 hover:text-[#0B1220]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6">
                  <h2 className="font-display text-lg font-bold text-[#0B1220]">
                    Ride Activity Overview
                  </h2>
                  <p className="mb-4 text-xs text-slate-500">
                    Completed vs cooperative pooled ride volume across the selected period.
                  </p>
                  <ActivityBarChart data={analytics.activitySeries} />
                </div>

                <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6">
                  <h2 className="font-display text-lg font-bold text-[#0B1220]">
                    Demand Distribution by Zone
                  </h2>
                  <p className="mb-4 text-xs text-slate-500">
                    Zone request share and average pickup wait times.
                  </p>
                  <div className="space-y-3.5">
                    {analytics.demandDistribution.map((z) => (
                      <div key={z.zone} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#0B1220] truncate pr-2">{z.zone}</span>
                          <span className="font-mono text-slate-600 tabular-nums shrink-0">
                            {z.requests} req ({z.sharePct}%) · {z.avgWaitMin}m wait
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-[#009F95]"
                            style={{ width: `${Math.min(100, z.sharePct * 3.8)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <h2 className="font-display text-lg font-bold text-[#0B1220]">
                  Fleet Fairness Equity Distribution
                </h2>
                <p className="mb-4 text-xs text-slate-500">
                  Daily trips completed, utilization index, fairness alignment score, and driver earnings.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                        <th className="py-2.5 pr-3">Driver</th>
                        <th className="py-2.5 pr-3">Sector</th>
                        <th className="py-2.5 pr-3 text-right">Trips</th>
                        <th className="py-2.5 pr-3 text-right">Utilization</th>
                        <th className="py-2.5 pr-3 text-right">Fairness</th>
                        <th className="py-2.5 text-right">Earnings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                      {analytics.driverAllocationAnalytics.map((d) => (
                        <tr key={d.driverName} className="hover:bg-slate-50/70">
                          <td className="py-2.5 pr-3 font-semibold text-[#0B1220]">{d.driverName}</td>
                          <td className="py-2.5 pr-3 text-slate-600">{d.area}</td>
                          <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                            {d.ridesToday}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                            {d.utilizationPct}%
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono font-semibold text-[#009F95] tabular-nums">
                            {d.fairnessScore}
                          </td>
                          <td className="py-2.5 text-right font-mono tabular-nums">
                            ₹{d.earnings.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {section === 'SETTINGS' && (
            <AdminSettingsView settings={settings} onSaveSettings={handleSaveSettings} />
          )}
        </>
      )}

      <BookingTimelineModal
        bookingId={selectedBookingId}
        onClose={() => setSelectedBookingId(null)}
      />
    </div>
  );
};
