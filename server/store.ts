import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import {
  AllocationRankingRecord,
  AuthUser,
  ContactSubmission,
  DriverDocument,
  DriverRecord,
  DriverRequestRecord,
  DriverVerificationStatus,
  EmergencyEventEntry,
  EmergencyIncidentRecord,
  LocationHistoryRecord,
  PaymentRecord,
  PaymentStatus,
  RideEventRecord,
  RideRecord,
  SystemSettingsRecord,
  UserRole,
  VehicleTier,
} from '../src/types/ridenexa.js';
import { getDefaultPricingConfig, normalizeCoordinates } from './algorithms.js';
import { hashPassword } from './auth.js';
import { createSeedDrivers, createSeedRides } from './cityData.js';

export interface StoredUser extends AuthUser {
  passwordHash: string;
}

interface PersistedState {
  users: StoredUser[];
  drivers: DriverRecord[];
  rides: RideRecord[];
  payments: PaymentRecord[];
  driverRequests: DriverRequestRecord[];
  rideEvents: RideEventRecord[];
  locationHistory: LocationHistoryRecord[];
  contacts: ContactSubmission[];
  allocationRankings: AllocationRankingRecord[];
  emergencyIncidents: EmergencyIncidentRecord[];
  settings: SystemSettingsRecord;
}

export function createDefaultSettings(): SystemSettingsRecord {
  return {
    id: 'global-settings',
    allocationWeights: {
      eta: 0.4,
      fairness: 0.3,
      reliability: 0.15,
      workload: 0.15,
    },
    maxPickupEtaMin: 25,
    maxReassignmentAttempts: 10,
    driverResponseTimeoutSec: Math.max(5, Number(process.env.DRIVER_RESPONSE_TIMEOUT || 30)),
    driverSearchIntervalSec: Math.max(2, Number(process.env.DRIVER_SEARCH_INTERVAL_SEC || 4)),
    maxBookingWaitSec: Math.max(30, Number(process.env.MAX_BOOKING_WAIT_SEC || 180)),
    dispatchStrategy: 'NEAREST_FIRST',
    surgeDemandRatioThreshold: 1.35,
    surgeMultiplierCap: 1.5,
    enableOsrmRouting: true,
    pricingConfig: getDefaultPricingConfig(),
    updatedAt: new Date().toISOString(),
  };
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'ridenexa-db.json');

// Mongoose Schemas (used when MONGODB_URI is configured)
const UserSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['PASSENGER', 'DRIVER', 'ADMIN'], required: true },
  phone: String,
  createdAt: { type: String, required: true },
});

const DriverSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: String,
  name: { type: String, required: true },
  vehicleModel: { type: String, required: true },
  vehicleTier: { type: String, required: true },
  plateNumber: { type: String, required: true },
  vehicleCapacity: Number,
  licenseNumber: String,
  licenseExpiry: String,
  verificationStatus: { type: String, default: 'PENDING_VERIFICATION' },
  rejectionReason: String,
  resubmissionNote: String,
  verifiedAt: String,
  verifiedBy: String,
  documents: [mongoose.Schema.Types.Mixed],
  rating: Number,
  isOnline: Boolean,
  isAvailable: Boolean,
  coordinates: { lat: Number, lng: Number },
  areaName: String,
  ridesCompletedToday: Number,
  totalRidesCompleted: Number,
  dailyEarnings: Number,
  minutesSinceLastRide: Number,
  acceptanceRate: Number,
  allocationOpportunities: Number,
  acceptedCount: Number,
  rejectedCount: Number,
  timedOutCount: Number,
  isSimulatedLocation: Boolean,
  isDemoScenario: Boolean,
  lastUpdatedAt: String,
});

const RideSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  passengerId: { type: String, index: true },
  passengerName: String,
  driverId: { type: String, index: true },
  driverName: String,
  driverPhone: String,
  driverRating: Number,
  driverEtaMin: Number,
  vehicleModel: String,
  plateNumber: String,
  vehicleTier: String,
  pickupAddress: String,
  pickupCoords: { lat: Number, lng: Number },
  destinationAddress: String,
  destinationCoords: { lat: Number, lng: Number },
  distanceKm: Number,
  durationMin: Number,
  actualDistanceKm: Number,
  actualDurationMin: Number,
  estimatedFare: Number,
  finalFare: Number,
  estimatedFareBreakdown: mongoose.Schema.Types.Mixed,
  finalFareBreakdown: mongoose.Schema.Types.Mixed,
  pooledDiscountFare: Number,
  poolingOptIn: Boolean,
  surgeMultiplier: Number,
  surgeDisclosure: String,
  routeSolverType: String,
  status: { type: String, index: true },
  allocationStatus: String,
  searchStage: String,
  allocationReason: String,
  allocationScore: Number,
  paymentId: String,
  paymentMethod: String,
  paymentStatus: { type: String, index: true },
  paymentReference: String,
  activeRequestId: String,
  excludedDriverIds: [String],
  allocationAttempts: Number,
  reassignmentCount: Number,
  rejectedDriverCount: Number,
  timedOutDriverCount: Number,
  idempotencyKey: String,
  cancellationReason: String,
  routePath: [[Number]],
  requestedAt: String,
  confirmedAt: String,
  searchStartedAt: String,
  lastSearchAt: String,
  waitDeadlineAt: String,
  lastRejectedAt: String,
  lastTimeoutAt: String,
  exclusionsResetAt: String,
  assignedAt: String,
  arrivedAt: String,
  startedAt: String,
  completedAt: String,
  cancelledAt: String,
  isSimulatedDemo: Boolean,
  isDemoScenario: Boolean,
});

const PaymentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  rideId: { type: String, required: true, unique: true, index: true },
  bookingId: { type: String, required: true, index: true },
  passengerId: { type: String, required: true, index: true },
  driverId: { type: String, index: true },
  estimatedFare: { type: Number, required: true },
  finalFare: Number,
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  paymentMethod: { type: String, enum: ['CASH', 'UPI', 'CARD', 'WALLET'], required: true, index: true },
  method: String,
  paymentStatus: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED', 'SUCCESS'],
    required: true,
    index: true,
  },
  status: String,
  transactionId: { type: String, index: true },
  transactionReference: String,
  gatewayMode: String,
  gatewayOrderId: { type: String, index: true },
  gatewayPaymentId: String,
  gatewayReference: String,
  accountLabel: String,
  fareBreakdown: mongoose.Schema.Types.Mixed,
  paidAt: String,
  cashConfirmedAt: String,
  cashConfirmedBy: String,
  failureReason: String,
  refundReference: String,
  createdAt: String,
  updatedAt: String,
});

const DriverRequestSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  bookingId: { type: String, required: true, index: true },
  driverId: { type: String, required: true, index: true },
  driverUserId: String,
  driverName: String,
  passengerId: String,
  passengerName: String,
  passengerPhone: String,
  pickupAddress: String,
  pickupCoords: { lat: Number, lng: Number },
  destinationAddress: String,
  destinationCoords: { lat: Number, lng: Number },
  distanceKm: Number,
  durationMin: Number,
  estimatedFare: Number,
  driverEarnings: Number,
  vehicleTier: String,
  attemptNumber: Number,
  allocationScore: Number,
  allocationReason: String,
  pickupDistanceKm: Number,
  pickupEtaMin: Number,
  status: String,
  deliveryStatus: String,
  deliveredAt: String,
  timerStartedAt: String,
  expiresAt: String,
  createdAt: String,
  respondedAt: String,
  rejectedAt: String,
  timedOutAt: String,
  isDemoScenario: Boolean,
});

const RideEventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  bookingId: { type: String, required: true, index: true },
  eventType: String,
  actorId: String,
  actorRole: String,
  status: String,
  message: String,
  metadata: mongoose.Schema.Types.Mixed,
  timestamp: String,
  isDemoScenario: Boolean,
});

const LocationHistorySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  driverId: { type: String, required: true, index: true },
  bookingId: String,
  coordinates: { lat: Number, lng: Number },
  areaName: String,
  isSimulatedLocation: Boolean,
  timestamp: String,
});

const ContactSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  email: String,
  organization: String,
  topic: String,
  message: String,
  createdAt: String,
});

const AllocationRankingSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  bookingId: { type: String, required: true, index: true },
  attemptNumber: Number,
  triggerReason: String,
  pickup: { lat: Number, lng: Number },
  weightsUsed: mongoose.Schema.Types.Mixed,
  totalFleetCount: Number,
  eligibleCount: Number,
  excludedCount: Number,
  selectedDriverId: String,
  selectedDriverName: String,
  greedyDriverId: String,
  greedyDriverName: String,
  greedyEtaMin: Number,
  candidates: [mongoose.Schema.Types.Mixed],
  explanation: String,
  createdAt: String,
  isDemoScenario: Boolean,
});

const SystemSettingsSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  allocationWeights: mongoose.Schema.Types.Mixed,
  maxPickupEtaMin: Number,
  maxReassignmentAttempts: Number,
  driverResponseTimeoutSec: Number,
  driverSearchIntervalSec: Number,
  maxBookingWaitSec: Number,
  dispatchStrategy: String,
  surgeDemandRatioThreshold: Number,
  surgeMultiplierCap: Number,
  enableOsrmRouting: Boolean,
  pricingConfig: mongoose.Schema.Types.Mixed,
  updatedAt: String,
  updatedBy: String,
});

const EmergencyIncidentSchema = new mongoose.Schema({
  incidentId: { type: String, required: true, unique: true, index: true },
  rideId: { type: String, index: true },
  activatedBy: { type: String, required: true, index: true },
  activatedByRole: { type: String, enum: ['PASSENGER', 'DRIVER', 'ADMIN'], required: true },
  activatedByName: String,
  passengerId: { type: String, index: true },
  passengerName: String,
  passengerPhone: String,
  passengerEmail: String,
  driverId: { type: String, index: true },
  driverName: String,
  driverPhone: String,
  vehicleId: String,
  vehicleRegistrationNumber: String,
  vehicleModel: String,
  vehicleTier: String,
  vehicleColor: String,
  pickupAddress: String,
  pickupCoords: { lat: Number, lng: Number },
  destinationAddress: String,
  destinationCoords: { lat: Number, lng: Number },
  rideStatusAtActivation: String,
  routePath: [[Number]],
  emergencyCategory: {
    type: String,
    enum: ['HARASSMENT', 'THREAT', 'UNSAFE_DRIVING', 'ACCIDENT', 'MEDICAL', 'OTHER'],
  },
  emergencyDescription: String,
  latitude: Number,
  longitude: Number,
  locationAccuracy: Number,
  locationTimestamp: String,
  locationSource: {
    type: String,
    enum: ['LIVE_GPS', 'LAST_KNOWN_BACKEND', 'MANUAL_USER_INPUT', 'UNAVAILABLE'],
    required: true,
  },
  locationVerifiedCurrent: Boolean,
  readableAddress: String,
  manualLocationText: String,
  nearestPoliceStations: [mongoose.Schema.Types.Mixed],
  policeLookupStatus: String,
  policeLookupNote: String,
  policeNotificationStatus: {
    type: String,
    enum: ['NOT_CONFIGURED', 'NOT_INITIATED', 'SUBMITTED', 'ACKNOWLEDGED', 'FAILED'],
    required: true,
  },
  policeReferenceId: String,
  policeLastCheckedAt: String,
  policeDeliveryError: String,
  adminNotificationStatus: {
    type: String,
    enum: ['NOTIFIED', 'ACKNOWLEDGED', 'PENDING'],
    default: 'NOTIFIED',
  },
  incidentStatus: {
    type: String,
    enum: [
      'SOS_ACTIVATED',
      'LOCATION_CAPTURED',
      'ADMIN_NOTIFIED',
      'AWAITING_EMERGENCY_RESPONSE',
      'ESCALATED',
      'RESOLVED',
      'CLOSED',
      'CANCELLED_ACCIDENTAL',
    ],
    required: true,
    index: true,
  },
  emergencyNumber: { type: String, default: '112' },
  emergencyCountry: { type: String, default: 'IN' },
  isDemoScenario: { type: Boolean, default: false, index: true },
  accidentalCancellationReason: String,
  escalationTarget: String,
  resolutionSummary: String,
  notes: [mongoose.Schema.Types.Mixed],
  events: [mongoose.Schema.Types.Mixed],
  adminAccessLog: [mongoose.Schema.Types.Mixed],
  idempotencyKey: String,
  createdAt: { type: String, required: true, index: true },
  updatedAt: { type: String, required: true },
  acknowledgedAt: String,
  acknowledgedBy: String,
  resolvedAt: String,
});

