export type UserRole = 'PASSENGER' | 'DRIVER' | 'ADMIN';

export type VehicleTier = 'ECO_HATCH' | 'CITY_SEDAN' | 'EV_COMFORT' | 'POOL_SHARE';

export type DriverVerificationStatus =
  | 'PENDING_VERIFICATION'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESUBMISSION_REQUIRED'
  | 'SUSPENDED';

export type DriverDocumentType = 'DRIVING_LICENCE' | 'IDENTITY_PROOF' | 'VEHICLE_RC';

export interface DriverDocument {
  id: string;
  docType: DriverDocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  uploadedAt: string;
}

export interface AllocationWeights {
  eta: number;
  fairness: number;
  reliability: number;
  workload: number;
}

export interface TierPricingRule {
  baseFare: number;
  perKmRate: number;
  perMinRate: number;
  minFare: number;
}

export interface PricingConfig {
  currency: 'INR';
  platformFee: number;
  poolingDiscountPct: number;
  tiers: Record<VehicleTier, TierPricingRule>;
}

export interface FareBreakdown {
  baseFare: number;
  distanceKm: number;
  perKmRate: number;
  distanceCharge: number;
  durationMin: number;
  perMinRate: number;
  timeCharge: number;
  surgeMultiplier: number;
  surgeCharge: number;
  poolingDiscount: number;
  additionalCharges: number;
  additionalChargesLabel?: string;
  minimumFareApplied: boolean;
  subtotal: number;
  totalFare: number;
  currency: 'INR';
  distanceSource: 'ACTUAL_GPS_TRACKED' | 'ROUTE_BASED_ESTIMATE';
  durationSource: 'ACTUAL_TIMED' | 'ROUTE_BASED_ESTIMATE';
  pricingNote: string;
}

export interface SystemSettingsRecord {
  id: string;
  allocationWeights: AllocationWeights;
  maxPickupEtaMin: number;
  maxReassignmentAttempts: number;
  driverResponseTimeoutSec: number;
  driverSearchIntervalSec?: number;
  maxBookingWaitSec?: number;
  dispatchStrategy?: 'NEAREST_FIRST' | 'FAIR_BALANCED';
  surgeDemandRatioThreshold: number;
  surgeMultiplierCap: number;
  enableOsrmRouting: boolean;
  pricingConfig?: PricingConfig;
  updatedAt: string;
  updatedBy?: string;
}

export type RideStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'SEARCHING_DRIVER'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVING'
  | 'DRIVER_ARRIVED'
  | 'TRIP_STARTED'
  | 'COMPLETED'
  | 'CANCELLED'
  // Legacy compatibility statuses from initial seed data
  | 'REQUESTED'
  | 'ASSIGNED'
  | 'EN_ROUTE'
  | 'IN_PROGRESS';

export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'WALLET';

export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'SUCCESS';

export type GatewayMode = 'RAZORPAY_LIVE' | 'SANDBOX_DEMO' | 'CASH_SETTLEMENT' | 'DEMO_PAYMENT_MODE';

export type AllocationStatus =
  | 'PENDING_PAYMENT'
  | 'SEARCHING_DRIVER'
  | 'DRIVER_ASSIGNED'
  | 'WAITING_FOR_DRIVER'
  | 'NO_DRIVERS_AVAILABLE'
  | 'MAX_WAIT_REACHED'
  | 'CANCELLED';

export type SearchStage =
  | 'SEARCHING'
  | 'CHECKING_DRIVERS'
  | 'REQUEST_SENT'
  | 'REASSIGNING'
  | 'WAITING_FOR_DRIVER'
  | 'NO_DRIVERS_AVAILABLE'
  | 'MAX_WAIT_REACHED'
  | 'ASSIGNED';

export type DriverRequestStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'TIMED_OUT'
  | 'EXPIRED'
  | 'CANCELLED';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface CityLandmark {
  id: string;
  name: string;
  area: string;
  coordinates: Coordinates;
  baseDemand: number;
  zoneType: 'TRANSIT_HUB' | 'TECH_PARK' | 'COMMERCIAL' | 'RESIDENTIAL' | 'AIRPORT';
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  createdAt: string;
}

