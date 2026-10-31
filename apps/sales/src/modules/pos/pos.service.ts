import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { randomUUID } from 'node:crypto';
import { DataSource, In } from 'typeorm';
import {
  CalculatedOrderQuote,
  QuoteLineInput,
  SalesDomainError,
  SalesDomainErrorCode,
  assertDiscountAuthority,
  calculateItemDiscount,
  calculateOrderQuote,
  formatVnd,
  parseVndAmount,
} from '../../domain/sales-domain';
import { CatalogClient } from '../../infrastructure/catalog-client/catalog.client';
import { getSchemaPrefix } from '../../infrastructure/persistence/sales-code.generator';
import { PosDraftEntity } from '../../infrastructure/persistence/sales.entities';
import {
  BranchScope,
  assertBranchAllowed,
  branchAllowed,
  branchFilter,
  discountTierFor,
} from '../../presentation/access';
import { PromotionsService } from '../promotions/promotions.service';
import {
  CreatePosDraftDto,
  PosCartLineDto,
  PosQuoteDto,
  UpdatePosDraftDto,
} from './pos.dto';

export const MAX_ACTIVE_DRAFTS_PER_STAFF = 5;
const DEFAULT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PosService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly catalogClient: CatalogClient,
    private readonly promotionsService: PromotionsService,
  ) {}

  async lookupProduct(query: { sku?: string; barcode?: string; q?: string }) {
    const raw = (query.sku ?? query.barcode ?? query.q ?? '').trim();
    if (!raw) {
      throw new SalesDomainError(
        SalesDomainErrorCode.VALIDATION_ERROR,
        'Lookup query (sku, barcode, or q) is required',
        422,
      );
    }

    let found;
    if (query.sku) {
      found = await this.catalogClient.lookupBySkuOrBarcode({ sku: query.sku });
    } else if (query.barcode) {
      found = await this.catalogClient.lookupBySkuOrBarcode({
        barcode: query.barcode,
      });
    } else {
      try {
        found = await this.catalogClient.lookupBySkuOrBarcode({ sku: raw });
      } catch {
        found = await this.catalogClient.lookupBySkuOrBarcode({ barcode: raw });
      }
    }

    if (found.status !== 'ACTIVE') {
      throw new SalesDomainError(
        SalesDomainErrorCode.PRODUCT_NOT_SELLABLE,
        `Product ${found.skuCode} has status ${found.status} and is not sellable`,
        409,
        { skuCode: found.skuCode, status: found.status },
      );
    }

    return found;
  }

  async resolveAndQuoteLines(params: {
    branchId: string;
    customerId?: string | null;
    lines: PosCartLineDto[];
    orderDiscountType?: 'NONE' | 'FIXED' | 'PERCENT';
    orderDiscountValue?: number;
    couponCode?: string | null;
    shippingFee?: number;
    role?: string | null;
    permissions?: string[];
    discountApprovedBy?: string | null;
  }): Promise<CalculatedOrderQuote & { couponCode: string | null }> {
    const catalogMap = await this.catalogClient.resolveVariants(
      params.lines.map((line) => ({
        variantId: line.variantId,
        skuCode: line.skuCode,
      })),
    );

    const quoteLines: QuoteLineInput[] = params.lines.map((line) => {
      const key =
        line.variantId ??
        (line.skuCode ? line.skuCode.trim().toUpperCase() : '');
      const cat = catalogMap.get(key);
      const resolvedVariantId = cat?.variantId ?? line.variantId ?? key;
      if (cat && !catalogMap.has(resolvedVariantId)) {
        catalogMap.set(resolvedVariantId, cat);
      }

      return {
        variantId: resolvedVariantId,
        qty: line.qty,
        expectedUnitPrice: line.expectedUnitPrice,
        discountType: line.discountType ?? 'NONE',
        discountValue: line.discountValue ?? 0,
        taxRatePercent: line.taxRatePercent ?? 0,
      };
    });

    // Preliminary pass without coupon to compute subtotal after line + order discounts
    const preliminaryQuote = calculateOrderQuote(
      {
        lines: quoteLines,
        orderDiscountType: params.orderDiscountType ?? 'NONE',
        orderDiscountValue: params.orderDiscountValue ?? 0,
        promotionDiscountAmount: '0.00',
        shippingFee: params.shippingFee ?? 0,
      },
      catalogMap,
    );

    // Enforce RBAC discount ceiling on manual discounts (item + order discounts)
    assertDiscountAuthority({
      effectiveDiscountPercent: preliminaryQuote.effectiveDiscountPercent,
      role: params.role,
      permissions: params.permissions,
      discountApprovedBy: params.discountApprovedBy,
    });

    let couponDiscountVnd = '0.00';
    let normalizedCouponCode: string | null = null;

    if (params.couponCode && params.couponCode.trim()) {
      const subtotalVnd = parseVndAmount(preliminaryQuote.subtotal, true);
      const itemDiscVnd = parseVndAmount(
        preliminaryQuote.itemDiscountTotal,
        true,
      );
      const orderDiscVnd = parseVndAmount(
        preliminaryQuote.orderDiscountTotal,
        true,
      );
      const afterOrderDiscountVnd = formatVnd(
        subtotalVnd - itemDiscVnd - orderDiscVnd,
      );

      const evaluated = await this.promotionsService.previewCouponDiscount(
        params.couponCode,
        afterOrderDiscountVnd,
        params.branchId,
        params.customerId ?? null,
      );
      couponDiscountVnd = evaluated.discountAmountVnd;
      normalizedCouponCode = evaluated.couponCode;
    }

    const finalQuote =
      couponDiscountVnd === '0.00'
        ? preliminaryQuote
        : calculateOrderQuote(
            {
              lines: quoteLines,
              orderDiscountType: params.orderDiscountType ?? 'NONE',
              orderDiscountValue: params.orderDiscountValue ?? 0,
              promotionDiscountAmount: couponDiscountVnd,
              shippingFee: params.shippingFee ?? 0,
            },
            catalogMap,
          );

    return {
      ...finalQuote,
      couponCode: normalizedCouponCode,
    };
  }

  async quoteOrder(
    dto: PosQuoteDto,
    permissions: string[],
    scope: BranchScope,
  ) {
    assertBranchAllowed(
      scope,
      dto.branchId,
      'ORDER_NOT_FOUND',
      'Branch not found',
    );
    return this.resolveAndQuoteLines({
      branchId: dto.branchId,
      customerId: dto.customerId,
      lines: dto.lines,
      orderDiscountType: dto.orderDiscountType,
      orderDiscountValue: dto.orderDiscountValue,
      couponCode: dto.couponCode,
      shippingFee: dto.shippingFee,
      role: discountTierFor(permissions),
      permissions,
      discountApprovedBy: dto.discountApprovedBy,
    });
  }

  async createDraft(
    staffId: string,
    scope: BranchScope,
    dto: CreatePosDraftDto,
  ): Promise<PosDraftEntity> {
    assertBranchAllowed(
      scope,
      dto.branchId,
      'POS_DRAFT_NOT_FOUND',
      'Branch not found',
    );
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);

    if (
      dto.orderDiscountType &&
      dto.orderDiscountType !== 'NONE' &&
      dto.orderDiscountValue !== undefined
    ) {
      calculateItemDiscount(
        1_000_000_000n,
        dto.orderDiscountType,
        dto.orderDiscountValue,
      );
    }

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      // Expire stale drafts first
      await em.query(
        `UPDATE ${prefix}"pos_drafts"
         SET status = 'EXPIRED', updated_at = now()
         WHERE tenant_id = $1
           AND branch_id = $2
           AND staff_id = $3
           AND status = 'ACTIVE'
           AND expires_at <= now()`,
        [tenantId, dto.branchId, staffId],
      );

      // Lock active drafts for this staff member in this branch to prevent race conditions
      const activeRows: Array<{ id: string }> = await em.query(
        `SELECT id
         FROM ${prefix}"pos_drafts"
         WHERE tenant_id = $1
           AND branch_id = $2
           AND staff_id = $3
           AND status = 'ACTIVE'
         FOR UPDATE`,
        [tenantId, dto.branchId, staffId],
      );

      if (activeRows.length >= MAX_ACTIVE_DRAFTS_PER_STAFF) {
        throw new SalesDomainError(
          SalesDomainErrorCode.POS_DRAFT_LIMIT_EXCEEDED,
          `Maximum of ${MAX_ACTIVE_DRAFTS_PER_STAFF} active POS drafts allowed per staff member in branch`,
          409,
          {
            activeDraftCount: activeRows.length,
            maxAllowed: MAX_ACTIVE_DRAFTS_PER_STAFF,
          },
        );
      }

      const now = new Date();
      const draft = em.create(PosDraftEntity, {
        id: randomUUID(),
        tenantId,
        branchId: dto.branchId,
        shiftId: dto.shiftId ?? null,
        staffId,
        customerId: dto.customerId ?? null,
        customerName: dto.customerName ?? null,
        title: dto.title ?? `Draft #${activeRows.length + 1}`,
        linesJson: dto.lines,
        orderDiscountType: dto.orderDiscountType ?? 'NONE',
        orderDiscountValue: Number(dto.orderDiscountValue ?? 0).toFixed(2),
        couponCode: dto.couponCode?.trim().toUpperCase() ?? null,
        paymentMethod: dto.paymentMethod ?? 'CASH',
        note: dto.note ?? null,
        status: 'ACTIVE',
        expiresAt: new Date(now.getTime() + DEFAULT_DRAFT_TTL_MS),
        createdAt: now,
        updatedAt: now,
      });

      return em.save(PosDraftEntity, draft);
    });
  }

  async listDrafts(
    staffId: string,
    scope: BranchScope,
    branchId?: string,
  ): Promise<PosDraftEntity[]> {
    const branchIds = branchFilter(
      scope,
      branchId,
      'POS_DRAFT_NOT_FOUND',
      'Branch not found',
    );
    if (branchIds?.length === 0) return [];
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const where: Record<string, unknown> = {
        tenantId,
        staffId,
        status: 'ACTIVE',
      };
      if (branchIds) {
        where.branchId = In(branchIds);
      }
      return em.getRepository(PosDraftEntity).find({
        where,
        order: { updatedAt: 'DESC' },
      });
    });
  }

  async updateDraft(
    staffId: string,
    draftId: string,
    scope: BranchScope,
    dto: UpdatePosDraftDto,
  ): Promise<PosDraftEntity> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const draft = await em.getRepository(PosDraftEntity).findOne({
        where: { id: draftId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !draft ||
        draft.status !== 'ACTIVE' ||
        !branchAllowed(scope, draft.branchId)
      ) {
        throw new SalesDomainError(
          SalesDomainErrorCode.POS_DRAFT_NOT_FOUND,
          'Active POS draft not found',
          404,
        );
      }
      if (draft.staffId !== staffId) {
        throw new SalesDomainError(
          SalesDomainErrorCode.PERMISSION_DENIED,
          'Cannot modify another staff member POS draft',
          403,
        );
      }

      if (dto.customerId !== undefined) draft.customerId = dto.customerId;
      if (dto.customerName !== undefined) draft.customerName = dto.customerName;
      if (dto.title !== undefined) draft.title = dto.title;
      if (dto.lines !== undefined) draft.linesJson = dto.lines;
      if (dto.orderDiscountType !== undefined) {
        draft.orderDiscountType = dto.orderDiscountType;
      }
      if (dto.orderDiscountValue !== undefined) {
        draft.orderDiscountValue = Number(dto.orderDiscountValue).toFixed(2);
      }
      if (dto.couponCode !== undefined) {
        draft.couponCode = dto.couponCode?.trim().toUpperCase() || null;
      }
      if (dto.paymentMethod !== undefined) {
        draft.paymentMethod = dto.paymentMethod;
      }
      if (dto.note !== undefined) {
        draft.note = dto.note;
      }
      draft.updatedAt = new Date();
      draft.expiresAt = new Date(Date.now() + DEFAULT_DRAFT_TTL_MS);

      return em.save(PosDraftEntity, draft);
    });
  }

  async discardDraft(
    staffId: string,
    draftId: string,
    scope: BranchScope,
  ): Promise<{ id: string; status: string }> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const draft = await em.getRepository(PosDraftEntity).findOne({
        where: { id: draftId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!draft || !branchAllowed(scope, draft.branchId)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.POS_DRAFT_NOT_FOUND,
          'POS draft not found',
          404,
        );
      }
      if (draft.staffId !== staffId) {
        throw new SalesDomainError(
          SalesDomainErrorCode.PERMISSION_DENIED,
          'Cannot discard another staff member POS draft',
          403,
        );
      }
      draft.status = 'DISCARDED';
      draft.updatedAt = new Date();
      await em.save(PosDraftEntity, draft);
      return { id: draft.id, status: draft.status };
    });
  }
}
