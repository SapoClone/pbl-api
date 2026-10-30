import type {
  MarketplaceProvider,
  NormalizedExternalOrderStatus,
} from '../../domain/integration-domain';

export interface ProviderCapabilityDeclaration {
  provider: MarketplaceProvider;
  apiVersion: string;
  supportsOAuth: boolean;
  supportsTokenRefresh: boolean;
  supportsWebhookSignatureVerification: boolean;
  supportsIncrementalOrderPolling: boolean;
  supportsBatchOrderFetch: boolean;
  supportsInventoryPublication: boolean;
  supportsProductListingDiscovery: boolean;
  liveCredentialsConfigured: boolean;
}

export interface OAuthAuthorizationUrlResult {
  authorizationUrl: string;
  stateNonce: string;
  expiresInSeconds: number;
}

export interface TokenExchangeResult {
  externalShopId: string;
  shopName: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  scopes: string[];
  liveMode: boolean;
}

export interface NormalizedWebhookEnvelope {
  provider: MarketplaceProvider;
  externalEventId: string;
  deduplicationKey: string;
  eventType:
    | 'ORDER_STATUS_UPDATE'
    | 'ORDER_CREATED'
    | 'ORDER_CANCELLED'
    | 'RESERVED_STOCK_CHANGE'
    | 'AUTH_EXPIRED'
    | 'UNKNOWN';
  externalShopId: string;
  externalOrderId: string | null;
  externalStatus: string | null;
  providerEventTime: Date;
  parsedPayload: Record<string, unknown>;
}

export interface NormalizedExternalOrderLine {
  externalItemId: string;
  externalSkuId: string;
  externalSkuCode: string | null;
  itemName: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
}

export interface NormalizedExternalOrder {
  provider: MarketplaceProvider;
  externalShopId: string;
  externalOrderId: string;
  externalStatus: string;
  normalizedStatus: NormalizedExternalOrderStatus;
  externalUpdatedAt: Date;
  buyerName: string;
  currency: string;
  totalAmount: number;
  shippingFee: number;
  paymentMethod: string;
  lines: NormalizedExternalOrderLine[];
  rawPayload: Record<string, unknown>;
}

export interface InventoryPublicationCommand {
  tenantId: string;
  connectionId: string;
  externalShopId: string;
  externalItemId: string;
  externalSkuId: string;
  externalSkuCode: string | null;
  quantity: number;
  stockVersion: number;
  accessToken: string;
  partnerSecret: string;
  partnerId?: string | null;
}

export interface InventoryPublicationResult {
  provider: MarketplaceProvider;
  externalItemId: string;
  externalSkuId: string;
  confirmedQuantity: number;
  providerRequestId: string;
  signedEndpoint: string;
  requestSignature: string;
  liveExecuted: boolean;
}

export interface ExternalProductListingVariation {
  externalItemId: string;
  externalSkuId: string;
  externalSkuCode: string | null;
  externalProductName: string;
  price: number;
  stock: number;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ChannelAuthAdapter {
  buildAuthorizationUrl(params: {
    connectionId: string;
    externalShopId: string;
    redirectUri: string;
    stateNonce: string;
    partnerId: string;
    partnerSecret: string;
  }): OAuthAuthorizationUrlResult;

  exchangeAuthorizationCode(params: {
    connectionId: string;
    code: string;
    externalShopId: string;
    partnerId: string;
    partnerSecret: string;
  }): Promise<TokenExchangeResult>;

  refreshAccessToken(params: {
    connectionId: string;
    externalShopId: string;
    refreshToken: string;
    partnerId: string;
    partnerSecret: string;
  }): Promise<TokenExchangeResult>;
}

export interface WebhookVerificationAdapter {
  verifyAndParseWebhook(params: {
    webhookUrl: string;
    rawBody: Buffer | string;
    headers: Record<string, string | string[] | undefined>;
    webhookSecret: string;
    nowMs?: number;
  }): NormalizedWebhookEnvelope;
}

export interface OrderFetchAndNormalizationAdapter {
  normalizeOrderPayload(
    rawOrder: Record<string, unknown>,
    defaultExternalShopId: string,
  ): NormalizedExternalOrder;

  fetchOrderDetails(params: {
    tenantId: string;
    connectionId: string;
    externalShopId: string;
    externalOrderId: string;
    accessToken: string;
    partnerSecret: string;
    partnerId?: string | null;
  }): Promise<NormalizedExternalOrder>;

  pollUpdatedOrders(params: {
    tenantId: string;
    connectionId: string;
    externalShopId: string;
    windowStart: Date;
    windowEnd: Date;
    cursor?: string | null;
    accessToken: string;
    partnerSecret: string;
    partnerId?: string | null;
  }): Promise<{
    orders: NormalizedExternalOrder[];
    nextCursor: string | null;
    hasMore: boolean;
  }>;
}

export interface InventoryPublicationAdapter {
  publishInventoryStock(
    command: InventoryPublicationCommand,
  ): Promise<InventoryPublicationResult>;
}

export interface ProductListingAdapter {
  fetchExternalListings(params: {
    tenantId: string;
    connectionId: string;
    externalShopId: string;
    accessToken: string;
    partnerSecret: string;
    partnerId?: string | null;
  }): Promise<ExternalProductListingVariation[]>;
}

export interface MarketplaceProviderAdapter
  extends ChannelAuthAdapter,
    WebhookVerificationAdapter,
    OrderFetchAndNormalizationAdapter,
    InventoryPublicationAdapter,
    ProductListingAdapter {
  readonly provider: MarketplaceProvider;
  getCapabilities(): ProviderCapabilityDeclaration;
}
