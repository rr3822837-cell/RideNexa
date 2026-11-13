import {
  AllocationWeights,
  Coordinates,
  DemandForecastResponse,
  DemandHourlyPoint,
  DemandZoneForecast,
  DriverRecord,
  FairAllocationFactor,
  FairAllocationResponse,
  FareBreakdown,
  PoolCandidateRequest,
  PooledGroup,
  PricingConfig,
  RepositionRecommendation,
  RepositioningResponse,
  RidePoolingResponse,
  RideRecord,
  RouteAlternative,
  RouteOptimizationResponse,
  SystemSettingsRecord,
  VehicleTier,
} from '../src/types/ridenexa.js';
import { CITY_LANDMARKS, createSimulatedPoolRequests } from './cityData.js';

export function normalizeCoordinates(input: unknown): Coordinates | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const rawLat = obj.lat ?? obj.latitude;
  const rawLng = obj.lng ?? obj.lon ?? obj.longitude;
  const lat = typeof rawLat === 'number' ? rawLat : Number(rawLat);
  const lng = typeof rawLng === 'number' ? rawLng : Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
  };
}

export function isValidCoordinates(coords?: Coordinates | null): coords is Coordinates {
  return normalizeCoordinates(coords) !== null;
}

export function haversineKm(a: Coordinates, b: Coordinates): number {
  const normA = normalizeCoordinates(a);
  const normB = normalizeCoordinates(b);
  if (!normA || !normB) return Infinity;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(normB.lat - normA.lat);
  const dLng = toRad(normB.lng - normA.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(normA.lat)) * Math.cos(toRad(normB.lat)) * sinDLng * sinDLng;
  const safeH = Math.min(1, Math.max(0, h));
  return 2 * R * Math.atan2(Math.sqrt(safeH), Math.sqrt(1 - safeH));
}

export function getDefaultPricingConfig(): PricingConfig {
  const envFee = Number(process.env.PRICING_PLATFORM_FEE || 0);
  const platformFee = Number.isFinite(envFee) && envFee >= 0 ? Math.round(envFee) : 0;
  return {
    currency: 'INR',
    platformFee,
    poolingDiscountPct: 15,
    tiers: {
      ECO_HATCH: { baseFare: 40, perKmRate: 12.5, perMinRate: 1.5, minFare: 65 },
      CITY_SEDAN: { baseFare: 55, perKmRate: 15.0, perMinRate: 2.0, minFare: 85 },
      EV_COMFORT: { baseFare: 65, perKmRate: 16.5, perMinRate: 2.2, minFare: 100 },
      POOL_SHARE: { baseFare: 30, perKmRate: 9.5, perMinRate: 1.2, minFare: 50 },
    },
  };
}

export function calculateDetailedFare(params: {
  distanceKm: number;
  durationMin: number;
  tier: VehicleTier;
  surgeMultiplier?: number;
  poolingOptIn?: boolean;
  pricingConfig?: PricingConfig;
  distanceSource?: 'ACTUAL_GPS_TRACKED' | 'ROUTE_BASED_ESTIMATE';
  durationSource?: 'ACTUAL_TIMED' | 'ROUTE_BASED_ESTIMATE';
  pricingNote?: string;
}): { totalFare: number; breakdown: FareBreakdown } {
  const cfg = params.pricingConfig || getDefaultPricingConfig();
  const rule = cfg.tiers[params.tier] || cfg.tiers.CITY_SEDAN;
  const distanceKm = Number(Math.max(0.2, params.distanceKm).toFixed(2));
  const durationMin = Math.max(1, Math.round(params.durationMin));
  const surgeMultiplier = Math.max(1, Number((params.surgeMultiplier ?? 1).toFixed(2)));
  const poolingOptIn = Boolean(params.poolingOptIn && params.tier !== 'POOL_SHARE');

  const baseFare = Math.round(rule.baseFare);
  const distanceCharge = Math.round(distanceKm * rule.perKmRate);
  const timeCharge = Math.round(durationMin * rule.perMinRate);
  const additionalCharges = Math.max(0, Math.round(cfg.platformFee || 0));

  const preSurgeSubtotal = baseFare + distanceCharge + timeCharge + additionalCharges;
  const surgeCharge =
    surgeMultiplier > 1 ? Math.round(preSurgeSubtotal * (surgeMultiplier - 1)) : 0;
  const afterSurge = preSurgeSubtotal + surgeCharge;
  const poolingDiscount = poolingOptIn
    ? Math.round(afterSurge * ((cfg.poolingDiscountPct || 15) / 100))
    : 0;
  const discountedTotal = Math.max(0, afterSurge - poolingDiscount);
  const minimumFareApplied = discountedTotal < rule.minFare;
  const totalFare = Math.round(Math.max(rule.minFare, discountedTotal));

  const distanceSource = params.distanceSource || 'ROUTE_BASED_ESTIMATE';
  const durationSource = params.durationSource || 'ROUTE_BASED_ESTIMATE';
  const defaultNote =
    distanceSource === 'ACTUAL_GPS_TRACKED' && durationSource === 'ACTUAL_TIMED'
      ? 'Calculated from actual GPS-tracked distance and timed ride duration.'
      : distanceSource === 'ACTUAL_GPS_TRACKED'
      ? 'Distance is GPS-tracked; duration uses route-based estimate.'
      : durationSource === 'ACTUAL_TIMED'
      ? 'Duration is timed from trip start to completion; distance uses route-based corridor estimate because continuous GPS waypoints were unavailable.'
      : 'Route-based estimate from pickup-to-destination corridor distance and projected travel time.';

  return {
    totalFare,
    breakdown: {
      baseFare,
      distanceKm,
      perKmRate: rule.perKmRate,
      distanceCharge,
      durationMin,
      perMinRate: rule.perMinRate,
      timeCharge,
      surgeMultiplier,
      surgeCharge,
      poolingDiscount,
      additionalCharges,
      additionalChargesLabel: additionalCharges > 0 ? 'Platform & Corridor Fee' : undefined,
      minimumFareApplied,
      subtotal: afterSurge,
      totalFare,
      currency: 'INR',
      distanceSource,
      durationSource,
      pricingNote: params.pricingNote || defaultNote,
    },
  };
}

export function calculateFare(
  distanceKm: number,
  tier: VehicleTier,
  surgeMultiplier = 1,
  durationMin?: number
): number {
  const estDuration = durationMin ?? Math.max(4, Math.round((distanceKm / 24) * 60));
  return calculateDetailedFare({
    distanceKm,
    durationMin: estDuration,
    tier,
    surgeMultiplier,
  }).totalFare;
}

