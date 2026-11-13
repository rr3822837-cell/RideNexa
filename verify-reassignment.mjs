import { io } from 'socket.io-client';

const BASE = 'http://localhost:3000';
const PICKUP = { lat: 12.9716, lng: 77.5946 }; // MG Road
const DEST = { lat: 12.9352, lng: 77.6245 }; // Koramangala

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, data: json };
}

function connectSocket(token) {
  const socket = io(BASE, {
    auth: token ? { token } : undefined,
    transports: ['websocket'],
    reconnection: false,
  });
  const events = [];
  const origOnevent = socket.onevent;
  socket.onevent = function (packet) {
    const [name, payload] = packet.data || [];
    events.push({ name, payload, ts: Date.now() });
    return origOnevent.call(this, packet);
  };
  return {
    socket,
    events,
    waitFor(name, predicate = () => true, timeoutMs = 10000) {
      const existing = events.find((e) => e.name === name && predicate(e.payload));
      if (existing) return Promise.resolve(existing.payload);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.off(name, handler);
          reject(new Error(`Timed out waiting for socket event "${name}"`));
        }, timeoutMs);
        function handler(payload) {
          if (predicate(payload)) {
            clearTimeout(timer);
            socket.off(name, handler);
            resolve(payload);
          }
        }
        socket.on(name, handler);
      });
    },
    close() {
      socket.disconnect();
    },
  };
}