export interface DriverRecord {
  id: string;
  userId?: string;
  name: string;
  vehicleModel: string;
  vehicleTier: VehicleTier;
  plateNumber: string;
  vehicleCapacity?: number;
  licenseNumber?: string;
  licenseExpiry?: string;
  verificationStatus: DriverVerificationStatus;
  rejectionReason?: string;
  resubmissionNote?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  documents?: DriverDocument[];
  rating: number;
  isOnline: boolean;
  isAvailable: boolean;
  coordinates: Coordinates;
  areaName: string;
  ridesCompletedToday: number;
  totalRidesCompleted: number;
  dailyEarnings: number;
  minutesSinceLastRide: number;
  acceptanceRate: number;
  allocationOpportunities?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  timedOutCount?: number;
  isSimulatedLocation: boolean;
  isDemoScenario?: boolean;
  lastUpdatedAt: string;
}

export interface FairAllocationFactor {
  driverId: string;
  driverName: string;
  vehicleModel: string;
  vehicleTier: VehicleTier;
  areaName: string;
  coordinates: Coordinates;
  distanceKm: number;
  etaMinutes: number;
  ridesCompletedToday: number;
  minutesSinceLastRide: number;
  rating: number;
  acceptanceRate: number;
  allocationOpportunities: number;
  acceptedCount: number;
  rejectedCount: number;
  proximityScore: number;
  workloadEquityScore: number;
  idleWaitScore: number;
  reliabilityScore: number;
  fairnessOpportunityScore: number;
  totalAllocationScore: number;
  isSelected: boolean;
  isNearestGreedy: boolean;
}

export interface FairAllocationResponse {
  algorithm: string;
  efficiencyWeight: number;
  fairnessWeight: number;
  weightsUsed?: AllocationWeights;
  pickup: Coordinates;
  selectedDriver: FairAllocationFactor | null;
  nearestGreedyDriver: FairAllocationFactor | null;
  candidates: FairAllocationFactor[];
  eligibleCount?: number;
  filteredReasons?: { driverId: string; driverName: string; reason: string }[];
  explanation: string;
  equityImpactSummary: string;
  isSimulatedFleet: boolean;
}

export interface AllocationRankingRecord {
  id: string;
  bookingId: string;
  attemptNumber: number;
  triggerReason: string;
  pickup: Coordinates;
  weightsUsed: AllocationWeights;
  totalFleetCount: number;
  eligibleCount: number;
  excludedCount: number;
  selectedDriverId?: string;
  selectedDriverName?: string;
  greedyDriverId?: string;
  greedyDriverName?: string;
  greedyEtaMin?: number;
  candidates: FairAllocationFactor[];
  explanation: string;
  createdAt: string;
  isDemoScenario?: boolean;
}

export interface DemoScenarioState {
  active: boolean;
  loadedAt?: string;
  passengerId?: string;
  booking?: RideRecord | null;
  sosIncident?: EmergencyIncidentRecord | null;
  drivers: DriverRecord[];
  requests: DriverRequestRecord[];
  rankings: AllocationRankingRecord[];
  events: RideEventRecord[];
  settings: SystemSettingsRecord;
}

export interface RideRecord {
  id: string;
  passengerId: string;
  passengerName: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  driverRating?: number;
  driverEtaMin?: number;
  vehicleModel?: string;
  plateNumber?: string;
  vehicleTier: VehicleTier;
  pickupAddress: string;
  pickupCoords: Coordinates;
  destinationAddress: string;
  destinationCoords: Coordinates;
  distanceKm: number;
  durationMin: number;
  actualDistanceKm?: number;
  actualDurationMin?: number;
  estimatedFare: number;
  finalFare?: number;
  estimatedFareBreakdown?: FareBreakdown;
  finalFareBreakdown?: FareBreakdown;
  pooledDiscountFare?: number;
  poolingOptIn?: boolean;
  surgeMultiplier?: number;
  surgeDisclosure?: string;
  routeSolverType?: 'EXTERNAL_ROUTING' | 'PROTOTYPE_GRAPH_ROUTER';
  status: RideStatus;
  allocationStatus?: AllocationStatus;
  searchStage?: SearchStage;
  allocationReason?: string;
  allocationScore?: number;
  paymentId?: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  paymentReference?: string;
  activeRequestId?: string;
  excludedDriverIds?: string[];
  allocationAttempts?: number;
  reassignmentCount?: number;
  rejectedDriverCount?: number;
  timedOutDriverCount?: number;
  idempotencyKey?: string;
  cancellationReason?: string;
  routePath: [number, number][];
  requestedAt: string;
  confirmedAt?: string;
  searchStartedAt?: string;
  lastSearchAt?: string;
  waitDeadlineAt?: string;
  lastRejectedAt?: string;
  lastTimeoutAt?: string;
  assignedAt?: string;
  arrivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  isSimulatedDemo?: boolean;
  isDemoScenario?: boolean;
  exclusionsResetAt?: string;
}

