import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export type MarketplaceProvider = 'SHOPEE' | 'LAZADA';

export type ConnectionStatus =
  | 'PENDING_AUTH'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'TOKEN_EXPIRED'
  | 'REAUTH_REQUIRED'
  | 'PAUSED'
  | 'DISCONNECTED';

export type WebhookProcessingStatus =
  | 'RECEIVED'
  | 'VALIDATED'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'NEEDS_REVIEW'
  | 'RETRY_PENDING'
  | 'DEAD_LETTERED';

export type SkuMappingStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'CONFLICT'
  | 'NEEDS_REVIEW';

export type ListingSyncStatus =
  | 'NOT_MAPPED'
  | 'MAPPED'
  | 'SYNC_PENDING'
  | 'SYNCED'
  | 'SYNC_FAILED'
  | 'NEEDS_REVIEW'
  | 'UNSUPPORTED';

export type ChannelOrderSyncStatus =
  | 'RECEIVED'
  | 'IMPORTING'
  | 'IMPORTED'
  | 'MAPPING_REQUIRED'
  | 'SHORTAGE_HOLD'
  | 'CONFLICT'
  | 'FAILED';

export type NormalizedExternalOrderStatus =
  | 'UNPAID'
  | 'READY_TO_SHIP'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED';

export type SyncJobType =
  | 'ORDER_IMPORT'
  | 'ORDER_POLL'
  | 'ORDER_STATUS_SYNC'
  | 'INVENTORY_PUBLICATION'
  | 'PRODUCT_MAPPING_SYNC'
  | 'PRODUCT_PUBLICATION'
  | 'CONNECTION_TOKEN_REFRESH'
  | 'FULL_RECONCILIATION'
  | 'INCREMENTAL_RECONCILIATION';

export type SyncJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'RETRY_SCHEDULED'
  | 'COMPLETED'
  | 'FAILED_PERMANENT'
  | 'CANCELLED'
  | 'NEEDS_REVIEW'
  | 'DEAD_LETTERED';

export type ErrorClassification =
  | 'TRANSIENT'
  | 'PERMANENT_CONFIG'
  | 'BUSINESS_CONFLICT'
  | 'UNKNOWN_OUTCOME';

export type SyncConflictType =
  | 'SKU_UNMAPPED'
  | 'SKU_INACTIVE'
  | 'QUANTITY_INVALID'
  | 'STOCK_INSUFFICIENT'
  | 'DUPLICATE_EXTERNAL_ORDER'
  | 'ORDER_STATE_CONFLICT'
  | 'PAYMENT_EVIDENCE_CONFLICT'
  | 'ADDRESS_INVALID'
  | 'PROVIDER_DATA_INCOMPLETE'
  | 'PROVIDER_AUTH_EXPIRED'
  | 'SYNC_VERSION_CONFLICT';

export enum IntegrationDomainErrorCode {
  CHANNEL_CONNECTION_NOT_FOUND = 'CHANNEL_CONNECTION_NOT_FOUND',
  CHANNEL_CONNECTION_INACTIVE = 'CHANNEL_CONNECTION_INACTIVE',
  CHANNEL_CONNECTION_CONFLICT = 'CHANNEL_CONNECTION_CONFLICT',
  CHANNEL_AUTHORIZATION_FAILED = 'CHANNEL_AUTHORIZATION_FAILED',
  CHANNEL_TOKEN_EXPIRED = 'CHANNEL_TOKEN_EXPIRED',
  CHANNEL_REAUTH_REQUIRED = 'CHANNEL_REAUTH_REQUIRED',
  INVALID_CONNECTION_TRANSITION = 'INVALID_CONNECTION_TRANSITION',