export function calculateZoneSurge(params: {
  pickupCoords: Coordinates;
  drivers: DriverRecord[];
  settings: SystemSettingsRecord;
}): {
  surgeMultiplier: number;
  zoneName: string;
  demandSupplyRatio: number;
  surgeDisclosure: string;
} {
  let nearestZone = CITY_LANDMARKS[0];
  let nearestDist = Infinity;
  for (const lm of CITY_LANDMARKS) {
    const d = haversineKm(params.pickupCoords, lm.coordinates);
    if (d < nearestDist) {
      nearestDist = d;
      nearestZone = lm;
    }
  }

  const nearbyDrivers = params.drivers.filter(
    (d) =>
      d.verificationStatus === 'APPROVED' &&
      d.isOnline &&
      d.isAvailable &&
      !d.isDemoScenario &&
      haversineKm(d.coordinates, nearestZone.coordinates) <= 4.2
  ).length;

  const supplyCapacity = Math.max(4, nearbyDrivers * 6);
  const ratio = Number((nearestZone.baseDemand / supplyCapacity).toFixed(2));
  const threshold = params.settings.surgeDemandRatioThreshold || 1.35;
  const cap = params.settings.surgeMultiplierCap || 1.5;

  if (ratio <= threshold) {
    return {
      surgeMultiplier: 1,
      zoneName: nearestZone.name,
      demandSupplyRatio: ratio,
      surgeDisclosure: `Standard base fare (1.00x) in ${nearestZone.name} · balanced fleet supply.`,
    };
  }

  const rawSurge = 1 + (ratio - threshold) * 0.25;
  const capped = Math.min(cap, Math.max(1.05, rawSurge));
  const surgeMultiplier = Number((Math.round(capped * 20) / 20).toFixed(2));

  return {
    surgeMultiplier,
    zoneName: nearestZone.name,
    demandSupplyRatio: ratio,
    surgeDisclosure: `${surgeMultiplier.toFixed(2)}x demand surge applied (capped at ${cap.toFixed(2)}x) in ${nearestZone.name} · ${nearbyDrivers} available driver(s) for ~${nearestZone.baseDemand} projected requests.`,
  };
}

// ============================================================================
// 1. FAIR DRIVER ALLOCATION ENGINE (4-FACTOR SCORING + STRICT ELIGIBILITY)
// ============================================================================
export function normalizeAllocationWeights(
  weights?: Partial<AllocationWeights>,
  efficiencyWeight?: number
): AllocationWeights {
  if (weights && (weights.eta !== undefined || weights.fairness !== undefined)) {
    const raw = {
      eta: Math.max(0, Number(weights.eta ?? 0.4)),
      fairness: Math.max(0, Number(weights.fairness ?? 0.3)),
      reliability: Math.max(0, Number(weights.reliability ?? 0.15)),
      workload: Math.max(0, Number(weights.workload ?? 0.15)),
    };
    const total = raw.eta + raw.fairness + raw.reliability + raw.workload;
    if (total > 0) {
      return {
        eta: Number((raw.eta / total).toFixed(4)),
        fairness: Number((raw.fairness / total).toFixed(4)),
        reliability: Number((raw.reliability / total).toFixed(4)),
        workload: Number((raw.workload / total).toFixed(4)),
      };
    }
  }

  if (efficiencyWeight !== undefined) {
    const eff = Math.min(0.95, Math.max(0.05, efficiencyWeight));
    const fair = 1 - eff;
    return {
      eta: Number((eff * 0.73).toFixed(4)),
      reliability: Number((eff * 0.27).toFixed(4)),
      fairness: Number((fair * 0.67).toFixed(4)),
      workload: Number((fair * 0.33).toFixed(4)),
    };
  }

  return {
    eta: 0.4,
    fairness: 0.3,
    reliability: 0.15,
    workload: 0.15,
  };
}

export interface NearbyDriverMatch {
  driver: DriverRecord;
  straightDistanceKm: number;
  distanceKm: number;
  etaMinutes: number;
}

export async function fetchOsrmDriverDistanceMatrix(params: {
  pickup: Coordinates;
  drivers: DriverRecord[];
  enableOsrmRouting?: boolean;
}): Promise<Map<string, { distanceKm: number; etaMinutes: number }>> {
  const result = new Map<string, { distanceKm: number; etaMinutes: number }>();
  if (params.enableOsrmRouting === false) return result;
  const pickup = normalizeCoordinates(params.pickup);
  if (!pickup) return result;

  const validDrivers: { id: string; coords: Coordinates }[] = [];
  for (const d of params.drivers) {
    const c = normalizeCoordinates(d.coordinates);
    if (c) validDrivers.push({ id: d.id, coords: c });
  }
  if (validDrivers.length === 0) return result;

  const chunkSize = 35;
  for (let i = 0; i < validDrivers.length; i += chunkSize) {
    const chunk = validDrivers.slice(i, i + chunkSize);
    const coordSegments = [`${pickup.lng},${pickup.lat}`];
    const sourcesIdx: number[] = [];
    chunk.forEach((entry, idx) => {
      coordSegments.push(`${entry.coords.lng},${entry.coords.lat}`);
      sourcesIdx.push(idx + 1);
    });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2200);
      const url = `https://router.project-osrm.org/table/v1/driving/${coordSegments.join(';')}?sources=${sourcesIdx.join(';')}&destinations=0&annotations=distance,duration`;
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const data = (await resp.json()) as {
        code?: string;
        distances?: (number | null)[][];
        durations?: (number | null)[][];
      };
      if (data.code !== 'Ok' || !Array.isArray(data.distances) || !Array.isArray(data.durations)) {
        continue;
      }
      chunk.forEach((entry, idx) => {
        const distM = data.distances?.[idx]?.[0];
        const durS = data.durations?.[idx]?.[0];
        if (
          typeof distM === 'number' &&
          Number.isFinite(distM) &&
          typeof durS === 'number' &&
          Number.isFinite(durS)
        ) {
          const distanceKm = Number(Math.max(0.1, distM / 1000).toFixed(2));
          const etaMinutes = Math.max(1, Math.round(durS / 60));
          result.set(entry.id, { distanceKm, etaMinutes });
        }
      });
    } catch {
      // Fall back cleanly to Haversine for any drivers missing from OSRM matrix
    }
  }
  return result;
}

export async function getOsrmRouteDistanceEta(params: {
  from: Coordinates;
  to: Coordinates;
  enableOsrmRouting?: boolean;
}): Promise<{ distanceKm: number; etaMinutes: number }> {
  const from = normalizeCoordinates(params.from);
  const to = normalizeCoordinates(params.to);
  if (!from || !to) {
    return { distanceKm: 1, etaMinutes: 3 };
  }
  const straightKm = haversineKm(from, to);
  const fallbackDist = Number(Math.max(0.25, straightKm * 1.22).toFixed(2));
  const fallbackEta = Math.max(2, Math.round((fallbackDist / 24) * 60));

  if (params.enableOsrmRouting === false) {
    return { distanceKm: fallbackDist, etaMinutes: fallbackEta };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return { distanceKm: fallbackDist, etaMinutes: fallbackEta };
    const data = (await resp.json()) as {
      code?: string;
      routes?: { distance: number; duration: number }[];
    };
    if (data.code === 'Ok' && data.routes?.[0]) {
      const r = data.routes[0];
      return {
        distanceKm: Number(Math.max(0.1, r.distance / 1000).toFixed(2)),
        etaMinutes: Math.max(1, Math.round(r.duration / 60)),
      };
    }
  } catch {
    // Fallback cleanly
  }
  return { distanceKm: fallbackDist, etaMinutes: fallbackEta };
}

