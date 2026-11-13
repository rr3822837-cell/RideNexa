import type { Server as SocketIOServer } from 'socket.io';
import {
  Coordinates,
  DriverRecord,
  EmergencyCategory,
  EmergencyEventEntry,
  EmergencyIncidentRecord,
  EmergencyNote,
  IncidentStatus,
  LocationSource,
  NearbyPoliceStation,
  PoliceLookupStatus,
  PoliceNotificationStatus,
  RideRecord,
  UserRole,
} from '../src/types/ridenexa.js';
import { store } from './store.js';

const ACTIVE_TERMINAL_STATUSES = new Set<IncidentStatus>([
  'RESOLVED',
  'CLOSED',
  'CANCELLED_ACCIDENTAL',
]);

const VALID_CATEGORIES = new Set<EmergencyCategory>([
  'HARASSMENT',
  'THREAT',
  'UNSAFE_DRIVING',
  'ACCIDENT',
  'MEDICAL',
  'OTHER',
]);

interface CachedPoliceLookup {
  stations: NearbyPoliceStation[];
  sourceStatus: PoliceLookupStatus;
  note: string;
  cachedAt: number;
}

const policeCache = new Map<string, CachedPoliceLookup>();
const geocodeCache = new Map<string, { address?: string; cachedAt: number }>();

export function getConfiguredEmergencyNumber(): string {
  return process.env.EMERGENCY_NUMBER?.trim() || '112';
}

export function getConfiguredEmergencyCountry(): string {
  return process.env.EMERGENCY_COUNTRY?.trim() || 'IN';
}

export function haversineKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return Number((R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c))).toFixed(2));
}