  INVALID_WEBHOOK_SIGNATURE = 'INVALID_WEBHOOK_SIGNATURE',
  WEBHOOK_REPLAY_REJECTED = 'WEBHOOK_REPLAY_REJECTED',
  WEBHOOK_PAYLOAD_UNSUPPORTED = 'WEBHOOK_PAYLOAD_UNSUPPORTED',
  WEBHOOK_PERSISTENCE_FAILED = 'WEBHOOK_PERSISTENCE_FAILED',

  SKU_MAPPING_NOT_FOUND = 'SKU_MAPPING_NOT_FOUND',
  SKU_MAPPING_CONFLICT = 'SKU_MAPPING_CONFLICT',
  EXTERNAL_SKU_UNKNOWN = 'EXTERNAL_SKU_UNKNOWN',
  INTERNAL_VARIANT_NOT_FOUND = 'INTERNAL_VARIANT_NOT_FOUND',
  INTERNAL_VARIANT_INACTIVE = 'INTERNAL_VARIANT_INACTIVE',

  EXTERNAL_ORDER_ALREADY_IMPORTED = 'EXTERNAL_ORDER_ALREADY_IMPORTED',
  EXTERNAL_ORDER_MAPPING_REQUIRED = 'EXTERNAL_ORDER_MAPPING_REQUIRED',
  EXTERNAL_ORDER_STATE_CONFLICT = 'EXTERNAL_ORDER_STATE_CONFLICT',

  PROVIDER_RATE_LIMITED = 'PROVIDER_RATE_LIMITED',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_CAPABILITY_UNSUPPORTED = 'PROVIDER_CAPABILITY_UNSUPPORTED',
  PROVIDER_CIRCUIT_OPEN = 'PROVIDER_CIRCUIT_OPEN',
  PROVIDER_TIMEOUT_UNKNOWN_OUTCOME = 'PROVIDER_TIMEOUT_UNKNOWN_OUTCOME',

  SYNC_JOB_NOT_FOUND = 'SYNC_JOB_NOT_FOUND',
  SYNC_JOB_ALREADY_RUNNING = 'SYNC_JOB_ALREADY_RUNNING',
  SYNC_JOB_RETRY_EXHAUSTED = 'SYNC_JOB_RETRY_EXHAUSTED',

  CONFLICT_NOT_FOUND = 'CONFLICT_NOT_FOUND',
  CONFLICT_ALREADY_RESOLVED = 'CONFLICT_ALREADY_RESOLVED',

  INVENTORY_PUBLICATION_CONFLICT = 'INVENTORY_PUBLICATION_CONFLICT',
  RECONCILIATION_REQUIRED = 'RECONCILIATION_REQUIRED',
  RECONCILIATION_RUN_NOT_FOUND = 'RECONCILIATION_RUN_NOT_FOUND',

  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  TENANT_ACCESS_DENIED = 'TENANT_ACCESS_DENIED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

export class IntegrationDomainError extends Error {
  constructor(
    public readonly code: IntegrationDomainErrorCode,
    message: string,
    public readonly httpStatus = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'IntegrationDomainError';
  }
}

// ============================================================================
// 1. CONNECTION LIFECYCLE STATE MACHINE
// ============================================================================

const ALLOWED_CONNECTION_TRANSITIONS: Record<
  ConnectionStatus,
  readonly ConnectionStatus[]
> = {
  PENDING_AUTH: ['CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED'],
  CONNECTED: [
    'CONNECTED',
    'DEGRADED',
    'TOKEN_EXPIRED',
    'REAUTH_REQUIRED',
    'PAUSED',
    'DISCONNECTED',
  ],
  DEGRADED: [
    'CONNECTED',
    'TOKEN_EXPIRED',
    'REAUTH_REQUIRED',
    'PAUSED',
    'DISCONNECTED',
  ],
  TOKEN_EXPIRED: ['CONNECTED', 'REAUTH_REQUIRED', 'PAUSED', 'DISCONNECTED'],
  REAUTH_REQUIRED: ['PENDING_AUTH', 'CONNECTED', 'DISCONNECTED'],
  PAUSED: ['CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED'],
  DISCONNECTED: ['PENDING_AUTH', 'CONNECTED'],
};

export function assertValidConnectionTransition(
  from: ConnectionStatus,
  to: ConnectionStatus,
): void {
  const allowed = ALLOWED_CONNECTION_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new IntegrationDomainError(
      IntegrationDomainErrorCode.INVALID_CONNECTION_TRANSITION,
      `Cannot transition channel connection from ${from} to ${to}`,
      409,
      { from, to },
    );
  }
}

