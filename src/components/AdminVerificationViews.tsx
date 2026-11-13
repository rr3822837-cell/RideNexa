import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  FileText,
  PauseCircle,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  AllocationWeights,
  DriverDocument,
  DriverRecord,
  DriverVerificationStatus,
  SystemSettingsRecord,
} from '../types/ridenexa';

export interface AdminDriverRow extends DriverRecord {
  email?: string;
  phone?: string;
}

export interface AdminPassengerRow {
  id: string;
  name: string;
  email: string;
  phone?: string;
  createdAt: string;
  totalBookings: number;
  completedRides: number;
  cancelledRides: number;
  totalSpend: number;
  lastBookingAt: string | null;
}

interface DocumentPreviewModalProps {
  driver: AdminDriverRow | null;
  onClose: () => void;
}

const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({ driver, onClose }) => {
  const [selectedDoc, setSelectedDoc] = useState<DriverDocument | null>(null);

  useEffect(() => {
    setSelectedDoc(driver?.documents?.[0] || null);
  }, [driver]);

  if (!driver) return null;
  const docs = driver.documents || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1220]/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <div className="text-xs font-semibold text-[#009F95]">Driver Verification Dossier</div>
            <h3 className="font-display text-lg font-bold text-[#0B1220]">
              {driver.name} · {driver.plateNumber}
            </h3>
            <div className="font-mono text-xs text-slate-500">
              Licence: {driver.licenseNumber || 'Not provided'} · Expires:{' '}
              {driver.licenseExpiry || 'N/A'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document preview"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {docs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
              No uploaded binary documents attached yet. Verify licence number on file or request resubmission.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {docs.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setSelectedDoc(doc)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                      selectedDoc?.id === doc.id
                        ? 'border-[#009F95] bg-[#009F95]/10 text-[#0B1220]'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 text-[#009F95]" />
                    <span>
                      {doc.docType.replace(/_/g, ' ')} ({doc.fileName})
                    </span>
                  </button>
                ))}
              </div>

              {selectedDoc && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-slate-600 font-mono">
                    <span>{selectedDoc.fileName}</span>
                    <span>
                      {selectedDoc.mimeType} · {Math.round(selectedDoc.sizeBytes / 1024)} KB
                    </span>
                  </div>
                  {selectedDoc.mimeType === 'application/pdf' ? (
                    <iframe
                      title={selectedDoc.fileName}
                      src={selectedDoc.dataUrl}
                      className="h-96 w-full rounded border border-slate-200 bg-white"
                    />
                  ) : (
                    <img
                      src={selectedDoc.dataUrl}
                      alt={selectedDoc.fileName}
                      className="max-h-96 mx-auto rounded border border-slate-200 object-contain bg-white"
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface DriverVerificationViewProps {
  drivers: AdminDriverRow[];
  onVerifyAction: (
    driverId: string,
    action: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION' | 'SUSPEND' | 'REACTIVATE',
    reason?: string
  ) => Promise<void>;
}

export const AdminDriverVerificationView: React.FC<DriverVerificationViewProps> = ({
  drivers,
  onVerifyAction,
}) => {
  const [statusFilter, setStatusFilter] = useState<'ALL' | DriverVerificationStatus>('ALL');
  const [previewDriver, setPreviewDriver] = useState<AdminDriverRow | null>(null);
  const [actionTarget, setActionTarget] = useState<{
    driverId: string;
    action: 'REJECT' | 'REQUEST_RESUBMISSION' | 'SUSPEND';
  } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (statusFilter === 'ALL') return drivers;
    return drivers.filter((d) => d.verificationStatus === statusFilter);
  }, [drivers, statusFilter]);

  const handleAction = async (
    driverId: string,
    action: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION' | 'SUSPEND' | 'REACTIVATE',
    reason?: string
  ) => {
    setBusyId(driverId);
    try {
      await onVerifyAction(driverId, action, reason);
      setActionTarget(null);
      setReasonText('');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-lg font-bold text-[#0B1220]">
            Driver Onboarding & Document Verification
          </h2>
          <p className="text-xs text-slate-500">
            Drivers remain blocked from going online or receiving allocations until approved by an Administrator.
          </p>
        </div>

        <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1">
          {(
            [
              { id: 'ALL', label: 'All' },
              { id: 'PENDING_VERIFICATION', label: 'Pending' },
              { id: 'RESUBMISSION_REQUIRED', label: 'Resubmit' },
              { id: 'APPROVED', label: 'Approved' },
              { id: 'REJECTED', label: 'Rejected' },
              { id: 'SUSPENDED', label: 'Suspended' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                statusFilter === tab.id
                  ? 'bg-white text-[#0B1220] shadow-sm'
                  : 'text-slate-600 hover:text-[#0B1220]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            No drivers match this verification status filter.
          </div>
        ) : (
          filtered.map((drv) => {
            const isPromptOpen = actionTarget?.driverId === drv.id;
            return (
              <div
                key={drv.id}
                className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
              >
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-base font-bold text-[#0B1220]">
                        {drv.name}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${
                          drv.verificationStatus === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-700'
                            : drv.verificationStatus === 'REJECTED' ||
                              drv.verificationStatus === 'SUSPENDED'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {drv.verificationStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
                      <span>{drv.email || 'Fleet driver'}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {drv.vehicleModel} ({drv.vehicleTier.replace(/_/g, ' ')})
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{drv.plateNumber}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">
                        Licence: {drv.licenseNumber || 'Not provided'}
                      </span>
                    </div>
                    {(drv.rejectionReason || drv.resubmissionNote) && (
                      <div className="text-xs text-red-700">
                        Note: {drv.resubmissionNote || drv.rejectionReason}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewDriver(drv)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1220] hover:bg-slate-50"
                    >
                      <Eye className="h-3.5 w-3.5 text-[#009F95]" />
                      <span>Docs ({drv.documents?.length || 0})</span>
                    </button>

                    {drv.verificationStatus !== 'APPROVED' && (
                      <button
                        type="button"
                        disabled={busyId === drv.id}
                        onClick={() => handleAction(drv.id, 'APPROVE')}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#009F95] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#00867d] disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Approve</span>
                      </button>
                    )}

                    {drv.verificationStatus !== 'RESUBMISSION_REQUIRED' &&
                      drv.verificationStatus !== 'SUSPENDED' && (
                        <button
                          type="button"
                          onClick={() => {
                            setActionTarget({
                              driverId: drv.id,
                              action: 'REQUEST_RESUBMISSION',
                            });
                            setReasonText('');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>Request Resubmission</span>
                        </button>
                      )}

                    {drv.verificationStatus !== 'REJECTED' && (
                      <button
                        type="button"
                        onClick={() => {
                          setActionTarget({ driverId: drv.id, action: 'REJECT' });
                          setReasonText('');
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Reject</span>
                      </button>
                    )}

                    {drv.verificationStatus === 'APPROVED' && (
                      <button
                        type="button"
                        onClick={() => {
                          setActionTarget({ driverId: drv.id, action: 'SUSPEND' });
                          setReasonText('');
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <PauseCircle className="h-3.5 w-3.5" />
                        <span>Suspend</span>
                      </button>
                    )}
                  </div>
                </div>

                {isPromptOpen && actionTarget && (
                  <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      placeholder={`Enter mandatory reason for ${actionTarget.action
                        .toLowerCase()
                        .replace(/_/g, ' ')}...`}
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-[#009F95] focus:outline-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!reasonText.trim() || busyId === drv.id}
                        onClick={() =>
                          handleAction(drv.id, actionTarget.action, reasonText.trim())
                        }
                        className="rounded-lg bg-[#0B1220] px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setActionTarget(null)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <DocumentPreviewModal driver={previewDriver} onClose={() => setPreviewDriver(null)} />
    </div>
  );
};

interface DriverManagementProps {
  drivers: AdminDriverRow[];
  onVerifyAction: (
    driverId: string,
    action: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION' | 'SUSPEND' | 'REACTIVATE',
    reason?: string
  ) => Promise<void>;
}

export const AdminDriverManagementView: React.FC<DriverManagementProps> = ({
  drivers,
  onVerifyAction,
}) => {
  const [query, setQuery] = useState('');
  const [previewDriver, setPreviewDriver] = useState<AdminDriverRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.plateNumber.toLowerCase().includes(q) ||
        d.areaName.toLowerCase().includes(q) ||
        (d.email || '').toLowerCase().includes(q)
    );
  }, [drivers, query]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-lg font-bold text-[#0B1220]">
            Registered Fleet & Driver Management
          </h2>
          <p className="text-xs text-slate-500">
            Live verification state, online/busy telemetry, fairness opportunities, and response counts.
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search driver, plate, sector..."
            className="rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-xs focus:border-[#009F95] focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 font-semibold text-slate-500">
              <th className="py-2.5 pr-3">Driver & Vehicle</th>
              <th className="py-2.5 pr-3">Verification</th>
              <th className="py-2.5 pr-3">Fleet Status</th>
              <th className="py-2.5 pr-3 text-right">Today / Total</th>
              <th className="py-2.5 pr-3 text-right">Offers / Acc / Rej</th>
              <th className="py-2.5 pr-3 text-right">Idle / Accept%</th>
              <th className="py-2.5 pr-3 text-right">Earnings</th>
              <th className="py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50/70">
                <td className="py-3 pr-3">
                  <div className="font-semibold text-[#0B1220]">{d.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {d.vehicleModel} · <span className="font-mono">{d.plateNumber}</span> ·{' '}
                    {d.areaName}
                  </div>
                </td>
                <td className="py-3 pr-3 font-mono text-[11px] font-semibold">
                  <span
                    className={
                      d.verificationStatus === 'APPROVED'
                        ? 'text-emerald-700'
                        : d.verificationStatus === 'SUSPENDED' || d.verificationStatus === 'REJECTED'
                        ? 'text-red-700'
                        : 'text-amber-700'
                    }
                  >
                    {d.verificationStatus}
                  </span>
                </td>
                <td className="py-3 pr-3 font-mono text-[11px]">
                  {!d.isOnline ? (
                    <span className="text-slate-500">OFFLINE</span>
                  ) : d.isAvailable ? (
                    <span className="font-semibold text-[#009F95]">AVAILABLE</span>
                  ) : (
                    <span className="font-semibold text-amber-700">BUSY ON TRIP</span>
                  )}
                </td>
                <td className="py-3 pr-3 text-right font-mono tabular-nums">
                  {d.ridesCompletedToday} / {d.totalRidesCompleted}
                </td>
                <td className="py-3 pr-3 text-right font-mono tabular-nums">
                  {d.allocationOpportunities ?? 0} / {d.acceptedCount ?? 0} /{' '}
                  {d.rejectedCount ?? 0}
                </td>
                <td className="py-3 pr-3 text-right font-mono tabular-nums">
                  {d.minutesSinceLastRide}m · {Math.round(d.acceptanceRate * 100)}%
                </td>
                <td className="py-3 pr-3 text-right font-mono font-semibold tabular-nums">
                  ₹{d.dailyEarnings.toLocaleString()}
                </td>
                <td className="py-3 text-right whitespace-nowrap space-x-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewDriver(d)}
                    className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Docs
                  </button>
                  {d.verificationStatus === 'SUSPENDED' ? (
                    <button
                      type="button"
                      onClick={() => onVerifyAction(d.id, 'REACTIVATE')}
                      className="rounded bg-[#009F95] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#00867d]"
                    >
                      Reactivate
                    </button>
                  ) : d.verificationStatus === 'APPROVED' ? (
                    <button
                      type="button"
                      onClick={() =>
                        onVerifyAction(d.id, 'SUSPEND', 'Suspended via Driver Management')
                      }
                      className="rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                    >
                      Suspend
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onVerifyAction(d.id, 'APPROVE')}
                      className="rounded bg-[#009F95] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#00867d]"
                    >
                      Approve
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DocumentPreviewModal driver={previewDriver} onClose={() => setPreviewDriver(null)} />
    </div>
  );
};

export const AdminPassengerManagementView: React.FC<{ passengers: AdminPassengerRow[] }> = ({
  passengers,
}) => {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return passengers;
    return passengers.filter(
      (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
    );
  }, [passengers, query]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-lg font-bold text-[#0B1220]">
            Registered Passenger Directory
          </h2>
          <p className="text-xs text-slate-500">
            Active passenger accounts with live ride totals, completions, cancellations, and spend.
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search passenger name or email..."
            className="rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-xs focus:border-[#009F95] focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 font-semibold text-slate-500">
              <th className="py-2.5 pr-3">Passenger</th>
              <th className="py-2.5 pr-3">Contact</th>
              <th className="py-2.5 pr-3 text-right">Bookings</th>
              <th className="py-2.5 pr-3 text-right">Completed / Cancelled</th>
              <th className="py-2.5 pr-3 text-right">Total Spend</th>
              <th className="py-2.5 text-right">Last Booking</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">
                  No passengers match your filter.
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/70">
                  <td className="py-3 pr-3 font-semibold text-[#0B1220]">{p.name}</td>
                  <td className="py-3 pr-3 text-slate-600">
                    <div>{p.email}</div>
                    {p.phone && <div className="font-mono text-[11px]">{p.phone}</div>}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono tabular-nums">{p.totalBookings}</td>
                  <td className="py-3 pr-3 text-right font-mono tabular-nums">
                    {p.completedRides} / {p.cancelledRides}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono font-semibold text-[#009F95] tabular-nums">
                    ₹{p.totalSpend.toLocaleString()}
                  </td>
                  <td className="py-3 text-right font-mono text-[11px] text-slate-500">
                    {p.lastBookingAt ? new Date(p.lastBookingAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface SettingsViewProps {
  settings: SystemSettingsRecord | null;
  onSaveSettings: (payload: Partial<SystemSettingsRecord>) => Promise<void>;
}

export const AdminSettingsView: React.FC<SettingsViewProps> = ({ settings, onSaveSettings }) => {
  const [weights, setWeights] = useState<AllocationWeights>({
    eta: settings?.allocationWeights.eta ?? 0.4,
    fairness: settings?.allocationWeights.fairness ?? 0.3,
    reliability: settings?.allocationWeights.reliability ?? 0.15,
    workload: settings?.allocationWeights.workload ?? 0.15,
  });
  const [maxPickupEtaMin, setMaxPickupEtaMin] = useState(settings?.maxPickupEtaMin ?? 25);
  const [maxReassignmentAttempts, setMaxReassignmentAttempts] = useState(
    settings?.maxReassignmentAttempts ?? 5
  );
  const [driverResponseTimeoutSec, setDriverResponseTimeoutSec] = useState(
    settings?.driverResponseTimeoutSec ?? 30
  );
  const [driverSearchIntervalSec, setDriverSearchIntervalSec] = useState(
    settings?.driverSearchIntervalSec ?? 4
  );
  const [maxBookingWaitSec, setMaxBookingWaitSec] = useState(
    settings?.maxBookingWaitSec ?? 180
  );
  const [dispatchStrategy, setDispatchStrategy] = useState<'NEAREST_FIRST' | 'FAIR_BALANCED'>(
    settings?.dispatchStrategy ?? 'NEAREST_FIRST'
  );
  const [surgeDemandRatioThreshold, setSurgeDemandRatioThreshold] = useState(
    settings?.surgeDemandRatioThreshold ?? 1.4
  );
  const [surgeMultiplierCap, setSurgeMultiplierCap] = useState(settings?.surgeMultiplierCap ?? 1.8);
  const [enableOsrmRouting, setEnableOsrmRouting] = useState(settings?.enableOsrmRouting ?? true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setWeights(settings.allocationWeights);
    setMaxPickupEtaMin(settings.maxPickupEtaMin);
    setMaxReassignmentAttempts(settings.maxReassignmentAttempts);
    setDriverResponseTimeoutSec(settings.driverResponseTimeoutSec);
    setDriverSearchIntervalSec(settings.driverSearchIntervalSec ?? 4);
    setMaxBookingWaitSec(settings.maxBookingWaitSec ?? 180);
    setDispatchStrategy(settings.dispatchStrategy ?? 'NEAREST_FIRST');
    setSurgeDemandRatioThreshold(settings.surgeDemandRatioThreshold);
    setSurgeMultiplierCap(settings.surgeMultiplierCap);
    setEnableOsrmRouting(settings.enableOsrmRouting);
  }, [settings]);

  const rawSum = Math.round(
    (weights.eta + weights.fairness + weights.reliability + weights.workload) * 100
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveSettings({
        allocationWeights: weights,
        maxPickupEtaMin,
        maxReassignmentAttempts,
        driverResponseTimeoutSec,
        driverSearchIntervalSec,
        maxBookingWaitSec,
        dispatchStrategy,
        surgeDemandRatioThreshold,
        surgeMultiplierCap,
        enableOsrmRouting,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 bg-white p-6 space-y-6"
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-[#009F95]" />
          <div>
            <h2 className="font-display text-lg font-bold text-[#0B1220]">
              Allocation Weights & Dispatch Configuration
            </h2>
            <p className="text-xs text-slate-500">
              Changes persist in the database and take effect immediately on both live dispatch and Judge Demo Mode.
            </p>
          </div>
        </div>
        {settings?.updatedAt && (
          <span className="font-mono text-[11px] text-slate-500">
            Updated: {new Date(settings.updatedAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* 4-Factor Allocation Weights */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-[#0B1220]">
          <span>4-Factor Driver Allocation Weights (Auto-normalized on save)</span>
          <span className="font-mono text-[#009F95]">Current Sum: {rawSum}%</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              { key: 'eta', label: 'Pickup ETA Weight', defaultHint: 'Default 40%' },
              { key: 'fairness', label: 'Fairness / Idle Weight', defaultHint: 'Default 30%' },
              { key: 'reliability', label: 'Reliability Weight', defaultHint: 'Default 15%' },
              { key: 'workload', label: 'Workload Balance Weight', defaultHint: 'Default 15%' },
            ] as const
          ).map((item) => (
            <div key={item.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex items-center justify-between text-xs font-semibold text-[#0B1220]">
                <span>{item.label}</span>
                <span className="font-mono text-[#009F95]">
                  {Math.round(weights[item.key] * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.05}
                value={weights[item.key]}
                onChange={(e) =>
                  setWeights((prev) => ({ ...prev, [item.key]: Number(e.target.value) }))
                }
                className="mt-2 w-full accent-[#009F95]"
              />
              <div className="mt-1 text-[11px] text-slate-500">{item.defaultHint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Dispatch, Timeout, Surge & Routing */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Max Pickup ETA Radius (minutes)
          </label>
          <input
            type="number"
            min={5}
            max={60}
            value={maxPickupEtaMin}
            onChange={(e) => setMaxPickupEtaMin(Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#009F95] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Max Reassignment Attempts
          </label>
          <input
            type="number"
            min={1}
            max={12}
            value={maxReassignmentAttempts}
            onChange={(e) => setMaxReassignmentAttempts(Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#009F95] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Driver Response Timeout (seconds)
          </label>
          <input
            type="number"
            min={5}
            max={90}
            value={driverResponseTimeoutSec}
            onChange={(e) => setDriverResponseTimeoutSec(Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#009F95] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Continuous Search Interval (seconds)
          </label>
          <input
            type="number"
            min={2}
            max={30}
            value={driverSearchIntervalSec}
            onChange={(e) => setDriverSearchIntervalSec(Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#009F95] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Max Booking Wait Window (seconds)
          </label>
          <input
            type="number"
            min={30}
            max={900}
            value={maxBookingWaitSec}
            onChange={(e) => setMaxBookingWaitSec(Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#009F95] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Surge Trigger Ratio (Demand / Supply)
          </label>
          <input
            type="number"
            min={1.05}
            max={3.0}
            step={0.05}
            value={surgeDemandRatioThreshold}
            onChange={(e) => setSurgeDemandRatioThreshold(Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#009F95] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Surge Multiplier Cap
          </label>
          <input
            type="number"
            min={1.0}
            max={2.5}
            step={0.1}
            value={surgeMultiplierCap}
            onChange={(e) => setSurgeMultiplierCap(Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#009F95] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Live Dispatch Strategy
          </label>
          <select
            value={dispatchStrategy}
            onChange={(e) =>
              setDispatchStrategy(e.target.value as 'NEAREST_FIRST' | 'FAIR_BALANCED')
            }
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#009F95] focus:outline-none"
          >
            <option value="NEAREST_FIRST">Nearest Available Driver First</option>
            <option value="FAIR_BALANCED">4-Factor Fair Allocation Score</option>
          </select>
        </div>

        <div className="flex items-end">
          <label className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
            <input
              type="checkbox"
              checked={enableOsrmRouting}
              onChange={(e) => setEnableOsrmRouting(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#009F95] focus:ring-[#009F95]"
            />
            <span className="font-semibold text-[#0B1220]">
              Enable Live OSRM Road Routing (with graph fallback)
            </span>
          </label>
        </div>
      </div>

      <div className="flex justify-end border-t border-slate-100 pt-4">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-[#009F95] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#00867d] disabled:opacity-60"
        >
          {saving ? 'Saving Settings...' : 'Save Configuration'}
        </button>
      </div>
    </form>
  );
};

export { UserCheck, ShieldAlert };