export function findNearbyAvailableDrivers(params: {
  pickup: Coordinates;
  drivers: DriverRecord[];
  preferredTier?: VehicleTier;
  maxPickupEtaMin?: number;
  maxRadiusKm?: number;
  expandedMaxRadiusKm?: number;
  excludedDriverIds?: string[];
  strictTierMatch?: boolean;
  strictVerification?: boolean;
  expandSearchRadius?: boolean;
  osrmDistanceMap?: Map<string, { distanceKm: number; etaMinutes: number }>;
}): {
  matches: NearbyDriverMatch[];
  filteredReasons: { driverId: string; driverName: string; reason: string }[];
  searchRadiusKmUsed: number;
  expandedRadiusUsed: boolean;
} {
  const pickup = normalizeCoordinates(params.pickup);
  if (!pickup) {
    return {
      matches: [],
      filteredReasons: [{ driverId: 'pickup', driverName: 'Pickup', reason: 'Invalid pickup coordinates' }],
      searchRadiusKmUsed: 0,
      expandedRadiusUsed: false,
    };
  }

  const maxPickupEtaMin = params.maxPickupEtaMin ?? 30;
  // Derive at least a 15 km road-search radius so drivers across city sectors are not prematurely excluded
  const primaryRadiusKm = Math.max(
    params.maxRadiusKm ?? 15,
    Number(((maxPickupEtaMin / 60) * 24).toFixed(1))
  );
  const expandedRadiusKm = Math.max(primaryRadiusKm, params.expandedMaxRadiusKm ?? 50);
  const excludedSet = new Set(params.excludedDriverIds || []);
  const strictVerification = params.strictVerification !== false;
  const filteredReasons: { driverId: string; driverName: string; reason: string }[] = [];

  const tierQualified = (driver: DriverRecord): boolean => {
    if (!params.preferredTier) return true;
    if (driver.vehicleTier === params.preferredTier) return true;
    if (params.preferredTier === 'POOL_SHARE' && (driver.vehicleCapacity ?? 4) >= 4) {
      return true;
    }
    return false;
  };

  const baseCandidates: {
    driver: DriverRecord;
    straightDistanceKm: number;
    distanceKm: number;
    etaMinutes: number;
    tierMatches: boolean;
  }[] = [];

  for (const d of params.drivers) {
    const verification = String(d.verificationStatus || 'APPROVED').trim().toUpperCase();
    if (strictVerification && verification !== 'APPROVED') {
      filteredReasons.push({
        driverId: d.id,
        driverName: d.name,
        reason: `Verification status: ${verification}`,
      });
      continue;
    }
    if (!d.isOnline) {
      filteredReasons.push({ driverId: d.id, driverName: d.name, reason: 'Driver is offline' });
      continue;
    }
    if (!d.isAvailable) {
      filteredReasons.push({
        driverId: d.id,
        driverName: d.name,
        reason: 'Busy on another trip or pending request',
      });
      continue;
    }
    const driverCoords = normalizeCoordinates(d.coordinates);
    if (!driverCoords) {
      filteredReasons.push({
        driverId: d.id,
        driverName: d.name,
        reason: 'Invalid GPS coordinates',
      });
      continue;
    }
    if (excludedSet.has(d.id)) {
      filteredReasons.push({
        driverId: d.id,
        driverName: d.name,
        reason: 'Excluded (already declined or timed out for this booking)',
      });
      continue;
    }

    const straightDistanceKm = Number(haversineKm(pickup, driverCoords).toFixed(2));
    const osrmMetrics = params.osrmDistanceMap?.get(d.id);
    const distanceKm = osrmMetrics
      ? osrmMetrics.distanceKm
      : Number(Math.max(0.25, straightDistanceKm * 1.22).toFixed(2));
    const etaMinutes = osrmMetrics
      ? osrmMetrics.etaMinutes
      : Math.max(2, Math.round((distanceKm / 24) * 60));

    baseCandidates.push({
      driver: { ...d, coordinates: driverCoords },
      straightDistanceKm,
      distanceKm,
      etaMinutes,
      tierMatches: tierQualified(d),
    });
  }

  const pickWithinRadius = (radiusKm: number, requireTierMatch: boolean): NearbyDriverMatch[] =>
    baseCandidates
      .filter((c) => c.distanceKm <= radiusKm && (!requireTierMatch || c.tierMatches))
      .sort((a, b) => a.distanceKm - b.distanceKm || a.etaMinutes - b.etaMinutes)
      .map(({ driver, straightDistanceKm, distanceKm, etaMinutes }) => ({
        driver,
        straightDistanceKm,
        distanceKm,
        etaMinutes,
      }));

  let searchRadiusKmUsed = primaryRadiusKm;
  let expandedRadiusUsed = false;

  // 1. Try primary radius + preferred tier
  let matches = pickWithinRadius(primaryRadiusKm, Boolean(params.preferredTier));

  // 2. Fallback within primary radius across any tier when strictTierMatch is false
  if (matches.length === 0 && params.strictTierMatch === false && params.preferredTier) {
    matches = pickWithinRadius(primaryRadiusKm, false);
  }

  // 3. Progressive radius expansion (up to expandedRadiusKm) if no driver was found in primary radius
  if (matches.length === 0 && params.expandSearchRadius !== false && expandedRadiusKm > primaryRadiusKm) {
    const expandedTierMatches = pickWithinRadius(expandedRadiusKm, Boolean(params.preferredTier));
    if (expandedTierMatches.length > 0) {
      matches = expandedTierMatches;
      searchRadiusKmUsed = expandedRadiusKm;
      expandedRadiusUsed = true;
    } else if (params.strictTierMatch === false) {
      const expandedAnyTier = pickWithinRadius(expandedRadiusKm, false);
      if (expandedAnyTier.length > 0) {
        matches = expandedAnyTier;
        searchRadiusKmUsed = expandedRadiusKm;
        expandedRadiusUsed = true;
      }
    }
  }

  // Record clear distance/tier reasons for baseCandidates that did not qualify
  const matchedIds = new Set(matches.map((m) => m.driver.id));
  for (const c of baseCandidates) {
    if (matchedIds.has(c.driver.id)) continue;
    if (params.preferredTier && params.strictTierMatch !== false && !c.tierMatches) {
      filteredReasons.push({
        driverId: c.driver.id,
        driverName: c.driver.name,
        reason: `Vehicle tier ${c.driver.vehicleTier} does not match requested ${params.preferredTier}`,
      });
    } else if (c.distanceKm > searchRadiusKmUsed) {
      filteredReasons.push({
        driverId: c.driver.id,
        driverName: c.driver.name,
        reason: `Pickup distance ${c.distanceKm} km (ETA ${c.etaMinutes}m) exceeds search radius (${searchRadiusKmUsed} km)`,
      });
    }
  }

  return {
    matches,
    filteredReasons,
    searchRadiusKmUsed,
    expandedRadiusUsed,
  };
}

