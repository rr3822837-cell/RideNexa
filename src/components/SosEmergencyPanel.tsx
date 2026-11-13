import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  PhoneCall,
  Share2,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import {
  Coordinates,
  EmergencyCategory,
  EmergencyIncidentRecord,
  RideRecord,
} from '../types/ridenexa';

interface SosEmergencyPanelProps {
  role: 'PASSENGER' | 'DRIVER';
  activeRide?: RideRecord | null;
  fallbackCoords?: Coordinates | null;
  compactTriggerOnly?: boolean;
}

const EMERGENCY_CATEGORIES: { id: EmergencyCategory; label: string }[] = [
  { id: 'HARASSMENT', label: 'Harassment / Misbehaviour' },
  { id: 'THREAT', label: 'Threat / Intimidation' },
  { id: 'UNSAFE_DRIVING', label: 'Unsafe Driving' },
  { id: 'ACCIDENT', label: 'Accident / Crash' },
  { id: 'MEDICAL', label: 'Medical Emergency' },
  { id: 'OTHER', label: 'Other Emergency' },
];

function formatPoliceStatus(status: EmergencyIncidentRecord['policeNotificationStatus']): {
  label: string;
  cls: string;
} {
  if (status === 'ACKNOWLEDGED') {
    return { label: 'Police Acknowledged', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  }
  if (status === 'SUBMITTED') {
    return { label: 'Police API Submitted', cls: 'bg-sky-100 text-sky-800 border-sky-300' };
  }
  if (status === 'FAILED') {
    return { label: 'Police API Failed (Call 112)', cls: 'bg-red-100 text-red-800 border-red-300' };
  }
  if (status === 'NOT_INITIATED') {
    return { label: 'Police Contact Not Initiated', cls: 'bg-amber-100 text-amber-900 border-amber-300' };
  }
  return {
    label: 'Official Police API Not Configured · Dial 112',
    cls: 'bg-amber-100 text-amber-900 border-amber-300',
  };
}

function formatLocationBadge(incident: EmergencyIncidentRecord): { label: string; cls: string } {
  if (incident.locationSource === 'LIVE_GPS') {
    return { label: 'Live GPS Captured', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  }
  if (incident.locationSource === 'LAST_KNOWN_BACKEND') {
    return {
      label: 'Last-Known Location (Current GPS Unverified)',
      cls: 'bg-amber-100 text-amber-900 border-amber-300',
    };
  }
  if (incident.locationSource === 'MANUAL_USER_INPUT') {
    return { label: 'Manual Location Description', cls: 'bg-sky-100 text-sky-900 border-sky-300' };
  }
  return { label: 'Location Unavailable', cls: 'bg-red-100 text-red-800 border-red-300' };
}

export const SosEmergencyPanel: React.FC<SosEmergencyPanelProps> = ({
  role,
  activeRide,
  fallbackCoords,
}) => {
  const { user, apiFetch } = useAuth();
  const { lastSosEvent } = useSocket();

  const [activeIncident, setActiveIncident] = useState<EmergencyIncidentRecord | null>(null);
  const [emergencyNumber, setEmergencyNumber] = useState('112');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<EmergencyCategory | undefined>(undefined);
  const [description, setDescription] = useState('');
  const [manualLocInput, setManualLocInput] = useState('');
  const [manualUpdateInput, setManualUpdateInput] = useState('');
  const [gpsStatusNote, setGpsStatusNote] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [updatingLoc, setUpdatingLoc] = useState(false);
  const [cancellingAccidental, setCancellingAccidental] = useState(false);
  const [showAccidentalConfirm, setShowAccidentalConfirm] = useState(false);
  const [accidentalReason, setAccidentalReason] = useState('Pressed SOS button accidentally');
  const [copiedBanner, setCopiedBanner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadActiveSos = useCallback(async () => {
    if (!user) return;
    try {
      const qs = activeRide?.id ? `?rideId=${encodeURIComponent(activeRide.id)}` : '';
      const res = await apiFetch<{
        incident: EmergencyIncidentRecord | null;
        emergencyNumber?: string;
      }>(`/api/sos/active${qs}`);
      setActiveIncident(res.incident);
      if (res.emergencyNumber) setEmergencyNumber(res.emergencyNumber);
    } catch {
      // Non-fatal on initial load
    }
  }, [apiFetch, user, activeRide?.id]);

  useEffect(() => {
    loadActiveSos();
  }, [loadActiveSos]);

  useEffect(() => {
    const onOpenSos = () => setShowConfirmModal(true);
    window.addEventListener('ridenexa:open-sos', onOpenSos);
    return () => window.removeEventListener('ridenexa:open-sos', onOpenSos);
  }, []);

  useEffect(() => {
    if (!lastSosEvent?.incident) return;
    if (lastSosEvent.incident.activatedBy !== user?.id) return;
    if (
      ['RESOLVED', 'CLOSED', 'CANCELLED_ACCIDENTAL'].includes(lastSosEvent.incident.incidentStatus)
    ) {
      setActiveIncident(null);
    } else {
      setActiveIncident(lastSosEvent.incident);
    }
  }, [lastSosEvent, user?.id]);

  const tryCaptureBrowserGps = (): Promise<{
    latitude?: number;
    longitude?: number;
    locationAccuracy?: number;
    locationTimestamp?: string;
    deniedReason?: string;
  }> => {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve({ deniedReason: 'Geolocation API is not supported on this device/browser.' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: Number(pos.coords.latitude.toFixed(6)),
            longitude: Number(pos.coords.longitude.toFixed(6)),
            locationAccuracy: Math.round(pos.coords.accuracy),
            locationTimestamp: new Date(pos.timestamp).toISOString(),
          });
        },
        (geoErr) => {
          resolve({
            deniedReason:
              geoErr.code === 1
                ? 'Browser location permission denied. SOS will still activate with fallback/manual location.'
                : 'Unable to acquire live GPS signal in time. SOS will still activate.',
          });
        },
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 15000 }
      );
    });
  };

  const handleActivateSos = async () => {
    setError(null);
    setActivating(true);
    setGpsStatusNote('Requesting live GPS location...');

    try {
      const gps = await tryCaptureBrowserGps();
      if (gps.deniedReason) {
        setGpsStatusNote(gps.deniedReason);
      } else {
        setGpsStatusNote(null);
      }

      const idempotencyKey = `sos-${user?.id || 'usr'}-${activeRide?.id || 'standalone'}-${Math.floor(
        Date.now() / 5000
      )}`;

      const res = await apiFetch<{ incident: EmergencyIncidentRecord; deduplicated: boolean }>(
        '/api/sos/activate',
        {
          method: 'POST',
          body: JSON.stringify({
            rideId: activeRide?.id,
            emergencyCategory: selectedCategory,
            emergencyDescription: description.trim() || undefined,
            latitude: gps.latitude,
            longitude: gps.longitude,
            locationAccuracy: gps.locationAccuracy,
            locationTimestamp: gps.locationTimestamp,
            manualLocationText: manualLocInput.trim() || undefined,
            idempotencyKey,
          }),
        }
      );

      setActiveIncident(res.incident);
      setShowConfirmModal(false);
      setSelectedCategory(undefined);
      setDescription('');
      setManualLocInput('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActivating(false);
    }
  };

  const handleRefreshGpsForIncident = async () => {
    if (!activeIncident) return;
    setUpdatingLoc(true);
    setError(null);
    try {
      const gps = await tryCaptureBrowserGps();
      if (gps.latitude === undefined || gps.longitude === undefined) {
        setGpsStatusNote(gps.deniedReason || 'Live GPS unavailable. Use manual location below.');
        return;
      }
      const res = await apiFetch<{ incident: EmergencyIncidentRecord }>(
        `/api/sos/${activeIncident.incidentId}/location`,
        {
          method: 'POST',
          body: JSON.stringify({
            latitude: gps.latitude,
            longitude: gps.longitude,
            locationAccuracy: gps.locationAccuracy,
            locationSource: 'LIVE_GPS',
          }),
        }
      );
      setActiveIncident(res.incident);
      setGpsStatusNote('Live GPS coordinates refreshed and shared with RideNexa Safety Desk.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingLoc(false);
    }
  };

  const handleSaveManualLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeIncident || !manualUpdateInput.trim()) return;
    setUpdatingLoc(true);
    setError(null);
    try {
      const res = await apiFetch<{ incident: EmergencyIncidentRecord }>(
        `/api/sos/${activeIncident.incidentId}/location`,
        {
          method: 'POST',
          body: JSON.stringify({
            locationSource: 'MANUAL_USER_INPUT',
            manualLocationText: manualUpdateInput.trim(),
          }),
        }
      );
      setActiveIncident(res.incident);
      setManualUpdateInput('');
      setGpsStatusNote('Manual landmark/location saved and forwarded to RideNexa Admin.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingLoc(false);
    }
  };

  const handleCancelAccidental = async () => {
    if (!activeIncident) return;
    setCancellingAccidental(true);
    setError(null);
    try {
      await apiFetch(`/api/sos/${activeIncident.incidentId}/cancel-accidental`, {
        method: 'POST',
        body: JSON.stringify({ reason: accidentalReason }),
      });
      setActiveIncident(null);
      setShowAccidentalConfirm(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancellingAccidental(false);
    }
  };

  const buildShareText = (inc: EmergencyIncidentRecord): string => {
    const lines = [
      `EMERGENCY SOS ALERT (${inc.incidentId})`,
      `Activated by: ${inc.activatedByName} (${inc.activatedByRole})`,
      inc.emergencyCategory ? `Category: ${inc.emergencyCategory.replace(/_/g, ' ')}` : null,
      inc.rideId ? `Ride ID: ${inc.rideId}` : null,
      inc.vehicleRegistrationNumber || inc.vehicleModel
        ? `Vehicle: ${[inc.vehicleModel, inc.vehicleRegistrationNumber].filter(Boolean).join(' · ')}`
        : null,
      inc.driverName ? `Driver: ${inc.driverName}` : null,
      inc.passengerName ? `Passenger: ${inc.passengerName}` : null,
      inc.latitude !== undefined && inc.longitude !== undefined
        ? `Location (${inc.locationSource}): ${inc.latitude}, ${inc.longitude} -> https://www.google.com/maps?q=${inc.latitude},${inc.longitude}`
        : `Location: ${inc.manualLocationText || 'GPS Unavailable'}`,
      inc.readableAddress ? `Address: ${inc.readableAddress}` : null,
      `Nearest listed police: ${
        inc.nearestPoliceStations[0]
          ? `${inc.nearestPoliceStations[0].name} (${inc.nearestPoliceStations[0].distanceKm} km, jurisdiction unconfirmed)`
          : `Call ${inc.emergencyNumber}`
      }`,
    ].filter(Boolean);
    return lines.join('\n');
  };

  const handleCopyOrShare = async (useWebShare: boolean) => {
    if (!activeIncident) return;
    const text = buildShareText(activeIncident);
    if (useWebShare && typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `RideNexa SOS ${activeIncident.incidentId}`,
          text,
        });
        return;
      } catch {
        // Fall through to clipboard copy
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBanner(true);
      setTimeout(() => setCopiedBanner(false), 3000);
    } catch {
      setError('Clipboard access unavailable. Please copy coordinates directly.');
    }
  };

  if (!user) return null;

  const policeBadge = activeIncident ? formatPoliceStatus(activeIncident.policeNotificationStatus) : null;
  const locBadge = activeIncident ? formatLocationBadge(activeIncident) : null;
  const mapsUrl =
    activeIncident?.latitude !== undefined && activeIncident?.longitude !== undefined
      ? `https://www.google.com/maps?q=${activeIncident.latitude},${activeIncident.longitude}`
      : null;

  return (
    <>
      {/* Active SOS Incident Safety Panel */}
      {activeIncident && (
        <div
          data-testid="active-sos-panel"
          className="rounded-xl border-2 border-red-600 bg-red-50/60 p-5 sm:p-6 space-y-4 shadow-sm"
        >
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>SOS ACTIVATED · {activeIncident.incidentId}</span>
                </span>
                {locBadge && (
                  <span
                    className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${locBadge.cls}`}
                  >
                    {locBadge.label}
                  </span>
                )}
                <span className="rounded border border-emerald-300 bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-900">
                  Admin{' '}
                  {activeIncident.adminNotificationStatus === 'ACKNOWLEDGED'
                    ? 'Acknowledged & Handling'
                    : 'Notified'}
                </span>
                {policeBadge && (
                  <span
                    className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${policeBadge.cls}`}
                  >
                    {policeBadge.label}
                  </span>
                )}
              </div>
              <h2 className="font-display text-lg font-bold text-[#0B1220]">
                Emergency Assistance Active — Immediate Help Options Ready
              </h2>
              <p className="text-xs text-slate-700">
                RideNexa Safety Operations received this incident. Do not wait for Admin acknowledgement
                if you are in danger — dial <strong>{activeIncident.emergencyNumber}</strong> immediately.
              </p>
            </div>

            {/* Primary Immediate Action: Call 112 */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <a
                href={`tel:${activeIncident.emergencyNumber}`}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-3 text-sm font-bold text-white shadow hover:bg-red-700"
              >
                <PhoneCall className="h-4 w-4" />
                <span>Call {activeIncident.emergencyNumber} Emergency</span>
              </a>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          {gpsStatusNote && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {gpsStatusNote}
            </div>
          )}

          {/* Location, Ride & Vehicle Summary */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-6 rounded-lg border border-slate-200 bg-white p-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#0B1220] uppercase tracking-wide text-[11px]">
                  Captured Location & Share Details
                </span>
                <button
                  type="button"
                  disabled={updatingLoc}
                  onClick={handleRefreshGpsForIncident}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-[#0B1220] hover:bg-slate-50 disabled:opacity-50"
                >
                  <LocateFixed className="h-3 w-3 text-[#009F95]" />
                  <span>{updatingLoc ? 'Refreshing...' : 'Retry Live GPS'}</span>
                </button>
              </div>

              {activeIncident.latitude !== undefined && activeIncident.longitude !== undefined ? (
                <div className="space-y-1">
                  <div className="font-mono text-xs font-semibold text-[#0B1220]">
                    {activeIncident.latitude}, {activeIncident.longitude}
                    {activeIncident.locationAccuracy ? ` (±${activeIncident.locationAccuracy}m)` : ''}
                  </div>
                  {!activeIncident.locationVerifiedCurrent && (
                    <div className="text-[11px] font-semibold text-amber-800">
                      Note: Live browser GPS was unavailable; using last-known backend coordinates (current location unverified).
                    </div>
                  )}
                  {activeIncident.readableAddress && (
                    <div className="text-slate-600">{activeIncident.readableAddress}</div>
                  )}
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[#009F95] hover:underline"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      <span>Open Coordinates in Google Maps</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ) : (
                <div className="rounded bg-amber-50 p-2.5 text-amber-900">
                  Live GPS coordinates are currently unavailable. Enter a nearby landmark below or
                  share your ride & vehicle details directly with {activeIncident.emergencyNumber}.
                </div>
              )}

              {activeIncident.manualLocationText && (
                <div className="rounded bg-slate-50 px-2.5 py-1.5 text-slate-700">
                  <strong>Manual landmark:</strong> {activeIncident.manualLocationText}
                </div>
              )}

              <form onSubmit={handleSaveManualLocation} className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={manualUpdateInput}
                  onChange={(e) => setManualUpdateInput(e.target.value)}
                  placeholder="Enter nearby landmark or street if GPS unavailable..."
                  className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:border-[#009F95] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={updatingLoc || !manualUpdateInput.trim()}
                  className="rounded bg-[#0B1220] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  Update
                </button>
              </form>

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
                <button
                  type="button"
                  onClick={() => handleCopyOrShare(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1220] hover:bg-slate-50"
                >
                  <Copy className="h-3.5 w-3.5 text-[#009F95]" />
                  <span>{copiedBanner ? 'Copied Emergency Text!' : 'Copy Emergency Summary'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyOrShare(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1220] hover:bg-slate-50"
                >
                  <Share2 className="h-3.5 w-3.5 text-[#009F95]" />
                  <span>Share Location & Vehicle</span>
                </button>
              </div>
            </div>

            {/* Vehicle, Ride & Nearest Listed Police Stations */}
            <div className="lg:col-span-6 space-y-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs space-y-1.5">
                <div className="font-bold text-[#0B1220] uppercase tracking-wide text-[11px]">
                  Ride & Vehicle Record (Verified DB)
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <span className="text-slate-500">Ride ID:</span>{' '}
                    <strong className="font-mono text-[#0B1220]">
                      {activeIncident.rideId || 'Standalone SOS'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Vehicle Plate:</span>{' '}
                    <strong className="font-mono text-[#0B1220]">
                      {activeIncident.vehicleRegistrationNumber || 'Not recorded'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Vehicle Model:</span>{' '}
                    <strong className="text-[#0B1220]">
                      {activeIncident.vehicleModel || 'Not recorded'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">
                      {role === 'PASSENGER' ? 'Driver:' : 'Passenger:'}
                    </span>{' '}
                    <strong className="text-[#0B1220]">
                      {role === 'PASSENGER'
                        ? activeIncident.driverName || 'Unassigned'
                        : activeIncident.passengerName || 'Not attached'}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-bold text-[#0B1220] uppercase tracking-wide text-[11px]">
                    Nearest Listed Police Stations
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                    Jurisdiction unconfirmed
                  </span>
                </div>
                {activeIncident.nearestPoliceStations.length === 0 ? (
                  <p className="text-slate-600">
                    {activeIncident.policeLookupNote ||
                      `No listed stations returned nearby. Call ${activeIncident.emergencyNumber} directly for dispatch.`}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {activeIncident.nearestPoliceStations.map((st) => (
                      <div
                        key={st.id}
                        className="flex items-start justify-between gap-2 rounded border border-slate-100 bg-slate-50 p-2"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-[#0B1220] truncate">{st.name}</div>
                          <div className="font-mono text-[10px] text-slate-500">
                            {st.distanceKm} km away · Nearest listed (jurisdiction unconfirmed)
                          </div>
                          {st.address && (
                            <div className="text-[11px] text-slate-600 truncate">{st.address}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {st.phone && (
                            <a
                              href={`tel:${st.phone}`}
                              className="inline-flex items-center gap-1 rounded bg-[#009F95] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#00867d]"
                            >
                              <PhoneCall className="h-3 w-3" />
                              <span>{st.phone}</span>
                            </a>
                          )}
                          <a
                            href={st.googleMapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-[#0B1220] hover:bg-slate-100"
                          >
                            <Navigation className="h-3 w-3" />
                            <span>Map</span>
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Accidental Cancellation Safe Option */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-red-200 pt-3 text-xs">
            <div className="text-slate-600">
              Incident logs are preserved for safety compliance even if marked accidental.
            </div>
            {!showAccidentalConfirm ? (
              <button
                type="button"
                onClick={() => setShowAccidentalConfirm(true)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Mark as Accidental Activation
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={accidentalReason}
                  onChange={(e) => setAccidentalReason(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs"
                  placeholder="Reason..."
                />
                <button
                  type="button"
                  disabled={cancellingAccidental}
                  onClick={handleCancelAccidental}
                  className="rounded bg-[#0B1220] px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {cancellingAccidental ? 'Closing...' : 'Confirm Accidental'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAccidentalConfirm(false)}
                  className="text-xs font-semibold text-slate-500 hover:text-[#0B1220]"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick SOS Confirmation Modal */}
      {showConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sos-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1220]/70 p-4"
        >
          <div className="w-full max-w-lg rounded-xl border-2 border-red-600 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-mono text-[11px] font-bold text-red-600">
                    RIDENEXA EMERGENCY SOS
                  </div>
                  <h2 id="sos-confirm-title" className="font-display text-xl font-bold text-[#0B1220]">
                    Are you experiencing an emergency?
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-[#0B1220]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {activeIncident ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-950 space-y-2">
                <div className="font-bold">
                  SOS Incident {activeIncident.incidentId} is already active.
                </div>
                <p>
                  You can call <strong>{activeIncident.emergencyNumber}</strong> immediately or refresh
                  your live GPS location below.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <a
                    href={`tel:${activeIncident.emergencyNumber}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700"
                  >
                    <PhoneCall className="h-3.5 w-3.5" />
                    <span>Call {activeIncident.emergencyNumber} Now</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0B1220]"
                  >
                    Return to Active SOS Panel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-700">
                    Optional Emergency Type (leave blank to trigger immediately):
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {EMERGENCY_CATEGORIES.map((cat) => {
                      const selected = selectedCategory === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() =>
                            setSelectedCategory(selected ? undefined : cat.id)
                          }
                          className={`rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                            selected
                              ? 'border-red-600 bg-red-50 text-red-800'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional brief note (e.g., driver stopped route)"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-red-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={manualLocInput}
                    onChange={(e) => setManualLocInput(e.target.value)}
                    placeholder="Optional landmark if GPS off"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-red-500 focus:outline-none"
                  />
                </div>

                {/* Data Privacy & Honesty Notice */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-[#0B1220]">
                    <ShieldCheck className="h-3.5 w-3.5 text-[#009F95]" />
                    <span>Privacy & Data Shared Upon SOS Activation</span>
                  </div>
                  <p>
                    Activating SOS captures your live GPS (or falls back to last-known ride location
                    {fallbackCoords ? ` near ${fallbackCoords.lat.toFixed(3)}, ${fallbackCoords.lng.toFixed(3)}` : ''}
                    ), active Ride ID ({activeRide?.id || 'none active'}), vehicle plate/model, and your
                    registered name/phone, alerting RideNexa Safety Admins immediately and providing
                    direct <strong>{emergencyNumber}</strong> emergency dialling.
                  </p>
                </div>

                {gpsStatusNote && (
                  <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {gpsStatusNote}
                  </div>
                )}

                {error && (
                  <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {error}
                  </div>
                )}

                <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Dismiss
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`tel:${emergencyNumber}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 hover:bg-red-100"
                    >
                      <PhoneCall className="h-3.5 w-3.5" />
                      <span>Call {emergencyNumber} Directly</span>
                    </a>
                    <button
                      type="button"
                      disabled={activating}
                      onClick={handleActivateSos}
                      data-testid="confirm-activate-sos"
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-xs font-bold text-white shadow hover:bg-red-700 disabled:opacity-60"
                    >
                      {activating ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 animate-pulse" />
                          <span>Activating SOS...</span>
                        </>
                      ) : (
                        <>
                          <ShieldAlert className="h-4 w-4" />
                          <span>Confirm & Activate SOS</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
