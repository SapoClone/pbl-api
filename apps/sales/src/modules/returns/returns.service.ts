import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  SALES_REFUND_REQUESTED,
  SALES_RETURN_APPROVED,
  SALES_RETURN_COMPLETED,
  SALES_RETURN_CREATED,
  SalesRefundRequestedPayload,
  SalesReturnEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { randomUUID } from 'node:crypto';
import { DataSource, In } from 'typeorm';
import { toMoney } from '../../common/money';
import {
  OriginalOrderLineSnapshot,
  SalesDomainError,
  SalesDomainErrorCode,
  calculateReturnRefund,
  formatQtyMillis,
  parseQtyMillis,
  parseVndAmount,
  vndNumber,
} from '../../domain/sales-domain';
import {
  getSchemaPrefix,
  nextTenantDocumentCode,
} from '../../infrastructure/persistence/sales-code.generator';
import {
  OrderStatusHistoryEntity,
  RefundRequestEntity,
  SalesReturnEntity,
  SalesReturnItemEntity,
} from '../../infrastructure/persistence/sales.entities';
import { InventoryClient } from '../../inventory/inventory.client';
import { inventoryStockKey } from '../../inventory/stock-key';
import { OrderItemEntity } from '../../orders/entities/order-item.entity';
import { OrderEntity } from '../../orders/entities/order.entity';
import { BranchScope, branchAllowed } from '../../presentation/access';
import { findCallersOpenShift, recordCashEntry } from '../shifts/cash-ledger';
import {
  CreateRefundRequestDto,
  CreateReturnDto,
  ReceiveReturnDto,
} from './returns.dto';