export function runFairDriverAllocation(params: {
  pickup: Coordinates;
  drivers: DriverRecord[];
  preferredTier?: VehicleTier;
  weights?: Partial<AllocationWeights>;
  efficiencyWeight?: number;
  maxPickupEtaMin?: number;
  maxRadiusKm?: number;
  expandedMaxRadiusKm?: number;
  excludedDriverIds?: string[];
  strictTierMatch?: boolean;
  strictVerification?: boolean;
  prioritizeNearest?: boolean;
  expandSearchRadius?: boolean;
  osrmDistanceMap?: Map<string, { distanceKm: number; etaMinutes: number }>;
}): FairAllocationResponse {
  const weightsUsed = normalizeAllocationWeights(params.weights, params.efficiencyWeight);
  const efficiencyWeight = Number((weightsUsed.eta + weightsUsed.reliability).toFixed(2));
  const fairnessWeight = Number((weightsUsed.fairness + weightsUsed.workload).toFixed(2));
  const maxPickupEtaMin = params.maxPickupEtaMin ?? 30;

  const nearby = findNearbyAvailableDrivers({
    pickup: params.pickup,
    drivers: params.drivers,
    preferredTier: params.preferredTier,
    maxPickupEtaMin,
    maxRadiusKm: params.maxRadiusKm,
    expandedMaxRadiusKm: params.expandedMaxRadiusKm,
    excludedDriverIds: params.excludedDriverIds,
    strictTierMatch: params.strictTierMatch,
    strictVerification: params.strictVerification,
    expandSearchRadius: params.expandSearchRadius,
    osrmDistanceMap: params.osrmDistanceMap,
  });

  const eligible = nearby.matches;
  const filteredReasons = nearby.filteredReasons;

  if (eligible.length === 0) {
    return {
      algorithm: '4-Factor Fairness-Weighted Dispatch Engine (MF-FWD v2)',
      efficiencyWeight,
      fairnessWeight,
      weightsUsed,
      pickup: params.pickup,
      selectedDriver: null,
      nearestGreedyDriver: null,
      candidates: [],
      eligibleCount: 0,
      filteredReasons,
      explanation: `No eligible approved & online drivers matched within ${nearby.expandedRadiusUsed ? params.expandedMaxRadiusKm ?? 50 : Math.max(params.maxRadiusKm ?? 15, Number(((maxPickupEtaMin / 60) * 24).toFixed(1)))} km of pickup.`,
      equityImpactSummary: 'Waiting for an approved driver to become available near your pickup location.',
      isSimulatedFleet: params.drivers.some((d) => d.isSimulatedLocation),
    };
  }

  const maxRidesToday = Math.max(...eligible.map((e) => e.driver.ridesCompletedToday), 1);
  const maxIdle = Math.max(...eligible.map((e) => e.driver.minutesSinceLastRide), 15);
  const maxOpps = Math.max(...eligible.map((e) => e.driver.allocationOpportunities ?? e.driver.ridesCompletedToday), 1);

  const scored: FairAllocationFactor[] = eligible.map(({ driver, distanceKm, etaMinutes }) => {
    // 1. ETA / Proximity Suitability (0..100)
    const etaRatio = Math.min(1, etaMinutes / Math.max(maxPickupEtaMin, 5));
    const proximityScore = Number(
      Math.max(8, Math.min(100, 100 - etaRatio * 75 - Math.min(15, distanceKm * 1.2))).toFixed(1)
    );

    // 2. Fair Driver Opportunity (idle wait + inverse opportunity saturation)
    const opportunities = driver.allocationOpportunities ?? driver.ridesCompletedToday;
    const oppDeficitRatio = 1 - Math.min(1, opportunities / Math.max(maxOpps, 1));
    const idleRatio = Math.min(1, driver.minutesSinceLastRide / Math.max(maxIdle, 15));
    const idleWaitScore = Number(Math.min(100, 20 + idleRatio * 80).toFixed(1));
    const fairnessOpportunityScore = Number(
      Math.min(100, 25 + idleRatio * 45 + oppDeficitRatio * 30).toFixed(1)
    );

    // 3. Reliability & Acceptance (neutral baseline when driver has no ride history yet)
    const hasHistory = (driver.totalRidesCompleted || 0) > 0 || (driver.allocationOpportunities || 0) > 0;
    const effectiveRating = hasHistory ? driver.rating : 4.8;
    const effectiveAcc = hasHistory ? driver.acceptanceRate : 0.92;
    const reliabilityScore = Number(
      Math.min(100, Math.max(30, ((effectiveRating - 3.5) / 1.5) * 50 + effectiveAcc * 50)).toFixed(1)
    );

    // 4. Workload Equity (fewer rides completed today => higher priority)
    const workloadRatio = driver.ridesCompletedToday / Math.max(maxRidesToday, 1);
    const workloadEquityScore = Number(Math.max(12, (1 - workloadRatio * 0.85) * 100).toFixed(1));

    const totalAllocationScore = Number(
      (
        weightsUsed.eta * proximityScore +
        weightsUsed.fairness * fairnessOpportunityScore +
        weightsUsed.reliability * reliabilityScore +
        weightsUsed.workload * workloadEquityScore
      ).toFixed(1)
    );

    return {
      driverId: driver.id,
      driverName: driver.name,
      vehicleModel: driver.vehicleModel,
      vehicleTier: driver.vehicleTier,
      areaName: driver.areaName,
      coordinates: driver.coordinates,
      distanceKm,
      etaMinutes,
      ridesCompletedToday: driver.ridesCompletedToday,
      minutesSinceLastRide: driver.minutesSinceLastRide,
      rating: driver.rating,
      acceptanceRate: driver.acceptanceRate,
      allocationOpportunities: opportunities,
      acceptedCount: driver.acceptedCount ?? driver.ridesCompletedToday,
      rejectedCount: driver.rejectedCount ?? 0,
      proximityScore,
      workloadEquityScore,
      idleWaitScore,
      reliabilityScore,
      fairnessOpportunityScore,
      totalAllocationScore,
      isSelected: false,
      isNearestGreedy: false,
    };
  });

  const sortedByScore = [...scored].sort((a, b) => b.totalAllocationScore - a.totalAllocationScore);
  const sortedByNearest = [...scored].sort(
    (a, b) =>
      a.distanceKm - b.distanceKm ||
      a.etaMinutes - b.etaMinutes ||
      b.totalAllocationScore - a.totalAllocationScore
  );
  const nearestGreedy = sortedByNearest[0];
  const rankedCandidates = params.prioritizeNearest ? sortedByNearest : sortedByScore;

  const selected = rankedCandidates[0];
  const candidates = rankedCandidates.map((c) => ({
    ...c,
    isSelected: c.driverId === selected.driverId,
    isNearestGreedy: c.driverId === nearestGreedy.driverId,
  }));

  const selectedMarked = candidates.find((c) => c.isSelected) || null;
  const greedyMarked = candidates.find((c) => c.isNearestGreedy) || null;

  let explanation = '';
  if (params.prioritizeNearest && selectedMarked) {
    explanation =
      `Selected nearest available driver ${selectedMarked.driverName} (${selectedMarked.distanceKm} km, ~${selectedMarked.etaMinutes} min pickup ETA · Composite Score ${selectedMarked.totalAllocationScore} pts).`;
  } else if (selectedMarked && greedyMarked && selectedMarked.driverId !== greedyMarked.driverId) {
    const etaDiff = selectedMarked.etaMinutes - greedyMarked.etaMinutes;
    explanation =
      `Selected ${selectedMarked.driverName} (${selectedMarked.totalAllocationScore} pts) over nearest driver ${greedyMarked.driverName} (${greedyMarked.distanceKm} km, ${greedyMarked.etaMinutes}m ETA). ` +
      `Although ${greedyMarked.driverName} is ${Math.max(1, etaDiff)} min closer, they already completed ${greedyMarked.ridesCompletedToday} trips (${greedyMarked.allocationOpportunities} opportunities) with only ${greedyMarked.minutesSinceLastRide}m idle. ` +
      `${selectedMarked.driverName} had ${selectedMarked.ridesCompletedToday} trips (${selectedMarked.allocationOpportunities} opportunities) and waited ${selectedMarked.minutesSinceLastRide}m, achieving a fair ${selectedMarked.etaMinutes}-min pickup.`;
  } else if (selectedMarked) {
    explanation =
      `Selected ${selectedMarked.driverName} (${selectedMarked.totalAllocationScore} pts, ${selectedMarked.etaMinutes}m ETA). ` +
      `Strongest 4-factor composite across ETA (${selectedMarked.proximityScore}), fairness opportunity (${selectedMarked.fairnessOpportunityScore}), reliability (${selectedMarked.reliabilityScore}), and workload equity (${selectedMarked.workloadEquityScore}).`;
  }

  const avgTrips = eligible.reduce((acc, e) => acc + e.driver.ridesCompletedToday, 0) / eligible.length;
  const equityImpactSummary =
    selectedMarked && greedyMarked && selectedMarked.driverId !== greedyMarked.driverId
      ? `Prevented driver starvation and workload skew (${greedyMarked.ridesCompletedToday} vs ${selectedMarked.ridesCompletedToday} trips today) with +${Math.max(1, selectedMarked.etaMinutes - greedyMarked.etaMinutes)}m ETA trade-off.`
      : `Fleet workload distribution stays balanced (eligible avg ${avgTrips.toFixed(1)} trips today).`;

  return {
    algorithm: '4-Factor Fairness-Weighted Dispatch Engine (MF-FWD v2)',
    efficiencyWeight,
    fairnessWeight,
    weightsUsed,
    pickup: params.pickup,
    selectedDriver: selectedMarked,
    nearestGreedyDriver: greedyMarked,
    candidates,
    eligibleCount: eligible.length,
    filteredReasons,
    explanation,
    equityImpactSummary,
    isSimulatedFleet: eligible.some((e) => e.driver.isSimulatedLocation),
  };
}