const UserModel = mongoose.models.RnUser || mongoose.model('RnUser', UserSchema);
const DriverModel = mongoose.models.RnDriver || mongoose.model('RnDriver', DriverSchema);
const RideModel = mongoose.models.RnRide || mongoose.model('RnRide', RideSchema);
const PaymentModel = mongoose.models.RnPayment || mongoose.model('RnPayment', PaymentSchema);
const DriverRequestModel = mongoose.models.RnDriverRequest || mongoose.model('RnDriverRequest', DriverRequestSchema);
const RideEventModel = mongoose.models.RnRideEvent || mongoose.model('RnRideEvent', RideEventSchema);
const LocationHistoryModel = mongoose.models.RnLocationHistory || mongoose.model('RnLocationHistory', LocationHistorySchema);
const ContactModel = mongoose.models.RnContact || mongoose.model('RnContact', ContactSchema);
const AllocationRankingModel =
  mongoose.models.RnAllocationRanking || mongoose.model('RnAllocationRanking', AllocationRankingSchema);
const SystemSettingsModel =
  mongoose.models.RnSystemSettings || mongoose.model('RnSystemSettings', SystemSettingsSchema);
const EmergencyIncidentModel =
  mongoose.models.RnEmergencyIncident || mongoose.model('RnEmergencyIncident', EmergencyIncidentSchema);

class RideNexaStore {
  public databaseMode: 'MONGODB' | 'LOCAL_DEMO_STORE' = 'LOCAL_DEMO_STORE';
  private state: PersistedState = {
    users: [],
    drivers: [],
    rides: [],
    payments: [],
    driverRequests: [],
    rideEvents: [],
    locationHistory: [],
    contacts: [],
    allocationRankings: [],
    emergencyIncidents: [],
    settings: createDefaultSettings(),
  };
  private initialized = false;
  private lastLoadedMtimeMs = 0;
  private bookingLocks = new Map<string, Promise<unknown>>();

  async withBookingLock<T>(bookingId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.bookingLocks.get(bookingId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    this.bookingLocks.set(bookingId, next);
    try {
      return await next;
    } finally {
      if (this.bookingLocks.get(bookingId) === next) {
        this.bookingLocks.delete(bookingId);
      }
    }
  }

  private normalizePaymentStatus(status?: string): PaymentStatus {
    if (!status) return 'PENDING';
    if (status === 'SUCCESS' || status === 'PAID') return 'PAID';
    if (status === 'PROCESSING' || status === 'FAILED' || status === 'REFUNDED') return status;
    return 'PENDING';
  }

  private normalizeRideRecord(r: RideRecord): RideRecord {
    return {
      ...r,
      paymentStatus: r.paymentStatus ? this.normalizePaymentStatus(r.paymentStatus) : undefined,
    };
  }

  private normalizePaymentRecord(p: PaymentRecord): PaymentRecord {
    const method = p.paymentMethod || p.method || 'UPI';
    const status = this.normalizePaymentStatus(p.paymentStatus || p.status);
    const rideId = p.rideId || p.bookingId;
    const bookingId = p.bookingId || p.rideId;
    const finalFare = p.finalFare ?? p.amount;
    const estimatedFare = p.estimatedFare ?? p.amount;
    const amount = finalFare ?? estimatedFare;
    const transactionId = p.transactionId || p.transactionReference;
    const transactionReference = p.transactionReference || p.transactionId || `INIT-${p.id}`;
    return {
      ...p,
      rideId,
      bookingId,
      estimatedFare,
      finalFare,
      amount,
      currency: 'INR',
      paymentMethod: method,
      method,
      paymentStatus: status,
      status,
      transactionId,
      transactionReference,
    };
  }

  private normalizeDriverRecord(d: DriverRecord): DriverRecord {
    const normalizedVerification = (String(d.verificationStatus || 'APPROVED')
      .trim()
      .toUpperCase() || 'APPROVED') as DriverVerificationStatus;
    const isUnlinkedNonDemo = !d.isDemoScenario && !d.userId;
    const isOnline = isUnlinkedNonDemo ? false : Boolean(d.isOnline);
    const isAvailable = isOnline ? (d.isAvailable !== undefined ? Boolean(d.isAvailable) : true) : false;
    const normalizedCoords = normalizeCoordinates(d.coordinates) || { lat: 12.9722, lng: 77.6012 };
    return {
      ...d,
      verificationStatus: normalizedVerification,
      isOnline,
      isAvailable,
      coordinates: normalizedCoords,
      vehicleCapacity: d.vehicleCapacity ?? 4,
      documents: d.documents || [],
      allocationOpportunities: d.allocationOpportunities ?? d.ridesCompletedToday ?? 0,
      acceptedCount: d.acceptedCount ?? d.ridesCompletedToday ?? 0,
      rejectedCount: d.rejectedCount ?? 0,
      timedOutCount: d.timedOutCount ?? 0,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    const mongoUri = process.env.MONGODB_URI?.trim();
    if (mongoUri) {
      try {
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 4000 });
        this.databaseMode = 'MONGODB';
        await this.seedMongoIfEmpty();
        await this.syncCacheFromMongo();
        await this.reconcileAdminProvisioning();
        this.initialized = true;
        console.log('[RideNexa] Connected to MongoDB via Mongoose.');
        return;
      } catch (err) {
        console.warn(
          '[RideNexa] MongoDB connection unavailable, using persistent local demo store:',
          (err as Error).message
        );
      }
    }

    this.databaseMode = 'LOCAL_DEMO_STORE';
    await this.loadOrSeedLocalStore();
    await this.reconcileAdminProvisioning();
    this.initialized = true;
    console.log('[RideNexa] Initialized persistent local demo store at .data/ridenexa-db.json');
  }