async function main() {
  console.log('=== RideNexa E2E Assignment, Delivery-Ack Timer & Auto-Reassignment Verification ===');

  // 1. Check /api/health
  const health = await api('/api/health');
  assert(health.ok && health.data.status === 'ok', 'Health endpoint ok');
  assert(
    health.data.driverResponseTimeoutSec === 30,
    `Expected default 30s timeout, got ${health.data.driverResponseTimeoutSec}`
  );
  assert(health.data.osrmEnabled === true, 'Expected osrmEnabled === true');
  console.log('✓ 1. /api/health confirms 30s default timeout and OSRM routing enabled');

  // 2. Login as Admin & verify no unlinked seeded drivers are online
  const adminLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'e2e-admin@ridenexa.test', password: 'TestAdmin#2026' }),
  });
  assert(adminLogin.ok && adminLogin.data.token, 'Admin login succeeded');
  const adminToken = adminLogin.data.token;

  const existingDriversRes = await api('/api/admin/drivers', { token: adminToken });
  assert(existingDriversRes.ok, 'Fetched existing drivers');
  const unlinkedOnline = existingDriversRes.data.drivers.filter(
    (d) => !d.isDemoScenario && !d.userId && d.isOnline
  );
  assert(
    unlinkedOnline.length === 0,
    `Unlinked seeded drivers must be offline, found online: ${unlinkedOnline.map((d) => d.id).join(', ')}`
  );

  const initiallyOnlineIds = existingDriversRes.data.drivers
    .filter((d) => d.isOnline && d.userId && !d.isDemoScenario)
    .map((d) => d.id);

  for (const d of existingDriversRes.data.drivers) {
    if (d.isOnline) {
      await api('/api/drivers/me/status', {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({ driverId: d.id, isOnline: false }),
      });
    }
  }

  // Cancel any stale open non-demo bookings from prior interrupted test runs
  const existingBookingsRes = await api('/api/admin/bookings', { token: adminToken });
  if (existingBookingsRes.ok && Array.isArray(existingBookingsRes.data.bookings)) {
    for (const b of existingBookingsRes.data.bookings) {
      if (
        !b.isDemoScenario &&
        !b.isSimulatedDemo &&
        (b.status === 'SEARCHING_DRIVER' || b.status === 'CONFIRMED')
      ) {
        await api(`/api/bookings/${b.id}/cancel`, {
          method: 'POST',
          token: adminToken,
          body: JSON.stringify({ reason: 'E2E pre-run cleanup' }),
        });
      }
    }
  }
  console.log('✓ 2. Verified unlinked seeded drivers are offline & isolated existing fleet/bookings');

  const createdBookingIds = [];
  const tempDrivers = [];
  const openSockets = [];

  try {
  // 3. Register Passenger + 4 Drivers (3 online at increasing distances, 1 offline closest)
  const suffix = Date.now().toString(36);
  const pReg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'E2E Passenger',
      email: `e2e-p-${suffix}@ridenexa.test`,
      password: 'Password#123',
      role: 'PASSENGER',
      phone: '+91 9900011223',
    }),
  });
  assert(pReg.ok, `Passenger register failed: ${JSON.stringify(pReg.data)}`);
  const passengerToken = pReg.data.token;

  async function createAndApproveDriver(label, coords, online = true) {
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: label,
        email: `${label.toLowerCase().replace(/\s+/g, '-')}-${suffix}@ridenexa.test`,
        password: 'Password#123',
        role: 'DRIVER',
        phone: '+91 9811122233',
        vehicleModel: 'Tata Nexon EV',
        vehicleTier: 'EV_COMFORT',
        plateNumber: `KA-01-${Math.floor(1000 + Math.random() * 8999)}`,
        licenseNumber: `KA01-2024-${Math.floor(10000 + Math.random() * 89999)}`,
      }),
    });
    assert(reg.ok, `Register ${label} failed: ${JSON.stringify(reg.data)}`);
    const drvId = reg.data.driverProfile.id;
    const drvToken = reg.data.token;

    const appRes = await api(`/api/admin/drivers/${drvId}/verify`, {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ action: 'APPROVE' }),
    });
    assert(appRes.ok, `Approve ${label} failed`);

    const locRes = await api('/api/drivers/me/location', {
      method: 'PATCH',
      token: drvToken,
      body: JSON.stringify({ coordinates: coords, areaName: `${label} Zone`, isSimulatedLocation: false }),
    });
    assert(locRes.ok, `Location ${label} failed`);

    if (online) {
      const stRes = await api('/api/drivers/me/status', {
        method: 'PATCH',
        token: drvToken,
        body: JSON.stringify({ isOnline: true }),
      });
      assert(stRes.ok, `Online ${label} failed`);
    }
    return { id: drvId, name: label, token: drvToken };
  }

  const drvOffline = await createAndApproveDriver('Driver Offline Closest', { lat: 12.9717, lng: 77.5949 }, false);
  const drv1 = await createAndApproveDriver('Driver 1 Nearest', { lat: 12.9722, lng: 77.5965 }, true);
  const drv2 = await createAndApproveDriver('Driver 2 Mid', { lat: 12.9745, lng: 77.6105 }, true);
  const drv3 = await createAndApproveDriver('Driver 3 Far', { lat: 12.9784, lng: 77.6408 }, true);
  tempDrivers.push(drvOffline, drv1, drv2, drv3);
  console.log('✓ 3. Provisioned 3 online approved drivers along MG Road corridor + 1 offline driver closest');

  const preNearbyRes = await api(`/api/drivers/nearby?lat=${PICKUP.lat}&lng=${PICKUP.lng}`);
  assert(preNearbyRes.ok && Array.isArray(preNearbyRes.data.drivers), 'Pre-booking /api/drivers/nearby ok');
  assert(
    preNearbyRes.data.drivers.length >= 3 &&
      preNearbyRes.data.drivers[0].id === drv1.id &&
      preNearbyRes.data.drivers[1].id === drv2.id &&
      preNearbyRes.data.drivers[2].id === drv3.id,
    `Expected OSRM nearby order [drv1, drv2, drv3], got ${preNearbyRes.data.drivers
      .map((d) => `${d.name}(${d.distanceKm}km)`)
      .join(', ')}`
  );
  console.log(
    `✓ 3b. OSRM /api/drivers/nearby verified order: ${preNearbyRes.data.drivers
      .slice(0, 3)
      .map((d) => `${d.name}=${d.distanceKm}km`)
      .join(' < ')}`
  );

  const pSock = connectSocket(passengerToken);
  const d1Sock = connectSocket(drv1.token);
  const d2Sock = connectSocket(drv2.token);
  const d3Sock = connectSocket(drv3.token);
  openSockets.push(pSock, d1Sock, d2Sock, d3Sock);
  await new Promise((r) => setTimeout(r, 400));

  // 4. Book Ride -> Nearest online driver (Driver 1) receives request in PENDING_DELIVERY (timer NOT started)
  const book1Res = await api('/api/bookings', {
    method: 'POST',
    token: passengerToken,
    body: JSON.stringify({
      pickupAddress: 'MG Road Metro',
      destinationAddress: 'Koramangala 4th Block',
      pickupCoords: PICKUP,
      destinationCoords: DEST,
      vehicleTier: 'EV_COMFORT',
      paymentMethod: 'UPI',
      idempotencyKey: `e2e-1-${suffix}`,
    }),
  });
  assert(book1Res.status === 201, `Booking 1 create failed: ${JSON.stringify(book1Res.data)}`);
  const bk1 = book1Res.data.booking;
  createdBookingIds.push(bk1.id);
  pSock.socket.emit('booking:join', bk1.id);

  const d1ReqEvt = await d1Sock.waitFor('driver:new-request', (p) => p?.request?.bookingId === bk1.id);
  const req1 = d1ReqEvt.request;
  assert(req1.driverId === drv1.id, `Expected nearest driver (${drv1.id}), got ${req1.driverId}`);
  assert(req1.bookingId === bk1.id, 'Request bookingId matches booking');
  assert(
    req1.pickupAddress === 'MG Road Metro' &&
      req1.destinationAddress === 'Koramangala 4th Block' &&
      req1.distanceKm > 0 &&
      req1.estimatedFare > 0,
    'Request includes pickupAddress, destinationAddress, distanceKm, estimatedFare'
  );
  assert(
    req1.deliveryStatus === 'PENDING_DELIVERY' && !req1.expiresAt,
    `Expected PENDING_DELIVERY with unstarted expiresAt before ack, got ${req1.deliveryStatus} / ${req1.expiresAt}`
  );
  assert(
    d2Sock.events.every((e) => e.name !== 'driver:new-request' || e.payload?.request?.bookingId !== bk1.id),
    'Driver 2 must not receive initial request'
  );
  assert(drvOffline.id !== req1.driverId, 'Offline driver must never receive request');

  // Verify persisted in DB before delivery ack
  const bk1Inspect = await api(`/api/bookings/${bk1.id}`, { token: passengerToken });
  assert(
    bk1Inspect.ok &&
      bk1Inspect.data.driverRequests.some((r) => r.id === req1.id && r.driverId === drv1.id && r.status === 'PENDING'),
    'Request persisted in DB linked to bookingId and driverId'
  );
  console.log(`✓ 4. Booking ${bk1.id} dispatched to nearest driver (${drv1.name}) with unstarted pre-delivery timer`);

  // 5. Driver Dashboard fetch (GET /api/drivers/me) marks request DELIVERED and starts 30s expiry timer
  const d1MeRes = await api('/api/drivers/me', { token: drv1.token });
  assert(d1MeRes.ok, 'GET /api/drivers/me succeeded');
  const deliveredReq1 = d1MeRes.data.pendingRequests.find((r) => r.id === req1.id);
  assert(deliveredReq1, 'Driver dashboard /api/drivers/me returned incoming pendingRequest');
  assert(
    deliveredReq1.deliveryStatus === 'DELIVERED' &&
      Boolean(deliveredReq1.deliveredAt) &&
      Boolean(deliveredReq1.timerStartedAt) &&
      Boolean(deliveredReq1.expiresAt),
    'Delivery marked DELIVERED with deliveredAt, timerStartedAt, and expiresAt'
  );
  const timeoutDurationSec = Math.round(
    (new Date(deliveredReq1.expiresAt).getTime() - new Date(deliveredReq1.deliveredAt).getTime()) / 1000
  );
  assert(timeoutDurationSec === 30, `Expected 30s timer starting at deliveredAt, got ${timeoutDurationSec}s`);
  const d1UpdatedEvt = await d1Sock.waitFor(
    'driver:request-updated',
    (p) => p?.request?.id === req1.id && p?.request?.deliveryStatus === 'DELIVERED'
  );
  assert(Boolean(d1UpdatedEvt.request.expiresAt), 'driver:request-updated socket emitted with started expiresAt');
  console.log('✓ 5. Driver dashboard delivery confirmed -> 30s expiry timer started from deliveredAt');

  // 6. Driver 1 Rejects -> Automatically reassigns to Driver 2 (next nearest)
  const rej1Res = await api(`/api/driver-requests/${req1.id}/reject`, {
    method: 'POST',
    token: drv1.token,
  });
  assert(rej1Res.ok, `Reject 1 failed: ${JSON.stringify(rej1Res.data)}`);

  const reassignedEvt1 = await pSock.waitFor(
    'booking:reassigned',
    (p) => p?.booking?.id === bk1.id && p?.stage === 'REASSIGNING'
  );
  assert(reassignedEvt1.booking.reassignmentCount >= 1, 'Reassignment count incremented');

  const d2ReqEvt = await d2Sock.waitFor(
    'driver:new-request',
    (p) => p?.request?.bookingId === bk1.id && p?.request?.attemptNumber === 2
  );
  const req2 = d2ReqEvt.request;
  assert(req2.driverId === drv2.id, `Expected Attempt #2 to go to Driver 2 (${drv2.id}), got ${req2.driverId}`);

  // Driver 2 acknowledges delivery via POST /ack-delivery and atomically accepts (1 wins, 1 gets 409)
  const ack2Res = await api(`/api/driver-requests/${req2.id}/ack-delivery`, { method: 'POST', token: drv2.token });
  assert(ack2Res.ok && ack2Res.data.request.deliveryStatus === 'DELIVERED', 'Driver 2 /ack-delivery succeeded');

  const [accA, accB] = await Promise.all([
    api(`/api/driver-requests/${req2.id}/accept`, { method: 'POST', token: drv2.token }),
    api(`/api/driver-requests/${req2.id}/accept`, { method: 'POST', token: drv2.token }),
  ]);
  const successes = [accA, accB].filter((r) => r.ok);
  const conflicts = [accA, accB].filter((r) => r.status === 409);
  assert(
    successes.length === 1 && conflicts.length === 1,
    `Expected 1 success + 1 409 conflict, got ${accA.status}, ${accB.status}`
  );

  const assignedEvt = await pSock.waitFor('booking:driver-assigned', (p) => p?.booking?.id === bk1.id);
  assert(
    assignedEvt.booking.status === 'DRIVER_ASSIGNED' && assignedEvt.booking.driverId === drv2.id,
    'Booking updated to DRIVER_ASSIGNED with Driver 2'
  );
  assert(
    d3Sock.events.every((e) => e.name !== 'driver:new-request' || e.payload?.request?.bookingId !== bk1.id),
    'Driver 3 must NOT receive request after Driver 2 accepted'
  );
  console.log('✓ 6. Driver 1 reject -> auto-reassigned Attempt #2 to Driver 2 -> atomic accept -> DRIVER_ASSIGNED (no requests to Driver 3)');

  // 7. Complete ride lifecycle & post-ride payment generation
  await api(`/api/bookings/${bk1.id}/status`, { method: 'PATCH', token: drv2.token, body: JSON.stringify({ status: 'DRIVER_ARRIVING' }) });
  await api(`/api/bookings/${bk1.id}/status`, { method: 'PATCH', token: drv2.token, body: JSON.stringify({ status: 'DRIVER_ARRIVED' }) });
  await api(`/api/bookings/${bk1.id}/status`, { method: 'PATCH', token: drv2.token, body: JSON.stringify({ status: 'TRIP_STARTED' }) });
  const comp1 = await api(`/api/rides/${bk1.id}/complete`, { method: 'POST', token: drv2.token });
  assert(comp1.ok && comp1.data.booking.status === 'COMPLETED' && comp1.data.payment, 'Ride completion & post-ride payment verified');
  console.log('✓ 7. Existing trip lifecycle & post-ride payment generation verified intact');

  // 8. Real Timeout Expiry after Delivery Ack -> Auto-reassigns to next nearest driver (Driver 2)
  const set5s = await api('/api/admin/settings', {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ driverResponseTimeoutSec: 5 }),
  });
  assert(set5s.ok && set5s.data.settings.driverResponseTimeoutSec === 5, 'Updated timeout to 5s for live timer test');

  const book2Res = await api('/api/bookings', {
    method: 'POST',
    token: passengerToken,
    body: JSON.stringify({
      pickupAddress: 'MG Road Metro',
      destinationAddress: 'Indiranagar 100ft Rd',
      pickupCoords: PICKUP,
      destinationCoords: { lat: 12.9784, lng: 77.6408 },
      vehicleTier: 'EV_COMFORT',
      paymentMethod: 'CASH',
      idempotencyKey: `e2e-2-${suffix}`,
    }),
  });
  assert(book2Res.status === 201, 'Booking 2 created');
  const bk2 = book2Res.data.booking;
  createdBookingIds.push(bk2.id);
  pSock.socket.emit('booking:join', bk2.id);

  const b2r1Evt = await d1Sock.waitFor('driver:new-request', (p) => p?.request?.bookingId === bk2.id);
  const b2r1 = b2r1Evt.request;
  assert(b2r1.driverId === drv1.id, 'Booking 2 Attempt #1 went to Driver 1');

  // Acknowledge delivery via Socket.IO event driver:request-delivered (starts 5s timer)
  await new Promise((resolve, reject) => {
    d1Sock.socket.emit('driver:request-delivered', { requestId: b2r1.id }, (ack) => {
      if (ack?.ok) resolve();
      else reject(new Error(`Socket delivery ack failed: ${ack?.error}`));
    });
  });

  const expEvt = await d1Sock.waitFor('driver:request-expired', (p) => p?.request?.id === b2r1.id, 9000);
  assert(expEvt.request.status === 'TIMED_OUT', `Driver 1 request marked TIMED_OUT on timeout, got ${expEvt.request.status}`);

  const b2r2Evt = await d2Sock.waitFor(
    'driver:new-request',
    (p) => p?.request?.bookingId === bk2.id && p?.request?.attemptNumber === 2,
    6000
  );
  assert(b2r2Evt.request.driverId === drv2.id, 'Timed-out request auto-reassigned to Driver 2');

  const lateAcc = await api(`/api/driver-requests/${b2r1.id}/accept`, { method: 'POST', token: drv1.token });
  assert(lateAcc.status === 409, `Expected 409 on timed-out request accept, got ${lateAcc.status}`);

  await api('/api/admin/settings', {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ driverResponseTimeoutSec: 30 }),
  });
  await api(`/api/bookings/${bk2.id}/cancel`, { method: 'POST', token: passengerToken, body: JSON.stringify({ reason: 'Cleanup' }) });
  console.log('✓ 8. Socket delivery ack started 5s timer -> TIMED_OUT -> auto-reassigned to Driver 2');

  // 9. Driver goes offline mid-request -> expires & automatically reassigns to Driver 2
  const bookOffRes = await api('/api/bookings', {
    method: 'POST',
    token: passengerToken,
    body: JSON.stringify({
      pickupAddress: 'MG Road Metro',
      destinationAddress: 'Indiranagar 100ft Rd',
      pickupCoords: PICKUP,
      destinationCoords: { lat: 12.9784, lng: 77.6408 },
      vehicleTier: 'EV_COMFORT',
      paymentMethod: 'CASH',
      idempotencyKey: `e2e-off-${suffix}`,
    }),
  });
  const bkOff = bookOffRes.data.booking;
  createdBookingIds.push(bkOff.id);
  pSock.socket.emit('booking:join', bkOff.id);
  const offReq1 = (await d1Sock.waitFor('driver:new-request', (p) => p?.request?.bookingId === bkOff.id)).request;
  assert(offReq1.driverId === drv1.id, 'Offline-mid-request Attempt #1 went to Driver 1');

  await api('/api/drivers/me/status', {
    method: 'PATCH',
    token: drv1.token,
    body: JSON.stringify({ isOnline: false }),
  });

  const offReassign = await d2Sock.waitFor(
    'driver:new-request',
    (p) => p?.request?.bookingId === bkOff.id && p?.request?.attemptNumber === 2,
    6000
  );
  assert(offReassign.request.driverId === drv2.id, 'Driver offline mid-request auto-reassigned to Driver 2');
  await api(`/api/bookings/${bkOff.id}/cancel`, { method: 'POST', token: passengerToken, body: JSON.stringify({ reason: 'Cleanup' }) });
  console.log('✓ 9. Driver offline mid-request -> expired & auto-reassigned to Driver 2');

  // 10. Undeliverable online driver failover (drv1 online in DB, never acks delivery) -> fails over after ~5s to Driver 2
  await api('/api/admin/settings', {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ driverResponseTimeoutSec: 5 }),
  });
  await api('/api/drivers/me/status', { method: 'PATCH', token: drv1.token, body: JSON.stringify({ isOnline: true }) });
  const bookUndelivRes = await api('/api/bookings', {
    method: 'POST',
    token: passengerToken,
    body: JSON.stringify({
      pickupAddress: 'MG Road Metro',
      destinationAddress: 'Indiranagar 100ft Rd',
      pickupCoords: PICKUP,
      destinationCoords: { lat: 12.9784, lng: 77.6408 },
      vehicleTier: 'EV_COMFORT',
      paymentMethod: 'CASH',
      idempotencyKey: `e2e-undeliv-${suffix}`,
    }),
  });
  assert(bookUndelivRes.status === 201, 'Booking undeliverable failover test created');
  const bkUndeliv = bookUndelivRes.data.booking;
  createdBookingIds.push(bkUndeliv.id);
  pSock.socket.emit('booking:join', bkUndeliv.id);
  const undelivReq1 = (await d1Sock.waitFor('driver:new-request', (p) => p?.request?.bookingId === bkUndeliv.id)).request;
  assert(undelivReq1.driverId === drv1.id, 'Undeliverable test Attempt #1 went to Driver 1');
  // Intentionally do NOT call /api/drivers/me, /ack-delivery, or driver:request-delivered for undelivReq1
  const undelivFailover = await d2Sock.waitFor(
    'driver:new-request',
    (p) => p?.request?.bookingId === bkUndeliv.id && p?.request?.attemptNumber === 2,
    9000
  );
  assert(undelivFailover.request.driverId === drv2.id, 'Unacknowledged delivery failed over to Driver 2');
  await api('/api/admin/settings', {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ driverResponseTimeoutSec: 30 }),
  });
  await api(`/api/bookings/${bkUndeliv.id}/cancel`, { method: 'POST', token: passengerToken, body: JSON.stringify({ reason: 'Cleanup' }) });
  console.log('✓ 10. Undeliverable driver failover (no delivery ack within 5s) -> auto-reassigned to Driver 2');

  // 11. Test GET /api/drivers/nearby + 0-online-drivers initial wait -> newly online driver gets Attempt #1
  await api('/api/drivers/me/status', { method: 'PATCH', token: drv1.token, body: JSON.stringify({ isOnline: false }) });
  const nearbyRes = await api(`/api/drivers/nearby?lat=${PICKUP.lat}&lng=${PICKUP.lng}`);
  assert(nearbyRes.ok && Array.isArray(nearbyRes.data.drivers), 'GET /api/drivers/nearby returned drivers array');
  assert(nearbyRes.data.drivers[0]?.id === drv2.id, `Expected nearest online in /api/drivers/nearby to be ${drv2.id}, got ${nearbyRes.data.drivers[0]?.id}`);
  console.log(`✓ 11a. GET /api/drivers/nearby returned ${nearbyRes.data.count} nearby driver(s), nearest=${nearbyRes.data.drivers[0].name} (${nearbyRes.data.drivers[0].distanceKm} km)`);

  await api('/api/drivers/me/status', { method: 'PATCH', token: drv2.token, body: JSON.stringify({ isOnline: false }) });
  await api('/api/drivers/me/status', { method: 'PATCH', token: drv3.token, body: JSON.stringify({ isOnline: false }) });

  const book3Res = await api('/api/bookings', {
    method: 'POST',
    token: passengerToken,
    body: JSON.stringify({
      pickupAddress: 'MG Road Metro',
      destinationAddress: 'Koramangala 4th Block',
      pickupCoords: PICKUP,
      destinationCoords: DEST,
      vehicleTier: 'EV_COMFORT',
      paymentMethod: 'CASH',
      idempotencyKey: `e2e-3-${suffix}`,
    }),
  });
  assert(book3Res.status === 201, 'Booking 3 created with 0 online drivers');
  const bk3 = book3Res.data.booking;
  createdBookingIds.push(bk3.id);
  assert(
    bk3.allocationStatus === 'WAITING_FOR_DRIVER' && bk3.searchStage === 'WAITING_FOR_DRIVER',
    `0 online drivers enters WAITING_FOR_DRIVER (got ${bk3.allocationStatus})`
  );
  pSock.socket.emit('booking:join', bk3.id);

  await api('/api/drivers/me/status', { method: 'PATCH', token: drv3.token, body: JSON.stringify({ isOnline: true }) });
  const b3ReqEvt = await d3Sock.waitFor('driver:new-request', (p) => p?.request?.bookingId === bk3.id, 6000);
  assert(b3ReqEvt.request.driverId === drv3.id && b3ReqEvt.request.attemptNumber === 1, 'Newly online driver received initial Attempt #1 request');

  await api(`/api/bookings/${bk3.id}/cancel`, { method: 'POST', token: passengerToken, body: JSON.stringify({ reason: 'Cleanup' }) });
  const sosCheck = await api('/api/sos/active', { token: passengerToken });
  assert(sosCheck.ok, 'SOS /api/sos/active endpoint healthy');
  console.log('✓ 11b. 0-online-drivers enters WAITING_FOR_DRIVER -> newly online driver receives Attempt #1 -> SOS healthy');

  // 12. 4-Driver Availability Matrix & Reassignment Flow:
  // Driver 1 (drv1) = ONLINE + IDLE (nearest) -> REJECTS
  // Driver 2 (drv2) = ONLINE + BUSY -> MUST BE SKIPPED
  // Driver 3 (drvOffline) = OFFLINE (closest) -> MUST BE SKIPPED
  // Driver 4 (drv3) = ONLINE + IDLE -> RECEIVES & ACCEPTS -> BECOMES BUSY & PASSENGER CONFIRMED
  await api('/api/drivers/me/status', { method: 'PATCH', token: drv1.token, body: JSON.stringify({ isOnline: true, isAvailable: true }) });
  await api('/api/drivers/me/status', { method: 'PATCH', token: drv2.token, body: JSON.stringify({ isOnline: true, isAvailable: false }) });
  await api('/api/drivers/me/status', { method: 'PATCH', token: drvOffline.token, body: JSON.stringify({ isOnline: false }) });
  await api('/api/drivers/me/status', { method: 'PATCH', token: drv3.token, body: JSON.stringify({ isOnline: true, isAvailable: true }) });

  const dOffSock = connectSocket(drvOffline.token);
  openSockets.push(dOffSock);
  await new Promise((r) => setTimeout(r, 250));

  const book4Res = await api('/api/bookings', {
    method: 'POST',
    token: passengerToken,
    body: JSON.stringify({
      pickupAddress: 'MG Road Metro',
      destinationAddress: 'Koramangala 4th Block',
      pickupCoords: PICKUP,
      destinationCoords: DEST,
      vehicleTier: 'EV_COMFORT',
      paymentMethod: 'CASH',
      idempotencyKey: `e2e-4drv-${suffix}`,
    }),
  });
  assert(book4Res.status === 201, 'Booking 4 (4-driver matrix) created');
  const bk4 = book4Res.data.booking;
  createdBookingIds.push(bk4.id);
  pSock.socket.emit('booking:join', bk4.id);

  // Driver 1 (ONLINE + IDLE) receives request and fetches /api/drivers/me
  const b4d1Evt = await d1Sock.waitFor('driver:new-request', (p) => p?.request?.bookingId === bk4.id);
  const b4r1 = b4d1Evt.request;
  assert(b4r1.driverId === drv1.id, `Expected Driver 1 (${drv1.id}), got ${b4r1.driverId}`);
  const b4d1Me = await api('/api/drivers/me', { token: drv1.token });
  const b4d1Pending = b4d1Me.data.pendingRequests.find((r) => r.id === b4r1.id);
  assert(
    b4d1Pending &&
      b4d1Pending.passengerName === 'E2E Passenger' &&
      Boolean(b4d1Pending.passengerPhone) &&
      b4d1Pending.pickupAddress === 'MG Road Metro' &&
      b4d1Pending.destinationAddress === 'Koramangala 4th Block' &&
      b4d1Pending.distanceKm > 0 &&
      b4d1Pending.estimatedFare > 0,
    'Driver 1 dashboard includes passenger details, pickup, destination, distance, and estimated fare'
  );

  // Driver 1 rejects
  const b4Rej = await api(`/api/driver-requests/${b4r1.id}/reject`, { method: 'POST', token: drv1.token });
  assert(b4Rej.ok, 'Driver 1 reject succeeded');

  // Driver 4 (drv3, ONLINE + IDLE) receives Attempt #2 directly, skipping BUSY drv2 & OFFLINE drvOffline
  const b4d4Evt = await d3Sock.waitFor(
    'driver:new-request',
    (p) => p?.request?.bookingId === bk4.id && p?.request?.attemptNumber === 2,
    6000
  );
  const b4r2 = b4d4Evt.request;
  assert(b4r2.driverId === drv3.id, `Expected Driver 4 (${drv3.id}), got ${b4r2.driverId}`);
  assert(
    d2Sock.events.every((e) => e.name !== 'driver:new-request' || e.payload?.request?.bookingId !== bk4.id),
    'ONLINE + BUSY Driver 2 must be SKIPPED'
  );
  assert(
    dOffSock.events.every((e) => e.name !== 'driver:new-request' || e.payload?.request?.bookingId !== bk4.id),
    'OFFLINE Driver 3 must be SKIPPED'
  );

  // Driver 4 accepts -> passenger immediately receives confirmation, Driver 4 becomes BUSY
  const b4d4Me = await api('/api/drivers/me', { token: drv3.token });
  assert(b4d4Me.data.pendingRequests.some((r) => r.id === b4r2.id), 'Driver 4 sees incoming request on dashboard');
  const b4Acc = await api(`/api/driver-requests/${b4r2.id}/accept`, { method: 'POST', token: drv3.token });
  assert(b4Acc.ok, 'Driver 4 accept succeeded');
  const b4Assigned = await pSock.waitFor('booking:driver-assigned', (p) => p?.booking?.id === bk4.id);
  assert(b4Assigned.booking.status === 'DRIVER_ASSIGNED' && b4Assigned.booking.driverId === drv3.id, 'Passenger received confirmation for Driver 4');

  const d4BusyMe = await api('/api/drivers/me', { token: drv3.token });
  assert(d4BusyMe.data.driver.isAvailable === false, 'Driver 4 is marked BUSY (isAvailable === false) after accepting');

  // Complete Driver 4 trip -> Driver 4 returns to IDLE
  await api(`/api/bookings/${bk4.id}/status`, { method: 'PATCH', token: drv3.token, body: JSON.stringify({ status: 'DRIVER_ARRIVING' }) });
  await api(`/api/bookings/${bk4.id}/status`, { method: 'PATCH', token: drv3.token, body: JSON.stringify({ status: 'DRIVER_ARRIVED' }) });
  await api(`/api/bookings/${bk4.id}/status`, { method: 'PATCH', token: drv3.token, body: JSON.stringify({ status: 'TRIP_STARTED' }) });
  const comp4 = await api(`/api/rides/${bk4.id}/complete`, { method: 'POST', token: drv3.token });
  assert(comp4.ok && comp4.data.booking.status === 'COMPLETED', 'Driver 4 completed trip');
  const d4IdleMe = await api('/api/drivers/me', { token: drv3.token });
  assert(d4IdleMe.data.driver.isAvailable === true, 'Driver 4 returns to IDLE after completing trip');
  console.log('✓ 12. 4-driver matrix passed: IDLE rejects -> BUSY skipped -> OFFLINE skipped -> IDLE accepts & becomes BUSY -> passenger confirmed');

  console.log('\nALL E2E TESTS PASSED SUCCESSFULLY!');
  } finally {
    await api('/api/admin/settings', {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ driverResponseTimeoutSec: 30 }),
    });
    for (const bkId of createdBookingIds) {
      await api(`/api/bookings/${bkId}/cancel`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ reason: 'E2E post-run cleanup' }),
      });
    }
    for (const tempDrv of tempDrivers) {
      await api('/api/drivers/me/status', {
        method: 'PATCH',
        token: tempDrv.token,
        body: JSON.stringify({ isOnline: false }),
      });
    }
    for (const id of initiallyOnlineIds) {
      await api('/api/drivers/me/status', {
        method: 'PATCH',
        token: adminToken,
        body: JSON.stringify({ driverId: id, isOnline: true }),
      });
    }
    for (const s of openSockets) {
      s.close();
    }
  }
}

main().catch((err) => {
  console.error('\nE2E TEST FAILED:', err);
  process.exit(1);
});