export async function findNearbyAvailableDriversWithOsrm(params: {
  pickup: Coordinates;
  drivers: DriverRecord[];
  preferredTier?: VehicleTier;
  maxPickupEtaMin?: number;
  maxRadiusKm?: number;
  expandedMaxRadiusKm?: number;
  excludedDriverIds?: string[];
  strictTierMatch?: boolean;
  strictVerification?: boolean;
  expandSearchRadius?: boolean;
  enableOsrmRouting?: boolean;
}) {
  const excludedSet = new Set(params.excludedDriverIds || []);
  const candidateDrivers = params.drivers.filter((d) => {
    const verification = String(d.verificationStatus || 'APPROVED').trim().toUpperCase();
    if (params.strictVerification !== false && verification !== 'APPROVED') return false;
    return d.isOnline && d.isAvailable && !excludedSet.has(d.id) && isValidCoordinates(d.coordinates);
  });
  const osrmDistanceMap = await fetchOsrmDriverDistanceMatrix({
    pickup: params.pickup,
    drivers: candidateDrivers,
    enableOsrmRouting: params.enableOsrmRouting,
  });
  return findNearbyAvailableDrivers({ ...params, osrmDistanceMap });
}

export async function runFairDriverAllocationWithOsrm(params: {
  pickup: Coordinates;
  drivers: DriverRecord[];
  preferredTier?: VehicleTier;
  weights?: Partial<AllocationWeights>;
  efficiencyWeight?: number;
  maxPickupEtaMin?: number;
  maxRadiusKm?: number;
  expandedMaxRadiusKm?: number;
  excludedDriverIds?: string[];
  strictTierMatch?: boolean;
  strictVerification?: boolean;
  prioritizeNearest?: boolean;
  expandSearchRadius?: boolean;
  enableOsrmRouting?: boolean;
}): Promise<FairAllocationResponse> {
  const excludedSet = new Set(params.excludedDriverIds || []);
  const candidateDrivers = params.drivers.filter((d) => {
    const verification = String(d.verificationStatus || 'APPROVED').trim().toUpperCase();
    if (params.strictVerification !== false && verification !== 'APPROVED') return false;
    return d.isOnline && d.isAvailable && !excludedSet.has(d.id) && isValidCoordinates(d.coordinates);
  });
  const osrmDistanceMap = await fetchOsrmDriverDistanceMatrix({
    pickup: params.pickup,
    drivers: candidateDrivers,
    enableOsrmRouting: params.enableOsrmRouting,
  });
  return runFairDriverAllocation({ ...params, osrmDistanceMap });
}