export interface PaymentRecord {
  id: string;
  rideId: string;
  bookingId: string;
  passengerId: string;
  driverId?: string;
  estimatedFare: number;
  finalFare?: number;
  amount: number;
  currency: 'INR';
  paymentMethod: PaymentMethod;
  method: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: PaymentStatus;
  transactionId?: string;
  transactionReference: string;
  gatewayMode: GatewayMode;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  gatewayReference?: string;
  accountLabel?: string;
  fareBreakdown?: FareBreakdown;
  paidAt?: string;
  cashConfirmedAt?: string;
  cashConfirmedBy?: string;
  failureReason?: string;
  refundReference?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPaymentRow extends PaymentRecord {
  passengerName: string;
  passengerEmail?: string;
  driverName?: string;
  pickupAddress: string;
  destinationAddress: string;
  rideStatus: RideStatus;
  rideCompletedAt?: string;
}

export interface AdminPaymentSummary {
  totalCompletedRideFares: number;
  totalCollectedAmount: number;
  pendingPaymentsCount: number;
  pendingPaymentsAmount: number;
  failedPaymentsCount: number;
  failedPaymentsAmount: number;
  refundedPaymentsCount: number;
  refundedPaymentsAmount: number;
  paidCount: number;
  processingCount: number;
  byMethod: {
    CASH: { count: number; collectedAmount: number; pendingAmount: number };
    UPI: { count: number; collectedAmount: number; pendingAmount: number; failedAmount: number };
    CARD: { count: number; collectedAmount: number; pendingAmount: number; failedAmount: number };
  };
}

export interface DriverRequestRecord {
  id: string;
  bookingId: string;
  driverId: string;
  driverUserId?: string;
  driverName: string;
  passengerId: string;
  passengerName: string;
  passengerPhone?: string;
  pickupAddress: string;
  pickupCoords: Coordinates;
  destinationAddress: string;
  destinationCoords: Coordinates;
  distanceKm: number;
  durationMin: number;
  estimatedFare: number;
  driverEarnings: number;
  vehicleTier: VehicleTier;
  attemptNumber: number;
  allocationScore: number;
  allocationReason: string;
  pickupDistanceKm?: number;
  pickupEtaMin?: number;
  status: DriverRequestStatus;
  deliveryStatus?: 'PENDING_DELIVERY' | 'DELIVERED';
  deliveredAt?: string;
  timerStartedAt?: string;
  expiresAt: string;
  createdAt: string;
  respondedAt?: string;
  rejectedAt?: string;
  timedOutAt?: string;
  isDemoScenario?: boolean;
}

export interface RideEventRecord {
  id: string;
  bookingId: string;
  eventType: string;
  actorId: string;
  actorRole: UserRole | 'SYSTEM';
  status?: string;
  message: string;
  metadata?: Record<string, string | number | boolean | null>;
  timestamp: string;
  isDemoScenario?: boolean;
}

export interface LocationHistoryRecord {
  id: string;
  driverId: string;
  bookingId?: string;
  coordinates: Coordinates;
  areaName: string;
  isSimulatedLocation: boolean;
  timestamp: string;
}

export interface DemandZoneForecast {
  zoneId: string;
  zoneName: string;
  area: string;
  coordinates: Coordinates;
  zoneType: string;
  currentDemand: number;
  predictedDemand: number;
  activeDrivers: number;
  supplyGap: number;
  surgeMultiplier: number;
  confidencePct: number;
  intensity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  reason: string;
}

export interface DemandHourlyPoint {
  hourLabel: string;
  historicalDemand: number;
  predictedDemand: number;
  availableSupply: number;
}

export interface DemandForecastResponse {
  modelName: string;
  modelType: 'EXTERNAL_ML_SERVICE' | 'PROTOTYPE_TIME_SERIES';
  horizon: string;
  dayType: 'WEEKDAY' | 'WEEKEND';
  weather: 'CLEAR' | 'RAINY';
  zones: DemandZoneForecast[];
  hourlySeries: DemandHourlyPoint[];
  summary: string;
  isSimulatedData: boolean;
}

export interface PoolCandidateRequest {
  id: string;
  passengerName: string;
  pickupName: string;
  pickupCoords: Coordinates;
  destinationName: string;
  destinationCoords: Coordinates;
  soloDistanceKm: number;
  soloFare: number;
  requestedWindow: string;
  isLiveDbRequest: boolean;
}

export interface PooledGroup {
  groupId: string;
  riders: PoolCandidateRequest[];
  compatibilityScore: number;
  sharedCorridorKm: number;
  detourPenaltyPct: number;
  combinedSoloFare: number;
  totalSharedFare: number;
  perRiderSavingsPct: number;
  co2SavedKg: number;
  routeWaypoints: [number, number][];
  explanation: string;
}

export interface RidePoolingResponse {
  algorithm: string;
  activeRequestsCount: number;
  groups: PooledGroup[];
  unmatchedRequests: PoolCandidateRequest[];
  totalDistanceSavedKm: number;
  averageFareSavingsPct: number;
  summary: string;
  isSimulatedData: boolean;
}

export interface RepositionRecommendation {
  driverId: string;
  driverName: string;
  currentArea: string;
  currentCoords: Coordinates;
  targetZoneId: string;
  targetZoneName: string;
  targetCoords: Coordinates;
  travelDistanceKm: number;
  travelMinutes: number;
  expectedDemand: number;
  currentSupplyInTarget: number;
  expectedWaitReductionMin: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  explanation: string;
}

export interface RepositioningResponse {
  algorithm: string;
  recommendations: RepositionRecommendation[];
  hotspots: DemandZoneForecast[];
  fleetUtilizationGainPct: number;
  summary: string;
  isSimulatedData: boolean;
}

export interface RouteAlternative {
  id: string;
  name: string;
  corridorType: 'OPTIMIZED' | 'ARTERIAL' | 'SHORTCUT';
  distanceKm: number;
  durationMin: number;
  trafficIndex: number;
  estimatedFare: number;
  fuelEfficiencyScore: number;
  waypoints: [number, number][];
  isRecommended: boolean;
  reason: string;
}

export interface RouteOptimizationResponse {
  solverType: 'EXTERNAL_ROUTING' | 'PROTOTYPE_GRAPH_ROUTER';
  pickupName: string;
  destinationName: string;
  pickupCoords: Coordinates;
  destinationCoords: Coordinates;
  timePeriod: 'OFF_PEAK' | 'MORNING_PEAK' | 'EVENING_PEAK';
  recommendedRoute: RouteAlternative;
  alternatives: RouteAlternative[];
  explanation: string;
}

export interface AdminOperationsSummary {
  totalBookings: number;
  confirmedBookings: number;
  pendingAllocations: number;
  assignedRides: number;
  completedRidesCount: number;
  cancelledRidesCount: number;
  paymentSuccessCount: number;
  paymentPendingCount: number;
  paymentFailedCount: number;
  paymentRefundedCount: number;
  completedRideValue: number;
  collectedRevenue: number;
  availableDrivers: number;
  busyDrivers: number;
  driverRejections: number;
  driverExpirations: number;
  reassignmentAttempts: number;
}

export interface AdminAnalyticsResponse {
  dateFilter: 'TODAY' | '7_DAYS' | '30_DAYS';
  dataSourceSummary: {
    databaseMode: 'MONGODB' | 'LOCAL_DEMO_STORE';
    liveDatabaseRides: number;
    simulatedBaselineRides: number;
  };
  kpis: {
    totalRides: number;
    activePassengers: number;
    availableDrivers: number;
    onlineDrivers: number;
    completedRides: number;
    avgWaitTimeMin: number;
    driverUtilizationPct: number;
    completionRatePct: number;
    fairnessGiniImprovementPct: number;
  };
  operationsSummary: AdminOperationsSummary;
  activitySeries: {
    label: string;
    completed: number;
    pooled: number;
    cancelled: number;
  }[];
  demandDistribution: {
    zone: string;
    requests: number;
    sharePct: number;
    avgWaitMin: number;
  }[];
  driverAllocationAnalytics: {
    driverName: string;
    area: string;
    ridesToday: number;
    utilizationPct: number;
    fairnessScore: number;
    earnings: number;
  }[];
  recentRides: RideRecord[];
}

export interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  organization: string;
  topic: string;
  message: string;
  createdAt: string;
}

