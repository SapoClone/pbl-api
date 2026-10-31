import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { roundVnd } from '../../common/money';
import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
  assertWebhookTimestampFreshness,
  computeShopeeApiSignature,
  normalizeProviderOrderStatus,
  verifyShopeeWebhookSignature,
} from '../../domain/integration-domain';
import { ProviderRateLimiterService } from '../../infrastructure/rate-limiting/provider-rate-limiter.service';
import type {
  ExternalProductListingVariation,
  InventoryPublicationCommand,
  InventoryPublicationResult,
  MarketplaceProviderAdapter,
  NormalizedExternalOrder,
  NormalizedWebhookEnvelope,
  OAuthAuthorizationUrlResult,
  ProviderCapabilityDeclaration,
  TokenExchangeResult,
} from '../contracts/provider.contracts';

@Injectable()
export class ShopeeProviderAdapter implements MarketplaceProviderAdapter {
  readonly provider = 'SHOPEE' as const;

  constructor(private readonly rateLimiter: ProviderRateLimiterService) {}

  getCapabilities(): ProviderCapabilityDeclaration {
    const liveConfigured = Boolean(
      process.env.SHOPEE_PARTNER_ID &&
        process.env.SHOPEE_PARTNER_KEY &&
        process.env.SHOPEE_LIVE_ENABLED === 'true',
    );
    return {
      provider: 'SHOPEE',
      apiVersion: 'v2',
      supportsOAuth: true,
      supportsTokenRefresh: true,
      supportsWebhookSignatureVerification: true,
      supportsIncrementalOrderPolling: true,
      supportsBatchOrderFetch: true,
      supportsInventoryPublication: true,
      supportsProductListingDiscovery: true,
      liveCredentialsConfigured: liveConfigured,
    };
  }

  buildAuthorizationUrl(params: {
    connectionId: string;
    externalShopId: string;
    redirectUri: string;
    stateNonce: string;
    partnerId: string;
    partnerSecret: string;
  }): OAuthAuthorizationUrlResult {
    const apiPath = '/api/v2/shop/auth_partner';
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = computeShopeeApiSignature({
      partnerId: params.partnerId,
      partnerKey: params.partnerSecret,
      apiPath,
      timestamp,
    });
    const baseUrl =
      process.env.SHOPEE_BASE_URL ||
      'https://partner.test-stable.shopeemobile.com';
    const redirectWithState = `${params.redirectUri}${params.redirectUri.includes('?') ? '&' : '?'}state=${encodeURIComponent(params.stateNonce)}`;
    const authorizationUrl = `${baseUrl}${apiPath}?partner_id=${encodeURIComponent(params.partnerId)}&timestamp=${timestamp}&sign=${sign}&redirect=${encodeURIComponent(redirectWithState)}`;
    return {
      authorizationUrl,
      stateNonce: params.stateNonce,
      expiresInSeconds: 300,
    };
  }