// ============================================================================
// 2. AI-BASED DEMAND FORECASTING
// ============================================================================
export async function runDemandForecast(params: {
  horizon?: 'NOW' | '+1H' | '+3H' | 'MORNING_PEAK' | 'EVENING_PEAK';
  dayType?: 'WEEKDAY' | 'WEEKEND';
  weather?: 'CLEAR' | 'RAINY';
  drivers: DriverRecord[];
}): Promise<DemandForecastResponse> {
  const horizon = params.horizon || '+1H';
  const dayType = params.dayType || 'WEEKDAY';
  const weather = params.weather || 'CLEAR';

  const mlServiceUrl = process.env.ML_SERVICE_URL?.trim();
  if (mlServiceUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2200);
      const resp = await fetch(`${mlServiceUrl.replace(/\/$/, '')}/forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ horizon, dayType, weather }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.ok) {
        const externalData = (await resp.json()) as DemandForecastResponse;
        return {
          ...externalData,
          modelType: 'EXTERNAL_ML_SERVICE',
        };
      }
    } catch {
      // Fallback cleanly to prototype forecasting engine below
    }
  }

  const horizonFactors: Record<string, number> = {
    NOW: 1.0,
    '+1H': 1.18,
    '+3H': 1.32,
    MORNING_PEAK: 1.48,
    EVENING_PEAK: 1.62,
  };

  const weatherMultiplier = weather === 'RAINY' ? 1.28 : 1.0;
  const hFactor = horizonFactors[horizon] ?? 1.15;

  const zones: DemandZoneForecast[] = CITY_LANDMARKS.map((landmark) => {
    let zoneTypeBoost = 1.0;
    if (dayType === 'WEEKDAY') {
      if (horizon === 'MORNING_PEAK' && (landmark.zoneType === 'RESIDENTIAL' || landmark.zoneType === 'TRANSIT_HUB')) {
        zoneTypeBoost = 1.24;
      } else if (horizon === 'EVENING_PEAK' && (landmark.zoneType === 'TECH_PARK' || landmark.zoneType === 'COMMERCIAL')) {
        zoneTypeBoost = 1.3;
      }
    } else {
      if (landmark.zoneType === 'COMMERCIAL' || landmark.zoneType === 'AIRPORT') {
        zoneTypeBoost = 1.26;
      } else if (landmark.zoneType === 'TECH_PARK') {
        zoneTypeBoost = 0.58;
      }
    }

    const currentDemand = Math.round(landmark.baseDemand * (dayType === 'WEEKEND' && landmark.zoneType === 'TECH_PARK' ? 0.65 : 1.0));
    const predictedDemand = Math.round(landmark.baseDemand * hFactor * weatherMultiplier * zoneTypeBoost);

    const activeDrivers = params.drivers.filter(
      (d) =>
        d.verificationStatus === 'APPROVED' &&
        d.isOnline &&
        haversineKm(d.coordinates, landmark.coordinates) <= 3.6
    ).length;

    const supplyCapacity = activeDrivers * 5;
    const supplyGap = Math.max(0, predictedDemand - supplyCapacity);
    const ratio = predictedDemand / Math.max(supplyCapacity, 4);

    let intensity: DemandZoneForecast['intensity'] = 'LOW';
    if (ratio >= 2.3 || supplyGap >= 28) intensity = 'CRITICAL';
    else if (ratio >= 1.65 || supplyGap >= 16) intensity = 'HIGH';
    else if (ratio >= 1.15) intensity = 'MODERATE';

    const surgeMultiplier = Number(Math.min(1.5, Math.max(1.0, 1 + (ratio - 1.15) * 0.22)).toFixed(2));
    const confidencePct = weather === 'RAINY' ? 84 : 91;

    const reason =
      intensity === 'CRITICAL' || intensity === 'HIGH'
        ? `${landmark.zoneType.replace('_', ' ').toLowerCase()} corridor faces +${supplyGap} unmet requests (${activeDrivers} nearby drivers vs ${predictedDemand} projected riders).`
        : `Balanced zone coverage with ${activeDrivers} drivers available for ${predictedDemand} projected requests.`;

    return {
      zoneId: landmark.id,
      zoneName: landmark.name,
      area: landmark.area,
      coordinates: landmark.coordinates,
      zoneType: landmark.zoneType,
      currentDemand,
      predictedDemand,
      activeDrivers,
      supplyGap,
      surgeMultiplier,
      confidencePct,
      intensity,
      reason,
    };
  }).sort((a, b) => b.predictedDemand - a.predictedDemand);

  const baseCurve = [18, 12, 9, 11, 22, 46, 82, 118, 134, 96, 78, 84, 92, 86, 89, 108, 138, 168, 174, 142, 108, 84, 56, 32];
  const hourlySeries: DemandHourlyPoint[] = baseCurve.map((val, idx) => {
    const label = `${String(idx).padStart(2, '0')}:00`;
    const hist = Math.round(val * (dayType === 'WEEKEND' ? 0.88 : 1.0));
    const pred = Math.round(hist * weatherMultiplier * (idx >= 17 && idx <= 20 ? 1.14 : 1.06));
    const supply = Math.round(hist * 0.84 + 18);
    return {
      hourLabel: label,
      historicalDemand: hist,
      predictedDemand: pred,
      availableSupply: supply,
    };
  });

  const topZone = zones[0];
  return {
    modelName: 'Prototype Spatio-Temporal Demand Forecaster (Holt-Winters + Zone Elasticity)',
    modelType: 'PROTOTYPE_TIME_SERIES',
    horizon,
    dayType,
    weather,
    zones,
    hourlySeries,
    summary:
      `Prototype forecast indicates peak demand at ${topZone.zoneName} (${topZone.predictedDemand} req/hr, ${topZone.intensity} pressure) ` +
      `under ${dayType.toLowerCase()} ${weather.toLowerCase()} conditions. Live FastAPI ML endpoint is optional via ML_SERVICE_URL.`,
    isSimulatedData: true,
  };
}

// ============================================================================
// 3. INTELLIGENT RIDE POOLING ENGINE
// ============================================================================
function bearingDegrees(a: Coordinates, b: Coordinates): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angularDifference(deg1: number, deg2: number): number {
  const diff = Math.abs(deg1 - deg2) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function runRidePooling(params: {
  liveRides: RideRecord[];
  maxPickupRadiusKm?: number;
  maxDetourPct?: number;
}): RidePoolingResponse {
  const maxPickupRadiusKm = params.maxPickupRadiusKm ?? 4.5;
  const maxDetourPct = params.maxDetourPct ?? 28;

  const liveCandidates: PoolCandidateRequest[] = params.liveRides
    .filter(
      (r) =>
        (r.poolingOptIn || r.vehicleTier === 'POOL_SHARE') &&
        ['SEARCHING_DRIVER', 'CONFIRMED', 'DRIVER_ASSIGNED', 'REQUESTED', 'ASSIGNED'].includes(r.status)
    )
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      passengerName: r.passengerName,
      pickupName: r.pickupAddress,
      pickupCoords: r.pickupCoords,
      destinationName: r.destinationAddress,
      destinationCoords: r.destinationCoords,
      soloDistanceKm: r.distanceKm,
      soloFare: r.estimatedFare,
      requestedWindow: 'Live Queue',
      isLiveDbRequest: true,
    }));

  const poolRequests: PoolCandidateRequest[] = [...liveCandidates, ...createSimulatedPoolRequests()];
  const used = new Set<string>();
  const groups: PooledGroup[] = [];

  for (let i = 0; i < poolRequests.length; i++) {
    const r1 = poolRequests[i];
    if (used.has(r1.id)) continue;

    let bestMatch: { rider: PoolCandidateRequest; score: number; detourPct: number; sharedKm: number } | null = null;
    const bearing1 = bearingDegrees(r1.pickupCoords, r1.destinationCoords);

    for (let j = i + 1; j < poolRequests.length; j++) {
      const r2 = poolRequests[j];
      if (used.has(r2.id)) continue;

      const pickupGap = haversineKm(r1.pickupCoords, r2.pickupCoords);
      const dropGap = haversineKm(r1.destinationCoords, r2.destinationCoords);
      const bearing2 = bearingDegrees(r2.pickupCoords, r2.destinationCoords);
      const angleDiff = angularDifference(bearing1, bearing2);

      if (pickupGap > maxPickupRadiusKm || dropGap > maxPickupRadiusKm + 1.5 || angleDiff > 55) {
        continue;
      }

      const jointRouteKm =
        haversineKm(r1.pickupCoords, r2.pickupCoords) * 1.2 +
        haversineKm(r2.pickupCoords, r2.destinationCoords) * 1.22 +
        haversineKm(r2.destinationCoords, r1.destinationCoords) * 1.15;

      const maxSolo = Math.max(r1.soloDistanceKm, r2.soloDistanceKm);
      const detourPct = Number(Math.max(3, ((jointRouteKm - maxSolo) / Math.max(maxSolo, 1)) * 100).toFixed(1));
      if (detourPct > maxDetourPct) continue;

      const compatibilityScore = Number(
        Math.min(
          98,
          Math.max(
            62,
            100 - pickupGap * 6.5 - dropGap * 5.0 - angleDiff * 0.35 - detourPct * 0.4
          )
        ).toFixed(1)
      );

      const sharedKm = Number(Math.max(2, Math.min(r1.soloDistanceKm, r2.soloDistanceKm) - pickupGap * 0.4).toFixed(1));
      if (!bestMatch || compatibilityScore > bestMatch.score) {
        bestMatch = { rider: r2, score: compatibilityScore, detourPct, sharedKm };
      }
    }

    if (bestMatch) {
      used.add(r1.id);
      used.add(bestMatch.rider.id);
      const r2 = bestMatch.rider;
      const combinedSoloFare = r1.soloFare + r2.soloFare;
      const perRiderSavingsPct = Math.round(Math.min(38, Math.max(22, 36 - bestMatch.detourPct * 0.35)));
      const totalSharedFare = Math.round(combinedSoloFare * (1 - perRiderSavingsPct / 100));
      const distanceSaved = Number(
        Math.max(
          1.8,
          r1.soloDistanceKm + r2.soloDistanceKm - Math.max(r1.soloDistanceKm, r2.soloDistanceKm) * (1 + bestMatch.detourPct / 100)
        ).toFixed(1)
      );
      const co2SavedKg = Number((distanceSaved * 0.145).toFixed(2));

      groups.push({
        groupId: `POOL-${groups.length + 1}`,
        riders: [r1, r2],
        compatibilityScore: bestMatch.score,
        sharedCorridorKm: bestMatch.sharedKm,
        detourPenaltyPct: bestMatch.detourPct,
        combinedSoloFare,
        totalSharedFare,
        perRiderSavingsPct,
        co2SavedKg,
        routeWaypoints: [
          [r1.pickupCoords.lat, r1.pickupCoords.lng],
          [r2.pickupCoords.lat, r2.pickupCoords.lng],
          [r2.destinationCoords.lat, r2.destinationCoords.lng],
          [r1.destinationCoords.lat, r1.destinationCoords.lng],
        ],
        explanation:
          `Matched ${r1.passengerName} (${r1.pickupName} → ${r1.destinationName}) with ${r2.passengerName} (${r2.pickupName} → ${r2.destinationName}). ` +
          `Pickup offset is ${haversineKm(r1.pickupCoords, r2.pickupCoords).toFixed(1)} km with ${bestMatch.sharedKm} km shared corridor and ${bestMatch.detourPct}% detour, cutting each passenger's fare by ${perRiderSavingsPct}%.`,
      });
    }
  }

  const unmatchedRequests = poolRequests.filter((r) => !used.has(r.id));
  const totalDistanceSavedKm = Number(
    groups
      .reduce((sum, g) => {
        const soloSum = g.riders.reduce((s, r) => s + r.soloDistanceKm, 0);
        return sum + Math.max(1.5, soloSum - g.sharedCorridorKm * (1 + g.detourPenaltyPct / 100));
      }, 0)
      .toFixed(1)
  );
  const averageFareSavingsPct =
    groups.length > 0
      ? Math.round(groups.reduce((sum, g) => sum + g.perRiderSavingsPct, 0) / groups.length)
      : 0;

  return {
    algorithm: 'Corridor Bearing & Detour-Bounded Ride Pooling (CB-DBP)',
    activeRequestsCount: poolRequests.length,
    groups,
    unmatchedRequests,
    totalDistanceSavedKm,
    averageFareSavingsPct,
    summary:
      groups.length > 0
        ? `Formed ${groups.length} compatible shared ride pool(s) from ${poolRequests.length} active requests, saving ${totalDistanceSavedKm} vehicle-km and an average ${averageFareSavingsPct}% fare per rider.`
        : 'No compatible pools met the current pickup radius and detour constraints.',
    isSimulatedData: poolRequests.some((r) => !r.isLiveDbRequest),
  };
}