  private async buildDefaultDemoUsers(): Promise<StoredUser[]> {
    // Only Passenger & Driver demonstration accounts are seeded automatically.
    // Admin accounts are NEVER hardcoded and must be provisioned server-side via environment variables or protected setup.
    const defaultPasswordHash = await hashPassword('RideNexa123!');
    const now = new Date().toISOString();
    return [
      {
        id: 'user-passenger-demo',
        name: 'Aarav Sharma',
        email: 'passenger@ridenexa.io',
        passwordHash: defaultPasswordHash,
        role: 'PASSENGER',
        phone: '+91 98450 11223',
        createdAt: now,
      },
      {
        id: 'user-driver-demo',
        name: 'Arjun Nair',
        email: 'driver@ridenexa.io',
        passwordHash: defaultPasswordHash,
        role: 'DRIVER',
        phone: '+91 98450 44556',
        createdAt: now,
      },
    ];
  }

  private async seedMongoIfEmpty(): Promise<void> {
    const userCount = await UserModel.countDocuments();
    if (userCount === 0) {
      const users = await this.buildDefaultDemoUsers();
      await UserModel.insertMany(users);
    }
    const driverCount = await DriverModel.countDocuments();
    if (driverCount === 0) {
      await DriverModel.insertMany(createSeedDrivers());
    }
    const rideCount = await RideModel.countDocuments();
    if (rideCount === 0) {
      await RideModel.insertMany(createSeedRides());
    }
    const settingsCount = await SystemSettingsModel.countDocuments();
    if (settingsCount === 0) {
      await SystemSettingsModel.create(createDefaultSettings());
    }
  }

  private async syncCacheFromMongo(): Promise<void> {
    const [
      users,
      drivers,
      rides,
      payments,
      driverRequests,
      rideEvents,
      locationHistory,
      contacts,
      allocationRankings,
      emergencyIncidents,
      settingsDoc,
    ] = await Promise.all([
      UserModel.find().lean(),
      DriverModel.find().lean(),
      RideModel.find().lean(),
      PaymentModel.find().lean(),
      DriverRequestModel.find().lean(),
      RideEventModel.find().lean(),
      LocationHistoryModel.find().lean(),
      ContactModel.find().lean(),
      AllocationRankingModel.find().lean(),
      EmergencyIncidentModel.find().lean(),
      SystemSettingsModel.findOne({ id: 'global-settings' }).lean(),
    ]);
    this.state = {
      users: users as unknown as StoredUser[],
      drivers: (drivers as unknown as DriverRecord[]).map((d) => this.normalizeDriverRecord(d)),
      rides: (rides as unknown as RideRecord[]).map((r) => this.normalizeRideRecord(r)),
      payments: (payments as unknown as PaymentRecord[]).map((p) => this.normalizePaymentRecord(p)),
      driverRequests: driverRequests as unknown as DriverRequestRecord[],
      rideEvents: rideEvents as unknown as RideEventRecord[],
      locationHistory: locationHistory as unknown as LocationHistoryRecord[],
      contacts: contacts as unknown as ContactSubmission[],
      allocationRankings: allocationRankings as unknown as AllocationRankingRecord[],
      emergencyIncidents: (emergencyIncidents as unknown as EmergencyIncidentRecord[]) || [],
      settings: {
        ...createDefaultSettings(),
        ...((settingsDoc as unknown as SystemSettingsRecord) || {}),
      },
    };
  }