@Injectable()
export class ReturnsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly inventoryClient: InventoryClient,
    private readonly outbox: EventOutbox,
  ) {}

  async createReturn(
    actorId: string,
    scope: BranchScope,
    dto: CreateReturnDto,
  ) {
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);

    const createdReturnId = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      // Lock parent order FOR UPDATE
      const order = await em.getRepository(OrderEntity).findOne({
        where: { id: dto.orderId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order || !branchAllowed(scope, order.branchId)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.ORDER_NOT_FOUND,
          `Order ${dto.orderId} not found`,
          404,
        );
      }

      if (
        order.orderStatus !== 'COMPLETED' &&
        order.fulfillmentStatus !== 'FULFILLED' &&
        order.fulfillmentStatus !== 'PARTIALLY_FULFILLED' &&
        order.fulfillmentStatus !== 'RETURNED'
      ) {
        throw new SalesDomainError(
          SalesDomainErrorCode.RETURN_NOT_ELIGIBLE,
          `Order ${order.code} with status ${order.orderStatus}/${order.fulfillmentStatus} is not eligible for return`,
          409,
        );
      }

      // Lock all order_items for this order in deterministic id order
      const itemRows: OrderItemEntity[] = await em.query(
        `SELECT *
         FROM ${prefix}"order_items"
         WHERE tenant_id = $1 AND order_id = $2
         ORDER BY id ASC
         FOR UPDATE`,
        [tenantId, dto.orderId],
      );

      const originalSnapshots: OriginalOrderLineSnapshot[] = itemRows.map(
        (r: unknown) => {
          const row = r as Record<string, unknown>;
          const soldQtyStr = String(
            row.qty ?? `${Number(row.quantity ?? 1)}.000`,
          );
          const lineTotal = toMoney(row.line_total ?? 0);
          return {
            orderItemId: String(row.id),
            variantId: String(row.variant_id ?? row.id),
            skuCode: String(row.sku),
            productName: String(row.name),
            soldQty: soldQtyStr,
            alreadyReturnedQty: String(row.returned_qty ?? '0.000'),
            unitPrice: toMoney(row.unit_price ?? 0),
            lineNet: toMoney(row.line_net ?? lineTotal),
            taxAmount: toMoney(row.tax_amount ?? 0),
            lineTotal,
            alreadyRefundedAmount: toMoney(row.refunded_amount ?? 0),
          };
        },
      );

      const calculated = calculateReturnRefund(
        originalSnapshots,
        dto.items.map((item) => ({
          orderItemId: item.orderItemId,
          returnQty: item.returnQty,
          disposition: item.disposition ?? 'RESTOCK',
          reason: item.reason,
        })),
      );

      // Update order_items returned_qty and refunded_amount immediately under lock so concurrent returns cannot exceed soldQty
      for (const line of calculated.lines) {
        await em.query(
          `UPDATE ${prefix}"order_items"
           SET returned_qty = returned_qty + $3::numeric(18,3),
               refunded_amount = refunded_amount + $4::bigint
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, line.orderItemId, line.returnQty, line.refundAmount],
        );
      }

      const returnId = randomUUID();
      const code = await nextTenantDocumentCode(em, tenantId, 'TH');
      const now = new Date();
      const initialStatus =
        dto.autoApprove || dto.autoReceive ? 'APPROVED' : 'REQUESTED';

      const salesReturn = em.create(SalesReturnEntity, {
        id: returnId,
        tenantId,
        code,
        orderId: order.id,
        branchId: order.branchId,
        warehouseId: order.warehouseId ?? null,
        shiftId: order.shiftId ?? null,
        status: initialStatus,
        totalRefundAmount: calculated.totalRefundAmount,
        inventoryReceiptId: null,
        note: dto.note ?? null,
        requestedBy: actorId,
        approvedBy: initialStatus === 'APPROVED' ? actorId : null,
        receivedBy: null,
        createdAt: now,
        updatedAt: now,
      });
      await em.save(SalesReturnEntity, salesReturn);

      const returnItems = calculated.lines.map((line) =>
        em.create(SalesReturnItemEntity, {
          id: randomUUID(),
          tenantId,
          returnId,
          orderItemId: line.orderItemId,
          variantId: line.variantId,
          skuCode: line.skuCode,
          productName: line.productName,
          returnQty: line.returnQty,
          unitRefundAmount: line.unitRefundAmount,
          refundAmount: line.refundAmount,
          disposition: line.disposition,
          reason: line.reason,
        }),
      );
      await em.save(SalesReturnItemEntity, returnItems);

      await this.outbox.add(em, SALES_RETURN_CREATED, {
        returnId,
        code,
        orderId: order.id,
        branchId: order.branchId,
        status: initialStatus,
        totalRefundAmount: calculated.totalRefundAmount,
        occurredAt: now.toISOString(),
      } satisfies SalesReturnEventPayload);

      if (initialStatus === 'APPROVED') {
        await this.outbox.add(em, SALES_RETURN_APPROVED, {
          returnId,
          code,
          orderId: order.id,
          branchId: order.branchId,
          status: 'APPROVED',
          totalRefundAmount: calculated.totalRefundAmount,
          occurredAt: now.toISOString(),
        } satisfies SalesReturnEventPayload);
      }

      return returnId;
    });

    if (dto.autoReceive) {
      try {
        return await this.receiveReturn(createdReturnId, actorId, scope, {
          warehouseId: dto.warehouseId,
        });
      } catch (error) {
        // no resolvable warehouse: the return stays APPROVED and needs action, it is not an error here
        if (
          !(
            error instanceof SalesDomainError &&
            error.code === SalesDomainErrorCode.RETURN_WAREHOUSE_UNRESOLVED
          )
        ) {
          throw error;
        }
      }
    }

    return this.getReturnById(createdReturnId, scope);
  }

  async approveReturn(returnId: string, actorId: string, scope: BranchScope) {
    const tenantId = TenantContext.require();

    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const ret = await em.getRepository(SalesReturnEntity).findOne({
        where: { id: returnId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ret || !branchAllowed(scope, ret.branchId)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.RETURN_NOT_FOUND,
          `Return ${returnId} not found`,
          404,
        );
      }
      if (ret.status === 'APPROVED' || ret.status === 'COMPLETED') {
        return;
      }
      if (ret.status !== 'REQUESTED') {
        throw new SalesDomainError(
          SalesDomainErrorCode.RETURN_NOT_ELIGIBLE,
          `Cannot approve return in status ${ret.status}`,
          409,
        );
      }

      ret.status = 'APPROVED';
      ret.approvedBy = actorId;
      ret.updatedAt = new Date();
      await em.save(SalesReturnEntity, ret);

      await this.outbox.add(em, SALES_RETURN_APPROVED, {
        returnId: ret.id,
        code: ret.code,
        orderId: ret.orderId,
        branchId: ret.branchId,
        status: 'APPROVED',
        totalRefundAmount: ret.totalRefundAmount,
        occurredAt: ret.updatedAt.toISOString(),
      } satisfies SalesReturnEventPayload);
    });

    return this.getReturnById(returnId, scope);
  }

  async rejectReturn(
    returnId: string,
    actorId: string,
    scope: BranchScope,
    reason?: string,
  ) {
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);

    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const ret = await em.getRepository(SalesReturnEntity).findOne({
        where: { id: returnId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ret || !branchAllowed(scope, ret.branchId)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.RETURN_NOT_FOUND,
          `Return ${returnId} not found`,
          404,
        );
      }
      if (ret.status === 'REJECTED') {
        return;
      }
      if (ret.status === 'COMPLETED' || ret.status === 'RECEIVED') {
        throw new SalesDomainError(
          SalesDomainErrorCode.RETURN_NOT_ELIGIBLE,
          `Cannot reject return in status ${ret.status}`,
          409,
        );
      }

      const items = await em.getRepository(SalesReturnItemEntity).find({
        where: { returnId: ret.id, tenantId },
      });

      // Reverse the reserved returned_qty and refunded_amount on order_items
      for (const item of items) {
        await em.query(
          `UPDATE ${prefix}"order_items"
           SET returned_qty = GREATEST(0, returned_qty - $3::numeric(18,3)),
               refunded_amount = GREATEST(0, refunded_amount - $4::bigint)
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, item.orderItemId, item.returnQty, item.refundAmount],
        );
      }

      ret.status = 'REJECTED';
      ret.note = reason
        ? `${ret.note ? `${ret.note} | ` : ''}${reason}`
        : ret.note;
      ret.updatedAt = new Date();
      await em.save(SalesReturnEntity, ret);
    });

    return this.getReturnById(returnId, scope);
  }

  /**
   * Receive a return: the goods go back to the warehouse of the ORIGINAL sale (resolved from the order,
   * never from the request) at the original line cost. The return row is locked before inventory is
   * called and the receipt carries an idempotency key per return, so two simultaneous receives restock
   * once. A return with goods to restock and no resolvable warehouse stays APPROVED (409
   * RETURN_WAREHOUSE_UNRESOLVED): it is never marked COMPLETED. The restock call uses the service
   * identity, so a cashier who may receive their own branch's return needs no inventory permission.
   */
  async receiveReturn(
    returnId: string,
    actorId: string,
    scope: BranchScope,
    // `warehouseId` is accepted for old clients and ignored: the original sale's warehouse is used
    _dto: ReceiveReturnDto,
  ) {
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);

    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const lockedRet = await em.getRepository(SalesReturnEntity).findOne({
        where: { id: returnId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedRet || !branchAllowed(scope, lockedRet.branchId)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.RETURN_NOT_FOUND,
          `Return ${returnId} not found`,
          404,
        );
      }
      if (lockedRet.status === 'COMPLETED' || lockedRet.status === 'RECEIVED') {
        return;
      }
      if (lockedRet.status === 'REJECTED') {
        throw new SalesDomainError(
          SalesDomainErrorCode.RETURN_NOT_ELIGIBLE,
          'Cannot receive a REJECTED return',
          409,
        );
      }
      if (lockedRet.status === 'REQUESTED') {
        throw new SalesDomainError(
          SalesDomainErrorCode.RETURN_NOT_ELIGIBLE,
          'A return must be approved before it is received',
          409,
        );
      }
      const items = await em.getRepository(SalesReturnItemEntity).find({
        where: { returnId: lockedRet.id, tenantId },
      });
      const order = await em.getRepository(OrderEntity).findOne({
        where: { id: lockedRet.orderId, tenantId },
      });
      const warehouseId = order?.warehouseId ?? null;
      const restockLines = items.filter((i) => i.disposition === 'RESTOCK');
      let inventoryReceiptId = lockedRet.inventoryReceiptId;

      if (restockLines.length > 0 && !inventoryReceiptId) {
        if (!warehouseId) {
          throw new SalesDomainError(
            SalesDomainErrorCode.RETURN_WAREHOUSE_UNRESOLVED,
            `Return ${lockedRet.code} cannot be restocked: the original sale has no warehouse. It stays approved until it is resolved`,
            409,
            { returnId: lockedRet.id, orderId: lockedRet.orderId },
          );
        }
        const costRows: { id: string; unit_cost_snapshot: string }[] =
          await em.query(
            `SELECT id, unit_cost_snapshot FROM ${prefix}"order_items"
             WHERE tenant_id = $1 AND order_id = $2`,
            [tenantId, lockedRet.orderId],
          );
        const costByItem = new Map(
          costRows.map((r) => [r.id, toMoney(r.unit_cost_snapshot ?? 0)]),
        );
        // the row lock is held across this call: a second receive waits, then finds the return completed
        const receiptRes = await this.inventoryClient.receiveReturnedStock({
          warehouseId,
          returnId: lockedRet.id,
          code: `PN-${lockedRet.code}`,
          idempotencyKey: `return-receipt:${lockedRet.id}`,
          items: restockLines.map((rl) => ({
            skuId: inventoryStockKey(rl.variantId, rl.skuCode),
            qty: formatQtyMillis(parseQtyMillis(rl.returnQty)),
            unitCost: costByItem.get(rl.orderItemId) ?? 0,
          })),
        });
        inventoryReceiptId = receiptRes.receiptId;
      }

      lockedRet.warehouseId = warehouseId;
      lockedRet.status = 'COMPLETED';
      lockedRet.receivedBy = actorId;
      lockedRet.approvedBy = lockedRet.approvedBy ?? actorId;
      lockedRet.inventoryReceiptId = inventoryReceiptId;
      lockedRet.updatedAt = new Date();
      await em.save(SalesReturnEntity, lockedRet);

      const orderItems: OrderItemEntity[] = await em
        .getRepository(OrderItemEntity)
        .find({ where: { orderId: lockedRet.orderId, tenantId } });
      const allReturned = orderItems.every((oi) => {
        const soldMillis = parseQtyMillis(oi.qty ?? oi.quantity);
        const retMillis =
          oi.returnedQty && Number(oi.returnedQty) > 0
            ? parseQtyMillis(oi.returnedQty)
            : 0n;
        return retMillis >= soldMillis;
      });
      if (allReturned) {
        await em.query(
          `UPDATE ${prefix}"orders"
           SET fulfillment_status = 'RETURNED', version = version + 1, updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, lockedRet.orderId],
        );
      }

      await this.outbox.add(em, SALES_RETURN_COMPLETED, {
        returnId: lockedRet.id,
        code: lockedRet.code,
        orderId: lockedRet.orderId,
        branchId: lockedRet.branchId,
        customerId: order?.customerId ?? null,
        status: 'COMPLETED',
        totalRefundAmount: lockedRet.totalRefundAmount,
        occurredAt: lockedRet.updatedAt.toISOString(),
      } satisfies SalesReturnEventPayload);
    });

    return this.getReturnById(returnId, scope);
  }

  async createRefundRequest(
    returnId: string,
    actorId: string,
    scope: BranchScope,
    headerIdempotencyKey: string | undefined,
    dto: CreateRefundRequestDto,
  ): Promise<RefundRequestEntity> {
    const tenantId = TenantContext.require();
    const idempotencyKey = (
      headerIdempotencyKey ??
      dto.idempotencyKey ??
      `refund:${returnId}`
    )
      .trim()
      .toLowerCase();

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const ret = await em.getRepository(SalesReturnEntity).findOne({
        where: { id: returnId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ret || !branchAllowed(scope, ret.branchId)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.RETURN_NOT_FOUND,
          `Return ${returnId} not found`,
          404,
        );
      }

      // Idempotency check (after the return lock: two simultaneous requests with one key write one)
      const existing = await em.getRepository(RefundRequestEntity).findOne({
        where: { tenantId, idempotencyKey },
      });
      if (existing) {
        if (existing.returnId !== ret.id) {
          throw new SalesDomainError(
            SalesDomainErrorCode.IDEMPOTENCY_CONFLICT,
            'Idempotency-Key was already used for another return',
            409,
          );
        }
        return existing;
      }
      // a refund waits for an approved return (REQUESTED and REJECTED are refused)
      if (
        !['APPROVED', 'RECEIVED', 'REFUND_REQUESTED', 'COMPLETED'].includes(
          ret.status,
        )
      ) {
        throw new SalesDomainError(
          SalesDomainErrorCode.RETURN_NOT_ELIGIBLE,
          `Cannot request a refund for a ${ret.status} return: it must be approved first`,
          409,
        );
      }

      const order = await em.getRepository(OrderEntity).findOne({
        where: { id: ret.orderId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        throw new SalesDomainError(
          SalesDomainErrorCode.ORDER_NOT_FOUND,
          `Order ${ret.orderId} not found`,
          404,
        );
      }

      const maxReturnRefundVnd = parseVndAmount(ret.totalRefundAmount, true);
      const requestedVnd =
        dto.amount !== undefined
          ? parseVndAmount(dto.amount, false)
          : maxReturnRefundVnd;

      // Sum existing refund requests for this return
      const existingForReturn = await em
        .getRepository(RefundRequestEntity)
        .find({
          where: { tenantId, returnId: ret.id },
        });
      const alreadyRequestedForReturn = existingForReturn.reduce(
        (sum, r) => sum + parseVndAmount(r.amount, true),
        0n,
      );

      if (alreadyRequestedForReturn + requestedVnd > maxReturnRefundVnd) {
        throw new SalesDomainError(
          SalesDomainErrorCode.REFUND_AMOUNT_EXCEEDED,
          `Refund request (${requestedVnd}) exceeds remaining refundable amount (${maxReturnRefundVnd - alreadyRequestedForReturn}) for return ${ret.code}`,
          409,
        );
      }

      // one refund request per return (UQ_refund_requests_return): say so instead of failing on the index
      if (existingForReturn.length > 0) {
        throw new SalesDomainError(
          SalesDomainErrorCode.REFUND_ALREADY_REQUESTED,
          `Return ${ret.code} already has a refund request`,
          409,
        );
      }

      const orderPaidVnd = parseVndAmount(
        order.paidAmount ?? order.totalAmount,
        true,
      );
      const orderRefundedVnd = parseVndAmount(order.refundedAmount, true);
      if (orderRefundedVnd + requestedVnd > orderPaidVnd) {
        throw new SalesDomainError(
          SalesDomainErrorCode.REFUND_AMOUNT_EXCEEDED,
          `Total order refunds (${orderRefundedVnd + requestedVnd}) cannot exceed order paid amount (${orderPaidVnd})`,
          409,
        );
      }

      const method = dto.method ?? 'CASH';
      // A cash refund leaves the REFUNDING cashier's own open shift, chosen here, never by the client
      // (409 SHIFT_REQUIRED without one). A non-cash refund touches no drawer.
      const shiftId =
        method === 'CASH'
          ? await findCallersOpenShift(em, tenantId, actorId, ret.branchId)
          : null;
      const now = new Date();
      // Cash refunds at the POS drawer are settled immediately; non-cash refunds are PENDING for Finance M4
      const refundStatus = method === 'CASH' ? 'CONFIRMED' : 'PENDING';

      const refundReq = em.create(RefundRequestEntity, {
        id: randomUUID(),
        tenantId,
        returnId: ret.id,
        orderId: order.id,
        branchId: ret.branchId,
        shiftId,
        idempotencyKey,
        amount: vndNumber(requestedVnd),
        method,
        status: refundStatus,
        externalSettlementRef: null,
        requestedBy: actorId,
        confirmedAt: refundStatus === 'CONFIRMED' ? now : null,
        createdAt: now,
        updatedAt: now,
      });
      await em.save(RefundRequestEntity, refundReq);

      // Update order refundedAmount and paymentStatus
      const newOrderRefundedVnd = orderRefundedVnd + requestedVnd;
      const prevPaymentStatus = order.paymentStatus ?? 'PAID';
      const newPaymentStatus =
        refundStatus === 'PENDING'
          ? 'REFUND_PENDING'
          : newOrderRefundedVnd >= orderPaidVnd
            ? 'REFUNDED'
            : 'PARTIALLY_REFUNDED';

      order.refundedAmount = vndNumber(newOrderRefundedVnd);
      order.paymentStatus = newPaymentStatus;
      order.version = Number(order.version ?? 1) + 1;
      order.updatedAt = now;
      await em.save(OrderEntity, order);

      const history = em.create(OrderStatusHistoryEntity, {
        id: randomUUID(),
        tenantId,
        orderId: order.id,
        fromOrderStatus: order.orderStatus ?? 'COMPLETED',
        toOrderStatus: order.orderStatus ?? 'COMPLETED',
        fromPaymentStatus: prevPaymentStatus,
        toPaymentStatus: newPaymentStatus,
        fromFulfillmentStatus: order.fulfillmentStatus ?? 'FULFILLED',
        toFulfillmentStatus: order.fulfillmentStatus ?? 'FULFILLED',
        reason: `REFUND_${refundStatus}:${ret.code}`,
        actorId,
        createdAt: now,
      });
      await em.save(OrderStatusHistoryEntity, history);

      if (shiftId && requestedVnd > 0n) {
        await recordCashEntry(em, {
          tenantId,
          shiftId,
          kind: 'CASH_REFUND',
          amount: -vndNumber(requestedVnd),
          reason: 'return_refund',
          orderId: order.id,
          returnId: ret.id,
          staffId: actorId,
          sourceKey: `refund:${refundReq.id}`,
        });
      }

      await this.outbox.add(em, SALES_REFUND_REQUESTED, {
        refundRequestId: refundReq.id,
        returnId: ret.id,
        orderId: order.id,
        branchId: ret.branchId,
        amount: refundReq.amount,
        method: refundReq.method,
        status: refundReq.status,
        occurredAt: now.toISOString(),
      } satisfies SalesRefundRequestedPayload);

      return refundReq;
    });
  }

  async getReturnById(returnId: string, scope: BranchScope) {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const ret = await em.getRepository(SalesReturnEntity).findOne({
        where: { id: returnId, tenantId },
      });
      if (!ret || !branchAllowed(scope, ret.branchId)) {
        throw new SalesDomainError(
          SalesDomainErrorCode.RETURN_NOT_FOUND,
          `Return ${returnId} not found`,
          404,
        );
      }
      const items = await em.getRepository(SalesReturnItemEntity).find({
        where: { returnId: ret.id, tenantId },
      });
      const refundRequests = await em.getRepository(RefundRequestEntity).find({
        where: { returnId: ret.id, tenantId },
        order: { createdAt: 'ASC' },
      });
      return {
        ...ret,
        items,
        refundRequests,
      };
    });
  }

  async listReturns(scope: BranchScope, orderId?: string) {
    if (scope !== null && scope.length === 0) return [];
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const where: Record<string, unknown> = { tenantId };
      if (orderId) {
        where.orderId = orderId;
      }
      if (scope !== null) {
        where.branchId = In([...scope]);
      }
      return em.getRepository(SalesReturnEntity).find({
        where,
        order: { createdAt: 'DESC' },
      });
    });
  }
}