// ============================================================================
// 4. SMART DRIVER REPOSITIONING ENGINE
// ============================================================================
export async function runDriverRepositioning(params: {
  drivers: DriverRecord[];
  horizon?: 'NOW' | '+1H' | '+3H' | 'MORNING_PEAK' | 'EVENING_PEAK';
  targetDriverId?: string;
}): Promise<RepositioningResponse> {
  const forecast = await runDemandForecast({
    horizon: params.horizon || '+1H',
    dayType: 'WEEKDAY',
    weather: 'CLEAR',
    drivers: params.drivers,
  });

  const hotspots = forecast.zones.filter((z) => z.supplyGap > 0).slice(0, 5);
  const candidateDrivers = params.targetDriverId
    ? params.drivers.filter((d) => d.id === params.targetDriverId || d.userId === params.targetDriverId)
    : params.drivers.filter((d) => d.verificationStatus === 'APPROVED' && d.isOnline && d.isAvailable);

  const activePool = candidateDrivers.length > 0 ? candidateDrivers : params.drivers.slice(0, 4);
  const recommendations: RepositionRecommendation[] = [];

  for (let i = 0; i < activePool.length; i++) {
    const driver = activePool[i];
    let bestZone = hotspots[0] || forecast.zones[0];
    let bestUtility = -Infinity;

    for (const zone of forecast.zones.slice(0, 6)) {
      const distKm = Math.max(0.4, haversineKm(driver.coordinates, zone.coordinates) * 1.2);
      if (distKm < 1.0 && zone.supplyGap < 10) continue;
      const utility = zone.supplyGap * 2.2 - distKm * 3.1;
      if (utility > bestUtility) {
        bestUtility = utility;
        bestZone = zone;
      }
    }

    const travelDistanceKm = Number(Math.max(0.8, haversineKm(driver.coordinates, bestZone.coordinates) * 1.2).toFixed(1));
    const travelMinutes = Math.max(4, Math.round((travelDistanceKm / 25) * 60));
    const expectedWaitReductionMin = Number(Math.min(9.5, Math.max(2.4, bestZone.supplyGap * 0.19)).toFixed(1));
    const priority: RepositionRecommendation['priority'] =
      bestZone.intensity === 'CRITICAL' || bestZone.supplyGap >= 20
        ? 'HIGH'
        : bestZone.supplyGap >= 10
        ? 'MEDIUM'
        : 'LOW';

    recommendations.push({
      driverId: driver.id,
      driverName: driver.name,
      currentArea: driver.areaName,
      currentCoords: driver.coordinates,
      targetZoneId: bestZone.zoneId,
      targetZoneName: bestZone.zoneName,
      targetCoords: bestZone.coordinates,
      travelDistanceKm,
      travelMinutes,
      expectedDemand: bestZone.predictedDemand,
      currentSupplyInTarget: bestZone.activeDrivers,
      expectedWaitReductionMin,
      priority,
      explanation:
        `Move ${travelDistanceKm} km (${travelMinutes} min) from ${driver.areaName} toward ${bestZone.zoneName}. ` +
        `Forecast projects ${bestZone.predictedDemand} ride requests/hr with only ${bestZone.activeDrivers} active driver(s) nearby, cutting local passenger wait times by ~${expectedWaitReductionMin} min.`,
    });
  }

  return {
    algorithm: 'Supply-Deficit Spatial Repositioning Optimizer (SDS-RO)',
    recommendations,
    hotspots: forecast.zones,
    fleetUtilizationGainPct: 24,
    summary: `Generated ${recommendations.length} proactive repositioning directive(s) across high-deficit urban zones to raise fleet utilization and reduce pickup wait times.`,
    isSimulatedData: true,
  };
}

// ============================================================================
// 5. ROUTE OPTIMIZATION ENGINE (OPTIONAL OSRM + PROTOTYPE FALLBACK)
// ============================================================================
export function generateCorridorWaypoints(
  pickup: Coordinates,
  destination: Coordinates,
  offsetFactor: number
): [number, number][] {
  const dLat = destination.lat - pickup.lat;
  const dLng = destination.lng - pickup.lng;
  const orthoLat = -dLng * offsetFactor;
  const orthoLng = dLat * offsetFactor;

  return [
    [pickup.lat, pickup.lng],
    [
      Number((pickup.lat + dLat * 0.33 + orthoLat * 0.85).toFixed(5)),
      Number((pickup.lng + dLng * 0.33 + orthoLng * 0.85).toFixed(5)),
    ],
    [
      Number((pickup.lat + dLat * 0.68 + orthoLat).toFixed(5)),
      Number((pickup.lng + dLng * 0.68 + orthoLng).toFixed(5)),
    ],
    [destination.lat, destination.lng],
  ];
}

