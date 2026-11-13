import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  MapPin,
  Navigation,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { CityMap } from './CityMap';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { EmergencyIncidentRecord } from '../types/ridenexa';

interface AdminIncidentsResponse {
  incidents: EmergencyIncidentRecord[];
  activeCount: number;
  liveActiveCount: number;
  emergencyNumber: string;
  policeApiConfigured: boolean;
}

function isTerminalStatus(status: EmergencyIncidentRecord['incidentStatus']): boolean {
  return status === 'RESOLVED' || status === 'CLOSED' || status === 'CANCELLED_ACCIDENTAL';
}

export const AdminEmergencyMonitor: React.FC<{
  onIncidentsUpdated?: () => void;
}> = ({ onIncidentsUpdated }) => {
  const { apiFetch } = useAuth();
  const { drivers, lastSosEvent } = useSocket();

  const [data, setData] = useState<AdminIncidentsResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectedIncident, setInspectedIncident] = useState<EmergencyIncidentRecord | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'RESOLVED' | 'LIVE_ONLY' | 'DEMO_ONLY'>(
    'ALL'
  );
  const [noteInput, setNoteInput] = useState('');
  const [escalationTarget, setEscalationTarget] = useState(
    'Senior Safety Operations & Regional Escalation Lead'
  );
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadIncidents = useCallback(async () => {
    try {
      const res = await apiFetch<AdminIncidentsResponse>(
        '/api/admin/emergency-incidents?includeDemo=true'
      );
      setData(res);
      setSelectedId((prev) => {
        if (prev && res.incidents.some((i) => i.incidentId === prev)) return prev;
        return res.incidents[0]?.incidentId || null;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  const inspectIncident = useCallback(
    async (incidentId: string) => {
      try {
        const res = await apiFetch<{ incident: EmergencyIncidentRecord }>(
          `/api/admin/emergency-incidents/${incidentId}`
        );
        setInspectedIncident(res.incident);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [apiFetch]
  );

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  useEffect(() => {
    if (selectedId) {
      inspectIncident(selectedId);
    } else {
      setInspectedIncident(null);
    }
  }, [selectedId, inspectIncident]);

  useEffect(() => {
    if (lastSosEvent) {
      loadIncidents();
      if (selectedId && lastSosEvent.incident?.incidentId === selectedId) {
        inspectIncident(selectedId);
      }
    }
  }, [lastSosEvent, loadIncidents, selectedId, inspectIncident]);

  const filteredIncidents = useMemo(() => {
    const list = data?.incidents || [];
    return list.filter((inc) => {
      if (filter === 'ACTIVE') return !isTerminalStatus(inc.incidentStatus);
      if (filter === 'RESOLVED') return isTerminalStatus(inc.incidentStatus);
      if (filter === 'LIVE_ONLY') return !inc.isDemoScenario;
      if (filter === 'DEMO_ONLY') return Boolean(inc.isDemoScenario);
      return true;
    });
  }, [data, filter]);

  const runAdminSosAction = async (
    actionKey: string,
    url: string,
    body: Record<string, unknown>,
    successMsg: string
  ) => {
    if (!inspectedIncident) return;
    setBusyAction(actionKey);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ incident: EmergencyIncidentRecord }>(url, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setInspectedIncident(res.incident);
      setNotice(successMsg);
      await loadIncidents();
      onIncidentsUpdated?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
    );
  }

  const allIncidents = data?.incidents || [];
  const activeIncidents = allIncidents.filter((i) => !isTerminalStatus(i.incidentStatus));
  const demoCount = allIncidents.filter((i) => i.isDemoScenario).length;

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Active SOS Incidents</div>
          <div
            className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
              activeIncidents.length > 0 ? 'text-red-600' : 'text-[#0B1220]'
            }`}
          >
            {data?.activeCount ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data?.liveActiveCount ?? 0} live · {demoCount} demo sandbox
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Total Logged Incidents</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#0B1220] tabular-nums">
            {allIncidents.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Includes resolved & accidental audit trail
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Police API Dispatch Mode</div>
          <div className="mt-1 font-mono text-sm font-bold text-[#0B1220]">
            {data?.policeApiConfigured ? 'CONFIGURED API' : 'NOT CONFIGURED'}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {data?.policeApiConfigured
              ? 'Official endpoint active'
              : 'Honest 112 & OSM lookup fallback'}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Emergency Dispatch Number</div>
          <div className="mt-1 font-mono text-2xl font-bold text-red-600 tabular-nums">
            {data?.emergencyNumber || '112'}
          </div>
          <div className="mt-1 text-xs text-slate-500">Immediate user dialer active</div>
        </div>
      </div>

      {/* Filter Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-lg font-bold text-[#0B1220]">
            Emergency & Personal Safety Command Queue
          </h2>
          <p className="text-xs text-slate-500">
            Real-time SOS monitoring with audited Admin access, OpenStreetMap Overpass police directory, and honest dispatch telemetry.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'ALL', label: 'All' },
                { id: 'ACTIVE', label: 'Active' },
                { id: 'RESOLVED', label: 'Resolved' },
                { id: 'LIVE_ONLY', label: 'Live Only' },
                { id: 'DEMO_ONLY', label: 'Demo Only' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  filter === tab.id
                    ? 'bg-white text-[#0B1220] shadow-sm'
                    : 'text-slate-600 hover:text-[#0B1220]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={loadIncidents}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          {notice}
        </div>
      )}

      {/* Master-Detail Split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Queue List */}
        <div className="lg:col-span-5 space-y-3">
          {filteredIncidents.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
              No SOS incidents match the selected filter. Trigger an SOS or run the SOS Judge Demo Scenario to inspect live handling.
            </div>
          ) : (
            filteredIncidents.map((inc) => {
              const selected = selectedId === inc.incidentId;
              const active = !isTerminalStatus(inc.incidentStatus);
              return (
                <button
                  key={inc.incidentId}
                  type="button"
                  onClick={() => setSelectedId(inc.incidentId)}
                  className={`w-full text-left rounded-xl border p-4 transition-all space-y-2 ${
                    selected
                      ? 'border-red-600 bg-red-50/40 ring-1 ring-red-600/30'
                      : active
                      ? 'border-red-200 bg-white hover:border-red-400'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="font-mono text-xs font-bold text-[#0B1220]">
                      {inc.incidentId}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {inc.isDemoScenario ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-800">
                          DEMO ONLY
                        </span>
                      ) : (
                        <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                          LIVE
                        </span>
                      )}
                      <span
                        className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold ${
                          inc.incidentStatus === 'CANCELLED_ACCIDENTAL'
                            ? 'bg-slate-100 text-slate-600'
                            : isTerminalStatus(inc.incidentStatus)
                            ? 'bg-emerald-50 text-emerald-700'
                            : inc.incidentStatus === 'ESCALATED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {inc.incidentStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm font-bold text-[#0B1220]">
                    {inc.activatedByName}{' '}
                    <span className="font-mono text-[11px] font-normal text-slate-500">
                      ({inc.activatedByRole})
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 font-mono">
                    <span>
                      {inc.emergencyCategory
                        ? inc.emergencyCategory.replace(/_/g, ' ')
                        : 'Immediate SOS'}
                    </span>
                    <span>{new Date(inc.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                      Loc: {inc.locationSource}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                      Police: {inc.policeNotificationStatus}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Incident Inspector */}
        <div className="lg:col-span-7 space-y-4">
          {!inspectedIncident ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-500">
              Select an SOS incident on the left to inspect location map, vehicle record, nearest listed police stations, and audit logs.
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-red-600" />
                    <span className="font-mono text-sm font-bold text-[#0B1220]">
                      {inspectedIncident.incidentId}
                    </span>
                    {inspectedIncident.isDemoScenario && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-800">
                        DEMO SANDBOX INCIDENT
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 font-display text-lg font-bold text-[#0B1220]">
                    Activated by {inspectedIncident.activatedByName} ({inspectedIncident.activatedByRole})
                  </h3>
                  {inspectedIncident.emergencyDescription && (
                    <p className="mt-1 text-xs text-slate-600">
                      "{inspectedIncident.emergencyDescription}"
                    </p>
                  )}
                </div>
                <div className="text-right font-mono text-xs">
                  <div className="font-bold text-[#0B1220]">
                    {inspectedIncident.incidentStatus.replace(/_/g, ' ')}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Admin: {inspectedIncident.adminNotificationStatus}
                  </div>
                  <div className="text-[11px] text-amber-800 font-semibold">
                    Police API: {inspectedIncident.policeNotificationStatus}
                  </div>
                </div>
              </div>

              {/* Honest Police Dispatch Status Banner (never fakes confirmation) */}
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950 space-y-1">
                <div className="flex items-center justify-between gap-2 font-bold">
                  <span>Police Communication Status: {inspectedIncident.policeNotificationStatus}</span>
                  <span>Emergency Dial: {inspectedIncident.emergencyNumber}</span>
                </div>
                <p className="text-[11px]">
                  {inspectedIncident.policeNotificationStatus === 'NOT_CONFIGURED'
                    ? 'Official POLICE_EMERGENCY_API_URL is not configured. RideNexa never fabricates police dispatch confirmation — user has immediate 112 dial & nearest OpenStreetMap listed station links.'
                    : inspectedIncident.policeNotificationStatus === 'NOT_INITIATED'
                    ? 'Demo-Only SOS incident: external police dispatch APIs are bypassed.'
                    : inspectedIncident.policeDeliveryError ||
                      `Reference: ${inspectedIncident.policeReferenceId || 'Recorded'}`}
                </p>
              </div>

              {/* Map Visualization */}
              {inspectedIncident.latitude !== undefined && inspectedIncident.longitude !== undefined ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#0B1220]">
                      Incident Location ({inspectedIncident.locationSource})
                      {!inspectedIncident.locationVerifiedCurrent && ' · Unverified Current GPS'}
                    </span>
                    <a
                      href={`https://www.google.com/maps?q=${inspectedIncident.latitude},${inspectedIncident.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[#009F95] hover:underline"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      <span>
                        {inspectedIncident.latitude}, {inspectedIncident.longitude}
                      </span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {inspectedIncident.readableAddress && (
                    <div className="text-xs text-slate-600">{inspectedIncident.readableAddress}</div>
                  )}
                  <CityMap
                    heightClass="h-[260px]"
                    drivers={drivers.filter((d) => d.id === inspectedIncident.driverId)}
                    pickup={
                      inspectedIncident.pickupCoords
                        ? {
                            coordinates: inspectedIncident.pickupCoords,
                            label: inspectedIncident.pickupAddress || 'Ride Pickup',
                          }
                        : null
                    }
                    destination={
                      inspectedIncident.destinationCoords
                        ? {
                            coordinates: inspectedIncident.destinationCoords,
                            label: inspectedIncident.destinationAddress || 'Ride Destination',
                          }
                        : null
                    }
                    emergencyLocation={{
                      coordinates: {
                        lat: inspectedIncident.latitude,
                        lng: inspectedIncident.longitude,
                      },
                      label: `SOS · ${inspectedIncident.incidentId}`,
                      sublabel: `${inspectedIncident.activatedByName} (${inspectedIncident.locationSource})`,
                    }}
                    policeStations={inspectedIncident.nearestPoliceStations}
                    routes={
                      inspectedIncident.routePath && inspectedIncident.routePath.length >= 2
                        ? [
                            {
                              waypoints: inspectedIncident.routePath,
                              color: '#0B1220',
                              weight: 3,
                              dashArray: '5, 5',
                              label: 'Active Ride Corridor',
                            },
                          ]
                        : []
                    }
                    fitToOverlays={true}
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  No GPS coordinates recorded ({inspectedIncident.locationSource}).{' '}
                  {inspectedIncident.manualLocationText
                    ? `Manual user note: "${inspectedIncident.manualLocationText}"`
                    : 'No manual landmark entered.'}
                </div>
              )}

              {/* Passenger, Driver, Vehicle & Ride Record */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1">
                  <div className="font-bold text-[#0B1220] uppercase text-[10px]">
                    Passenger & Ride Details
                  </div>
                  <div>
                    Name: <strong>{inspectedIncident.passengerName || 'Not attached'}</strong>
                  </div>
                  <div>
                    Phone: <strong className="font-mono">{inspectedIncident.passengerPhone || 'Not on file'}</strong>
                  </div>
                  <div>
                    Ride ID: <strong className="font-mono">{inspectedIncident.rideId || 'Standalone'}</strong>
                  </div>
                  {inspectedIncident.pickupAddress && (
                    <div className="truncate">
                      Route: {inspectedIncident.pickupAddress} → {inspectedIncident.destinationAddress}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-1">
                  <div className="font-bold text-[#0B1220] uppercase text-[10px]">
                    Driver & Vehicle Record
                  </div>
                  <div>
                    Driver: <strong>{inspectedIncident.driverName || 'Unassigned'}</strong>
                  </div>
                  <div>
                    Driver Phone:{' '}
                    <strong className="font-mono">{inspectedIncident.driverPhone || 'Not on file'}</strong>
                  </div>
                  <div>
                    Registration:{' '}
                    <strong className="font-mono">
                      {inspectedIncident.vehicleRegistrationNumber || 'Not recorded'}
                    </strong>
                  </div>
                  <div>
                    Model / Tier:{' '}
                    <strong>
                      {inspectedIncident.vehicleModel || 'Not recorded'}
                      {inspectedIncident.vehicleTier ? ` (${inspectedIncident.vehicleTier})` : ''}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Nearest Listed Police Stations */}
              <div className="rounded-lg border border-slate-200 p-3.5 text-xs space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-[#0B1220]">
                    Nearest Listed Police Stations ({inspectedIncident.policeLookupStatus})
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600">
                    Jurisdiction Unconfirmed · OSM Overpass
                  </span>
                </div>
                {inspectedIncident.nearestPoliceStations.length === 0 ? (
                  <p className="text-slate-600">{inspectedIncident.policeLookupNote}</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {inspectedIncident.nearestPoliceStations.map((st) => (
                      <div key={st.id} className="rounded border border-slate-100 bg-slate-50 p-2.5 space-y-1">
                        <div className="font-semibold text-[#0B1220]">{st.name}</div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {st.distanceKm} km away · Nearest listed (jurisdiction unconfirmed)
                        </div>
                        {st.address && <div className="text-[11px] text-slate-600">{st.address}</div>}
                        <div className="flex flex-wrap gap-2 pt-0.5">
                          {st.phone && (
                            <a
                              href={`tel:${st.phone}`}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#009F95] hover:underline"
                            >
                              <PhoneCall className="h-3 w-3" />
                              <span>{st.phone}</span>
                            </a>
                          )}
                          <a
                            href={st.googleMapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:underline"
                          >
                            <Navigation className="h-3 w-3" />
                            <span>Directions</span>
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Admin Coordination Controls (NO fake police acknowledgement button) */}
              {!isTerminalStatus(inspectedIncident.incidentStatus) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3 text-xs">
                  <div className="font-bold text-[#0B1220]">Admin Safety Coordination Actions</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        runAdminSosAction(
                          'ack',
                          `/api/sos/${inspectedIncident.incidentId}/admin-acknowledge`,
                          {},
                          'Incident acknowledged by Admin Safety Desk.'
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B1220] px-3.5 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-[#009F95]" />
                      <span>Acknowledge / Mark Handling</span>
                    </button>

                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        runAdminSosAction(
                          'escalate',
                          `/api/sos/${inspectedIncident.incidentId}/escalate`,
                          { escalationTarget },
                          'Incident escalated to Senior Safety Operations.'
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>Escalate Incident</span>
                    </button>

                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        runAdminSosAction(
                          'resolve',
                          `/api/sos/${inspectedIncident.incidentId}/resolve`,
                          {
                            status: 'RESOLVED',
                            resolutionSummary:
                              resolutionSummary.trim() || 'Safety assistance completed and verified.',
                          },
                          'Incident marked as Resolved.'
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#009F95] px-3.5 py-2 font-semibold text-white hover:bg-[#00867d] disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Mark Resolved</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      value={escalationTarget}
                      onChange={(e) => setEscalationTarget(e.target.value)}
                      placeholder="Escalation target..."
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="text"
                      value={resolutionSummary}
                      onChange={(e) => setResolutionSummary(e.target.value)}
                      placeholder="Resolution summary (optional)..."
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Add Internal Note */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!noteInput.trim()) return;
                  runAdminSosAction(
                    'note',
                    `/api/sos/${inspectedIncident.incidentId}/notes`,
                    { note: noteInput },
                    'Internal safety coordination note saved.'
                  ).then(() => setNoteInput(''));
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Add internal Admin safety note (not exposed to external actors)..."
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#009F95] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busyAction !== null || !noteInput.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#0B1220] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Add Note</span>
                </button>
              </form>

              {/* Notes, Audit Timeline & Admin Access Log */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 text-xs">
                <div className="rounded-lg border border-slate-200 p-3.5 space-y-2">
                  <div className="font-bold text-[#0B1220]">
                    Incident Audit Timeline ({inspectedIncident.events.length})
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                    {inspectedIncident.events.map((evt) => (
                      <div key={evt.id} className="rounded bg-slate-50 p-2">
                        <div className="flex items-center justify-between font-mono text-[10px]">
                          <span className="font-bold text-[#0B1220]">{evt.eventType}</span>
                          <span className="text-slate-400">
                            {new Date(evt.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="mt-0.5 text-slate-600">{evt.message}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 p-3.5 space-y-2">
                    <div className="font-bold text-[#0B1220]">
                      Internal Admin Notes ({inspectedIncident.notes.length})
                    </div>
                    {inspectedIncident.notes.length === 0 ? (
                      <div className="text-slate-400">No internal notes recorded yet.</div>
                    ) : (
                      <div className="max-h-24 overflow-y-auto space-y-1.5">
                        {inspectedIncident.notes.map((n) => (
                          <div key={n.id} className="rounded bg-slate-50 p-2">
                            <div className="font-semibold text-[#0B1220]">
                              {n.authorName} ·{' '}
                              <span className="font-mono text-[10px] text-slate-400">
                                {new Date(n.createdAt).toLocaleTimeString()}
                              </span>
                            </div>
                            <div className="text-slate-700">{n.note}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200 p-3.5 space-y-1.5">
                    <div className="flex items-center gap-1.5 font-bold text-[#0B1220]">
                      <Clock className="h-3.5 w-3.5 text-[#009F95]" />
                      <span>
                        Admin Access Audit Log ({inspectedIncident.adminAccessLog?.length || 0})
                      </span>
                    </div>
                    <div className="max-h-20 overflow-y-auto space-y-1 font-mono text-[10px] text-slate-500">
                      {(inspectedIncident.adminAccessLog || []).slice(0, 8).map((a) => (
                        <div key={a.id}>
                          {a.adminEmail} · {a.action} · {new Date(a.accessedAt).toLocaleTimeString()}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