// ============================================================================
// SOS EMERGENCY ASSISTANCE & PERSONAL SAFETY TYPES
// ============================================================================
export type EmergencyCategory =
  | 'HARASSMENT'
  | 'THREAT'
  | 'UNSAFE_DRIVING'
  | 'ACCIDENT'
  | 'MEDICAL'
  | 'OTHER';

export type IncidentStatus =
  | 'SOS_ACTIVATED'
  | 'LOCATION_CAPTURED'
  | 'ADMIN_NOTIFIED'
  | 'AWAITING_EMERGENCY_RESPONSE'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CANCELLED_ACCIDENTAL';

export type PoliceNotificationStatus =
  | 'NOT_CONFIGURED'
  | 'NOT_INITIATED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'FAILED';

export type LocationSource =
  | 'LIVE_GPS'
  | 'LAST_KNOWN_BACKEND'
  | 'MANUAL_USER_INPUT'
  | 'UNAVAILABLE';

export type PoliceLookupStatus =
  | 'VERIFIED_OSM'
  | 'NO_STATIONS_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'NOT_RUN';

export interface NearbyPoliceStation {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  coordinates: Coordinates;
  distanceKm: number;
  jurisdictionStatus: 'NEAREST_LISTED_UNCONFIRMED' | 'JURISDICTION_CONFIRMED';
  source: 'OPENSTREETMAP_OVERPASS';
  googleMapsUrl: string;
  osmUrl: string;
}