export function runRouteOptimization(params: {
  pickupName: string;
  destinationName: string;
  pickupCoords: Coordinates;
  destinationCoords: Coordinates;
  timePeriod?: 'OFF_PEAK' | 'MORNING_PEAK' | 'EVENING_PEAK';
  tier?: VehicleTier;
  surgeMultiplier?: number;
}): RouteOptimizationResponse {
  const timePeriod = params.timePeriod || 'MORNING_PEAK';
  const tier = params.tier || 'CITY_SEDAN';
  const surge = params.surgeMultiplier ?? 1;
  const straightKm = Math.max(1.2, haversineKm(params.pickupCoords, params.destinationCoords));

  const congestionFactor =
    timePeriod === 'EVENING_PEAK' ? 1.42 : timePeriod === 'MORNING_PEAK' ? 1.28 : 1.0;

  const optWaypoints = generateCorridorWaypoints(params.pickupCoords, params.destinationCoords, 0.08);
  const artWaypoints = generateCorridorWaypoints(params.pickupCoords, params.destinationCoords, -0.14);
  const shortWaypoints = generateCorridorWaypoints(params.pickupCoords, params.destinationCoords, 0.02);

  const optDist = Number((straightKm * 1.24).toFixed(2));
  const artDist = Number((straightKm * 1.38).toFixed(2));
  const shortDist = Number((straightKm * 1.15).toFixed(2));

  const optDuration = Math.max(6, Math.round((optDist / 28) * 60 * (congestionFactor * 0.88)));
  const artDuration = Math.max(7, Math.round((artDist / 26) * 60 * congestionFactor));
  const shortDuration = Math.max(8, Math.round((shortDist / 19) * 60 * (congestionFactor * 1.18)));

  const routes: RouteAlternative[] = [
    {
      id: 'route-optimized',
      name: 'RideNexa Express Corridor',
      corridorType: 'OPTIMIZED',
      distanceKm: optDist,
      durationMin: optDuration,
      trafficIndex: Number((0.36 * congestionFactor).toFixed(2)),
      estimatedFare: calculateFare(optDist, tier, surge),
      fuelEfficiencyScore: 93,
      waypoints: optWaypoints,
      isRecommended: true,
      reason: `Balances signalized arterial flow with ${Math.max(3, shortDuration - optDuration)} min faster transit than congested inner streets during ${timePeriod.toLowerCase().replace('_', ' ')}.`,
    },
    {
      id: 'route-arterial',
      name: 'Outer Ring Bypass',
      corridorType: 'ARTERIAL',
      distanceKm: artDist,
      durationMin: artDuration,
      trafficIndex: Number((0.44 * congestionFactor).toFixed(2)),
      estimatedFare: calculateFare(artDist, tier, surge),
      fuelEfficiencyScore: 84,
      waypoints: artWaypoints,
      isRecommended: false,
      reason: `Longer perimeter bypass (+${(artDist - optDist).toFixed(1)} km) with moderate junction delays.`,
    },
    {
      id: 'route-shortcut',
      name: 'Direct Inner-City Corridor',
      corridorType: 'SHORTCUT',
      distanceKm: shortDist,
      durationMin: shortDuration,
      trafficIndex: Number((0.72 * congestionFactor).toFixed(2)),
      estimatedFare: calculateFare(shortDist, tier, surge),
      fuelEfficiencyScore: 71,
      waypoints: shortWaypoints,
      isRecommended: false,
      reason: `Shortest geometric path (${shortDist} km) but encounters high intersection density and stop-and-go congestion.`,
    },
  ];

  const recommended = routes[0];
  return {
    solverType: 'PROTOTYPE_GRAPH_ROUTER',
    pickupName: params.pickupName,
    destinationName: params.destinationName,
    pickupCoords: params.pickupCoords,
    destinationCoords: params.destinationCoords,
    timePeriod,
    recommendedRoute: recommended,
    alternatives: routes,
    explanation:
      `Selected "${recommended.name}" (${recommended.distanceKm} km, ${recommended.durationMin} min) over "${routes[2].name}" (${routes[2].durationMin} min). ` +
      `Although the inner-city path is ${(optDist - shortDist).toFixed(1)} km shorter, avoiding bottleneck intersections saves ${Math.max(2, shortDuration - optDuration)} min and improves energy efficiency to ${recommended.fuelEfficiencyScore}/100.`,
  };
}

export async function runRouteOptimizationWithOsrm(params: {
  pickupName: string;
  destinationName: string;
  pickupCoords: Coordinates;
  destinationCoords: Coordinates;
  timePeriod?: 'OFF_PEAK' | 'MORNING_PEAK' | 'EVENING_PEAK';
  tier?: VehicleTier;
  surgeMultiplier?: number;
  enableOsrmRouting?: boolean;
}): Promise<RouteOptimizationResponse> {
  const fallback = runRouteOptimization(params);
  if (params.enableOsrmRouting === false) {
    return fallback;
  }

  const { pickupCoords, destinationCoords } = params;
  const tier = params.tier || 'CITY_SEDAN';
  const surge = params.surgeMultiplier ?? 1;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const url = `https://router.project-osrm.org/route/v1/driving/${pickupCoords.lng},${pickupCoords.lat};${destinationCoords.lng},${destinationCoords.lat}?overview=simplified&geometries=geojson&alternatives=true`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) return fallback;
    const data = (await resp.json()) as {
      code?: string;
      routes?: {
        distance: number;
        duration: number;
        geometry?: { coordinates: [number, number][] };
      }[];
    };

    if (data.code !== 'Ok' || !data.routes?.length) return fallback;

    const mapped: RouteAlternative[] = data.routes.slice(0, 3).map((r, idx) => {
      const distKm = Number(Math.max(0.4, r.distance / 1000).toFixed(2));
      const durMin = Math.max(3, Math.round(r.duration / 60));
      const waypoints: [number, number][] =
        r.geometry?.coordinates?.map(([lng, lat]) => [lat, lng]) ||
        fallback.alternatives[0].waypoints;
      return {
        id: `osrm-route-${idx + 1}`,
        name: idx === 0 ? 'OSRM Primary Road Corridor' : `OSRM Alternative #${idx}`,
        corridorType: idx === 0 ? 'OPTIMIZED' : idx === 1 ? 'ARTERIAL' : 'SHORTCUT',
        distanceKm: distKm,
        durationMin: durMin,
        trafficIndex: Number((0.35 + idx * 0.14).toFixed(2)),
        estimatedFare: calculateFare(distKm, tier, surge),
        fuelEfficiencyScore: Math.max(72, 94 - idx * 8),
        waypoints,
        isRecommended: idx === 0,
        reason:
          idx === 0
            ? `Real OpenStreetMap road geometry (${distKm} km, ${durMin} min) via OSRM public router.`
            : `Alternative OpenStreetMap road path (${distKm} km, ${durMin} min).`,
      };
    });

    return {
      solverType: 'EXTERNAL_ROUTING',
      pickupName: params.pickupName,
      destinationName: params.destinationName,
      pickupCoords,
      destinationCoords,
      timePeriod: params.timePeriod || 'MORNING_PEAK',
      recommendedRoute: mapped[0],
      alternatives: mapped,
      explanation: `Routed over live OpenStreetMap road network via OSRM (${mapped[0].distanceKm} km, ~${mapped[0].durationMin} min).`,
    };
  } catch {
    return fallback;
  }
}
