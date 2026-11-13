import React, { useEffect, useState } from 'react';
import { Clock, CreditCard, ShieldCheck, UserCheck, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  DriverRequestRecord,
  PaymentRecord,
  RideEventRecord,
  RideRecord,
} from '../types/ridenexa';

interface BookingTimelineModalProps {
  bookingId: string | null;
  onClose: () => void;
}

interface BookingHistoryResponse {
  booking: RideRecord;
  payment: PaymentRecord | null;
  driverRequests: DriverRequestRecord[];
  events: RideEventRecord[];
}

export const BookingTimelineModal: React.FC<BookingTimelineModalProps> = ({
  bookingId,
  onClose,
}) => {
  const { apiFetch } = useAuth();
  const [data, setData] = useState<BookingHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<BookingHistoryResponse>(`/api/bookings/${bookingId}/history`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId, apiFetch]);

  if (!bookingId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1220]/50 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <div className="text-xs font-semibold text-[#009F95]">Persistent Booking Audit</div>
            <h3 className="font-display text-lg font-bold text-[#0B1220] font-mono">
              {bookingId}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close timeline modal"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#0B1220]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="space-y-3">
              <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : data ? (
            <>
              {/* Payment & Booking Summary */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-[#0B1220]">
                    <ShieldCheck className="h-4 w-4 text-[#009F95]" />
                    <span>Booking Lifecycle</span>
                  </div>
                  <div className="text-slate-600">
                    {data.booking.pickupAddress} → {data.booking.destinationAddress}
                  </div>
                  <div className="font-mono text-[#0B1220]">
                    Status: <strong>{data.booking.status.replace(/_/g, ' ')}</strong>
                  </div>
                  <div className="text-slate-500">
                    Allocation attempts: {data.booking.allocationAttempts ?? 0} · Excluded:{' '}
                    {data.booking.excludedDriverIds?.length ?? 0}
                  </div>
                  {data.booking.searchStartedAt && (
                    <div className="font-mono text-[11px] text-slate-500">
                      Search start: {new Date(data.booking.searchStartedAt).toLocaleTimeString()}
                      {data.booking.lastSearchAt &&
                        ` · Last check: ${new Date(data.booking.lastSearchAt).toLocaleTimeString()}`}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-[#0B1220]">
                    <CreditCard className="h-4 w-4 text-[#009F95]" />
                    <span>
                      Payment Record ({data.payment?.gatewayMode || 'POST-RIDE'})
                    </span>
                  </div>
                  <div className="font-mono text-[#0B1220]">
                    Est: ₹{data.booking.estimatedFare}
                    {data.booking.finalFare !== undefined && (
                      <> · Final: <strong>₹{data.booking.finalFare}</strong></>
                    )}
                  </div>
                  {data.payment ? (
                    <>
                      <div className="font-mono text-[#0B1220]">
                        {data.payment.paymentMethod || data.payment.method} ·{' '}
                        <strong>
                          {(data.payment.paymentStatus || data.payment.status) === 'SUCCESS'
                            ? 'PAID'
                            : data.payment.paymentStatus || data.payment.status}
                        </strong>
                      </div>
                      <div className="font-mono text-[11px] text-slate-600 break-all">
                        Txn: {data.payment.transactionId || data.payment.transactionReference}
                      </div>
                      {data.payment.gatewayOrderId && (
                        <div className="font-mono text-[11px] text-slate-500 break-all">
                          Order: {data.payment.gatewayOrderId}
                        </div>
                      )}
                      {data.payment.cashConfirmedAt && (
                        <div className="text-[11px] text-emerald-700 font-medium">
                          Cash Confirmed: {new Date(data.payment.cashConfirmedAt).toLocaleString()}
                        </div>
                      )}
                      {data.payment.paidAt && (
                        <div className="text-[11px] text-emerald-700 font-medium">
                          Paid At: {new Date(data.payment.paidAt).toLocaleString()}
                        </div>
                      )}
                      {data.payment.fareBreakdown && (
                        <div className="pt-1 text-[11px] text-slate-600 font-mono">
                          Base ₹{data.payment.fareBreakdown.baseFare} + Dist ₹
                          {data.payment.fareBreakdown.distanceCharge} + Time ₹
                          {data.payment.fareBreakdown.timeCharge}
                          {data.payment.fareBreakdown.surgeCharge > 0 &&
                            ` + Surge ₹${data.payment.fareBreakdown.surgeCharge}`}
                        </div>
                      )}
                      {data.payment.refundReference && (
                        <div className="font-mono text-[11px] text-amber-700">
                          Refund: {data.payment.refundReference}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-slate-500">
                      Method: {data.booking.paymentMethod || 'N/A'} · Status:{' '}
                      <strong className="font-mono">
                        {data.booking.paymentStatus || 'PENDING'}
                      </strong>{' '}
                      (settled after completion)
                    </div>
                  )}
                </div>
              </div>

              {/* Driver Allocation Attempts */}
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <UserCheck className="h-3.5 w-3.5 text-[#009F95]" />
                  <span>Driver Dispatch Attempts ({data.driverRequests.length})</span>
                </h4>
                {data.driverRequests.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No driver dispatch requests generated yet.
                  </p>
                ) : (
                  <div className="mt-2.5 space-y-2">
                    {data.driverRequests.map((req) => (
                      <div
                        key={req.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-xs"
                      >
                        <div>
                          <span className="font-mono font-semibold text-slate-500">
                            #{req.attemptNumber}
                          </span>{' '}
                          <span className="font-semibold text-[#0B1220]">{req.driverName}</span>
                          <span className="ml-2 text-slate-500 font-mono">
                            Score {req.allocationScore}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${
                              req.status === 'ACCEPTED'
                                ? 'bg-emerald-50 text-emerald-700'
                                : req.status === 'REJECTED' || req.status === 'TIMED_OUT' || req.status === 'EXPIRED'
                                ? 'bg-red-50 text-red-700'
                                : req.status === 'PENDING'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {req.status}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {new Date(
                              req.rejectedAt || req.timedOutAt || req.respondedAt || req.createdAt
                            ).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Event Log */}
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Clock className="h-3.5 w-3.5 text-[#009F95]" />
                  <span>Lifecycle Event Log ({data.events.length})</span>
                </h4>
                {data.events.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No lifecycle events logged.</p>
                ) : (
                  <div className="mt-2.5 space-y-2.5 border-l-2 border-slate-200 pl-4">
                    {data.events.map((evt) => (
                      <div key={evt.id} className="text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-[#0B1220]">
                            {evt.eventType}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {new Date(evt.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-0.5 text-slate-600">{evt.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
