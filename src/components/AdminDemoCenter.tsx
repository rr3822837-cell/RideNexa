import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TimerOff,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { CityMap } from './CityMap';
import {
  AllocationRankingRecord,
  DemoScenarioState,
  SystemSettingsRecord,
} from '../types/ridenexa';

interface AdminDemoCenterProps {
  demoState: DemoScenarioState | null;
  demoBusy: string | null;
  onDemoAction: (
    endpoint:
      | 'load'
      | 'start'
      | 'simulate-accept'
      | 'simulate-reject'
      | 'simulate-timeout'
      | 'sos-trigger'
      | 'reset'
  ) => Promise<void>;
}

export const AdminDemoCenter: React.FC<AdminDemoCenterProps> = ({
  demoState,
  demoBusy,
  onDemoAction,
}) => {
  const [showRawJson, setShowRawJson] = useState(false);

  const latestRanking: AllocationRankingRecord | null =
    demoState?.rankings && demoState.rankings.length > 0 ? demoState.rankings[0] : null;
  const booking = demoState?.booking || null;
  const requests = demoState?.requests || [];
  const drivers = demoState?.drivers || [];
  const events = demoState?.events || [];

  const pendingReq = requests.find((r) => r.status === 'PENDING');
  const excludedIds = new Set(booking?.excludedDriverIds || []);

  return (
    <div className="space-y-6">
      {/* Control Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="text-xs font-semibold text-[#009F95]">
              Judge Demo Mode · Real Backend Dispatch Pipeline
            </div>
            <h2 className="mt-1 font-display text-xl font-bold text-[#0B1220]">
              6-Panel Live Demonstration Center
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600 max-w-3xl">
              Isolated demonstration sandbox using real backend booking creation, payment verification,
              4-factor fair scoring, Socket.IO dispatch, and driver rejection/timeout handling
              without touching live production rides.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRawJson((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#0B1220] hover:bg-slate-50"
            >
              <Eye className="h-3.5 w-3.5 text-[#009F95]" />
              <span>{showRawJson ? 'Hide Demo Data' : 'View Demo Data'}</span>
            </button>
            <button
              type="button"
              disabled={demoBusy !== null}
              onClick={() => onDemoAction('reset')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset Demo Scenario</span>
            </button>
          </div>
        </div>

        {/* Action Buttons Bar */}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-4">
          <button
            type="button"
            disabled={demoBusy !== null}
            onClick={() => onDemoAction('load')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#0B1220] bg-white px-3.5 py-2 text-xs font-semibold text-[#0B1220] hover:bg-slate-50 disabled:opacity-50"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-[#009F95]" />
            <span>{demoBusy === 'load' ? 'Loading...' : '1. Load Demo Scenario'}</span>
          </button>

          <button
            type="button"
            disabled={demoBusy !== null}
            onClick={() => onDemoAction('start')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#009F95] px-4 py-2 text-xs font-semibold text-white hover:bg-[#00867d] disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{demoBusy === 'start' ? 'Starting...' : '2. Start Demo Booking'}</span>
          </button>

          <button
            type="button"
            disabled={demoBusy !== null || !pendingReq}
            onClick={() => onDemoAction('simulate-reject')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
          >
            <XCircle className="h-3.5 w-3.5" />
            <span>{demoBusy === 'simulate-reject' ? 'Rejecting...' : 'Simulate Rejection'}</span>
          </button>

          <button
            type="button"
            disabled={demoBusy !== null || !pendingReq}
            onClick={() => onDemoAction('simulate-timeout')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40"
          >
            <TimerOff className="h-3.5 w-3.5" />
            <span>{demoBusy === 'simulate-timeout' ? 'Timing out...' : 'Simulate Timeout'}</span>
          </button>

          <button
            type="button"
            disabled={demoBusy !== null || !pendingReq}
            onClick={() => onDemoAction('simulate-accept')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1220] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-[#009F95]" />
            <span>{demoBusy === 'simulate-accept' ? 'Accepting...' : 'Simulate Driver Accept'}</span>
          </button>

          <button
            type="button"
            disabled={demoBusy !== null}
            onClick={() => onDemoAction('sos-trigger')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-40"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>{demoBusy === 'sos-trigger' ? 'Triggering Demo SOS...' : 'Simulate Demo SOS'}</span>
          </button>
        </div>

        {demoState?.sosIncident && (
          <div className="rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3 text-xs text-red-950 flex flex-wrap items-center justify-between gap-2">
            <div>
              <strong>DEMO-ONLY SOS ACTIVE ({demoState.sosIncident.incidentId}):</strong>{' '}
              Location: {demoState.sosIncident.locationSource} · Police API:{' '}
              {demoState.sosIncident.policeNotificationStatus} · Nearest Listed Police:{' '}
              {demoState.sosIncident.nearestPoliceStations[0]
                ? `${demoState.sosIncident.nearestPoliceStations[0].name} (${demoState.sosIncident.nearestPoliceStations[0].distanceKm} km, jurisdiction unconfirmed)`
                : 'Open Emergency & Safety tab for details'}
            </div>
            <span className="rounded bg-red-600 px-2 py-0.5 font-mono text-[10px] font-bold text-white">
              DEMO ONLY · NO REAL DISPATCH
            </span>
          </div>
        )}

        {showRawJson && demoState && (
          <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 font-mono text-[11px] text-slate-200">
            {JSON.stringify(
              {
                active: demoState.active,
                bookingId: booking?.id,
                bookingStatus: booking?.status,
                excludedDriverIds: booking?.excludedDriverIds,
                driversCount: drivers.length,
                requestsCount: requests.length,
                rankingsCount: demoState.rankings.length,
              },
              null,
              2
            )}
          </pre>
        )}
      </div>

      {/* 6 Synchronized Monitoring Panels */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Panel 1: Passenger Booking Monitor */}
        <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-bold text-[#009F95]">
              PANEL 1 · PASSENGER BOOKING MONITOR
            </span>
            {booking && (
              <span className="font-mono text-[11px] text-slate-500">{booking.id}</span>
            )}
          </div>
          {!booking ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              Click "Start Demo Booking" to create a confirmed post-ride passenger booking.
            </p>
          ) : (
            <div className="space-y-2.5 text-xs">
              <div className="font-semibold text-sm text-[#0B1220]">
                {booking.passengerName}
              </div>
              <div className="text-slate-600">
                {booking.pickupAddress} → {booking.destinationAddress}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 font-mono tabular-nums">
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-[10px] font-sans text-slate-500">Booking Status</div>
                  <div className="font-bold text-[#0B1220]">{booking.status.replace(/_/g, ' ')}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-[10px] font-sans text-slate-500">Post-Ride Payment</div>
                  <div
                    className={`font-bold ${
                      booking.paymentStatus === 'PAID' || booking.paymentStatus === 'SUCCESS'
                        ? 'text-emerald-700'
                        : booking.paymentStatus === 'FAILED'
                        ? 'text-red-700'
                        : 'text-amber-700'
                    }`}
                  >
                    ₹{booking.finalFare ?? booking.estimatedFare} ·{' '}
                    {booking.paymentStatus === 'SUCCESS'
                      ? 'PAID'
                      : booking.paymentStatus || 'PENDING'}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 border-t border-slate-100 pt-2 tabular-nums">
                <span>Attempts: {booking.allocationAttempts ?? 0}</span>
                <span>Surge: {booking.surgeMultiplier ?? 1}x</span>
              </div>
            </div>
          )}
        </div>

        {/* Panel 2: Driver Availability Monitor */}
        <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-bold text-[#009F95]">
              PANEL 2 · DRIVER AVAILABILITY MONITOR
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {drivers.length} sandbox drivers
            </span>
          </div>
          {drivers.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              Click "Load Demo Scenario" to spawn Vikram (close/busy), Ananya (fair #1), and Kabir (backup).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                    <th className="py-2 pr-3">Driver</th>
                    <th className="py-2 pr-3">Fleet State</th>
                    <th className="py-2 pr-3 text-right">Trips</th>
                    <th className="py-2 pr-3 text-right">Idle</th>
                    <th className="py-2 pr-3 text-right">Offers / Acc / Rej</th>
                    <th className="py-2 text-right">Exclusion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {drivers.map((d) => {
                    const isAssigned = booking?.driverId === d.id;
                    const isExcluded = excludedIds.has(d.id);
                    const hasPending = pendingReq?.driverId === d.id;
                    return (
                      <tr key={d.id}>
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-[#0B1220]">{d.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {d.areaName} · Rating {d.rating.toFixed(2)}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 font-mono">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                              isAssigned
                                ? 'bg-emerald-50 text-emerald-700'
                                : hasPending
                                ? 'bg-amber-50 text-amber-700'
                                : d.isOnline && d.isAvailable
                                ? 'bg-teal-50 text-[#009F95]'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {isAssigned
                              ? 'ASSIGNED TRIP'
                              : hasPending
                              ? 'OFFER PENDING'
                              : d.isOnline && d.isAvailable
                              ? 'ONLINE · FREE'
                              : 'BUSY / OFFLINE'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {d.ridesCompletedToday}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {d.minutesSinceLastRide}m
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {d.allocationOpportunities ?? 0} / {d.acceptedCount ?? 0} /{' '}
                          {d.rejectedCount ?? 0}
                        </td>
                        <td className="py-2.5 text-right font-mono">
                          {isExcluded ? (
                            <span className="text-red-600 font-semibold">Excluded</span>
                          ) : (
                            <span className="text-slate-400">Eligible</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Panel 3: Allocation Ranking Monitor */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-bold text-[#009F95]">
              PANEL 3 · ALLOCATION RANKING MONITOR (4-FACTOR SCORE)
            </span>
            {latestRanking && (
              <span className="font-mono text-[11px] text-slate-500">
                Attempt #{latestRanking.attemptNumber} · {latestRanking.triggerReason}
              </span>
            )}
          </div>
          {!latestRanking ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              Weighted factor scores (ETA 40% · Fairness 30% · Reliability 15% · Workload 15%) appear once allocation runs.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 leading-relaxed">
                {latestRanking.explanation}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-2 pr-2">Candidate</th>
                      <th className="py-2 pr-2 text-right">ETA</th>
                      <th className="py-2 pr-2 text-right">Fairness</th>
                      <th className="py-2 pr-2 text-right">Reliability</th>
                      <th className="py-2 pr-2 text-right">Workload</th>
                      <th className="py-2 text-right">Weighted Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {latestRanking.candidates.map((c) => (
                      <tr key={c.driverId} className={c.isSelected ? 'bg-[#009F95]/5' : ''}>
                        <td className="py-2 pr-2 font-sans">
                          <div className="font-semibold text-[#0B1220]">
                            {c.driverName}
                            {c.isSelected && (
                              <span className="ml-1.5 rounded bg-[#009F95] px-1.5 py-0.5 font-mono text-[10px] text-white">
                                SELECTED
                              </span>
                            )}
                            {c.isNearestGreedy && !c.isSelected && (
                              <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                                NEAREST GREEDY
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-2 text-right">{c.etaMinutes}m ({c.proximityScore})</td>
                        <td className="py-2 pr-2 text-right">{c.fairnessOpportunityScore}</td>
                        <td className="py-2 pr-2 text-right">{c.reliabilityScore}</td>
                        <td className="py-2 pr-2 text-right">{c.workloadEquityScore}</td>
                        <td className="py-2 text-right font-bold text-[#009F95]">
                          {c.totalAllocationScore}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Panel 4 & 5: Live Assignment + Request Response Monitors */}
        <div className="lg:col-span-5 space-y-6">
          {/* Panel 4 */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-bold text-[#009F95]">
                PANEL 4 · LIVE ASSIGNMENT MONITOR
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                {requests.length} dispatch attempt(s)
              </span>
            </div>
            {requests.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No driver requests sent yet.
              </p>
            ) : (
              <div className="space-y-2">
                {requests.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-[#0B1220]">
                        Attempt #{r.attemptNumber}: {r.driverName}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        Score {r.allocationScore} · ₹{r.driverEarnings} driver payout
                      </div>
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${
                        r.status === 'ACCEPTED'
                          ? 'bg-emerald-50 text-emerald-700'
                          : r.status === 'REJECTED' || r.status === 'TIMED_OUT' || r.status === 'EXPIRED'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Panel 5 */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-bold text-[#009F95]">
                PANEL 5 · DRIVER RESPONSE MONITOR
              </span>
              {(booking?.allocationStatus === 'WAITING_FOR_DRIVER' ||
                booking?.allocationStatus === 'MAX_WAIT_REACHED') && (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
            </div>
            {requests.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                Driver responses and exclusions will trace here live.
              </p>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  {requests
                    .slice()
                    .reverse()
                    .map((r, idx, arr) => (
                      <React.Fragment key={r.id}>
                        <span
                          className={`rounded border px-2 py-1 font-mono text-[11px] ${
                            r.status === 'ACCEPTED'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                              : r.status === 'PENDING'
                              ? 'border-teal-300 bg-teal-50 text-[#0B1220]'
                              : 'border-red-200 bg-red-50 text-red-700'
                          }`}
                        >
                          #{r.attemptNumber} {r.driverName.split(' ')[0]} ({r.status})
                        </span>
                        {idx < arr.length - 1 && (
                          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                        )}
                      </React.Fragment>
                    ))}
                </div>
                <div className="text-[11px] text-slate-500">
                  Excluded for this booking: {excludedIds.size} driver(s). Rejecting drivers stay Online &
                  Available for other riders.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Panel 6: Persistent Event Timeline + Live Demo Map */}
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-bold text-[#009F95]">
              PANEL 6 · PERSISTENT EVENT TIMELINE
            </span>
            <span className="font-mono text-[11px] text-slate-500">{events.length} events</span>
          </div>
          {events.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              Persistent lifecycle audit entries appear here as actions run.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-2.5 pr-1">
              {events.map((evt) => (
                <div key={evt.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[#0B1220]">{evt.eventType}</span>
                    <span className="font-mono text-[10px] text-slate-400">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="mt-1 text-slate-600">{evt.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-bold text-[#009F95]">
              LIVE DEMO FLEET MAP
            </span>
            <span className="text-xs text-slate-500">MG Road → Whitefield Tech Corridor</span>
          </div>
          <CityMap
            heightClass="h-[290px]"
            drivers={drivers}
            selectedDriverId={booking?.driverId || pendingReq?.driverId}
            pickup={
              booking
                ? { coordinates: booking.pickupCoords, label: booking.pickupAddress }
                : { coordinates: { lat: 12.9756, lng: 77.6066 }, label: 'MG Road Transit Hub' }
            }
            destination={
              booking
                ? { coordinates: booking.destinationCoords, label: booking.destinationAddress }
                : {
                    coordinates: { lat: 12.9698, lng: 77.7499 },
                    label: 'Whitefield Tech Corridor',
                  }
            }
            routes={
              booking
                ? [
                    {
                      waypoints: booking.routePath,
                      color: '#009F95',
                      weight: 4,
                      label: 'Demo Corridor',
                    },
                  ]
                : []
            }
            emergencyLocation={
              demoState?.sosIncident?.latitude !== undefined &&
              demoState?.sosIncident?.longitude !== undefined
                ? {
                    coordinates: {
                      lat: demoState.sosIncident.latitude,
                      lng: demoState.sosIncident.longitude,
                    },
                    label: `DEMO SOS · ${demoState.sosIncident.incidentId}`,
                    sublabel: demoState.sosIncident.locationSource,
                  }
                : null
            }
            policeStations={demoState?.sosIncident?.nearestPoliceStations || []}
            fitToOverlays={drivers.length > 0 || Boolean(demoState?.sosIncident)}
          />
        </div>
      </div>
    </div>
  );
};

interface AllocationInspectorProps {
  rankings: AllocationRankingRecord[];
  settings: SystemSettingsRecord | null;
}

export const AdminAllocationInspector: React.FC<AllocationInspectorProps> = ({
  rankings,
  settings,
}) => {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#0B1220]">
              Intelligent Driver Allocation Engine Audit
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Persisted 4-factor weighted scoring attempts comparing RideNexa fair selection against greedy nearest-driver dispatch.
            </p>
          </div>
          {settings && (
            <div className="font-mono text-xs text-slate-600 tabular-nums">
              Weights: ETA {Math.round(settings.allocationWeights.eta * 100)}% · Fairness{' '}
              {Math.round(settings.allocationWeights.fairness * 100)}% · Reliability{' '}
              {Math.round(settings.allocationWeights.reliability * 100)}% · Workload{' '}
              {Math.round(settings.allocationWeights.workload * 100)}%
            </div>
          )}
        </div>
      </div>

      {rankings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No persisted allocation ranking runs recorded yet. Confirm a booking or run Judge Demo Mode to inspect candidate scores.
        </div>
      ) : (
        <div className="space-y-4">
          {rankings.slice(0, 15).map((run) => (
            <div key={run.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#009F95]" />
                  <span className="font-mono text-xs font-bold text-[#0B1220]">
                    {run.bookingId} · Attempt #{run.attemptNumber}
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                    {run.triggerReason}
                  </span>
                  {run.isDemoScenario && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-800">
                      DEMO SANDBOX
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-slate-500">
                  Eligible: {run.eligibleCount}/{run.totalFleetCount} ·{' '}
                  {new Date(run.createdAt).toLocaleString()}
                </div>
              </div>

              <p className="text-xs leading-relaxed text-slate-600">{run.explanation}</p>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-2 pr-3">Driver</th>
                      <th className="py-2 pr-3 text-right">Dist / ETA</th>
                      <th className="py-2 pr-3 text-right">ETA Score</th>
                      <th className="py-2 pr-3 text-right">Fairness</th>
                      <th className="py-2 pr-3 text-right">Reliability</th>
                      <th className="py-2 pr-3 text-right">Workload</th>
                      <th className="py-2 text-right">Total Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {run.candidates.map((c) => (
                      <tr key={c.driverId} className={c.isSelected ? 'bg-[#009F95]/5' : ''}>
                        <td className="py-2 pr-3 font-sans">
                          <span className="font-semibold text-[#0B1220]">{c.driverName}</span>
                          {c.isSelected && (
                            <span className="ml-2 rounded bg-[#009F95] px-1.5 py-0.5 font-mono text-[10px] text-white">
                              WINNER
                            </span>
                          )}
                          {c.isNearestGreedy && !c.isSelected && (
                            <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                              GREEDY
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {c.distanceKm}km ({c.etaMinutes}m)
                        </td>
                        <td className="py-2 pr-3 text-right">{c.proximityScore}</td>
                        <td className="py-2 pr-3 text-right">{c.fairnessOpportunityScore}</td>
                        <td className="py-2 pr-3 text-right">{c.reliabilityScore}</td>
                        <td className="py-2 pr-3 text-right">{c.workloadEquityScore}</td>
                        <td className="py-2 text-right font-bold text-[#009F95]">
                          {c.totalAllocationScore}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