// ============================================================================
// 2. ENVELOPE ENCRYPTION FOR CREDENTIALS (AES-256-GCM)
// ============================================================================

const DEFAULT_DEV_MASTER_KEY =
  'sapoclone-m6-integration-default-master-key-32b!';

function deriveAesKey(rawMasterKey?: string): Buffer {
  const secret = rawMasterKey || DEFAULT_DEV_MASTER_KEY;
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptCredentialSecret(
  plaintext: string,
  keyVersion = 1,
  masterKey?: string,
): string {
  if (!plaintext) {
    throw new IntegrationDomainError(
      IntegrationDomainErrorCode.VALIDATION_ERROR,
      'Credential secret plaintext must not be empty',
      400,
    );
  }
  const key = deriveAesKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `v${keyVersion}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptCredentialSecret(
  ciphertext: string,
  masterKey?: string,
): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || !parts[0].startsWith('v')) {
    throw new IntegrationDomainError(
      IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
      'Invalid encrypted credential envelope format',
      500,
    );
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const key = deriveAesKey(masterKey);
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function redactSensitiveObject<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }
  if (typeof input === 'string') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveObject(item)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('password') ||
        lower.includes('signature') ||
        lower.includes('authorization') ||
        lower.includes('partnerkey') ||
        lower.includes('appsecret')
      ) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitiveObject(v);
      }
    }
    return out as T;
  }
  return input;
}

// ============================================================================
// 3. PROVIDER-SPECIFIC CRYPTOGRAPHIC SIGNING & WEBHOOK VERIFICATION
// ============================================================================

/**
 * Shopee Open Platform v2 API Request Signature:
 * baseString = partner_id + api_path + timestamp (+ access_token + shop_id for shop APIs)
 * sign = hex(HMAC_SHA256(partner_key, baseString))
 */
export function computeShopeeApiSignature(params: {
  partnerId: string;
  partnerKey: string;
  apiPath: string;
  timestamp: number;
  accessToken?: string;
  shopId?: string;
}): string {
  const base =
    params.accessToken && params.shopId
      ? `${params.partnerId}${params.apiPath}${params.timestamp}${params.accessToken}${params.shopId}`
      : `${params.partnerId}${params.apiPath}${params.timestamp}`;
  return createHmac('sha256', params.partnerKey)
    .update(base, 'utf8')
    .digest('hex');
}

/**
 * Shopee Open Platform v2 Webhook Signature:
 * baseString = webhookUrl + '|' + rawBody
 * Authorization header = hex(HMAC_SHA256(partnerKey, baseString))
 */
export function computeShopeeWebhookSignature(
  webhookUrl: string,
  rawBody: Buffer | string,
  partnerKey: string,
): string {
  const mac = createHmac('sha256', partnerKey);
  mac.update(webhookUrl, 'utf8');
  mac.update('|', 'utf8');
  if (Buffer.isBuffer(rawBody)) {
    mac.update(rawBody);
  } else {
    mac.update(rawBody, 'utf8');
  }
  return mac.digest('hex');
}

export function verifyShopeeWebhookSignature(params: {
  webhookUrl: string;
  rawBody: Buffer | string;
  partnerKey: string;
  providedSignature: string;
}): boolean {
  if (!params.providedSignature || !params.partnerKey) {
    return false;
  }
  const expected = computeShopeeWebhookSignature(
    params.webhookUrl,
    params.rawBody,
    params.partnerKey,
  );
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(params.providedSignature.trim(), 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Lazada Open Platform API Request Signature:
 * Sort all parameter keys ASCII ascending, concatenate apiPath + key1 + val1 + key2 + val2 ...
 * sign = UPPERCASE(hex(HMAC_SHA256(appSecret, concatenated)))
 */
export function computeLazadaApiSignature(params: {
  appSecret: string;
  apiPath: string;
  queryParams: Record<string, string | number>;
}): string {
  const sortedKeys = Object.keys(params.queryParams)
    .filter((k) => k !== 'sign')
    .sort();
  let base = params.apiPath;
  for (const k of sortedKeys) {
    base += `${k}${params.queryParams[k]}`;
  }
  return createHmac('sha256', params.appSecret)
    .update(base, 'utf8')
    .digest('hex')
    .toUpperCase();
}

/**
 * Lazada Open Platform Webhook Signature:
 * hex(HMAC_SHA256(appSecret, rawBody))
 */
export function computeLazadaWebhookSignature(
  rawBody: Buffer | string,
  appSecret: string,
): string {
  const mac = createHmac('sha256', appSecret);
  if (Buffer.isBuffer(rawBody)) {
    mac.update(rawBody);
  } else {
    mac.update(rawBody, 'utf8');
  }
  return mac.digest('hex');
}

export function verifyLazadaWebhookSignature(params: {
  rawBody: Buffer | string;
  appSecret: string;
  providedSignature: string;
}): boolean {
  if (!params.providedSignature || !params.appSecret) {
    return false;
  }
  const expected = computeLazadaWebhookSignature(
    params.rawBody,
    params.appSecret,
  ).toLowerCase();
  const provided = params.providedSignature.trim().toLowerCase();
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

export function assertWebhookTimestampFreshness(
  eventTimestampSeconds: number,
  nowMs = Date.now(),
  maxSkewSeconds = 300,
): void {
  if (!Number.isFinite(eventTimestampSeconds) || eventTimestampSeconds <= 0) {
    throw new IntegrationDomainError(
      IntegrationDomainErrorCode.WEBHOOK_REPLAY_REJECTED,
      'Webhook timestamp is missing or invalid',
      401,
    );
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  const skew = Math.abs(nowSeconds - eventTimestampSeconds);
  if (skew > maxSkewSeconds) {
    throw new IntegrationDomainError(
      IntegrationDomainErrorCode.WEBHOOK_REPLAY_REJECTED,
      `Webhook timestamp skew (${skew}s) exceeds maximum allowed replay window (${maxSkewSeconds}s)`,
      401,
      { eventTimestampSeconds, nowSeconds, skew, maxSkewSeconds },
    );
  }
}

// ============================================================================
// 4. ORDER STATUS NORMALIZATION & MONOTONIC OUT-OF-ORDER PROTECTION
// ============================================================================

const SHOPEE_STATUS_MAP: Record<string, NormalizedExternalOrderStatus> = {
  UNPAID: 'UNPAID',
  READY_TO_SHIP: 'READY_TO_SHIP',
  PROCESSED: 'SHIPPED',
  SHIPPED: 'SHIPPED',
  TO_CONFIRM_RECEIVE: 'DELIVERED',
  COMPLETED: 'DELIVERED',
  IN_CANCEL: 'CANCELLED',
  CANCELLED: 'CANCELLED',
  TO_RETURN: 'RETURN_REQUESTED',
};

const LAZADA_STATUS_MAP: Record<string, NormalizedExternalOrderStatus> = {
  unpaid: 'UNPAID',
  pending: 'READY_TO_SHIP',
  packed: 'READY_TO_SHIP',
  ready_to_ship: 'READY_TO_SHIP',
  shipped: 'SHIPPED',
  delivered: 'DELIVERED',
  canceled: 'CANCELLED',
  cancelled: 'CANCELLED',
  returned: 'RETURN_REQUESTED',
};

const STATUS_PROGRESSION_RANK: Record<NormalizedExternalOrderStatus, number> = {
  UNPAID: 10,
  READY_TO_SHIP: 20,
  SHIPPED: 30,
  DELIVERED: 40,
  CANCELLED: 50,
  RETURN_REQUESTED: 60,
};

export function normalizeProviderOrderStatus(
  provider: MarketplaceProvider,
  rawStatus: string,
): NormalizedExternalOrderStatus {
  const trimmed = rawStatus?.trim() ?? '';
  if (provider === 'SHOPEE') {
    const mapped = SHOPEE_STATUS_MAP[trimmed.toUpperCase()];
    if (mapped) return mapped;
  } else if (provider === 'LAZADA') {
    const mapped = LAZADA_STATUS_MAP[trimmed.toLowerCase()];
    if (mapped) return mapped;
  }
  throw new IntegrationDomainError(
    IntegrationDomainErrorCode.WEBHOOK_PAYLOAD_UNSUPPORTED,
    `Unsupported external order status "${rawStatus}" for provider ${provider}`,
    422,
    { provider, rawStatus },
  );
}

export function getNormalizedStatusRank(
  status: NormalizedExternalOrderStatus,
): number {
  return STATUS_PROGRESSION_RANK[status] ?? 0;
}

export interface StatusTransitionEvaluation {
  outcome: 'APPLY' | 'IGNORE_STALE' | 'CONFLICT_RECONCILIATION_REQUIRED';
  reason?: string;
  targetRank: number;
}

/**
 * Evaluates whether an incoming external status update can be safely applied
 * or is an out-of-order / conflicting transition.
 */
export function evaluateExternalStatusProgression(params: {
  currentStatus: NormalizedExternalOrderStatus | null;
  currentRank: number;
  incomingStatus: NormalizedExternalOrderStatus;
  currentExternalUpdatedAt?: Date | null;
  incomingExternalUpdatedAt?: Date | null;
}): StatusTransitionEvaluation {
  const targetRank = getNormalizedStatusRank(params.incomingStatus);
  if (!params.currentStatus || params.currentRank === 0) {
    return { outcome: 'APPLY', targetRank };
  }

  if (params.currentStatus === params.incomingStatus) {
    return {
      outcome: 'IGNORE_STALE',
      reason: `Order already at normalized status ${params.incomingStatus}`,
      targetRank: params.currentRank,
    };
  }

  // Once DELIVERED, an external CANCELLED event is a business conflict requiring reconciliation
  if (
    params.currentStatus === 'DELIVERED' &&
    params.incomingStatus === 'CANCELLED'
  ) {
    return {
      outcome: 'CONFLICT_RECONCILIATION_REQUIRED',
      reason:
        'Cannot transition a DELIVERED order to CANCELLED without return/reconciliation workflow',
      targetRank: params.currentRank,
    };
  }

  // Once CANCELLED, any regression to UNPAID / READY_TO_SHIP / SHIPPED is rejected/flagged
  if (
    params.currentStatus === 'CANCELLED' &&
    targetRank < STATUS_PROGRESSION_RANK.CANCELLED
  ) {
    return {
      outcome: 'IGNORE_STALE',
      reason: `Ignoring regression from CANCELLED backward to ${params.incomingStatus}`,
      targetRank: params.currentRank,
    };
  }

  // Out-of-order stale event check
  if (targetRank < params.currentRank) {
    return {
      outcome: 'IGNORE_STALE',
      reason: `Incoming status ${params.incomingStatus} (rank ${targetRank}) is older than current status ${params.currentStatus} (rank ${params.currentRank})`,
      targetRank: params.currentRank,
    };
  }

  return { outcome: 'APPLY', targetRank };
}

// ============================================================================
// 5. SELLABLE INVENTORY CALCULATION & STALE VERSION GUARD
// ============================================================================

export interface SellableQuantityCalculationInput {
  onHandQty: number;
  reservedQty: number;
  safetyBuffer: number;
  allocationPercent: number;
}

export interface SellableQuantityCalculationResult {
  availableQty: number;
  afterBufferQty: number;
  publishableQty: number;
}

/**
 * Computes sellable quantity for an external marketplace channel:
 * available = max(0, floor(onHandQty - reservedQty))
 * afterBuffer = max(0, available - safetyBuffer)
 * publishable = max(0, floor(afterBuffer * (allocationPercent / 100)))
 */
export function calculateChannelPublishableQuantity(
  input: SellableQuantityCalculationInput,
): SellableQuantityCalculationResult {
  const onHand = Number.isFinite(input.onHandQty)
    ? Math.floor(input.onHandQty)
    : 0;
  const reserved = Number.isFinite(input.reservedQty)
    ? Math.floor(input.reservedQty)
    : 0;
  const buffer = Math.max(0, Math.floor(input.safetyBuffer || 0));
  const pct = Math.min(
    100,
    Math.max(0, Number(input.allocationPercent ?? 100)),
  );

  const availableQty = Math.max(0, onHand - reserved);
  const afterBufferQty = Math.max(0, availableQty - buffer);
  const publishableQty = Math.max(0, Math.floor((afterBufferQty * pct) / 100));

  return {
    availableQty,
    afterBufferQty,
    publishableQty,
  };
}

export function shouldApplyInventoryStockVersion(
  lastPublishedVersion: number,
  incomingVersion: number,
): boolean {
  return incomingVersion > lastPublishedVersion;
}

// ============================================================================
// 6. ERROR CLASSIFICATION & JITTERED EXPONENTIAL BACKOFF
// ============================================================================

export function calculateBackoffDelayMs(params: {
  attemptCount: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryAfterSeconds?: number;
  jitterRatio?: number;
  randomFn?: () => number;
}): number {
  if (params.retryAfterSeconds !== undefined && params.retryAfterSeconds > 0) {
    return Math.ceil(params.retryAfterSeconds * 1000);
  }
  const base = params.baseDelayMs ?? 1000;
  const max = params.maxDelayMs ?? 60_000;
  const exp = Math.min(
    max,
    base * Math.pow(2, Math.max(0, params.attemptCount - 1)),
  );
  const jitterRatio = params.jitterRatio ?? 0.2;
  const rand = (params.randomFn ?? Math.random)();
  const jitter = exp * jitterRatio * rand;
  return Math.min(max, Math.round(exp + jitter));
}

export function classifyIntegrationError(error: unknown): {
  category: ErrorClassification;
  code: string;
  retryable: boolean;
  retryAfterSeconds?: number;
} {
  if (error instanceof IntegrationDomainError) {
    switch (error.code) {
      case IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED:
        return {
          category: 'TRANSIENT',
          code: error.code,
          retryable: true,
          retryAfterSeconds:
            typeof error.details?.retryAfterSeconds === 'number'
              ? error.details.retryAfterSeconds
              : undefined,
        };
      case IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE:
      case IntegrationDomainErrorCode.PROVIDER_CIRCUIT_OPEN:
      case IntegrationDomainErrorCode.WEBHOOK_PERSISTENCE_FAILED:
        return {
          category: 'TRANSIENT',
          code: error.code,
          retryable: true,
        };
      case IntegrationDomainErrorCode.PROVIDER_TIMEOUT_UNKNOWN_OUTCOME:
        return {
          category: 'UNKNOWN_OUTCOME',
          code: error.code,
          retryable: true,
        };
      case IntegrationDomainErrorCode.EXTERNAL_SKU_UNKNOWN:
      case IntegrationDomainErrorCode.SKU_MAPPING_NOT_FOUND:
      case IntegrationDomainErrorCode.SKU_MAPPING_CONFLICT:
      case IntegrationDomainErrorCode.INTERNAL_VARIANT_INACTIVE:
      case IntegrationDomainErrorCode.EXTERNAL_ORDER_MAPPING_REQUIRED:
      case IntegrationDomainErrorCode.EXTERNAL_ORDER_STATE_CONFLICT:
      case IntegrationDomainErrorCode.INVENTORY_PUBLICATION_CONFLICT:
        return {
          category: 'BUSINESS_CONFLICT',
          code: error.code,
          retryable: false,
        };
      default:
        return {
          category: 'PERMANENT_CONFIG',
          code: error.code,
          retryable: false,
        };
    }
  }

  const msg = error instanceof Error ? error.message : String(error);
  if (
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('429')
  ) {
    return {
      category: 'TRANSIENT',
      code: 'TRANSIENT_NETWORK_ERROR',
      retryable: true,
    };
  }
  return {
    category: 'PERMANENT_CONFIG',
    code: 'UNHANDLED_INTEGRATION_ERROR',
    retryable: false,
  };
}

// ============================================================================
// 7. CHANNEL CONNECTION AGGREGATE & ANTI-CORRUPTION LAYER (M7.5 DDD)
// ============================================================================

export class ChannelConnectionAggregate {
  constructor(
    public readonly id: string,
    public readonly tenantId: string,
    public readonly provider: MarketplaceProvider,
    private _status: ConnectionStatus,
    private _safetyStockBuffer: number,
    private _stockAllocationPercent: number,
  ) {
    this.assertValidAllocationPolicy(
      _safetyStockBuffer,
      _stockAllocationPercent,
    );
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get safetyStockBuffer(): number {
    return this._safetyStockBuffer;
  }

  get stockAllocationPercent(): number {
    return this._stockAllocationPercent;
  }

  transitionTo(next: ConnectionStatus): void {
    assertValidConnectionTransition(this._status, next);
    this._status = next;
  }

  updateAllocationPolicy(safetyBuffer: number, allocationPct: number): void {
    this.assertValidAllocationPolicy(safetyBuffer, allocationPct);
    this._safetyStockBuffer = Math.floor(safetyBuffer);
    this._stockAllocationPercent = Math.floor(allocationPct);
  }

  computePublishableStock(onHandQty: number, reservedQty: number): number {
    return calculateChannelPublishableQuantity({
      onHandQty,
      reservedQty,
      safetyBuffer: this._safetyStockBuffer,
      allocationPercent: this._stockAllocationPercent,
    }).publishableQty;
  }

  private assertValidAllocationPolicy(
    safetyBuffer: number,
    allocationPct: number,
  ): void {
    if (!Number.isFinite(safetyBuffer) || safetyBuffer < 0) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.VALIDATION_ERROR,
        `safetyStockBuffer must be a non-negative integer, got ${safetyBuffer}`,
        422,
      );
    }
    if (
      !Number.isFinite(allocationPct) ||
      allocationPct < 0 ||
      allocationPct > 100
    ) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.VALIDATION_ERROR,
        `stockAllocationPercent must be between 0 and 100, got ${allocationPct}`,
        422,
      );
    }
  }
}

export interface ExternalMarketplaceOrderInput {
  provider: MarketplaceProvider;
  connectionId: string;
  branchId: string;
  warehouseId: string | null;
  externalOrderId: string;
  rawStatus: string;
  buyerName?: string | null;
  shippingFee?: string | number | null;
  lines: ReadonlyArray<{
    externalSkuId: string;
    qty: number;
    unitPrice?: string | number;
  }>;
}

export interface ResolvedInternalSkuMapping {
  externalSkuId: string;
  internalVariantId: string;
  internalSkuCode: string;
  mappingStatus: SkuMappingStatus;
  isSellable: boolean;
}

export interface CanonicalSalesOrderImportCommand {
  sourceConnectionId: string;
  externalOrderId: string;
  channelType: 'MARKETPLACE';
  channelId: MarketplaceProvider;
  branchId: string;
  warehouseId: string | null;
  customerName: string;
  normalizedExternalStatus: NormalizedExternalOrderStatus;
  initialOrderStatus: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  autoConfirm: boolean;
  shippingFee: string;
  lines: Array<{
    variantId: string;
    skuCode: string;
    qty: string;
  }>;
}

/**
 * Anti-Corruption Layer (ACL) translating external Shopee/Lazada order payloads
 * and SKU mappings into canonical internal Sales import commands without leaking
 * provider DTOs or raw status strings into Sales.
 */
export function translateExternalOrderToCanonicalSalesImport(
  externalOrder: ExternalMarketplaceOrderInput,
  skuMappingByExternalSku: ReadonlyMap<string, ResolvedInternalSkuMapping>,
): CanonicalSalesOrderImportCommand {
  if (!externalOrder.externalOrderId?.trim()) {
    throw new IntegrationDomainError(
      IntegrationDomainErrorCode.VALIDATION_ERROR,
      'External order ID is required for canonical import translation',
      422,
    );
  }
  if (!externalOrder.lines || externalOrder.lines.length === 0) {
    throw new IntegrationDomainError(
      IntegrationDomainErrorCode.VALIDATION_ERROR,
      `External order ${externalOrder.externalOrderId} contains no line items`,
      422,
    );
  }

  const normalizedStatus = normalizeProviderOrderStatus(
    externalOrder.provider,
    externalOrder.rawStatus,
  );

  const canonicalLines: Array<{
    variantId: string;
    skuCode: string;
    qty: string;
  }> = [];

  for (const line of externalOrder.lines) {
    if (!Number.isFinite(line.qty) || line.qty <= 0) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.VALIDATION_ERROR,
        `Invalid external line quantity ${line.qty} on SKU ${line.externalSkuId}`,
        422,
      );
    }
    const mapping = skuMappingByExternalSku.get(line.externalSkuId.trim());
    if (!mapping || mapping.mappingStatus !== 'ACTIVE') {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.EXTERNAL_ORDER_MAPPING_REQUIRED,
        `External SKU ${line.externalSkuId} is not mapped to an active internal variant`,
        409,
        { externalSkuId: line.externalSkuId },
      );
    }
    if (!mapping.isSellable) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.INTERNAL_VARIANT_INACTIVE,
        `Mapped internal variant ${mapping.internalSkuCode} is not sellable`,
        409,
        {
          externalSkuId: line.externalSkuId,
          internalVariantId: mapping.internalVariantId,
        },
      );
    }
    canonicalLines.push({
      variantId: mapping.internalVariantId,
      skuCode: mapping.internalSkuCode,
      qty: Number(line.qty).toFixed(3),
    });
  }

  const initialOrderStatus: 'PENDING' | 'CONFIRMED' | 'CANCELLED' =
    normalizedStatus === 'CANCELLED'
      ? 'CANCELLED'
      : normalizedStatus === 'UNPAID'
        ? 'PENDING'
        : 'CONFIRMED';

  const autoConfirm =
    initialOrderStatus === 'CONFIRMED' && Boolean(externalOrder.warehouseId);

  const shippingFeeNum = Number(externalOrder.shippingFee ?? 0);
  const shippingFee =
    Number.isFinite(shippingFeeNum) && shippingFeeNum >= 0
      ? shippingFeeNum.toFixed(2)
      : '0.00';

  return {
    sourceConnectionId: externalOrder.connectionId,
    externalOrderId: externalOrder.externalOrderId.trim(),
    channelType: 'MARKETPLACE',
    channelId: externalOrder.provider,
    branchId: externalOrder.branchId,
    warehouseId: externalOrder.warehouseId,
    customerName:
      externalOrder.buyerName?.trim() || `${externalOrder.provider} Customer`,
    normalizedExternalStatus: normalizedStatus,
    initialOrderStatus,
    autoConfirm,
    shippingFee,
    lines: canonicalLines,
  };
}