  private async loadOrSeedLocalStore(): Promise<void> {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const stat = fs.statSync(STORE_FILE);
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        if (parsed.users?.length && parsed.drivers?.length) {
          this.state = {
            users: parsed.users,
            drivers: parsed.drivers.map((d) => this.normalizeDriverRecord(d)),
            rides: (parsed.rides || []).map((r) => this.normalizeRideRecord(r)),
            payments: (parsed.payments || []).map((p) => this.normalizePaymentRecord(p)),
            driverRequests: parsed.driverRequests || [],
            rideEvents: parsed.rideEvents || [],
            locationHistory: parsed.locationHistory || [],
            contacts: parsed.contacts || [],
            allocationRankings: parsed.allocationRankings || [],
            emergencyIncidents: parsed.emergencyIncidents || [],
            settings: {
              ...createDefaultSettings(),
              ...(parsed.settings || {}),
              allocationWeights: {
                ...createDefaultSettings().allocationWeights,
                ...(parsed.settings?.allocationWeights || {}),
              },
              pricingConfig: {
                ...getDefaultPricingConfig(),
                ...(parsed.settings?.pricingConfig || {}),
              },
            },
          };
          this.lastLoadedMtimeMs = stat.mtimeMs;
          return;
        }
      }
    } catch {
      // Fall back to fresh seed
    }

    this.state = {
      users: await this.buildDefaultDemoUsers(),
      drivers: createSeedDrivers(),
      rides: createSeedRides(),
      payments: [],
      driverRequests: [],
      rideEvents: [],
      locationHistory: [],
      contacts: [],
      allocationRankings: [],
      emergencyIncidents: [],
      settings: createDefaultSettings(),
    };
    this.persistLocal();
  }

  private async reconcileAdminProvisioning(): Promise<void> {
    const hadLegacyAdmin = this.state.users.some((u) => u.id === 'user-admin-demo');
    if (hadLegacyAdmin) {
      this.state.users = this.state.users.filter((u) => u.id !== 'user-admin-demo');
      if (this.databaseMode === 'MONGODB') {
        await UserModel.deleteOne({ id: 'user-admin-demo' });
      }
      this.persistLocal();
    }

    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME?.trim() || 'RideNexa Administrator';

    if (adminEmail && adminPassword && adminPassword.length >= 8) {
      await this.provisionAdmin({
        email: adminEmail,
        password: adminPassword,
        name: adminName,
      });
    }
  }

  async provisionAdmin(input: {
    email: string;
    password: string;
    name?: string;
  }): Promise<StoredUser> {
    this.syncIfLocalChanged();
    const emailNorm = input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);
    const existingIdx = this.state.users.findIndex((u) => u.email.toLowerCase() === emailNorm);

    if (existingIdx !== -1) {
      const updated: StoredUser = {
        ...this.state.users[existingIdx],
        name: input.name?.trim() || this.state.users[existingIdx].name,
        passwordHash,
        role: 'ADMIN',
      };
      this.state.users[existingIdx] = updated;
      if (this.databaseMode === 'MONGODB') {
        await UserModel.updateOne(
          { id: updated.id },
          { $set: { name: updated.name, passwordHash: updated.passwordHash, role: 'ADMIN' } }
        );
      }
      this.persistLocal();
      return updated;
    }

    const adminUser: StoredUser = {
      id: `user-admin-${Date.now().toString(36)}`,
      name: input.name?.trim() || 'RideNexa Administrator',
      email: emailNorm,
      passwordHash,
      role: 'ADMIN',
      createdAt: new Date().toISOString(),
    };
    this.state.users.push(adminUser);
    if (this.databaseMode === 'MONGODB') {
      await UserModel.create(adminUser);
    }
    this.persistLocal();
    return adminUser;
  }

  hasAdminUser(): boolean {
    this.syncIfLocalChanged();
    return this.state.users.some((u) => u.role === 'ADMIN');
  }

  private persistLocal(): void {
    if (this.databaseMode !== 'LOCAL_DEMO_STORE') return;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STORE_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
      this.lastLoadedMtimeMs = fs.statSync(STORE_FILE).mtimeMs;
    } catch (err) {
      console.error('[RideNexa] Failed to persist local store:', err);
    }
  }

  private syncIfLocalChanged(): void {
    if (this.databaseMode !== 'LOCAL_DEMO_STORE') return;
    try {
      if (!fs.existsSync(STORE_FILE)) return;
      const stat = fs.statSync(STORE_FILE);
      if (stat.mtimeMs > this.lastLoadedMtimeMs) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        if (parsed.users?.length) {
          this.state = {
            users: parsed.users,
            drivers: (parsed.drivers || this.state.drivers).map((d) =>
              this.normalizeDriverRecord(d)
            ),
            rides: (parsed.rides || this.state.rides).map((r) => this.normalizeRideRecord(r)),
            payments: (parsed.payments || this.state.payments).map((p) =>
              this.normalizePaymentRecord(p)
            ),
            driverRequests: parsed.driverRequests || this.state.driverRequests,
            rideEvents: parsed.rideEvents || this.state.rideEvents,
            locationHistory: parsed.locationHistory || this.state.locationHistory,
            contacts: parsed.contacts || this.state.contacts,
            allocationRankings: parsed.allocationRankings || this.state.allocationRankings,
            emergencyIncidents: parsed.emergencyIncidents || this.state.emergencyIncidents,
            settings: parsed.settings || this.state.settings,
          };
          this.lastLoadedMtimeMs = stat.mtimeMs;
        }
      }
    } catch {
      // Ignore transient read error
    }
  }

  // SETTINGS
  getSettings(): SystemSettingsRecord {
    this.syncIfLocalChanged();
    return this.state.settings || createDefaultSettings();
  }

  async updateSettings(patch: Partial<SystemSettingsRecord>): Promise<SystemSettingsRecord> {
    this.syncIfLocalChanged();
    const current = this.getSettings();
    const next: SystemSettingsRecord = {
      ...current,
      ...patch,
      allocationWeights: {
        ...current.allocationWeights,
        ...(patch.allocationWeights || {}),
      },
      updatedAt: new Date().toISOString(),
    };
    this.state.settings = next;
    if (this.databaseMode === 'MONGODB') {
      await SystemSettingsModel.updateOne(
        { id: 'global-settings' },
        { $set: next },
        { upsert: true }
      );
    }
    this.persistLocal();
    return next;
  }

  // USERS
  findUserByEmail(email: string): StoredUser | undefined {
    this.syncIfLocalChanged();
    const norm = email.trim().toLowerCase();
    return this.state.users.find((u) => u.email.toLowerCase() === norm);
  }

  findUserById(id: string): StoredUser | undefined {
    this.syncIfLocalChanged();
    return this.state.users.find((u) => u.id === id);
  }

  getAllUsersSafe(): AuthUser[] {
    this.syncIfLocalChanged();
    return this.state.users.map(({ passwordHash: _ph, ...safe }) => safe);
  }

  async upsertDemoUser(user: StoredUser): Promise<StoredUser> {
    this.syncIfLocalChanged();
    const idx = this.state.users.findIndex((u) => u.id === user.id || u.email === user.email);
    if (idx !== -1) {
      this.state.users[idx] = user;
      if (this.databaseMode === 'MONGODB') {
        await UserModel.updateOne({ id: user.id }, { $set: user }, { upsert: true });
      }
    } else {
      this.state.users.push(user);
      if (this.databaseMode === 'MONGODB') {
        await UserModel.create(user);
      }
    }
    this.persistLocal();
    return user;
  }

  async createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
    role: 'PASSENGER' | 'DRIVER';
    phone?: string;
    vehicleModel?: string;
    vehicleTier?: VehicleTier;
    plateNumber?: string;
    vehicleCapacity?: number;
    licenseNumber?: string;
    licenseExpiry?: string;
    documents?: DriverDocument[];
  }): Promise<StoredUser> {
    const safeRole: 'PASSENGER' | 'DRIVER' = input.role === 'DRIVER' ? 'DRIVER' : 'PASSENGER';

    const user: StoredUser = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      passwordHash: input.passwordHash,
      role: safeRole,
      phone: input.phone?.trim(),
      createdAt: new Date().toISOString(),
    };

    this.state.users.push(user);
    if (this.databaseMode === 'MONGODB') {
      await UserModel.create(user);
    }

    if (safeRole === 'DRIVER') {
      const tier: VehicleTier = input.vehicleTier || 'EV_COMFORT';
      const driver: DriverRecord = {
        id: `drv-${Date.now().toString().slice(-5)}-${Math.random().toString(36).slice(2, 4)}`,
        userId: user.id,
        name: user.name,
        vehicleModel: input.vehicleModel?.trim() || 'Tata Nexon EV',
        vehicleTier: tier,
        plateNumber:
          input.plateNumber?.trim().toUpperCase() ||
          `KA-01-RN-${Math.floor(1000 + Math.random() * 8999)}`,
        vehicleCapacity: input.vehicleCapacity ?? (tier === 'POOL_SHARE' ? 6 : 4),
        licenseNumber: input.licenseNumber?.trim().toUpperCase() || undefined,
        licenseExpiry: input.licenseExpiry?.trim() || undefined,
        verificationStatus: 'PENDING_VERIFICATION',
        documents: input.documents || [],
        rating: 4.8,
        isOnline: false,
        isAvailable: false,
        coordinates: { lat: 12.9722, lng: 77.6012 },
        areaName: 'MG Road Transit Hub',
        ridesCompletedToday: 0,
        totalRidesCompleted: 0,
        dailyEarnings: 0,
        minutesSinceLastRide: 30,
        acceptanceRate: 0.95,
        allocationOpportunities: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        timedOutCount: 0,
        isSimulatedLocation: true,
        lastUpdatedAt: new Date().toISOString(),
      };
      this.state.drivers.push(driver);
      if (this.databaseMode === 'MONGODB') {
        await DriverModel.create(driver);
      }
    }

    this.persistLocal();
    return user;
  }

  // DRIVERS
  getDrivers(): DriverRecord[] {
    this.syncIfLocalChanged();
    return this.state.drivers;
  }

  getDriversByVerification(status?: DriverVerificationStatus): DriverRecord[] {
    const all = this.getDrivers();
    return status ? all.filter((d) => d.verificationStatus === status) : all;
  }

  getDriverByUserIdOrId(userIdOrId: string): DriverRecord | undefined {
    this.syncIfLocalChanged();
    return this.state.drivers.find((d) => d.userId === userIdOrId || d.id === userIdOrId);
  }

  async upsertDriver(driver: DriverRecord): Promise<DriverRecord> {
    this.syncIfLocalChanged();
    const idx = this.state.drivers.findIndex((d) => d.id === driver.id);
    const normalized = this.normalizeDriverRecord(driver);
    if (idx !== -1) {
      this.state.drivers[idx] = normalized;
      if (this.databaseMode === 'MONGODB') {
        await DriverModel.updateOne({ id: normalized.id }, { $set: normalized }, { upsert: true });
      }
    } else {
      this.state.drivers.push(normalized);
      if (this.databaseMode === 'MONGODB') {
        await DriverModel.create(normalized);
      }
    }
    this.persistLocal();
    return normalized;
  }

  async updateDriver(driverId: string, patch: Partial<DriverRecord>): Promise<DriverRecord | null> {
    this.syncIfLocalChanged();
    const idx = this.state.drivers.findIndex((d) => d.id === driverId || d.userId === driverId);
    if (idx === -1) return null;

    const current = this.state.drivers[idx];
    const safeCoords = patch.coordinates
      ? normalizeCoordinates(patch.coordinates) || current.coordinates
      : current.coordinates;

    const updated = this.normalizeDriverRecord({
      ...current,
      ...patch,
      coordinates: safeCoords,
      lastUpdatedAt: new Date().toISOString(),
    });
    this.state.drivers[idx] = updated;
    if (this.databaseMode === 'MONGODB') {
      await DriverModel.updateOne({ id: updated.id }, { $set: updated });
    }
    this.persistLocal();
    return updated;
  }

  // RIDES / BOOKINGS
  getRides(): RideRecord[] {
    this.syncIfLocalChanged();
    return [...this.state.rides].sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );
  }

  getRideById(id: string): RideRecord | undefined {
    this.syncIfLocalChanged();
    return this.state.rides.find((r) => r.id === id);
  }

  findRideByIdempotencyKey(passengerId: string, key: string): RideRecord | undefined {
    this.syncIfLocalChanged();
    return this.state.rides.find(
      (r) => r.passengerId === passengerId && r.idempotencyKey === key
    );
  }

  async createRide(ride: RideRecord): Promise<RideRecord> {
    this.state.rides.unshift(ride);
    if (this.databaseMode === 'MONGODB') {
      await RideModel.create(ride);
    }
    this.persistLocal();
    return ride;
  }

  async updateRide(id: string, patch: Partial<RideRecord>): Promise<RideRecord | null> {
    const idx = this.state.rides.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const updated: RideRecord = { ...this.state.rides[idx], ...patch };
    this.state.rides[idx] = updated;
    if (this.databaseMode === 'MONGODB') {
      await RideModel.updateOne({ id }, { $set: updated });
    }
    this.persistLocal();
    return updated;
  }

  // PAYMENTS
  getPayments(): PaymentRecord[] {
    this.syncIfLocalChanged();
    return [...this.state.payments]
      .map((p) => this.normalizePaymentRecord(p))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getPaymentByBookingId(bookingId: string): PaymentRecord | undefined {
    this.syncIfLocalChanged();
    const found = this.state.payments.find(
      (p) => p.rideId === bookingId || p.bookingId === bookingId
    );
    return found ? this.normalizePaymentRecord(found) : undefined;
  }

  getPaymentByRideId(rideId: string): PaymentRecord | undefined {
    return this.getPaymentByBookingId(rideId);
  }

  getPaymentById(id: string): PaymentRecord | undefined {
    this.syncIfLocalChanged();
    const found = this.state.payments.find((p) => p.id === id);
    return found ? this.normalizePaymentRecord(found) : undefined;
  }

  getPaymentByGatewayOrderId(orderId: string): PaymentRecord | undefined {
    this.syncIfLocalChanged();
    const found = this.state.payments.find((p) => p.gatewayOrderId === orderId);
    return found ? this.normalizePaymentRecord(found) : undefined;
  }

  getPaymentsByPassengerId(passengerId: string): PaymentRecord[] {
    return this.getPayments().filter((p) => p.passengerId === passengerId);
  }

  getPaymentsByDriverId(driverId: string): PaymentRecord[] {
    return this.getPayments().filter((p) => p.driverId === driverId);
  }

  async createPayment(payment: PaymentRecord): Promise<PaymentRecord> {
    this.syncIfLocalChanged();
    const normalized = this.normalizePaymentRecord(payment);
    // Prevent duplicate payment records for the same ride
    const existingIdx = this.state.payments.findIndex(
      (p) => p.rideId === normalized.rideId || p.bookingId === normalized.bookingId
    );
    if (existingIdx !== -1) {
      const merged = this.normalizePaymentRecord({
        ...this.state.payments[existingIdx],
        ...normalized,
        id: this.state.payments[existingIdx].id,
      });
      this.state.payments[existingIdx] = merged;
      if (this.databaseMode === 'MONGODB') {
        await PaymentModel.updateOne({ id: merged.id }, { $set: merged });
      }
      this.persistLocal();
      return merged;
    }

    this.state.payments.unshift(normalized);
    if (this.databaseMode === 'MONGODB') {
      await PaymentModel.create(normalized);
    }
    this.persistLocal();
    return normalized;
  }

  async updatePayment(id: string, patch: Partial<PaymentRecord>): Promise<PaymentRecord | null> {
    this.syncIfLocalChanged();
    const idx = this.state.payments.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const mergedRaw: PaymentRecord = {
      ...this.state.payments[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    if (patch.paymentStatus && !patch.status) mergedRaw.status = patch.paymentStatus;
    if (patch.status && !patch.paymentStatus) mergedRaw.paymentStatus = patch.status;
    if (patch.paymentMethod && !patch.method) mergedRaw.method = patch.paymentMethod;
    if (patch.method && !patch.paymentMethod) mergedRaw.paymentMethod = patch.method;
    if (patch.transactionId && !patch.transactionReference) {
      mergedRaw.transactionReference = patch.transactionId;
    }
    if (patch.transactionReference && !patch.transactionId) {
      mergedRaw.transactionId = patch.transactionReference;
    }
    const updated = this.normalizePaymentRecord(mergedRaw);
    this.state.payments[idx] = updated;
    if (this.databaseMode === 'MONGODB') {
      await PaymentModel.updateOne({ id }, { $set: updated });
    }
    this.persistLocal();
    return updated;
  }

  // DRIVER REQUESTS
  getDriverRequests(): DriverRequestRecord[] {
    this.syncIfLocalChanged();
    return [...this.state.driverRequests].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getDriverRequestById(id: string): DriverRequestRecord | undefined {
    this.syncIfLocalChanged();
    return this.state.driverRequests.find((r) => r.id === id);
  }

  getDriverRequestsByBooking(bookingId: string): DriverRequestRecord[] {
    this.syncIfLocalChanged();
    return this.state.driverRequests
      .filter((r) => r.bookingId === bookingId)
      .sort((a, b) => a.attemptNumber - b.attemptNumber);
  }

  getPendingDriverRequestsForDriver(driverId: string): DriverRequestRecord[] {
    this.syncIfLocalChanged();
    const nowMs = Date.now();
    return this.state.driverRequests
      .filter((r) => {
        if (r.driverId !== driverId || r.status !== 'PENDING') return false;
        if (!r.expiresAt) return true;
        const expMs = new Date(r.expiresAt).getTime();
        return !Number.isFinite(expMs) || expMs > nowMs;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getPendingDriverRequests(): DriverRequestRecord[] {
    this.syncIfLocalChanged();
    return this.state.driverRequests.filter((r) => r.status === 'PENDING');
  }

  async createDriverRequest(reqRecord: DriverRequestRecord): Promise<DriverRequestRecord> {
    const existingPending = this.state.driverRequests.find(
      (r) => r.bookingId === reqRecord.bookingId && r.status === 'PENDING'
    );
    if (existingPending) {
      return existingPending;
    }
    this.state.driverRequests.unshift(reqRecord);
    if (this.databaseMode === 'MONGODB') {
      await DriverRequestModel.create(reqRecord);
    }
    this.persistLocal();
    return reqRecord;
  }

  async updateDriverRequest(
    id: string,
    patch: Partial<DriverRequestRecord>
  ): Promise<DriverRequestRecord | null> {
    const idx = this.state.driverRequests.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const updated: DriverRequestRecord = { ...this.state.driverRequests[idx], ...patch };
    this.state.driverRequests[idx] = updated;
    if (this.databaseMode === 'MONGODB') {
      await DriverRequestModel.updateOne({ id }, { $set: updated });
    }
    this.persistLocal();
    return updated;
  }

  // ALLOCATION RANKINGS
  getAllocationRankings(bookingId?: string): AllocationRankingRecord[] {
    this.syncIfLocalChanged();
    const list = bookingId
      ? this.state.allocationRankings.filter((r) => r.bookingId === bookingId)
      : this.state.allocationRankings;
    return [...list].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async createAllocationRanking(record: AllocationRankingRecord): Promise<AllocationRankingRecord> {
    this.state.allocationRankings.unshift(record);
    if (this.state.allocationRankings.length > 400) {
      this.state.allocationRankings = this.state.allocationRankings.slice(0, 400);
    }
    if (this.databaseMode === 'MONGODB') {
      await AllocationRankingModel.create(record);
    }
    this.persistLocal();
    return record;
  }

  // RIDE EVENTS (PERSISTENT AUDIT & LIFECYCLE HISTORY)
  getRideEvents(bookingId?: string): RideEventRecord[] {
    this.syncIfLocalChanged();
    const list = bookingId
      ? this.state.rideEvents.filter((e) => e.bookingId === bookingId)
      : this.state.rideEvents;
    return [...list].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  async createRideEvent(event: RideEventRecord): Promise<RideEventRecord> {
    this.state.rideEvents.unshift(event);
    if (this.state.rideEvents.length > 1200) {
      this.state.rideEvents = this.state.rideEvents.slice(0, 1200);
    }
    if (this.databaseMode === 'MONGODB') {
      await RideEventModel.create(event);
    }
    this.persistLocal();
    return event;
  }

  // LOCATION HISTORY
  getLocationHistory(driverId?: string, bookingId?: string): LocationHistoryRecord[] {
    this.syncIfLocalChanged();
    return this.state.locationHistory
      .filter((loc) => {
        if (driverId && loc.driverId !== driverId) return false;
        if (bookingId && loc.bookingId !== bookingId) return false;
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async appendLocationHistory(entry: LocationHistoryRecord): Promise<LocationHistoryRecord> {
    this.state.locationHistory.unshift(entry);
    if (this.state.locationHistory.length > 500) {
      this.state.locationHistory = this.state.locationHistory.slice(0, 500);
    }
    if (this.databaseMode === 'MONGODB') {
      await LocationHistoryModel.create(entry);
    }
    this.persistLocal();
    return entry;
  }

  // CONTACTS
  async createContact(submission: ContactSubmission): Promise<ContactSubmission> {
    this.state.contacts.unshift(submission);
    if (this.databaseMode === 'MONGODB') {
      await ContactModel.create(submission);
    }
    this.persistLocal();
    return submission;
  }

  // SOS EMERGENCY INCIDENTS (PERSISTENT + AUDITED + REAL RECORD PROTECTION)
  getEmergencyIncidents(options?: { includeDemo?: boolean }): EmergencyIncidentRecord[] {
    this.syncIfLocalChanged();
    const includeDemo = options?.includeDemo ?? true;
    return [...(this.state.emergencyIncidents || [])]
      .filter((i) => includeDemo || !i.isDemoScenario)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getEmergencyIncidentById(incidentId: string): EmergencyIncidentRecord | undefined {
    this.syncIfLocalChanged();
    return (this.state.emergencyIncidents || []).find((i) => i.incidentId === incidentId);
  }

  getActiveEmergencyIncidentForUser(
    userId: string,
    rideId?: string
  ): EmergencyIncidentRecord | undefined {
    this.syncIfLocalChanged();
    return (this.state.emergencyIncidents || [])
      .filter((i) => {
        if (i.activatedBy !== userId) return false;
        if (['RESOLVED', 'CLOSED', 'CANCELLED_ACCIDENTAL'].includes(i.incidentStatus)) {
          return false;
        }
        if (rideId && i.rideId) {
          return i.rideId === rideId;
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }

  findEmergencyIncidentByIdempotencyKey(
    userId: string,
    key: string
  ): EmergencyIncidentRecord | undefined {
    this.syncIfLocalChanged();
    return (this.state.emergencyIncidents || []).find(
      (i) => i.activatedBy === userId && i.idempotencyKey === key
    );
  }

  async createEmergencyIncident(
    incident: EmergencyIncidentRecord
  ): Promise<EmergencyIncidentRecord> {
    this.syncIfLocalChanged();
    this.state.emergencyIncidents.unshift(incident);
    if (this.databaseMode === 'MONGODB') {
      await EmergencyIncidentModel.create(incident);
    }
    this.persistLocal();
    return incident;
  }

  async updateEmergencyIncident(
    incidentId: string,
    patch: Partial<EmergencyIncidentRecord>
  ): Promise<EmergencyIncidentRecord | null> {
    this.syncIfLocalChanged();
    const idx = this.state.emergencyIncidents.findIndex((i) => i.incidentId === incidentId);
    if (idx === -1) return null;
    const updated: EmergencyIncidentRecord = {
      ...this.state.emergencyIncidents[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.state.emergencyIncidents[idx] = updated;
    if (this.databaseMode === 'MONGODB') {
      await EmergencyIncidentModel.updateOne({ incidentId }, { $set: updated });
    }
    this.persistLocal();
    return updated;
  }

  async appendEmergencyIncidentEvent(
    incidentId: string,
    evt: EmergencyEventEntry
  ): Promise<EmergencyIncidentRecord | null> {
    this.syncIfLocalChanged();
    const idx = this.state.emergencyIncidents.findIndex((i) => i.incidentId === incidentId);
    if (idx === -1) return null;
    const current = this.state.emergencyIncidents[idx];
    const updated: EmergencyIncidentRecord = {
      ...current,
      events: [evt, ...(current.events || [])],
      updatedAt: new Date().toISOString(),
    };
    this.state.emergencyIncidents[idx] = updated;
    if (this.databaseMode === 'MONGODB') {
      await EmergencyIncidentModel.updateOne({ incidentId }, { $set: updated });
    }
    this.persistLocal();
    return updated;
  }

  async recordAdminSosAccess(
    incidentId: string,
    adminId: string,
    adminEmail: string,
    action = 'VIEWED_FULL_INCIDENT'
  ): Promise<EmergencyIncidentRecord | null> {
    this.syncIfLocalChanged();
    const idx = this.state.emergencyIncidents.findIndex((i) => i.incidentId === incidentId);
    if (idx === -1) return null;
    const current = this.state.emergencyIncidents[idx];
    const entry = {
      id: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      adminId,
      adminEmail,
      action,
      accessedAt: new Date().toISOString(),
    };
    const updated: EmergencyIncidentRecord = {
      ...current,
      adminAccessLog: [entry, ...(current.adminAccessLog || [])].slice(0, 100),
    };
    this.state.emergencyIncidents[idx] = updated;
    if (this.databaseMode === 'MONGODB') {
      await EmergencyIncidentModel.updateOne(
        { incidentId },
        { $set: { adminAccessLog: updated.adminAccessLog } }
      );
    }
    this.persistLocal();
    return updated;
  }

  // SAFE JUDGE DEMO SCENARIO CLEANUP (NEVER DELETES REAL RIDES OR REAL SOS INCIDENTS)
  async removeDemoScenarioData(): Promise<void> {
    this.syncIfLocalChanged();
    const demoRideIds = new Set(
      this.state.rides.filter((r) => r.isDemoScenario).map((r) => r.id)
    );
    this.state.users = this.state.users.filter((u) => !u.id.startsWith('demo-judge-'));
    this.state.drivers = this.state.drivers.filter((d) => !d.isDemoScenario);
    this.state.rides = this.state.rides.filter((r) => !r.isDemoScenario);
    this.state.payments = this.state.payments.filter((p) => !demoRideIds.has(p.bookingId));
    this.state.driverRequests = this.state.driverRequests.filter((r) => !r.isDemoScenario);
    this.state.rideEvents = this.state.rideEvents.filter((e) => !e.isDemoScenario);
    this.state.allocationRankings = this.state.allocationRankings.filter((a) => !a.isDemoScenario);
    // Preserve ALL real SOS records; only clear sandbox isDemoScenario SOS incidents
    this.state.emergencyIncidents = (this.state.emergencyIncidents || []).filter(
      (i) => !i.isDemoScenario
    );

    if (this.databaseMode === 'MONGODB') {
      await Promise.all([
        UserModel.deleteMany({ id: { $regex: '^demo-judge-' } }),
        DriverModel.deleteMany({ isDemoScenario: true }),
        RideModel.deleteMany({ isDemoScenario: true }),
        PaymentModel.deleteMany({ bookingId: { $in: Array.from(demoRideIds) } }),
        DriverRequestModel.deleteMany({ isDemoScenario: true }),
        RideEventModel.deleteMany({ isDemoScenario: true }),
        AllocationRankingModel.deleteMany({ isDemoScenario: true }),
        EmergencyIncidentModel.deleteMany({ isDemoScenario: true }),
      ]);
    }
    this.persistLocal();
  }

  getUsersCountByRole(role: UserRole): number {
    this.syncIfLocalChanged();
    return this.state.users.filter((u) => u.role === role).length;
  }
}

export const store = new RideNexaStore();
