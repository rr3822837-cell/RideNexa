import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  FileText,
  History,
  LocateFixed,
  Navigation,
  Power,
  ShieldAlert,
  ShieldCheck,
  Star,
  Upload,
  X,
} from 'lucide-react';
import { BookingTimelineModal } from '../components/BookingTimelineModal';
import { CityMap } from '../components/CityMap';
import { SosEmergencyPanel } from '../components/SosEmergencyPanel';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { PRESET_LANDMARKS } from '../data/navigation';
import {
  DriverDocumentType,
  DriverRecord,
  DriverRequestRecord,
  PaymentRecord,
  RepositioningResponse,
  RideRecord,
  RideStatus,
} from '../types/ridenexa';

interface DriverWorkspacePayload {
  driver: DriverRecord;
  activeRide: RideRecord | null;
  incomingRides: RideRecord[];
  pendingRequests: DriverRequestRecord[];
  requestHistory: DriverRequestRecord[];
  rideHistory: RideRecord[];
  payments?: PaymentRecord[];
  repositioning: RepositioningResponse;
  driverResponseTimeoutSec: number;
}

function isDriverPaymentPaid(status?: string): boolean {
  return status === 'PAID' || status === 'SUCCESS';
}

export const DriverDashboard: React.FC = () => {
  const { user, apiFetch } = useAuth();
  const {
    reconnectCount,
    drivers,
    lastRideEvent,
    lastBookingEvent,
    lastPaymentEvent,
    lastDriverRequestEvent,
    lastVerificationEvent,
    emitDriverLocation,
    joinBookingRoom,
    joinDriverRoom,
    ackDriverRequestDelivery,
  } = useSocket();

  const lastHandledDriverEvtTsRef = useRef<number>(0);
  const lastDriverIdRef = useRef<string | null>(null);
  const [workspace, setWorkspace] = useState<DriverWorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<'TRIPS' | 'REQUESTS'>('TRIPS');
  const [timelineBookingId, setTimelineBookingId] = useState<string | null>(null);
  const [showDocForm, setShowDocForm] = useState(false);
  const [docType, setDocType] = useState<DriverDocumentType>('DRIVING_LICENCE');
  const [docLicenceNumber, setDocLicenceNumber] = useState('');
  const [docLicenceExpiry, setDocLicenceExpiry] = useState('2030-12-31');
  const [selectedFile, setSelectedFile] = useState<{
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiFetch<DriverWorkspacePayload>('/api/drivers/me');
      setWorkspace(data);
      if (data.driver?.id) {
        lastDriverIdRef.current = data.driver.id;
        joinDriverRoom(data.driver.id);
      }
      if (data.driver?.licenseNumber && !docLicenceNumber) {
        setDocLicenceNumber(data.driver.licenseNumber);
      }
      if (data.driver?.licenseExpiry) {
        setDocLicenceExpiry(data.driver.licenseExpiry);
      }
      if (data.activeRide?.id) {
        joinBookingRoom(data.activeRide.id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, user, joinBookingRoom, joinDriverRoom]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (
      !lastRideEvent &&
      !lastBookingEvent &&
      !lastPaymentEvent &&
      !lastDriverRequestEvent &&
      !lastVerificationEvent
    ) {
      return;
    }

    if (
      lastDriverRequestEvent &&
      lastDriverRequestEvent.ts > lastHandledDriverEvtTsRef.current
    ) {
      lastHandledDriverEvtTsRef.current = lastDriverRequestEvent.ts;
      const req = lastDriverRequestEvent.request;
      if (lastDriverRequestEvent.event === 'new-request' && req) {
        ackDriverRequestDelivery(req.id);
        setWorkspace((prev) => {
          if (!prev || req.driverId !== prev.driver.id) return prev;
          const exists = prev.pendingRequests.some((r) => r.id === req.id);
          const nextPending = exists
            ? prev.pendingRequests.map((r) => (r.id === req.id ? req : r))
            : [req, ...prev.pendingRequests];
          return { ...prev, pendingRequests: nextPending };
        });
        setNotice(`New ride request (${req.bookingId}) received! Respond before timeout.`);
      } else if (lastDriverRequestEvent.event === 'request-updated' && req) {
        setWorkspace((prev) => {
          if (!prev || req.driverId !== prev.driver.id) return prev;
          const exists = prev.pendingRequests.some((r) => r.id === req.id);
          const nextPending = exists
            ? prev.pendingRequests.map((r) => (r.id === req.id ? req : r))
            : [req, ...prev.pendingRequests];
          return { ...prev, pendingRequests: nextPending };
        });
      } else if (lastDriverRequestEvent.event === 'request-expired') {
        if (req) {
          setWorkspace((prev) =>
            prev
              ? { ...prev, pendingRequests: prev.pendingRequests.filter((r) => r.id !== req.id) }
              : prev
          );
        }
        setNotice('Incoming ride request timed out.');
      } else if (lastDriverRequestEvent.event === 'request-cancelled') {
        if (req) {
          setWorkspace((prev) =>
            prev
              ? { ...prev, pendingRequests: prev.pendingRequests.filter((r) => r.id !== req.id) }
              : prev
          );
        }
        setNotice('Pending ride request was cancelled.');
      }
    }

    if (lastVerificationEvent?.driver) {
      setNotice(
        `Account verification updated: ${lastVerificationEvent.driver.verificationStatus.replace(/_/g, ' ')}.`
      );
    } else if (lastPaymentEvent?.event === 'payment:success') {
      setNotice(
        `Passenger digital payment verified for ride ${lastPaymentEvent.rideId}. Earnings credited!`
      );
    } else if (lastPaymentEvent?.event === 'payment:cash-confirmed') {
      setNotice(`Cash payment confirmed for ride ${lastPaymentEvent.rideId}.`);
    }

    loadWorkspace();
  }, [
    lastRideEvent,
    lastBookingEvent,
    lastPaymentEvent,
    lastDriverRequestEvent,
    lastVerificationEvent,
    ackDriverRequestDelivery,
    loadWorkspace,
  ]);

  useEffect(() => {
    if (reconnectCount > 0) {
      joinDriverRoom(lastDriverIdRef.current || undefined);
      loadWorkspace();
    }
  }, [reconnectCount, joinDriverRoom, loadWorkspace]);

  const shouldPollRequests = Boolean(
    workspace?.driver?.isOnline &&
      workspace?.driver?.verificationStatus === 'APPROVED' &&
      !workspace?.activeRide
  );

  useEffect(() => {
    if (!shouldPollRequests) return;
    const pollTimer = setInterval(() => {
      loadWorkspace();
    }, 2500);
    return () => clearInterval(pollTimer);
  }, [shouldPollRequests, loadWorkspace]);

  useEffect(() => {
    if (!workspace?.pendingRequests?.length) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, [workspace?.pendingRequests?.length]);

  const hasExpiredPendingInView = Boolean(
    workspace?.pendingRequests?.some(
      (req) =>
        Boolean(req.expiresAt) &&
        Number.isFinite(new Date(req.expiresAt).getTime()) &&
        new Date(req.expiresAt).getTime() <= nowMs
    )
  );

  useEffect(() => {
    if (!hasExpiredPendingInView) return;
    const refreshTimer = setTimeout(() => {
      loadWorkspace();
    }, 1200);
    return () => clearTimeout(refreshTimer);
  }, [hasExpiredPendingInView, loadWorkspace]);

  const handleToggleOnline = async () => {
    if (!workspace) return;
    setError(null);
    setBusyAction('toggle');
    try {
      const nextState = !workspace.driver.isOnline;
      await apiFetch('/api/drivers/me/status', {
        method: 'PATCH',
        body: JSON.stringify({ isOnline: nextState, driverId: workspace.driver.id }),
      });
      setNotice(
        nextState ? 'You are now Online and eligible for fair dispatch.' : 'You are now Offline.'
      );
      await loadWorkspace();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleMoveToLandmark = async (landmarkId: string) => {
    const lm = PRESET_LANDMARKS.find((l) => l.id === landmarkId);
    if (!lm || !workspace) return;
    setError(null);
    try {
      await apiFetch('/api/drivers/me/location', {
        method: 'PATCH',
        body: JSON.stringify({
          driverId: workspace.driver.id,
          coordinates: lm.coordinates,
          areaName: lm.name,
          isSimulatedLocation: true,
          bookingId: workspace.activeRide?.id,
        }),
      });
      setNotice(`Updated demonstration driver position to ${lm.name}.`);
      await loadWorkspace();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleUseBrowserGps = () => {
    if (!workspace || !navigator.geolocation) {
      setError('Browser geolocation is unavailable on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = {
          lat: Number(pos.coords.latitude.toFixed(5)),
          lng: Number(pos.coords.longitude.toFixed(5)),
        };
        try {
          await apiFetch('/api/drivers/me/location', {
            method: 'PATCH',
            body: JSON.stringify({
              driverId: workspace.driver.id,
              coordinates: coords,
              areaName: 'Live Browser GPS',
              isSimulatedLocation: false,
              bookingId: workspace.activeRide?.id,
            }),
          });
          emitDriverLocation(
            workspace.driver.id,
            coords,
            'Live Browser GPS',
            workspace.activeRide?.id
          );
          setNotice('Synced live GPS coordinates from your browser.');
          await loadWorkspace();
        } catch (err) {
          setError((err as Error).message);
        }
      },
      () => {
        setError('Location permission denied or unavailable. You can select a city sector instead.');
      }
    );
  };

  const handleAcceptRequest = async (requestId: string) => {
    setError(null);
    setBusyAction(`accept-${requestId}`);
    try {
      await apiFetch(`/api/driver-requests/${requestId}/accept`, {
        method: 'POST',
      });
      setNotice('Ride accepted successfully! Passenger and Admin have been notified in real time.');
      await loadWorkspace();
    } catch (err) {
      setError((err as Error).message);
      await loadWorkspace();
    } finally {
      setBusyAction(null);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    setError(null);
    setBusyAction(`reject-${requestId}`);
    try {
      await apiFetch(`/api/driver-requests/${requestId}/reject`, {
        method: 'POST',
      });
      setNotice('Request rejected and automatically reassigned to the next nearest available driver.');
      await loadWorkspace();
    } catch (err) {
      setError((err as Error).message);
      await loadWorkspace();
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateRideStatus = async (bookingId: string, status: RideStatus) => {
    setError(null);
    setBusyAction(`status-${status}`);
    try {
      if (status === 'COMPLETED') {
        const res = await apiFetch<{ booking: RideRecord; payment: PaymentRecord | null }>(
          `/api/rides/${bookingId}/complete`,
          {
            method: 'POST',
          }
        );
        const finalFare = res.booking.finalFare ?? res.booking.estimatedFare;
        const method = res.booking.paymentMethod || 'CASH';
        setNotice(
          method === 'CASH'
            ? `Ride completed! Final fare is ₹${finalFare}. Collect cash from passenger and click "Confirm Cash Received".`
            : `Ride completed! Final fare is ₹${finalFare} (${method}). Awaiting passenger online payment.`
        );
      } else {
        await apiFetch(`/api/bookings/${bookingId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
        setNotice(
          status === 'TRIP_STARTED'
            ? 'Ride is now In Progress. Tracking duration & route until drop-off.'
            : `Trip status updated to ${status.replace(/_/g, ' ')}.`
        );
      }
      await loadWorkspace();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmCashReceived = async (rideId: string) => {
    setError(null);
    setBusyAction(`cash-${rideId}`);
    try {
      const res = await apiFetch<{ booking: RideRecord; payment: PaymentRecord }>(
        '/api/payments/cash/confirm',
        {
          method: 'POST',
          body: JSON.stringify({ rideId }),
        }
      );
      setNotice(
        `Cash payment of ₹${res.payment.finalFare ?? res.payment.amount} confirmed for ride ${rideId}. Earnings updated!`
      );
      await loadWorkspace();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDocumentFileChange = (file: File | null) => {
    setError(null);
    if (!file) return;
    const allowed = new Set([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
    ]);
    if (!allowed.has(file.type.toLowerCase())) {
      setError('Invalid file type. Only PDF, PNG, JPG, and WEBP documents are accepted.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Document file size must be 2 MB or less.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSelectedFile({
        fileName: file.name,
        mimeType: file.type.toLowerCase(),
        sizeBytes: file.size,
        dataUrl: String(reader.result || ''),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleUploadVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    setError(null);
    setBusyAction('upload-doc');
    try {
      await apiFetch('/api/drivers/me/documents', {
        method: 'POST',
        body: JSON.stringify({
          driverId: workspace.driver.id,
          licenseNumber: docLicenceNumber.trim() || undefined,
          licenseExpiry: docLicenceExpiry || undefined,
          document: selectedFile
            ? {
                docType,
                ...selectedFile,
              }
            : undefined,
        }),
      });
      setSelectedFile(null);
      setShowDocForm(false);
      setNotice('Verification details and documents submitted for Admin review.');
      await loadWorkspace();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  if (loading || !workspace) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-xl bg-white border border-slate-200" />
        <div className="h-96 animate-pulse rounded-xl bg-white border border-slate-200" />
      </div>
    );
  }

  const { driver, activeRide, pendingRequests, requestHistory, rideHistory, repositioning } =
    workspace;
  const driverRec = repositioning.recommendations[0] || null;
  const isApproved = driver.verificationStatus === 'APPROVED';
  const paymentByRideId = new Map(
    (workspace.payments || []).map((p) => [p.rideId || p.bookingId, p])
  );
  const pendingCashRides = rideHistory.filter(
    (r) =>
      r.status === 'COMPLETED' &&
      r.paymentMethod === 'CASH' &&
      !isDriverPaymentPaid(paymentByRideId.get(r.id)?.paymentStatus || r.paymentStatus)
  );

  return (
    <div className="space-y-6">
      {/* Driver Top Header & Online Toggle */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="text-[#009F95]">Driver Workspace</span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span
              className={`font-mono ${
                driver.verificationStatus === 'APPROVED'
                  ? 'text-emerald-700'
                  : driver.verificationStatus === 'REJECTED' ||
                    driver.verificationStatus === 'SUSPENDED'
                  ? 'text-red-700'
                  : 'text-amber-700'
              }`}
            >
              {driver.verificationStatus.replace(/_/g, ' ')}
            </span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1220]">
            {driver.name} · {driver.vehicleModel}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-mono">{driver.plateNumber}</span>
            <span aria-hidden="true">·</span>
            <span>Sector: {driver.areaName}</span>
            <span aria-hidden="true">·</span>
            <span>
              Status:{' '}
              <strong
                className={
                  driver.isOnline
                    ? driver.isAvailable
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                    : 'text-slate-500'
                }
              >
                {!driver.isOnline ? 'OFFLINE' : driver.isAvailable ? 'AVAILABLE' : 'BUSY ON TRIP'}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>{driver.isSimulatedLocation ? 'Simulated location' : 'Live GPS'}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowDocForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0B1220] hover:bg-slate-50 whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5 text-[#009F95]" />
            <span>Documents ({driver.documents?.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={handleUseBrowserGps}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#0B1220] hover:bg-slate-50 whitespace-nowrap"
          >
            <LocateFixed className="h-3.5 w-3.5 text-[#009F95]" />
            <span>Sync GPS</span>
          </button>

          <button
            type="button"
            disabled={busyAction === 'toggle' || (!driver.isOnline && !isApproved)}
            onClick={handleToggleOnline}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap disabled:opacity-50 ${
              driver.isOnline ? 'bg-[#009F95] hover:bg-[#00867d]' : 'bg-slate-700 hover:bg-slate-800'
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            <span>
              {!isApproved
                ? 'Approval Required'
                : driver.isOnline
                ? 'Online · Accepting Rides'
                : 'Offline · Go Online'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('ridenexa:open-sos'))}
            aria-label="Driver Emergency SOS Assistance"
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700 whitespace-nowrap"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>EMERGENCY SOS</span>
          </button>
        </div>
      </div>

      <SosEmergencyPanel
        role="DRIVER"
        activeRide={activeRide}
        fallbackCoords={driver.coordinates}
      />

      {/* Verification Status Gate Banner */}
      {!isApproved && (
        <div
          className={`rounded-xl border p-5 ${
            driver.verificationStatus === 'REJECTED' || driver.verificationStatus === 'SUSPENDED'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-amber-200 bg-amber-50 text-amber-950'
          }`}
        >
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3">
              {driver.verificationStatus === 'REJECTED' ||
              driver.verificationStatus === 'SUSPENDED' ? (
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              )}
              <div className="space-y-1 text-xs sm:text-sm">
                <div className="font-bold">
                  {driver.verificationStatus === 'PENDING_VERIFICATION' &&
                    'Driver Account Pending Admin Verification'}
                  {driver.verificationStatus === 'RESUBMISSION_REQUIRED' &&
                    'Document Resubmission Requested by Admin'}
                  {driver.verificationStatus === 'REJECTED' && 'Driver Verification Rejected'}
                  {driver.verificationStatus === 'SUSPENDED' && 'Driver Account Suspended'}
                </div>
                <p className="text-xs leading-relaxed opacity-90">
                  {driver.verificationStatus === 'PENDING_VERIFICATION' &&
                    'You cannot toggle Online or receive ride allocations until an Administrator reviews your licence and vehicle details.'}
                  {driver.verificationStatus === 'RESUBMISSION_REQUIRED' &&
                    `Admin note: ${driver.resubmissionNote || 'Please upload a clearer driving licence or identity proof document.'}`}
                  {(driver.verificationStatus === 'REJECTED' ||
                    driver.verificationStatus === 'SUSPENDED') &&
                    `Reason: ${driver.rejectionReason || 'Contact RideNexa Administrator for verification details.'}`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDocForm(true)}
              className="rounded-lg bg-[#0B1220] px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              Upload / Update Documents
            </button>
          </div>
        </div>
      )}

      {/* Document Upload & Resubmission Drawer */}
      {showDocForm && (
        <form
          onSubmit={handleUploadVerification}
          className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[#009F95]" />
              <h2 className="font-display text-base font-bold text-[#0B1220]">
                Driver Licence & Verification Documents
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowDocForm(false)}
              className="text-xs font-semibold text-slate-500 hover:text-[#0B1220]"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Driving Licence Number
              </label>
              <input
                type="text"
                value={docLicenceNumber}
                onChange={(e) => setDocLicenceNumber(e.target.value)}
                placeholder="KA01-2020-0014820"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono uppercase focus:border-[#009F95] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">Licence Expiry</label>
              <input
                type="date"
                value={docLicenceExpiry}
                onChange={(e) => setDocLicenceExpiry(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-[#009F95] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">Document Category</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as DriverDocumentType)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-[#009F95] focus:outline-none"
              >
                <option value="DRIVING_LICENCE">Driving Licence</option>
                <option value="IDENTITY_PROOF">Government Identity Proof</option>
                <option value="VEHICLE_RC">Vehicle Registration (RC)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 hover:border-[#009F95]">
              <Upload className="h-4 w-4 text-[#009F95]" />
              <span className="truncate">
                {selectedFile
                  ? `${selectedFile.fileName} (${Math.round(selectedFile.sizeBytes / 1024)} KB)`
                  : 'Select PDF, PNG, JPG, or WEBP file (max 2 MB)...'}
              </span>
              <input
                type="file"
                accept=".pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => handleDocumentFileChange(e.target.files?.[0] || null)}
                className="sr-only"
              />
            </label>

            <button
              type="submit"
              disabled={busyAction === 'upload-doc'}
              className="rounded-lg bg-[#009F95] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#00867d] disabled:opacity-60 whitespace-nowrap"
            >
              {busyAction === 'upload-doc' ? 'Submitting...' : 'Submit Verification Update'}
            </button>
          </div>

          {driver.documents && driver.documents.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <div className="text-xs font-semibold text-slate-600 mb-2">Uploaded Documents</div>
              <div className="flex flex-wrap gap-2">
                {driver.documents.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-mono text-slate-700"
                  >
                    {d.docType}: {d.fileName} ({Math.round(d.sizeBytes / 1024)} KB)
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Daily Earnings</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#0B1220] tabular-nums">
            ₹{driver.dailyEarnings.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            Idle {driver.minutesSinceLastRide} min
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Completed Today</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#0B1220] tabular-nums">
            {driver.ridesCompletedToday} trips
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {driver.totalRidesCompleted} lifetime
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Driver Rating</div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-2xl font-bold text-[#0B1220] tabular-nums">
            <span>{driver.rating.toFixed(2)}</span>
            <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono">
            Licence {driver.licenseNumber || 'On file'}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Fairness & Acceptance</div>
          <div className="mt-1 font-mono text-2xl font-bold text-[#009F95] tabular-nums">
            {Math.round(driver.acceptanceRate * 100)}%
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {driver.allocationOpportunities ?? 0} offers · {driver.acceptedCount ?? 0} acc ·{' '}
            {driver.rejectedCount ?? 0} rej
          </div>
        </div>
      </div>

      {/* Pending Cash Collection Banner */}
      {pendingCashRides.length > 0 && (
        <div className="space-y-3">
          {pendingCashRides.map((cashRide) => {
            const finalAmt = cashRide.finalFare ?? cashRide.estimatedFare;
            return (
              <div
                key={cashRide.id}
                className="flex flex-col justify-between gap-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-5 sm:flex-row sm:items-center"
              >
                <div className="flex items-start gap-3">
                  <Banknote className="mt-0.5 h-6 w-6 shrink-0 text-amber-700" />
                  <div>
                    <div className="font-mono text-xs font-bold text-amber-800">
                      CASH COLLECTION PENDING · {cashRide.id}
                    </div>
                    <h2 className="mt-0.5 font-display text-lg font-bold text-[#0B1220]">
                      Collect ₹{finalAmt} in Cash from {cashRide.passengerName}
                    </h2>
                    <p className="mt-0.5 text-xs text-amber-900">
                      {cashRide.pickupAddress} → {cashRide.destinationAddress} · Final Fare ₹
                      {finalAmt} (Est. ₹{cashRide.estimatedFare}). Confirm only after receiving cash.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => handleConfirmCashReceived(cashRide.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#009F95] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#00867d] disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    {busyAction === `cash-${cashRide.id}`
                      ? 'Confirming...'
                      : `Confirm Cash Received (₹${finalAmt})`}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Split: Incoming/Active Rides + Repositioning Map */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5 space-y-6">
          {/* Incoming Dispatch Requests */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-[#0B1220]">
                Incoming Ride Requests
              </h2>
              <span className="font-mono text-xs text-slate-500">
                Timeout: {workspace.driverResponseTimeoutSec}s
              </span>
            </div>

            {pendingRequests.length === 0 ? (
              <div className="mt-5 rounded-lg border border-dashed border-slate-200 py-8 px-4 text-center">
                <Navigation className="mx-auto h-5 w-5 text-slate-400" />
                <div className="mt-2 text-sm font-semibold text-[#0B1220]">No pending requests</div>
                <p className="mt-1 text-xs text-slate-500">
                  Stay online and idle to receive real-time ride requests as soon as passengers book.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {pendingRequests.map((req) => {
                  const hasDeliveredTimer =
                    Boolean(req.expiresAt) && Number.isFinite(new Date(req.expiresAt).getTime());
                  const secLeft = hasDeliveredTimer
                    ? Math.max(0, Math.ceil((new Date(req.expiresAt).getTime() - nowMs) / 1000))
                    : workspace.driverResponseTimeoutSec;
                  return (
                    <div
                      key={req.id}
                      className="rounded-lg border-2 border-[#009F95] bg-slate-50 p-4 space-y-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-semibold text-slate-500">
                              {req.bookingId}
                            </span>
                            <span className="rounded bg-[#0B1220] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                              Attempt #{req.attemptNumber}
                            </span>
                          </div>
                          <div className="mt-1 text-sm font-bold text-[#0B1220]">
                            Passenger: {req.passengerName}
                            {req.passengerPhone ? (
                              <span className="ml-2 font-mono text-xs font-normal text-slate-600">
                                ({req.passengerPhone})
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">
                            {req.vehicleTier.replace('_', ' ')} · Distance{' '}
                            <strong className="text-[#0B1220]">{req.distanceKm} km</strong> (
                            {req.durationMin} min)
                            {req.pickupDistanceKm !== undefined &&
                              ` · Pickup ${req.pickupDistanceKm} km (${req.pickupEtaMin ?? 3}m away)`}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Estimated Fare
                          </div>
                          <div className="font-mono text-base font-bold text-[#009F95] tabular-nums">
                            ₹{req.estimatedFare}
                          </div>
                          <div className="font-mono text-[11px] text-slate-600">
                            Your Earnings: ₹{req.driverEarnings}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1 rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-700">
                        <div>
                          <strong className="text-[#0B1220]">Pickup:</strong> {req.pickupAddress}
                        </div>
                        <div>
                          <strong className="text-[#0B1220]">Destination:</strong>{' '}
                          {req.destinationAddress}
                        </div>
                      </div>

                      <div className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 text-xs border border-slate-200">
                        <span className="inline-flex items-center gap-1 text-slate-600">
                          <Clock className="h-3.5 w-3.5 text-amber-600" />
                          <span>Respond before timeout</span>
                        </span>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            secLeft <= 6 ? 'text-red-600' : 'text-amber-700'
                          }`}
                        >
                          {secLeft}s remaining
                        </span>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={busyAction !== null || (hasDeliveredTimer && secLeft === 0)}
                          onClick={() => handleAcceptRequest(req.id)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#009F95] px-3 py-2.5 text-xs font-bold text-white hover:bg-[#00867d] disabled:opacity-60"
                        >
                          <Check className="h-4 w-4" />
                          <span>Accept</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() => handleRejectRequest(req.id)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          <X className="h-4 w-4" />
                          <span>Reject</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Quick Sector Relocation Control */}
            <div className="mt-6 border-t border-slate-100 pt-4">
              <label className="block text-xs font-semibold text-slate-700">
                Simulate Driver Location Sector
              </label>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) handleMoveToLandmark(e.target.value);
                }}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-[#009F95] focus:outline-none"
              >
                <option value="">Move vehicle to city sector...</option>
                {PRESET_LANDMARKS.map((lm) => (
                  <option key={lm.id} value={lm.id}>
                    {lm.name} ({lm.area})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Trip */}
          {activeRide && (
            <div className="rounded-xl border border-[#009F95] bg-white p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-[#009F95]">
                    Active Trip · {activeRide.id}
                  </div>
                  <h2 className="font-display text-lg font-bold text-[#0B1220]">
                    Passenger: {activeRide.passengerName}
                  </h2>
                </div>
                <span className="font-mono text-sm font-bold text-[#009F95]">
                  ₹{activeRide.estimatedFare}
                </span>
              </div>

              <div className="space-y-1.5 text-sm text-slate-700">
                <div>
                  <strong className="text-[#0B1220]">Pickup:</strong> {activeRide.pickupAddress}
                </div>
                <div>
                  <strong className="text-[#0B1220]">Drop-off:</strong> {activeRide.destinationAddress}
                </div>
                <div className="font-mono text-xs text-slate-500 tabular-nums">
                  {activeRide.distanceKm} km · Est. {activeRide.durationMin} min · Stage:{' '}
                  <strong className="text-[#0B1220]">
                    {activeRide.status === 'TRIP_STARTED' || activeRide.status === 'IN_PROGRESS'
                      ? 'In Progress'
                      : activeRide.status.replace(/_/g, ' ')}
                  </strong>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Payment Method: <strong className="text-[#0B1220]">{activeRide.paymentMethod || 'CASH'}</strong> ·
                  Est. Fare ₹{activeRide.estimatedFare} (Settled after Ride Completion)
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {(activeRide.status === 'DRIVER_ASSIGNED' || activeRide.status === 'ASSIGNED') && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleUpdateRideStatus(activeRide.id, 'DRIVER_ARRIVING')}
                    className="flex-1 rounded-lg bg-[#0B1220] px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Mark En Route to Pickup
                  </button>
                )}
                {(activeRide.status === 'DRIVER_ARRIVING' || activeRide.status === 'EN_ROUTE') && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleUpdateRideStatus(activeRide.id, 'DRIVER_ARRIVED')}
                    className="flex-1 rounded-lg bg-[#0B1220] px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Mark Arrived at Pickup
                  </button>
                )}
                {activeRide.status === 'DRIVER_ARRIVED' && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleUpdateRideStatus(activeRide.id, 'TRIP_STARTED')}
                    className="flex-1 rounded-lg bg-[#0B1220] px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Start Ride
                  </button>
                )}
                {(activeRide.status === 'TRIP_STARTED' || activeRide.status === 'IN_PROGRESS') && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleUpdateRideStatus(activeRide.id, 'COMPLETED')}
                    className="flex-1 rounded-lg bg-[#009F95] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#00867d]"
                  >
                    {busyAction === 'status-COMPLETED' ? 'Calculating Final Fare...' : 'Complete Ride'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTimelineBookingId(activeRide.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold text-[#0B1220] hover:bg-slate-50"
                >
                  <History className="h-3.5 w-3.5" />
                  <span>Timeline</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('ridenexa:open-sos'))}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-red-700"
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>SOS</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Smart Repositioning Map & Recommendation */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Compass className="h-5 w-5 text-[#009F95]" />
                <h2 className="font-display text-lg font-bold text-[#0B1220]">
                  Smart Repositioning Guidance
                </h2>
              </div>
              <span className="text-xs text-slate-500">
                Projected +1h demand vs active driver supply
              </span>
            </div>

            {driverRec && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-bold text-[#0B1220]">
                    Recommended Target: {driverRec.targetZoneName}
                  </div>
                  <div className="font-mono text-xs font-semibold text-[#009F95] tabular-nums">
                    {driverRec.travelDistanceKm} km ({driverRec.travelMinutes} min) · Priority{' '}
                    {driverRec.priority}
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-600">{driverRec.explanation}</p>
              </div>
            )}

            <CityMap
              heightClass="h-[380px]"
              drivers={drivers}
              selectedDriverId={driver.id}
              heatmapZones={repositioning.hotspots}
              repositionVectors={driverRec ? [driverRec] : []}
              pickup={
                activeRide
                  ? { coordinates: activeRide.pickupCoords, label: activeRide.pickupAddress }
                  : null
              }
              destination={
                activeRide
                  ? {
                      coordinates: activeRide.destinationCoords,
                      label: activeRide.destinationAddress,
                    }
                  : null
              }
              routes={
                activeRide
                  ? [
                      {
                        waypoints: activeRide.routePath,
                        color: '#009F95',
                        weight: 4,
                        label: 'Active Trip',
                      },
                    ]
                  : []
              }
            />
          </div>
        </div>
      </div>

      {/* Persistent Driver Ride & Request History */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <h2 className="font-display text-lg font-bold text-[#0B1220]">
            Driver History & Dispatch Log
          </h2>
          <div className="inline-flex rounded-lg bg-slate-100 p-1 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setHistoryTab('TRIPS')}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                historyTab === 'TRIPS'
                  ? 'bg-white text-[#0B1220] shadow-sm'
                  : 'text-slate-600 hover:text-[#0B1220]'
              }`}
            >
              Completed Trips ({rideHistory.length})
            </button>
            <button
              type="button"
              onClick={() => setHistoryTab('REQUESTS')}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                historyTab === 'REQUESTS'
                  ? 'bg-white text-[#0B1220] shadow-sm'
                  : 'text-slate-600 hover:text-[#0B1220]'
              }`}
            >
              Request Responses ({requestHistory.length})
            </button>
          </div>
        </div>

        {historyTab === 'TRIPS' ? (
          rideHistory.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No completed trips recorded for this driver yet.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-2.5 pr-4">Booking</th>
                    <th className="py-2.5 pr-4">Passenger</th>
                    <th className="py-2.5 pr-4">Corridor</th>
                    <th className="py-2.5 pr-4">Ride Status</th>
                    <th className="py-2.5 pr-4">Payment</th>
                    <th className="py-2.5 pr-4 text-right">Final Fare</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                  {rideHistory.map((r) => {
                    const pRec = paymentByRideId.get(r.id);
                    const pStatus = pRec?.paymentStatus || r.paymentStatus || 'PENDING';
                    const pMethod = pRec?.paymentMethod || r.paymentMethod || 'CASH';
                    const paid = isDriverPaymentPaid(pStatus);
                    const canConfirmCash =
                      r.status === 'COMPLETED' && pMethod === 'CASH' && !paid;
                    return (
                      <tr key={r.id}>
                        <td className="py-3 pr-4 font-mono text-xs text-slate-500">{r.id}</td>
                        <td className="py-3 pr-4 font-semibold text-[#0B1220]">{r.passengerName}</td>
                        <td className="py-3 pr-4 text-slate-600">
                          {r.pickupAddress} → {r.destinationAddress}
                        </td>
                        <td className="py-3 pr-4 font-medium text-emerald-700">
                          {r.status.replace(/_/g, ' ')}
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                              paid
                                ? 'bg-emerald-50 text-emerald-700'
                                : pStatus === 'FAILED'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-amber-50 text-amber-800'
                            }`}
                          >
                            {pMethod} · {paid ? 'Paid' : pStatus}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-right font-mono font-semibold tabular-nums">
                          <div>₹{r.finalFare ?? r.estimatedFare}</div>
                          {r.finalFare !== undefined && r.finalFare !== r.estimatedFare && (
                            <div className="text-[10px] font-normal text-slate-400">
                              Est ₹{r.estimatedFare}
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-right whitespace-nowrap space-x-2">
                          {canConfirmCash && (
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={() => handleConfirmCashReceived(r.id)}
                              className="rounded bg-[#009F95] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#00867d] disabled:opacity-60"
                            >
                              Confirm Cash Received
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setTimelineBookingId(r.id)}
                            className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-[#0B1220] hover:bg-slate-50"
                          >
                            Timeline
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : requestHistory.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No accepted, rejected, or expired dispatch requests logged yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 pr-4">Booking ID</th>
                  <th className="py-2.5 pr-4">Passenger & Route</th>
                  <th className="py-2.5 pr-4">Attempt</th>
                  <th className="py-2.5 pr-4">Response</th>
                  <th className="py-2.5 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                {requestHistory.map((req) => (
                  <tr key={req.id}>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-500">{req.bookingId}</td>
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-[#0B1220]">{req.passengerName}</div>
                      <div className="text-xs text-slate-500">
                        {req.pickupAddress} → {req.destinationAddress}
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs">#{req.attemptNumber}</td>
                    <td className="py-3 pr-4 font-mono text-xs font-semibold">
                      <span
                        className={
                          req.status === 'ACCEPTED'
                            ? 'text-emerald-700'
                            : req.status === 'REJECTED' || req.status === 'EXPIRED' || req.status === 'TIMED_OUT'
                            ? 'text-red-700'
                            : 'text-slate-600'
                        }
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono text-xs text-slate-500">
                      {new Date(req.respondedAt || req.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BookingTimelineModal
        bookingId={timelineBookingId}
        onClose={() => setTimelineBookingId(null)}
      />
    </div>
  );
};