export interface EmergencyEventEntry {
  id: string;
  incidentId: string;
  eventType: string;
  actorId: string;
  actorRole: UserRole | 'SYSTEM';
  message: string;
  metadata?: Record<string, string | number | boolean | null>;
  timestamp: string;
}

export interface EmergencyNote {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  note: string;
  createdAt: string;
}

export interface AdminAccessLogEntry {
  id: string;
  adminId: string;
  adminEmail: string;
  action: string;
  accessedAt: string;
}

export interface EmergencyIncidentRecord {
  incidentId: string;
  rideId?: string;
  activatedBy: string;
  activatedByRole: UserRole;
  activatedByName: string;
  passengerId?: string;
  passengerName?: string;
  passengerPhone?: string;
  passengerEmail?: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  vehicleId?: string;
  vehicleRegistrationNumber?: string;
  vehicleModel?: string;
  vehicleTier?: VehicleTier;
  vehicleColor?: string;
  pickupAddress?: string;
  pickupCoords?: Coordinates;
  destinationAddress?: string;
  destinationCoords?: Coordinates;
  rideStatusAtActivation?: RideStatus;
  routePath?: [number, number][];
  emergencyCategory?: EmergencyCategory;
  emergencyDescription?: string;
  latitude?: number;
  longitude?: number;
  locationAccuracy?: number;
  locationTimestamp?: string;
  locationSource: LocationSource;
  locationVerifiedCurrent: boolean;
  readableAddress?: string;
  manualLocationText?: string;
  nearestPoliceStations: NearbyPoliceStation[];
  policeLookupStatus: PoliceLookupStatus;
  policeLookupNote?: string;
  policeNotificationStatus: PoliceNotificationStatus;
  policeReferenceId?: string;
  policeLastCheckedAt?: string;
  policeDeliveryError?: string;
  adminNotificationStatus: 'NOTIFIED' | 'ACKNOWLEDGED' | 'PENDING';
  incidentStatus: IncidentStatus;
  emergencyNumber: string;
  emergencyCountry: string;
  isDemoScenario?: boolean;
  accidentalCancellationReason?: string;
  escalationTarget?: string;
  resolutionSummary?: string;
  notes: EmergencyNote[];
  events: EmergencyEventEntry[];
  adminAccessLog?: AdminAccessLogEntry[];
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
}