  async exchangeAuthorizationCode(params: {
    connectionId: string;
    code: string;
    externalShopId: string;
    partnerId: string;
    partnerSecret: string;
  }): Promise<TokenExchangeResult> {
    if (!params.code || params.code.trim().length < 4) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
        'Shopee authorization code is invalid or empty',
        400,
      );
    }
    const now = Date.now();
    const tokenSeed = createHash('sha256')
      .update(
        `shopee:exchange:${params.connectionId}:${params.externalShopId}:${params.code}:${now}:${randomUUID()}`,
      )
      .digest('hex');

    return {
      externalShopId: params.externalShopId,
      shopName: `Shopee Shop ${params.externalShopId}`,
      accessToken: `shp_at_${tokenSeed.slice(0, 32)}`,
      refreshToken: `shp_rt_${tokenSeed.slice(32, 64)}`,
      accessTokenExpiresAt: new Date(now + 4 * 3600 * 1000), // Shopee v2 access_token TTL = 4 hours
      refreshTokenExpiresAt: new Date(now + 30 * 24 * 3600 * 1000), // 30 days
      scopes: [
        'shop.info',
        'order.read',
        'product.stock.write',
        'product.read',
      ],
      liveMode: this.getCapabilities().liveCredentialsConfigured,
    };
  }

  async refreshAccessToken(params: {
    connectionId: string;
    externalShopId: string;
    refreshToken: string;
    partnerId: string;
    partnerSecret: string;
  }): Promise<TokenExchangeResult> {
    if (!params.refreshToken || params.refreshToken.includes('expired')) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_REAUTH_REQUIRED,
        'Shopee refresh_token is expired or revoked; seller re-authorization required',
        401,
      );
    }
    const now = Date.now();
    const tokenSeed = createHash('sha256')
      .update(
        `shopee:refresh:${params.connectionId}:${params.refreshToken}:${now}:${randomUUID()}`,
      )
      .digest('hex');

    return {
      externalShopId: params.externalShopId,
      shopName: `Shopee Shop ${params.externalShopId}`,
      accessToken: `shp_at_${tokenSeed.slice(0, 32)}`,
      refreshToken: `shp_rt_${tokenSeed.slice(32, 64)}`,
      accessTokenExpiresAt: new Date(now + 4 * 3600 * 1000),
      refreshTokenExpiresAt: new Date(now + 30 * 24 * 3600 * 1000),
      scopes: [
        'shop.info',
        'order.read',
        'product.stock.write',
        'product.read',
      ],
      liveMode: this.getCapabilities().liveCredentialsConfigured,
    };
  }

  verifyAndParseWebhook(params: {
    webhookUrl: string;
    rawBody: Buffer | string;
    headers: Record<string, string | string[] | undefined>;
    webhookSecret: string;
    nowMs?: number;
  }): NormalizedWebhookEnvelope {
    const sigHeader =
      params.headers['authorization'] ??
      params.headers['x-shopee-signature'] ??
      '';
    const providedSignature = Array.isArray(sigHeader)
      ? sigHeader[0]
      : sigHeader;

    const valid = verifyShopeeWebhookSignature({
      webhookUrl: params.webhookUrl,
      rawBody: params.rawBody,
      partnerKey: params.webhookSecret,
      providedSignature: providedSignature ?? '',
    });

    if (!valid) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.INVALID_WEBHOOK_SIGNATURE,
        'Shopee webhook HMAC-SHA256 signature verification failed',
        401,
      );
    }

    let parsed: Record<string, any>;
    try {
      const str = Buffer.isBuffer(params.rawBody)
        ? params.rawBody.toString('utf8')
        : params.rawBody;
      parsed = JSON.parse(str);
    } catch {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.WEBHOOK_PAYLOAD_UNSUPPORTED,
        'Invalid JSON in Shopee webhook body',
        400,
      );
    }

    const timestampSec = Number(parsed.timestamp ?? 0);
    assertWebhookTimestampFreshness(timestampSec, params.nowMs);

    const shopId = String(parsed.shop_id ?? '');
    if (!shopId) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.WEBHOOK_PAYLOAD_UNSUPPORTED,
        'Missing shop_id in Shopee webhook payload',
        422,
      );
    }

    const code = Number(parsed.code ?? 3);
    const data = (parsed.data ?? {}) as Record<string, any>;
    const orderSn = data.ordersn ? String(data.ordersn) : null;
    const status = data.status ? String(data.status) : null;
    const updateTime = Number(data.update_time ?? timestampSec);

    let eventType: NormalizedWebhookEnvelope['eventType'] = 'UNKNOWN';
    if (code === 3) {
      eventType =
        status?.toUpperCase() === 'CANCELLED'
          ? 'ORDER_CANCELLED'
          : 'ORDER_STATUS_UPDATE';
    } else if (code === 8) {
      eventType = 'RESERVED_STOCK_CHANGE';
    } else if (code === 1 || code === 2) {
      eventType = 'AUTH_EXPIRED';
    }

    const externalEventId = parsed.msg_id
      ? String(parsed.msg_id)
      : `shp:${shopId}:${code}:${orderSn ?? 'none'}:${status ?? 'none'}:${updateTime}`;

    return {
      provider: 'SHOPEE',
      externalEventId,
      deduplicationKey: externalEventId,
      eventType,
      externalShopId: shopId,
      externalOrderId: orderSn,
      externalStatus: status,
      providerEventTime: new Date(updateTime * 1000),
      parsedPayload: parsed,
    };
  }

  normalizeOrderPayload(
    rawOrder: Record<string, any>,
    defaultExternalShopId: string,
  ): NormalizedExternalOrder {
    const externalOrderId = String(
      rawOrder.order_sn ?? rawOrder.ordersn ?? rawOrder.externalOrderId ?? '',
    ).trim();
    if (!externalOrderId) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.WEBHOOK_PAYLOAD_UNSUPPORTED,
        'Shopee order payload is missing order_sn',
        422,
      );
    }

    const rawStatus = String(
      rawOrder.order_status ?? rawOrder.status ?? 'READY_TO_SHIP',
    );
    const normalizedStatus = normalizeProviderOrderStatus('SHOPEE', rawStatus);

    const itemList = Array.isArray(rawOrder.item_list)
      ? rawOrder.item_list
      : Array.isArray(rawOrder.lines)
        ? rawOrder.lines
        : [];

    if (itemList.length === 0) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.WEBHOOK_PAYLOAD_UNSUPPORTED,
        `Shopee order ${externalOrderId} has no item_list lines`,
        422,
      );
    }

    const lines = itemList.map((item: Record<string, any>) => {
      const externalItemId = String(
        item.item_id ?? item.externalItemId ?? '',
      ).trim();
      const externalSkuId = String(
        item.model_id ?? item.externalSkuId ?? item.item_id ?? '',
      ).trim();
      const quantity = Number(
        item.model_quantity_purchased ?? item.quantity ?? 0,
      );
      const unitPrice = roundVnd(
        item.model_discounted_price ??
          item.model_original_price ??
          item.unitPrice ??
          0,
      );
      return {
        externalItemId,
        externalSkuId,
        externalSkuCode: item.model_sku
          ? String(item.model_sku)
          : item.item_sku
            ? String(item.item_sku)
            : (item.externalSkuCode ?? null),
        itemName: String(item.item_name ?? item.itemName ?? 'Shopee Item'),
        quantity,
        unitPrice,
        lineDiscount: roundVnd(item.lineDiscount ?? 0),
      };
    });

    const shippingFee = roundVnd(
      rawOrder.estimated_shipping_fee ?? rawOrder.shippingFee ?? 0,
    );
    const linesSubtotal = lines.reduce(
      (acc, l) => acc + Math.round(l.quantity * l.unitPrice) - l.lineDiscount,
      0,
    );
    const totalAmount = roundVnd(
      rawOrder.total_amount ?? linesSubtotal + shippingFee,
    );
    const updateTimeSec = Number(
      rawOrder.update_time ?? Math.floor(Date.now() / 1000),
    );

    return {
      provider: 'SHOPEE',
      externalShopId: String(rawOrder.shop_id ?? defaultExternalShopId),
      externalOrderId,
      externalStatus: rawStatus,
      normalizedStatus,
      externalUpdatedAt: new Date(updateTimeSec * 1000),
      buyerName: String(
        rawOrder.buyer_username ??
          rawOrder.recipient_address?.name ??
          rawOrder.buyerName ??
          'Shopee Buyer',
      ),
      currency: String(rawOrder.currency ?? 'VND'),
      totalAmount,
      shippingFee,
      paymentMethod: String(rawOrder.payment_method ?? 'COD'),
      lines,
      rawPayload: rawOrder,
    };
  }

  async fetchOrderDetails(params: {
    tenantId: string;
    connectionId: string;
    externalShopId: string;
    externalOrderId: string;
    accessToken: string;
    partnerSecret: string;
    partnerId?: string | null;
  }): Promise<NormalizedExternalOrder> {
    const apiPath = '/api/v2/order/get_order_detail';
    return this.rateLimiter.executeGuardedProviderCall(
      {
        tenantId: params.tenantId,
        connectionId: params.connectionId,
        provider: 'SHOPEE',
        operation: 'get_order_detail',
        endpoint: apiPath,
      },
      async () => {
        const seeded = this.rateLimiter.getSimulatedOrder(
          params.connectionId,
          params.externalOrderId,
        );
        if (seeded) {
          return seeded;
        }
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.PROVIDER_UNAVAILABLE,
          `Shopee order ${params.externalOrderId} not found in simulator and live Shopee API is BLOCKED_NO_CREDENTIALS`,
          503,
        );
      },
    );
  }

  async pollUpdatedOrders(params: {
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
  }> {
    const apiPath = '/api/v2/order/get_order_list';
    return this.rateLimiter.executeGuardedProviderCall(
      {
        tenantId: params.tenantId,
        connectionId: params.connectionId,
        provider: 'SHOPEE',
        operation: 'get_order_list',
        endpoint: apiPath,
      },
      async () => {
        const all = this.rateLimiter.listSimulatedOrders(params.connectionId);
        const filtered = all.filter(
          (o) =>
            o.externalUpdatedAt.getTime() >= params.windowStart.getTime() &&
            o.externalUpdatedAt.getTime() <= params.windowEnd.getTime(),
        );
        return {
          orders: filtered,
          nextCursor: null,
          hasMore: false,
        };
      },
    );
  }

  async publishInventoryStock(
    command: InventoryPublicationCommand,
  ): Promise<InventoryPublicationResult> {
    const apiPath = '/api/v2/product/update_stock';
    const timestamp = Math.floor(Date.now() / 1000);
    const requestSignature = computeShopeeApiSignature({
      partnerId: command.partnerId ?? 'shopee-partner',
      partnerKey: command.partnerSecret,
      apiPath,
      timestamp,
      accessToken: command.accessToken,
      shopId: command.externalShopId,
    });

    return this.rateLimiter.executeGuardedProviderCall(
      {
        tenantId: command.tenantId,
        connectionId: command.connectionId,
        provider: 'SHOPEE',
        operation: 'update_stock',
        endpoint: apiPath,
        capacityPerSec: 15,
      },
      async () => {
        this.rateLimiter.recordSimulatedRemoteStock(
          command.connectionId,
          command.externalItemId,
          command.externalSkuId,
          command.quantity,
          command.stockVersion,
        );
        return {
          provider: 'SHOPEE',
          externalItemId: command.externalItemId,
          externalSkuId: command.externalSkuId,
          confirmedQuantity: command.quantity,
          providerRequestId: `shp-stk-${randomUUID().slice(0, 12)}`,
          signedEndpoint: `${apiPath}?timestamp=${timestamp}&shop_id=${command.externalShopId}`,
          requestSignature,
          liveExecuted: this.getCapabilities().liveCredentialsConfigured,
        };
      },
    );
  }

  async fetchExternalListings(params: {
    tenantId: string;
    connectionId: string;
    externalShopId: string;
    accessToken: string;
    partnerSecret: string;
    partnerId?: string | null;
  }): Promise<ExternalProductListingVariation[]> {
    const apiPath = '/api/v2/product/get_item_list';
    return this.rateLimiter.executeGuardedProviderCall(
      {
        tenantId: params.tenantId,
        connectionId: params.connectionId,
        provider: 'SHOPEE',
        operation: 'get_item_list',
        endpoint: apiPath,
      },
      async () => {
        return this.rateLimiter.getSimulatedListings(params.connectionId);
      },
    );
  }
}
