import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  Eye,
  RefreshCw,
  Search,
  Smartphone,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import {
  AdminPaymentRow,
  AdminPaymentSummary,
  DriverRecord,
  PaymentRecord,
  RideEventRecord,
  RideRecord,
} from '../types/ridenexa';

interface AdminPaymentDetailResponse {
  payment: PaymentRecord;
  ride: RideRecord | null;
  passenger: { id: string; name: string; email: string; phone?: string } | null;
  driver: DriverRecord | null;
  events: RideEventRecord[];
}

function isPaid(status?: string): boolean {
  return status === 'PAID' || status === 'SUCCESS';
}

function getStatusBadge(status?: string): { label: string; cls: string } {
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

export const AdminPaymentManagementView: React.FC = () => {
  const { apiFetch } = useAuth();
  const { lastPaymentEvent, lastRideEvent } = useSocket();

  const [query, setQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState<'ALL' | 'CASH' | 'UPI' | 'CARD'>('ALL');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REFUNDED'
  >('ALL');

  const [summary, setSummary] = useState<AdminPaymentSummary | null>(null);
  const [rows, setRows] = useState<AdminPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inspectId, setInspectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminPaymentDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadPayments = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('query', query.trim());
      if (methodFilter !== 'ALL') params.set('method', methodFilter);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);

      const res = await apiFetch<{
        summary: AdminPaymentSummary;
        payments: AdminPaymentRow[];
      }>(`/api/admin/payments?${params.toString()}`);
      setSummary(res.summary);
      setRows(res.payments);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, query, methodFilter, statusFilter]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    if (lastPaymentEvent || lastRideEvent) {
      loadPayments();
    }
  }, [lastPaymentEvent, lastRideEvent, loadPayments]);

  useEffect(() => {
    if (!inspectId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    apiFetch<AdminPaymentDetailResponse>(`/api/admin/payments/${inspectId}`)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inspectId, apiFetch]);

  return (
    <div className="space-y-6">
      {/* Revenue Integrity KPI Strip */}
      {summary && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-medium text-slate-500">Completed Ride Fares</div>
              <div className="mt-1 font-mono text-2xl font-bold text-[#0B1220] tabular-nums">
                ₹{summary.totalCompletedRideFares.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Total billed across completed trips
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5">
              <div className="text-xs font-medium text-emerald-800">
                Collected Revenue (Paid Only)
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                ₹{summary.totalCollectedAmount.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-emerald-700">
                {summary.paidCount} verified paid transaction(s)
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-5">
              <div className="text-xs font-medium text-amber-900">Pending Settlement</div>
              <div className="mt-1 font-mono text-2xl font-bold text-amber-700 tabular-nums">
                ₹{summary.pendingPaymentsAmount.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-amber-800">
                {summary.pendingPaymentsCount} awaiting settlement ({summary.processingCount} processing)
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-medium text-slate-500">Failed & Refunded</div>
              <div className="mt-1 font-mono text-2xl font-bold text-red-700 tabular-nums">
                ₹{summary.failedPaymentsAmount.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {summary.failedPaymentsCount} failed · {summary.refundedPaymentsCount} refunded (₹
                {summary.refundedPaymentsAmount.toLocaleString()})
              </div>
            </div>
          </div>

          {/* Method Breakdown Row */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-amber-50 p-2.5 text-amber-700">
                  <Banknote className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500">Cash Settlements</div>
                  <div className="font-mono text-base font-bold text-[#0B1220]">
                    ₹{summary.byMethod.CASH.collectedAmount.toLocaleString()} paid
                  </div>
                </div>
              </div>
              <div className="text-right font-mono text-xs text-slate-500">
                <div>{summary.byMethod.CASH.count} rides</div>
                <div className="text-amber-700">
                  ₹{summary.byMethod.CASH.pendingAmount.toLocaleString()} due
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-teal-50 p-2.5 text-[#009F95]">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500">UPI Payments</div>
                  <div className="font-mono text-base font-bold text-[#0B1220]">
                    ₹{summary.byMethod.UPI.collectedAmount.toLocaleString()} paid
                  </div>
                </div>
              </div>
              <div className="text-right font-mono text-xs text-slate-500">
                <div>{summary.byMethod.UPI.count} rides</div>
                <div className="text-amber-700">
                  ₹{summary.byMethod.UPI.pendingAmount.toLocaleString()} due
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-slate-100 p-2.5 text-[#0B1220]">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500">Card Payments</div>
                  <div className="font-mono text-base font-bold text-[#0B1220]">
                    ₹{summary.byMethod.CARD.collectedAmount.toLocaleString()} paid
                  </div>
                </div>
              </div>
              <div className="text-right font-mono text-xs text-slate-500">
                <div>{summary.byMethod.CARD.count} rides</div>
                <div className="text-amber-700">
                  ₹{summary.byMethod.CARD.pendingAmount.toLocaleString()} due
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search, Filter & Ledger Table */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#0B1220]">
              Post-Ride Payment Ledger & Reconciliation
            </h2>
            <p className="text-xs text-slate-500">
              Pending Cash and unpaid digital fares remain clearly separated from verified Paid revenue.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Ride ID, Passenger, Txn..."
                className="rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-[#009F95] focus:outline-none"
              />
            </div>

            <select
              value={methodFilter}
              onChange={(e) =>
                setMethodFilter(e.target.value as 'ALL' | 'CASH' | 'UPI' | 'CARD')
              }
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold"
            >
              <option value="ALL">All Methods</option>
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="CARD">Card</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target.value as
                    | 'ALL'
                    | 'PENDING'
                    | 'PROCESSING'
                    | 'PAID'
                    | 'FAILED'
                    | 'REFUNDED'
                )
              }
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="PROCESSING">Processing</option>
              <option value="PAID">Paid</option>
              <option value="FAILED">Failed</option>
              <option value="REFUNDED">Refunded</option>
            </select>

            <button
              type="button"
              onClick={loadPayments}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 pr-3">Payment / Ride</th>
                  <th className="py-2.5 pr-3">Passenger & Driver</th>
                  <th className="py-2.5 pr-3 text-right">Est / Final Fare</th>
                  <th className="py-2.5 pr-3">Method & Mode</th>
                  <th className="py-2.5 pr-3">Status</th>
                  <th className="py-2.5 pr-3">Transaction Ref & Time</th>
                  <th className="py-2.5 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-slate-500">
                      No payment records match the selected filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((p) => {
                    const badge = getStatusBadge(p.paymentStatus);
                    const rideId = p.rideId || p.bookingId;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/70 align-top">
                        <td className="py-3 pr-3 font-mono text-xs">
                          <div className="font-semibold text-[#0B1220]">{rideId}</div>
                          <div className="text-[11px] text-slate-400">{p.id}</div>
                        </td>
                        <td className="py-3 pr-3">
                          <div className="font-semibold text-[#0B1220]">{p.passengerName}</div>
                          <div className="text-[11px] text-slate-500">
                            Driver: {p.driverName || 'Unassigned'}
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-right font-mono tabular-nums">
                          <div className="font-bold text-[#0B1220]">
                            ₹{p.finalFare ?? p.amount}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Est ₹{p.estimatedFare ?? p.amount}
                          </div>
                        </td>
                        <td className="py-3 pr-3 font-mono text-xs">
                          <div className="font-semibold text-[#0B1220]">
                            {p.paymentMethod || p.method}
                          </div>
                          <div className="text-[10px] text-slate-400">{p.gatewayMode}</div>
                        </td>
                        <td className="py-3 pr-3">
                          <span
                            className={`inline-block rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-3 pr-3 font-mono text-[11px] text-slate-600">
                          <div>{p.transactionId || p.transactionReference}</div>
                          <div className="text-slate-400">
                            {p.paidAt
                              ? `Paid ${new Date(p.paidAt).toLocaleString()}`
                              : `Updated ${new Date(p.updatedAt).toLocaleTimeString()}`}
                          </div>
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setInspectId(p.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#0B1220] hover:bg-slate-100"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Details</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payment Detail Inspector Modal */}
      {inspectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1220]/50 p-4">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="text-xs font-semibold text-[#009F95]">
                  Payment & Fare Reconciliation Inspector
                </div>
                <h3 className="font-display text-lg font-bold text-[#0B1220] font-mono">
                  {inspectId}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectId(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#0B1220]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {detailLoading ? (
                <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
              ) : detail ? (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                      <div className="font-semibold text-[#0B1220]">Transaction Metadata</div>
                      <div>
                        Ride ID:{' '}
                        <strong className="font-mono">
                          {detail.payment.rideId || detail.payment.bookingId}
                        </strong>
                      </div>
                      <div>
                        Status:{' '}
                        <strong className="font-mono">{detail.payment.paymentStatus}</strong>
                      </div>
                      <div>
                        Method:{' '}
                        <strong className="font-mono">
                          {detail.payment.paymentMethod || detail.payment.method}
                        </strong>{' '}
                        ({detail.payment.gatewayMode})
                      </div>
                      <div className="font-mono break-all text-slate-600">
                        Txn ID: {detail.payment.transactionId || detail.payment.transactionReference}
                      </div>
                      {detail.payment.gatewayOrderId && (
                        <div className="font-mono break-all text-slate-600">
                          Order ID: {detail.payment.gatewayOrderId}
                        </div>
                      )}
                      {detail.payment.gatewayPaymentId && (
                        <div className="font-mono break-all text-slate-600">
                          Gateway Payment ID: {detail.payment.gatewayPaymentId}
                        </div>
                      )}
                      {detail.payment.cashConfirmedAt && (
                        <div className="text-emerald-700 font-medium">
                          Cash Confirmed: {new Date(detail.payment.cashConfirmedAt).toLocaleString()}{' '}
                          by {detail.payment.cashConfirmedBy}
                        </div>
                      )}
                      {detail.payment.paidAt && (
                        <div className="text-emerald-700 font-medium">
                          Paid At: {new Date(detail.payment.paidAt).toLocaleString()}
                        </div>
                      )}
                      {detail.payment.failureReason && (
                        <div className="text-red-700 font-medium">
                          Failure: {detail.payment.failureReason}
                        </div>
                      )}
                      {detail.payment.refundReference && (
                        <div className="text-amber-800 font-mono">
                          Refund Ref: {detail.payment.refundReference}
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                      <div className="font-semibold text-[#0B1220]">Parties & Fare Summary</div>
                      <div>
                        Passenger: <strong>{detail.passenger?.name || 'N/A'}</strong>{' '}
                        <span className="text-slate-500">{detail.passenger?.email}</span>
                      </div>
                      <div>
                        Driver: <strong>{detail.driver?.name || 'Unassigned'}</strong>
                      </div>
                      {detail.ride && (
                        <>
                          <div className="text-slate-600">
                            {detail.ride.pickupAddress} → {detail.ride.destinationAddress}
                          </div>
                          <div className="font-mono">
                            Est: ₹{detail.payment.estimatedFare ?? detail.ride.estimatedFare} · Final: ₹
                            {detail.payment.finalFare ?? detail.payment.amount}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {detail.payment.fareBreakdown && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                      <div className="flex items-center justify-between font-semibold text-[#0B1220] border-b border-slate-200 pb-1.5">
                        <span>Calculated Fare Breakdown</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {detail.payment.fareBreakdown.distanceSource} ·{' '}
                          {detail.payment.fareBreakdown.durationSource}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-slate-700">
                        <div className="flex justify-between">
                          <span>Base Fare</span>
                          <span className="font-mono">₹{detail.payment.fareBreakdown.baseFare}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>
                            Distance ({detail.payment.fareBreakdown.distanceKm} km)
                          </span>
                          <span className="font-mono">
                            ₹{detail.payment.fareBreakdown.distanceCharge}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>
                            Time ({detail.payment.fareBreakdown.durationMin} min)
                          </span>
                          <span className="font-mono">
                            ₹{detail.payment.fareBreakdown.timeCharge}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Surge ({detail.payment.fareBreakdown.surgeMultiplier}x)</span>
                          <span className="font-mono">
                            ₹{detail.payment.fareBreakdown.surgeCharge}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Pooling Discount</span>
                          <span className="font-mono text-emerald-700">
                            -₹{detail.payment.fareBreakdown.poolingDiscount}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Additional Charges</span>
                          <span className="font-mono">
                            ₹{detail.payment.fareBreakdown.additionalCharges}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {detail.events.length > 0 && (
                    <div>
                      <div className="font-semibold text-[#0B1220] mb-2">
                        Payment & Lifecycle Audit Events
                      </div>
                      <div className="space-y-2 border-l-2 border-slate-200 pl-3">
                        {detail.events.map((evt) => (
                          <div key={evt.id}>
                            <div className="flex items-center justify-between font-mono text-[11px]">
                              <span className="font-bold text-[#0B1220]">{evt.eventType}</span>
                              <span className="text-slate-400">
                                {new Date(evt.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-slate-600">{evt.message}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