function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function makeEvent(
  incidentId: string,
  eventType: string,
  actorId: string,
  actorRole: UserRole | 'SYSTEM',
  message: string,
  metadata?: Record<string, string | number | boolean | null>
): EmergencyEventEntry {
  return {
    id: `sosevt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    incidentId,
    eventType,
    actorId,
    actorRole,
    message,
    metadata,
    timestamp: new Date().toISOString(),
  };
}

export async function reverseGeocodeCoordinates(
  lat: number,
  lng: number
): Promise<{ readableAddress?: string; available: boolean }> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = geocodeCache.get(key);
  if (cached && Date.now() - cached.cachedAt < 10 * 60 * 1000) {
    return { readableAddress: cached.address, available: Boolean(cached.address) };
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lng)}&zoom=17&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'RideNexa-SOS-SafetySystem/1.0',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) {
      return { available: false };
    }
    const data = (await res.json()) as { display_name?: string };
    const readableAddress = data.display_name?.trim() || undefined;
    geocodeCache.set(key, { address: readableAddress, cachedAt: Date.now() });
    return { readableAddress, available: Boolean(readableAddress) };
  } catch {
    return { available: false };
  }
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function buildOsmAddress(tags?: Record<string, string>): string | undefined {
  if (!tags) return undefined;
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:suburb'] || tags['addr:neighbourhood'],
    tags['addr:city'] || tags['addr:town'] || tags['addr:state_district'],
    tags['addr:postcode'],
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return tags['addr:full']?.trim() || undefined;
}

export async function lookupNearbyPoliceStations(
  lat: number,
  lng: number,
  radiusMeters = 8000
): Promise<{ stations: NearbyPoliceStation[]; sourceStatus: PoliceLookupStatus; note: string }> {
  if (!isValidCoordinate(lat, lng)) {
    return {
      stations: [],
      sourceStatus: 'NOT_RUN',
      note: 'Coordinates unavailable for nearby police station lookup. Call emergency services directly.',
    };
  }

  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)},${radiusMeters}`;
  const cached = policeCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000) {
    return {
      stations: cached.stations,
      sourceStatus: cached.sourceStatus,
      note: cached.note,
    };
  }

  const query = `[out:json][timeout:5];(node["amenity"="police"](around:${radiusMeters},${lat},${lng});way["amenity"="police"](around:${radiusMeters},${lat},${lng}););out center 15;`;
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  let payload: { elements?: OverpassElement[] } | null = null;
  let lastHttpStatus: number | null = null;

  try {
    payload = await Promise.any(
      endpoints.map(async (endpoint) => {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'RideNexa-SOS-SafetySystem/1.0',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) {
          lastHttpStatus = res.status;
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as { elements?: OverpassElement[] };
      })
    );
  } catch {
    payload = null;
  }

  try {
    if (!payload) {
      return {
        stations: [],
        sourceStatus: 'PROVIDER_UNAVAILABLE',
        note: lastHttpStatus
          ? `OpenStreetMap Overpass directory returned HTTP ${lastHttpStatus}. Dial ${getConfiguredEmergencyNumber()} directly for immediate dispatch.`
          : `Police station directory lookup is temporarily unavailable. Dial ${getConfiguredEmergencyNumber()} directly for immediate emergency help.`,
      };
    }

    const elements = Array.isArray(payload.elements) ? payload.elements : [];

    const mapped: NearbyPoliceStation[] = [];
    for (const el of elements) {
      const sLat = el.lat ?? el.center?.lat;
      const sLng = el.lon ?? el.center?.lon;
      if (typeof sLat !== 'number' || typeof sLng !== 'number') continue;

      const tags = el.tags || {};
      const name = tags.name?.trim() || tags['name:en']?.trim() || 'Listed Police Station (OSM)';
      const phone =
        tags.phone?.trim() ||
        tags['contact:phone']?.trim() ||
        tags['phone:mobile']?.trim() ||
        undefined;
      const address = buildOsmAddress(tags);
      const distanceKm = haversineKm({ lat, lng }, { lat: sLat, lng: sLng });

      mapped.push({
        id: `osm-${el.type}-${el.id}`,
        name,
        address,
        phone,
        coordinates: { lat: sLat, lng: sLng },
        distanceKm,
        jurisdictionStatus: 'NEAREST_LISTED_UNCONFIRMED',
        source: 'OPENSTREETMAP_OVERPASS',
        googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${sLat},${sLng}`,
        osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      });
    }

    mapped.sort((a, b) => a.distanceKm - b.distanceKm);
    const topStations = mapped.slice(0, 5);

    const result: CachedPoliceLookup =
      topStations.length > 0
        ? {
            stations: topStations,
            sourceStatus: 'VERIFIED_OSM',
            note: 'Nearest listed police stations retrieved from OpenStreetMap Overpass. Jurisdictional responsibility is unconfirmed; call 112 for official dispatch.',
            cachedAt: Date.now(),
          }
        : {
            stations: [],
            sourceStatus: 'NO_STATIONS_FOUND',
            note: `No tagged police stations returned within ${(radiusMeters / 1000).toFixed(
              1
            )} km in OpenStreetMap. Call ${getConfiguredEmergencyNumber()} directly.`,
            cachedAt: Date.now(),
          };

    policeCache.set(cacheKey, result);
    return {
      stations: result.stations,
      sourceStatus: result.sourceStatus,
      note: result.note,
    };
  } catch {
    return {
      stations: [],
      sourceStatus: 'PROVIDER_UNAVAILABLE',
      note: `Police station directory lookup is temporarily unavailable. Dial ${getConfiguredEmergencyNumber()} directly for immediate emergency help.`,
    };
  }
}

export async function submitToConfiguredPoliceApi(incident: EmergencyIncidentRecord): Promise<{
  configured: boolean;
  status: PoliceNotificationStatus;
  referenceId?: string;
  error?: string;
  note: string;
}> {
  if (incident.isDemoScenario) {
    return {
      configured: false,
      status: 'NOT_INITIATED',
      note: 'Demo Mode SOS incident: external police APIs and 112 dispatch channels are intentionally disabled.',
    };
  }

  const endpoint = process.env.POLICE_EMERGENCY_API_URL?.trim();
  const apiKey = process.env.POLICE_EMERGENCY_API_KEY?.trim();

  if (!endpoint) {
    return {
      configured: false,
      status: 'NOT_CONFIGURED',
      note: `Official police emergency dispatch API is not configured (POLICE_EMERGENCY_API_URL unset). Use Call ${incident.emergencyNumber} or share coordinates with emergency responders directly.`,
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        incidentId: incident.incidentId,
        rideId: incident.rideId,
        activatedByRole: incident.activatedByRole,
        emergencyCategory: incident.emergencyCategory,
        emergencyDescription: incident.emergencyDescription,
        coordinates:
          incident.latitude !== undefined && incident.longitude !== undefined
            ? {
                lat: incident.latitude,
                lng: incident.longitude,
                accuracyMeters: incident.locationAccuracy,
                source: incident.locationSource,
                timestamp: incident.locationTimestamp,
              }
            : null,
        readableAddress: incident.readableAddress || incident.manualLocationText,
        vehicle: {
          registrationNumber: incident.vehicleRegistrationNumber,
          model: incident.vehicleModel,
          tier: incident.vehicleTier,
        },
        driverName: incident.driverName,
        passengerName: incident.passengerName,
        createdAt: incident.createdAt,
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        configured: true,
        status: 'FAILED',
        error: `HTTP ${res.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`,
        note: `Configured police API returned HTTP ${res.status}. Call ${incident.emergencyNumber} directly.`,
      };
    }

    const body = (await res.json().catch(() => ({}))) as {
      referenceId?: string;
      acknowledged?: boolean;
    };
    return {
      configured: true,
      status: body.acknowledged ? 'ACKNOWLEDGED' : 'SUBMITTED',
      referenceId: body.referenceId || `POL-REF-${Date.now().toString(36).toUpperCase()}`,
      note: body.acknowledged
        ? 'Emergency payload acknowledged by configured police response endpoint.'
        : 'Emergency payload submitted to configured police response endpoint.',
    };
  } catch (err) {
    return {
      configured: true,
      status: 'FAILED',
      error: (err as Error).message || 'Network timeout contacting police endpoint',
      note: `Unable to reach configured police endpoint. Dial ${incident.emergencyNumber} directly.`,
    };
  }
}

export function sanitizeIncidentForViewer(
  incident: EmergencyIncidentRecord,
  viewerId: string,
  viewerRole: UserRole
): EmergencyIncidentRecord {
  if (viewerRole === 'ADMIN') {
    return incident;
  }

  // Activator sees full actionable safety response (nearest police, 112, location, ride/vehicle info),
  // while internal Admin audit notes & Admin access logs remain Admin-only.
  // Also ensure if a driver activated SOS, passenger email is masked.
  const isDriverActivator = incident.activatedByRole === 'DRIVER' && viewerId === incident.activatedBy;
  return {
    ...incident,
    passengerEmail: isDriverActivator ? undefined : incident.passengerEmail,
    notes: [],
    adminAccessLog: undefined,
  };
}

export function canUserAccessSosIncident(
  incident: EmergencyIncidentRecord,
  userId: string,
  userRole: UserRole
): boolean {
  if (userRole === 'ADMIN') return true;
  return incident.activatedBy === userId;
}

function emitSosScoped(
  io: SocketIOServer,
  eventName: string,
  incident: EmergencyIncidentRecord
): void {
  // Always alert Admins cleanly
  io.to('role:ADMIN').emit(eventName, {
    incident,
    isDemoScenario: Boolean(incident.isDemoScenario),
  });
  // Emit ONLY to the SOS activator (never to uninvolved users or an accused counterparty)
  if (incident.activatedBy) {
    io.to(`user:${incident.activatedBy}`).emit(eventName, {
      incident: sanitizeIncidentForViewer(incident, incident.activatedBy, incident.activatedByRole),
      isDemoScenario: Boolean(incident.isDemoScenario),
    });
  }
}

function resolveUserActiveRide(userId: string, userRole: UserRole, explicitRideId?: string): RideRecord | undefined {
  const rides = store.getRides();
  if (explicitRideId) {
    const ride = store.getRideById(explicitRideId);
    if (!ride) {
      throw new Error('NOT_FOUND: Ride booking not found.');
    }
    if (userRole === 'PASSENGER' && ride.passengerId !== userId) {
      throw new Error('FORBIDDEN: You cannot activate SOS for another passenger ride.');
    }
    if (userRole === 'DRIVER') {
      const drv = store.getDriverByUserIdOrId(userId);
      if (!drv || ride.driverId !== drv.id) {
        throw new Error('FORBIDDEN: You are not the assigned driver for this ride.');
      }
    }
    return ride;
  }

  if (userRole === 'PASSENGER') {
    return rides.find(
      (r) =>
        !r.isSimulatedDemo &&
        !r.isDemoScenario &&
        r.passengerId === userId &&
        r.status !== 'COMPLETED' &&
        r.status !== 'CANCELLED'
    );
  }

  if (userRole === 'DRIVER') {
    const drv = store.getDriverByUserIdOrId(userId);
    if (!drv) return undefined;
    return rides.find(
      (r) =>
        !r.isSimulatedDemo &&
        !r.isDemoScenario &&
        r.driverId === drv.id &&
        [
          'DRIVER_ASSIGNED',
          'DRIVER_ARRIVING',
          'DRIVER_ARRIVED',
          'TRIP_STARTED',
          'ASSIGNED',
          'EN_ROUTE',
          'IN_PROGRESS',
        ].includes(r.status)
    );
  }

  return undefined;
}

export async function activateSosEmergency(
  io: SocketIOServer,
  params: {
    actorId: string;
    actorRole: UserRole;
    actorName: string;
    rideId?: string;
    emergencyCategory?: EmergencyCategory;
    emergencyDescription?: string;
    latitude?: number;
    longitude?: number;
    locationAccuracy?: number;
    locationTimestamp?: string;
    manualLocationText?: string;
    idempotencyKey?: string;
    isDemoScenario?: boolean;
  }
): Promise<{ incident: EmergencyIncidentRecord; deduplicated: boolean }> {
  const isDemo = Boolean(params.isDemoScenario);
  if (isDemo && params.actorRole !== 'ADMIN') {
    throw new Error('FORBIDDEN: Only Administrators can trigger Judge Demo SOS scenarios.');
  }

  if (params.idempotencyKey) {
    const existingByKey = store.findEmergencyIncidentByIdempotencyKey(
      params.actorId,
      params.idempotencyKey
    );
    if (existingByKey) {
      return { incident: existingByKey, deduplicated: true };
    }
  }

  const ride = resolveUserActiveRide(params.actorId, params.actorRole, params.rideId);

  // Duplicate active SOS protection for same activator & ride
  const existingActive = store.getActiveEmergencyIncidentForUser(params.actorId, ride?.id);
  if (existingActive && Boolean(existingActive.isDemoScenario) === isDemo) {
    if (isValidCoordinate(params.latitude, params.longitude)) {
      const updated = await updateSosLocation(io, {
        incidentId: existingActive.incidentId,
        actorId: params.actorId,
        actorRole: params.actorRole,
        latitude: params.latitude!,
        longitude: params.longitude!,
        locationAccuracy: params.locationAccuracy,
        locationSource: 'LIVE_GPS',
        manualLocationText: params.manualLocationText,
      });
      return { incident: updated, deduplicated: true };
    }
    return { incident: existingActive, deduplicated: true };
  }

  const now = new Date().toISOString();
  const incidentId = `${isDemo ? 'DEMO-SOS' : 'SOS'}-${Date.now()
    .toString(36)
    .toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

  // Retrieve genuine user, driver, and vehicle details (never fabricate missing fields)
  const activatorUser = store.findUserById(params.actorId);
  const passengerUser = ride?.passengerId
    ? store.findUserById(ride.passengerId)
    : params.actorRole === 'PASSENGER'
    ? activatorUser
    : undefined;

  let driverRecord: DriverRecord | undefined;
  if (ride?.driverId) {
    driverRecord = store.getDriverByUserIdOrId(ride.driverId);
  } else if (params.actorRole === 'DRIVER') {
    driverRecord = store.getDriverByUserIdOrId(params.actorId);
  }
  const driverUser = driverRecord?.userId ? store.findUserById(driverRecord.userId) : undefined;

  // Determine location source honestly without blocking SOS activation
  let latitude: number | undefined;
  let longitude: number | undefined;
  let locationAccuracy: number | undefined;
  let locationTimestamp: string | undefined;
  let locationSource: LocationSource = 'UNAVAILABLE';
  let locationVerifiedCurrent = false;

  if (isValidCoordinate(params.latitude, params.longitude)) {
    latitude = Number(params.latitude!.toFixed(6));
    longitude = Number(params.longitude!.toFixed(6));
    locationAccuracy =
      typeof params.locationAccuracy === 'number' && Number.isFinite(params.locationAccuracy)
        ? Math.round(params.locationAccuracy)
        : undefined;
    locationTimestamp = params.locationTimestamp || now;
    locationSource = 'LIVE_GPS';
    locationVerifiedCurrent = true;
  } else {
    // Fallback to latest backend GPS / last-known driver or ride pickup coordinates
    const latestHistory = driverRecord
      ? store.getLocationHistory(driverRecord.id, ride?.id)[0]
      : undefined;
    if (latestHistory && isValidCoordinate(latestHistory.coordinates.lat, latestHistory.coordinates.lng)) {
      latitude = latestHistory.coordinates.lat;
      longitude = latestHistory.coordinates.lng;
      locationTimestamp = latestHistory.timestamp;
      locationSource = params.manualLocationText?.trim() ? 'MANUAL_USER_INPUT' : 'LAST_KNOWN_BACKEND';
      locationVerifiedCurrent = false;
    } else if (
      driverRecord &&
      isValidCoordinate(driverRecord.coordinates.lat, driverRecord.coordinates.lng)
    ) {
      latitude = driverRecord.coordinates.lat;
      longitude = driverRecord.coordinates.lng;
      locationTimestamp = driverRecord.lastUpdatedAt;
      locationSource = params.manualLocationText?.trim() ? 'MANUAL_USER_INPUT' : 'LAST_KNOWN_BACKEND';
      locationVerifiedCurrent = false;
    } else if (ride && isValidCoordinate(ride.pickupCoords.lat, ride.pickupCoords.lng)) {
      latitude = ride.pickupCoords.lat;
      longitude = ride.pickupCoords.lng;
      locationTimestamp = ride.requestedAt;
      locationSource = params.manualLocationText?.trim() ? 'MANUAL_USER_INPUT' : 'LAST_KNOWN_BACKEND';
      locationVerifiedCurrent = false;
    } else if (params.manualLocationText?.trim()) {
      locationSource = 'MANUAL_USER_INPUT';
      locationVerifiedCurrent = false;
      locationTimestamp = now;
    }
  }

  const category =
    params.emergencyCategory && VALID_CATEGORIES.has(params.emergencyCategory)
      ? params.emergencyCategory
      : undefined;

  const emergencyNumber = getConfiguredEmergencyNumber();
  const emergencyCountry = getConfiguredEmergencyCountry();

  const initialEvents: EmergencyEventEntry[] = [
    makeEvent(
      incidentId,
      'ADMIN_NOTIFIED',
      'system',
      'SYSTEM',
      'RideNexa Operations Command notified immediately in real time via Socket.IO.'
    ),
    makeEvent(
      incidentId,
      locationSource === 'UNAVAILABLE' ? 'LOCATION_UNAVAILABLE' : 'LOCATION_CAPTURED',
      params.actorId,
      params.actorRole,
      locationSource === 'LIVE_GPS'
        ? `Live browser GPS coordinates captured (${latitude}, ${longitude}${
            locationAccuracy ? ` ±${locationAccuracy}m` : ''
          }).`
        : locationSource === 'LAST_KNOWN_BACKEND'
        ? `Browser GPS unavailable; fell back to unverified last-known backend coordinates (${latitude}, ${longitude}).`
        : params.manualLocationText?.trim()
        ? `Manual user location description recorded: "${params.manualLocationText.trim()}".`
        : 'Live GPS permission denied/unavailable and no backend coordinates were available.',
      {
        locationSource,
        locationVerifiedCurrent,
      }
    ),
    makeEvent(
      incidentId,
      'SOS_ACTIVATED',
      params.actorId,
      params.actorRole,
      `${params.actorRole} ${params.actorName} activated Emergency SOS${
        ride ? ` on ride ${ride.id}` : ''
      }${category ? ` (${category.replace(/_/g, ' ')})` : ''}.`
    ),
  ];

  let incident: EmergencyIncidentRecord = {
    incidentId,
    rideId: ride?.id,
    activatedBy: params.actorId,
    activatedByRole: isDemo ? 'PASSENGER' : params.actorRole,
    activatedByName: isDemo && ride ? ride.passengerName : params.actorName,
    passengerId: ride?.passengerId || (params.actorRole === 'PASSENGER' ? params.actorId : undefined),
    passengerName:
      ride?.passengerName || (params.actorRole === 'PASSENGER' ? params.actorName : undefined),
    passengerPhone: passengerUser?.phone,
    passengerEmail: passengerUser?.email,
    driverId: ride?.driverId || driverRecord?.id,
    driverName: ride?.driverName || driverRecord?.name,
    driverPhone: ride?.driverPhone || driverUser?.phone,
    vehicleId: driverRecord?.id,
    vehicleRegistrationNumber: ride?.plateNumber || driverRecord?.plateNumber,
    vehicleModel: ride?.vehicleModel || driverRecord?.vehicleModel,
    vehicleTier: ride?.vehicleTier || driverRecord?.vehicleTier,
    pickupAddress: ride?.pickupAddress,
    pickupCoords: ride?.pickupCoords,
    destinationAddress: ride?.destinationAddress,
    destinationCoords: ride?.destinationCoords,
    rideStatusAtActivation: ride?.status,
    routePath: ride?.routePath,
    emergencyCategory: category,
    emergencyDescription: params.emergencyDescription?.trim() || undefined,
    latitude,
    longitude,
    locationAccuracy,
    locationTimestamp,
    locationSource,
    locationVerifiedCurrent,
    manualLocationText: params.manualLocationText?.trim() || undefined,
    nearestPoliceStations: [],
    policeLookupStatus: 'NOT_RUN',
    policeNotificationStatus: isDemo ? 'NOT_INITIATED' : 'NOT_CONFIGURED',
    adminNotificationStatus: 'NOTIFIED',
    incidentStatus: 'ADMIN_NOTIFIED',
    emergencyNumber,
    emergencyCountry,
    isDemoScenario: isDemo,
    notes: [],
    events: initialEvents,
    adminAccessLog: [],
    idempotencyKey: params.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };

  await store.createEmergencyIncident(incident);
  emitSosScoped(io, 'sos:activated', incident);
  emitSosScoped(io, 'sos:admin-notified', incident);

  // Enrich concurrently with real OpenStreetMap Nominatim + Overpass + optional configured police API
  const [geoRes, policeDirRes] = await Promise.all([
    latitude !== undefined && longitude !== undefined
      ? reverseGeocodeCoordinates(latitude, longitude)
      : Promise.resolve({ readableAddress: undefined, available: false }),
    latitude !== undefined && longitude !== undefined
      ? lookupNearbyPoliceStations(latitude, longitude, 8000)
      : Promise.resolve({
          stations: [] as NearbyPoliceStation[],
          sourceStatus: 'NOT_RUN' as PoliceLookupStatus,
          note: 'No coordinates available for nearby police lookup. Call 112 directly.',
        }),
  ]);

  const apiSubmission = await submitToConfiguredPoliceApi({
    ...incident,
    readableAddress: geoRes.readableAddress || incident.manualLocationText,
  });

  const enrichmentEvents: EmergencyEventEntry[] = [...incident.events];
  if (policeDirRes.sourceStatus === 'VERIFIED_OSM' && policeDirRes.stations.length > 0) {
    enrichmentEvents.unshift(
      makeEvent(
        incidentId,
        'POLICE_DIRECTORY_LOOKUP',
        'system',
        'SYSTEM',
        `Retrieved ${policeDirRes.stations.length} nearest listed police station(s) via OpenStreetMap Overpass (jurisdiction unconfirmed). Closest: ${policeDirRes.stations[0].name} (${policeDirRes.stations[0].distanceKm} km).`
      )
    );
  }
  enrichmentEvents.unshift(
    makeEvent(
      incidentId,
      'POLICE_DISPATCH_CHECK',
      'system',
      'SYSTEM',
      apiSubmission.note,
      { policeNotificationStatus: apiSubmission.status }
    )
  );

  const enriched = await store.updateEmergencyIncident(incidentId, {
    readableAddress: geoRes.readableAddress,
    nearestPoliceStations: policeDirRes.stations,
    policeLookupStatus: policeDirRes.sourceStatus,
    policeLookupNote: policeDirRes.note,
    policeNotificationStatus: apiSubmission.status,
    policeReferenceId: apiSubmission.referenceId,
    policeLastCheckedAt: new Date().toISOString(),
    policeDeliveryError: apiSubmission.error,
    incidentStatus: 'AWAITING_EMERGENCY_RESPONSE',
    events: enrichmentEvents,
  });

  if (enriched) {
    incident = enriched;
    emitSosScoped(io, 'sos:location-updated', incident);
    if (apiSubmission.status === 'SUBMITTED') {
      emitSosScoped(io, 'sos:police-notification-submitted', incident);
    } else if (apiSubmission.status === 'ACKNOWLEDGED') {
      emitSosScoped(io, 'sos:police-notification-acknowledged', incident);
    }
  }

  return { incident, deduplicated: false };
}

export async function updateSosLocation(
  io: SocketIOServer,
  params: {
    incidentId: string;
    actorId: string;
    actorRole: UserRole;
    latitude?: number;
    longitude?: number;
    locationAccuracy?: number;
    locationSource?: LocationSource;
    manualLocationText?: string;
  }
): Promise<EmergencyIncidentRecord> {
  const incident = store.getEmergencyIncidentById(params.incidentId);
  if (!incident) {
    throw new Error('NOT_FOUND: Emergency SOS incident not found.');
  }
  if (!canUserAccessSosIncident(incident, params.actorId, params.actorRole)) {
    throw new Error('FORBIDDEN: Not authorized to update this SOS incident location.');
  }
  if (ACTIVE_TERMINAL_STATUSES.has(incident.incidentStatus)) {
    throw new Error('CONFLICT: Cannot update location for a resolved or cancelled incident.');
  }

  const hasCoords = isValidCoordinate(params.latitude, params.longitude);
  const nextLat = hasCoords ? Number(params.latitude!.toFixed(6)) : incident.latitude;
  const nextLng = hasCoords ? Number(params.longitude!.toFixed(6)) : incident.longitude;
  const nextSource: LocationSource = hasCoords
    ? params.locationSource || 'LIVE_GPS'
    : params.manualLocationText?.trim()
    ? 'MANUAL_USER_INPUT'
    : incident.locationSource;

  let readableAddress = incident.readableAddress;
  let policeLookup = {
    stations: incident.nearestPoliceStations,
    sourceStatus: incident.policeLookupStatus,
    note: incident.policeLookupNote,
  };

  if (nextLat !== undefined && nextLng !== undefined) {
    const movedKm =
      incident.latitude !== undefined && incident.longitude !== undefined
        ? haversineKm({ lat: incident.latitude, lng: incident.longitude }, { lat: nextLat, lng: nextLng })
        : 999;
    const geo = await reverseGeocodeCoordinates(nextLat, nextLng);
    if (geo.readableAddress) readableAddress = geo.readableAddress;

    if (movedKm >= 0.25 || incident.nearestPoliceStations.length === 0) {
      const lookup = await lookupNearbyPoliceStations(nextLat, nextLng, 8000);
      policeLookup = {
        stations: lookup.stations,
        sourceStatus: lookup.sourceStatus,
        note: lookup.note,
      };
    }
  }

  const evt = makeEvent(
    incident.incidentId,
    'LOCATION_UPDATED',
    params.actorId,
    params.actorRole,
    hasCoords
      ? `Updated ${nextSource === 'LIVE_GPS' ? 'live GPS' : 'location'} coordinates (${nextLat}, ${nextLng}).`
      : `Updated manual location description: "${params.manualLocationText?.trim() || ''}".`
  );

  const updated = await store.updateEmergencyIncident(incident.incidentId, {
    latitude: nextLat,
    longitude: nextLng,
    locationAccuracy:
      typeof params.locationAccuracy === 'number'
        ? Math.round(params.locationAccuracy)
        : incident.locationAccuracy,
    locationTimestamp: new Date().toISOString(),
    locationSource: nextSource,
    locationVerifiedCurrent: nextSource === 'LIVE_GPS',
    readableAddress,
    manualLocationText: params.manualLocationText?.trim() || incident.manualLocationText,
    nearestPoliceStations: policeLookup.stations,
    policeLookupStatus: policeLookup.sourceStatus,
    policeLookupNote: policeLookup.note,
    events: [evt, ...(incident.events || [])],
  });

  if (!updated) throw new Error('NOT_FOUND: Emergency SOS incident not found.');
  emitSosScoped(io, 'sos:location-updated', updated);
  return updated;
}

export async function cancelAccidentalSos(
  io: SocketIOServer,
  params: {
    incidentId: string;
    actorId: string;
    actorRole: UserRole;
    reason?: string;
  }
): Promise<EmergencyIncidentRecord> {
  const incident = store.getEmergencyIncidentById(params.incidentId);
  if (!incident) {
    throw new Error('NOT_FOUND: Emergency SOS incident not found.');
  }
  if (!canUserAccessSosIncident(incident, params.actorId, params.actorRole)) {
    throw new Error('FORBIDDEN: Not authorized to cancel this SOS incident.');
  }
  if (ACTIVE_TERMINAL_STATUSES.has(incident.incidentStatus)) {
    return incident;
  }

  const now = new Date().toISOString();
  const reasonText = params.reason?.trim() || 'Marked as accidental activation by user.';
  const evt = makeEvent(
    incident.incidentId,
    'CANCELLED_ACCIDENTAL',
    params.actorId,
    params.actorRole,
    `Incident marked as accidental cancellation ("${reasonText}"). Original record preserved for audit.`
  );

  const updated = await store.updateEmergencyIncident(incident.incidentId, {
    incidentStatus: 'CANCELLED_ACCIDENTAL',
    accidentalCancellationReason: reasonText,
    resolvedAt: now,
    events: [evt, ...(incident.events || [])],
  });
  if (!updated) throw new Error('NOT_FOUND: Incident not found.');
  emitSosScoped(io, 'sos:status-updated', updated);
  emitSosScoped(io, 'sos:incident-resolved', updated);
  return updated;
}

export async function adminAcknowledgeSos(
  io: SocketIOServer,
  params: {
    incidentId: string;
    adminId: string;
    adminEmail: string;
    adminName: string;
  }
): Promise<EmergencyIncidentRecord> {
  const incident = store.getEmergencyIncidentById(params.incidentId);
  if (!incident) {
    throw new Error('NOT_FOUND: Emergency SOS incident not found.');
  }

  const now = new Date().toISOString();
  const nextStatus: IncidentStatus = ACTIVE_TERMINAL_STATUSES.has(incident.incidentStatus)
    ? incident.incidentStatus
    : incident.incidentStatus === 'ESCALATED'
    ? 'ESCALATED'
    : 'AWAITING_EMERGENCY_RESPONSE';

  const evt = makeEvent(
    incident.incidentId,
    'ADMIN_ACKNOWLEDGED',
    params.adminId,
    'ADMIN',
    `Admin ${params.adminName} (${params.adminEmail}) acknowledged SOS alert and began incident coordination.`
  );

  const updated = await store.updateEmergencyIncident(incident.incidentId, {
    adminNotificationStatus: 'ACKNOWLEDGED',
    incidentStatus: nextStatus,
    acknowledgedAt: incident.acknowledgedAt || now,
    acknowledgedBy: params.adminEmail,
    events: [evt, ...(incident.events || [])],
  });
  if (!updated) throw new Error('NOT_FOUND: Incident not found.');
  emitSosScoped(io, 'sos:status-updated', updated);
  return updated;
}

export async function addSosInternalNote(
  io: SocketIOServer,
  params: {
    incidentId: string;
    adminId: string;
    adminName: string;
    note: string;
  }
): Promise<EmergencyIncidentRecord> {
  const incident = store.getEmergencyIncidentById(params.incidentId);
  if (!incident) {
    throw new Error('NOT_FOUND: Emergency SOS incident not found.');
  }
  const cleanNote = params.note.trim();
  if (!cleanNote) {
    throw new Error('Note text is required.');
  }

  const entry: EmergencyNote = {
    id: `sosnote-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    authorId: params.adminId,
    authorName: params.adminName,
    authorRole: 'ADMIN',
    note: cleanNote,
    createdAt: new Date().toISOString(),
  };

  const evt = makeEvent(
    incident.incidentId,
    'ADMIN_NOTE_ADDED',
    params.adminId,
    'ADMIN',
    `Admin ${params.adminName} added an internal safety coordination note.`
  );

  const updated = await store.updateEmergencyIncident(incident.incidentId, {
    notes: [entry, ...(incident.notes || [])],
    events: [evt, ...(incident.events || [])],
  });
  if (!updated) throw new Error('NOT_FOUND: Incident not found.');
  io.to('role:ADMIN').emit('sos:status-updated', {
    incident: updated,
    isDemoScenario: Boolean(updated.isDemoScenario),
  });
  return updated;
}

export async function escalateSosIncident(
  io: SocketIOServer,
  params: {
    incidentId: string;
    adminId: string;
    adminEmail: string;
    adminName: string;
    escalationTarget?: string;
    note?: string;
  }
): Promise<EmergencyIncidentRecord> {
  const incident = store.getEmergencyIncidentById(params.incidentId);
  if (!incident) {
    throw new Error('NOT_FOUND: Emergency SOS incident not found.');
  }
  if (ACTIVE_TERMINAL_STATUSES.has(incident.incidentStatus)) {
    throw new Error('CONFLICT: Cannot escalate an already resolved or cancelled incident.');
  }

  const target = params.escalationTarget?.trim() || 'Senior Safety Operations & Emergency Escalation Desk';
  const evt = makeEvent(
    incident.incidentId,
    'INCIDENT_ESCALATED',
    params.adminId,
    'ADMIN',
    `Incident escalated by ${params.adminName} to ${target}.${
      params.note?.trim() ? ` Note: ${params.note.trim()}` : ''
    }`
  );

  const updated = await store.updateEmergencyIncident(incident.incidentId, {
    incidentStatus: 'ESCALATED',
    adminNotificationStatus: 'ACKNOWLEDGED',
    acknowledgedAt: incident.acknowledgedAt || new Date().toISOString(),
    acknowledgedBy: incident.acknowledgedBy || params.adminEmail,
    escalationTarget: target,
    events: [evt, ...(incident.events || [])],
  });
  if (!updated) throw new Error('NOT_FOUND: Incident not found.');
  emitSosScoped(io, 'sos:status-updated', updated);
  return updated;
}

export async function resolveSosIncident(
  io: SocketIOServer,
  params: {
    incidentId: string;
    adminId: string;
    adminEmail: string;
    adminName: string;
    status?: 'RESOLVED' | 'CLOSED';
    resolutionSummary?: string;
  }
): Promise<EmergencyIncidentRecord> {
  const incident = store.getEmergencyIncidentById(params.incidentId);
  if (!incident) {
    throw new Error('NOT_FOUND: Emergency SOS incident not found.');
  }

  const finalStatus = params.status === 'CLOSED' ? 'CLOSED' : 'RESOLVED';
  const summary =
    params.resolutionSummary?.trim() ||
    `Marked ${finalStatus.toLowerCase()} by Admin ${params.adminName}.`;
  const evt = makeEvent(
    incident.incidentId,
    finalStatus === 'CLOSED' ? 'INCIDENT_CLOSED' : 'INCIDENT_RESOLVED',
    params.adminId,
    'ADMIN',
    summary
  );

  const updated = await store.updateEmergencyIncident(incident.incidentId, {
    incidentStatus: finalStatus,
    adminNotificationStatus: 'ACKNOWLEDGED',
    acknowledgedAt: incident.acknowledgedAt || new Date().toISOString(),
    acknowledgedBy: incident.acknowledgedBy || params.adminEmail,
    resolutionSummary: summary,
    resolvedAt: new Date().toISOString(),
    events: [evt, ...(incident.events || [])],
  });
  if (!updated) throw new Error('NOT_FOUND: Incident not found.');
  emitSosScoped(io, 'sos:status-updated', updated);
  emitSosScoped(io, 'sos:incident-resolved', updated);
  return updated;
}
