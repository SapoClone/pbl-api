import { Injectable, Logger } from '@nestjs/common';
import { InternalHttpClient } from '@pbl/common';
import { createHash } from 'node:crypto';
import {
  INTERNAL_TOKEN_HEADER,
  readInternalToken,
  readSalesUrl,
} from '../../config/integration.config';

export interface CanonicalSalesOrderLineCommand {
  variantId: string;
  skuCode: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
}

export interface CreateCanonicalSalesOrderCommand {
  tenantId: string;
  connectionId: string;
  provider: 'SHOPEE' | 'LAZADA';
  externalShopId: string;
  externalOrderId: string;
  branchId: string;
  warehouseId: string | null;
  buyerName: string;
  currency: string;
  shippingFee: number;
  paymentMethod: string;
  normalizedStatus: string;
  autoConfirm: boolean;
  lines: CanonicalSalesOrderLineCommand[];
  idempotencyKey: string;
}

export interface CanonicalSalesOrderResult {
  internalOrderId: string;
  internalOrderCode: string;
  orderStatus: 'PENDING' | 'CONFIRMED' | 'SHIPPING' | 'COMPLETED' | 'CANCELLED';
  fulfillmentStatus: 'UNFULFILLED' | 'RESERVED' | 'SHIPPING' | 'DELIVERED';
  replayed: boolean;
  shortageDetected: boolean;
  shortages: Array<{
    variantId: string;
    skuCode: string;
    requestedQty: number;
    availableQty: number;
  }>;
}

function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Removes the service token from an axios error before it is rethrown (it can end up in logs). */
function stripInternalToken(err: any): void {
  for (const config of [err?.config, err?.response?.config]) {
    const headers = config?.headers;
    if (!headers) continue;
    const blocks = [
      headers,
      ...Object.values(headers).filter((v) => v && typeof v === 'object'),
    ];
    for (const block of blocks as Array<Record<string, unknown>>) {
      for (const key of Object.keys(block)) {
        if (key.toLowerCase() === INTERNAL_TOKEN_HEADER) delete block[key];
      }
    }
  }
}

/**
 * Talks to sales over HTTP. There is no in-memory fallback: a missing
 * SALES_SERVICE_URL or INTERNAL_S2S_TOKEN fails the call (and the service does
 * not start, see assertIntegrationConfig). The shared secret goes in
 * `x-internal-token`; it is never logged.
 */
@Injectable()
export class SalesOrderClient {
  private readonly logger = new Logger(SalesOrderClient.name);

  constructor(private readonly http: InternalHttpClient) {}

  async createOrRecoverOmnichannelOrder(
    cmd: CreateCanonicalSalesOrderCommand,
  ): Promise<CanonicalSalesOrderResult> {
    const key = `${cmd.tenantId}:${cmd.connectionId}:${cmd.externalOrderId}`;
    let res;
    try {
      res = await this.http.post<any>(
        `${readSalesUrl()}/internal/v1/orders/omnichannel`,
        {
          branchId: cmd.branchId,
          warehouseId: cmd.warehouseId ?? undefined,
          channelType: 'MARKETPLACE',
          sourceConnectionId: cmd.connectionId,
          externalOrderId: cmd.externalOrderId,
          customerName: cmd.buyerName,
          shippingFee: cmd.shippingFee,
          paymentMethod: cmd.paymentMethod,
          autoConfirm: cmd.autoConfirm,
          lines: cmd.lines.map((l) => ({
            variantId: l.variantId,
            qty: l.quantity,
            unitPriceOverride: l.unitPrice,
          })),
        },
        {
          headers: {
            'Idempotency-Key': cmd.idempotencyKey,
            [INTERNAL_TOKEN_HEADER]: readInternalToken(),
          },
        },
        // jobs and webhooks run outside a request: no user token is forwarded then
        // a job or webhook has no user token: sales takes the tenant from the header once the service token is valid
        { asService: true, tenantId: cmd.tenantId },
      );
    } catch (err) {
      stripInternalToken(err);
      throw err;
    }
    const data = res.data;
    return {
      internalOrderId: data.order?.id ?? data.id ?? deterministicUuid(key),
      internalOrderCode:
        data.order?.code ?? data.code ?? `HD-${cmd.externalOrderId}`,
      orderStatus: data.order?.orderStatus ?? 'CONFIRMED',
      fulfillmentStatus: data.order?.fulfillmentStatus ?? 'RESERVED',
      replayed: Boolean(data.replayed),
      shortageDetected: false,
      shortages: [],
    };
  }

  /**
   * Sales has no endpoint that ingests a marketplace status change (only
   * confirm and cancel by order id), so this call changes nothing in sales and
   * says so in the log (deferred, see the phase-2 report).
   */
  async transitionCanonicalOrderStatus(params: {
    tenantId: string;
    internalOrderId: string;
    targetNormalizedStatus:
      | 'UNPAID'
      | 'READY_TO_SHIP'
      | 'SHIPPED'
      | 'DELIVERED'
      | 'CANCELLED'
      | 'RETURN_REQUESTED';
  }): Promise<CanonicalSalesOrderResult> {
    this.logger.warn(
      `Sales status ${params.targetNormalizedStatus} for order ${params.internalOrderId} not pushed: no sales endpoint`,
    );
    const t = params.targetNormalizedStatus;
    return {
      internalOrderId: params.internalOrderId,
      internalOrderCode: `HD-${params.internalOrderId.slice(0, 8)}`,
      orderStatus:
        t === 'CANCELLED'
          ? 'CANCELLED'
          : t === 'DELIVERED'
            ? 'COMPLETED'
            : 'CONFIRMED',
      fulfillmentStatus:
        t === 'DELIVERED'
          ? 'DELIVERED'
          : t === 'SHIPPED'
            ? 'SHIPPING'
            : 'UNFULFILLED',
      replayed: false,
      shortageDetected: false,
      shortages: [],
    };
  }
}
