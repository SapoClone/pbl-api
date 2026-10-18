import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { TenantContext } from '@pbl/common';
import {
  OrderCompletedPayload,
  ReserveStockRequest,
  StockLine,
  StockReservation,
  StockShortage,
} from '@pbl/contracts';
import { qualifiedTable } from '@pbl/events';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { mergeLines } from './stock-lines';

/** Thrown inside the reservation transaction so that it rolls back and nothing is held */
export class StockShortageError extends Error {
  constructor(readonly shortages: StockShortage[]) {
    super('Not enough stock');
    this.name = 'StockShortageError';
  }
}

export interface ReserveResult {
  /** False when the same order had already been held (an idempotent retry) */
  created: boolean;
  reservation: StockReservation;
}

type ReservationRow = {
  id: string;
  order_id: string;
  branch_id: string;
  status: StockReservation['status'];
  expires_at: Date;
};

/**
 * Holds stock for an order, turns a hold into a deduction when the order is
 * completed, and gives back the stock of holds nobody completed. Every statement
 * names the tenant explicitly (it comes from the verified token or from the event),
 * and the check constraint of `stock_item` backs the code up: stock cannot go
 * negative whatever happens here.
 */
@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);
  private readonly ttlMinutes =
    Number(process.env.INVENTORY_RESERVATION_TTL_MINUTES) || 15;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Holds every line, or nothing: one conditional UPDATE per line
   * (`on_hand - reserved >= qty`), in one transaction, lines locked in SKU order so
   * overlapping orders cannot deadlock. Idempotent by `(tenant, orderId)`.
   */
  async reserve(request: ReserveStockRequest): Promise<ReserveResult> {
    const tenantId = TenantContext.require();
    const lines = mergeLines(request.lines);
    return this.dataSource.transaction(async (em) => {
      const t = (name: string) => qualifiedTable(em.connection, name);

      let id = await this.insertReservation(em, tenantId, request);
      if (!id) {
        const existing = await this.findByOrder(em, tenantId, request.orderId);
        if (existing && ['held', 'committed'].includes(existing.status)) {
          return {
            created: false,
            reservation: await this.toReservation(em, existing),
          };
        }
        // released or expired earlier: this order tries again from scratch
        await em.query(
          `DELETE FROM ${t('stock_reservation')} WHERE "id" = $1`,
          [existing!.id],
        );
        id = await this.insertReservation(em, tenantId, request);
      }

      const shortages: StockShortage[] = [];
      for (const line of lines) {
        const [, held] = await em.query(
          `UPDATE ${t('stock_item')}
              SET "quantity_reserved" = "quantity_reserved" + $4, "updated_at" = now()
            WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "sku" = $3
              AND "quantity_on_hand" - "quantity_reserved" >= $4`,
          [tenantId, request.branchId, line.sku, line.quantity],
        );
        if (held === 0) {
          const [item] = await em.query(
            `SELECT "quantity_on_hand" - "quantity_reserved" AS "available"
               FROM ${t('stock_item')}
              WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "sku" = $3`,
            [tenantId, request.branchId, line.sku],
          );
          shortages.push({
            sku: line.sku,
            requested: line.quantity,
            available: item?.available ?? 0,
          });
        }
      }
      if (shortages.length > 0) throw new StockShortageError(shortages);

      for (const line of lines) {
        await em.query(
          `INSERT INTO ${t('stock_reservation_item')} ("id", "tenant_id", "reservation_id", "sku", "quantity")
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), tenantId, id, line.sku, line.quantity],
        );
      }
      const row = await this.findByOrder(em, tenantId, request.orderId);
      return {
        created: true,
        reservation: await this.toReservation(em, row!),
      };
    });
  }

  /** Gives back a hold nobody completed. Idempotent: anything but `held` is left alone. */
  async release(orderId: string): Promise<void> {
    const tenantId = TenantContext.require();
    await this.dataSource.transaction(async (em) => {
      const row = await this.findByOrder(em, tenantId, orderId, true);
      if (row?.status !== 'held') return;
      await this.giveBack(em, tenantId, row, 'released');
    });
  }

  /**
   * The order was completed (event `sales.order.completed`): the hold becomes a
   * deduction. When the hold is gone (the event was very late and it expired) the
   * lines are deducted directly, taking at most what other holds leave free, and
   * what was short is logged; stock never goes below what other holds need.
   */
  async commit(
    em: EntityManager,
    tenantId: string,
    order: OrderCompletedPayload,
  ): Promise<void> {
    const t = (name: string) => qualifiedTable(em.connection, name);
    const row = await this.findByOrder(em, tenantId, order.orderId, true);
    if (row?.status === 'committed') return;

    const held = row?.status === 'held';
    const branchId = row?.branch_id ?? order.branchId;
    const lines = held
      ? await this.itemsOf(em, row!.id)
      : mergeLines(
          order.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        );

    for (const line of lines) {
      let take = line.quantity;
      if (!held) {
        const [item] = await em.query(
          `SELECT "quantity_on_hand" - "quantity_reserved" AS "free"
             FROM ${t('stock_item')}
            WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "sku" = $3 FOR UPDATE`,
          [tenantId, branchId, line.sku],
        );
        take = Math.min(line.quantity, Math.max(0, item?.free ?? 0));
        if (take < line.quantity) {
          this.logger.warn(
            `Order ${order.code}: ${line.sku} short by ${line.quantity - take} when the hold had gone`,
          );
        }
        if (take === 0) continue;
      }
      const [rows] = await em.query(
        `UPDATE ${t('stock_item')}
            SET "quantity_on_hand" = "quantity_on_hand" - $4,
                "quantity_reserved" = "quantity_reserved" - $5,
                "updated_at" = now()
          WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "sku" = $3
          RETURNING "quantity_on_hand"`,
        [tenantId, branchId, line.sku, take, held ? take : 0],
      );
      await this.ledger(
        em,
        tenantId,
        branchId,
        line.sku,
        -take,
        rows[0].quantity_on_hand,
        'sale',
        order.orderId,
      );
    }
    if (row) {
      await em.query(
        `UPDATE ${t('stock_reservation')} SET "status" = 'committed' WHERE "id" = $1`,
        [row.id],
      );
    }
  }

  /** Expires the holds past their time and gives the stock back. Returns how many. */
  async expireDue(limit = 50): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      const t = (name: string) => qualifiedTable(em.connection, name);
      const due: (ReservationRow & { tenant_id: string })[] = await em.query(
        `SELECT * FROM ${t('stock_reservation')}
          WHERE "status" = 'held' AND "expires_at" < now()
          ORDER BY "expires_at" LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      for (const row of due) {
        await this.giveBack(em, row.tenant_id, row, 'expired');
      }
      return due.length;
    });
  }

  // ---- internals

  private async insertReservation(
    em: EntityManager,
    tenantId: string,
    request: ReserveStockRequest,
  ): Promise<string | null> {
    const rows = await em.query(
      `INSERT INTO ${qualifiedTable(em.connection, 'stock_reservation')}
         ("id", "tenant_id", "order_id", "branch_id", "status", "expires_at")
       VALUES ($1, $2, $3, $4, 'held', now() + make_interval(mins => $5))
       ON CONFLICT ("tenant_id", "order_id") DO NOTHING RETURNING "id"`,
      [
        randomUUID(),
        tenantId,
        request.orderId,
        request.branchId,
        this.ttlMinutes,
      ],
    );
    return rows[0]?.id ?? null;
  }

  private async findByOrder(
    em: EntityManager,
    tenantId: string,
    orderId: string,
    lock = false,
  ): Promise<ReservationRow | null> {
    const rows = await em.query(
      `SELECT "id", "order_id", "branch_id", "status", "expires_at"
         FROM ${qualifiedTable(em.connection, 'stock_reservation')}
        WHERE "tenant_id" = $1 AND "order_id" = $2 ${lock ? 'FOR UPDATE' : ''}`,
      [tenantId, orderId],
    );
    return rows[0] ?? null;
  }

  private async itemsOf(
    em: EntityManager,
    reservationId: string,
  ): Promise<StockLine[]> {
    const rows = await em.query(
      `SELECT "sku", "quantity" FROM ${qualifiedTable(em.connection, 'stock_reservation_item')}
        WHERE "reservation_id" = $1 ORDER BY "sku"`,
      [reservationId],
    );
    return rows.map((r: StockLine) => ({ sku: r.sku, quantity: r.quantity }));
  }

  private async toReservation(
    em: EntityManager,
    row: ReservationRow,
  ): Promise<StockReservation> {
    return {
      orderId: row.order_id,
      branchId: row.branch_id,
      status: row.status,
      expiresAt: new Date(row.expires_at).toISOString(),
      lines: await this.itemsOf(em, row.id),
    };
  }

  /** Returns the held quantities to the free stock and closes the reservation */
  private async giveBack(
    em: EntityManager,
    tenantId: string,
    row: ReservationRow,
    status: 'released' | 'expired',
  ): Promise<void> {
    const t = (name: string) => qualifiedTable(em.connection, name);
    for (const line of await this.itemsOf(em, row.id)) {
      await em.query(
        `UPDATE ${t('stock_item')}
            SET "quantity_reserved" = "quantity_reserved" - $4, "updated_at" = now()
          WHERE "tenant_id" = $1 AND "branch_id" = $2 AND "sku" = $3`,
        [tenantId, row.branch_id, line.sku, line.quantity],
      );
    }
    await em.query(
      `UPDATE ${t('stock_reservation')} SET "status" = $2 WHERE "id" = $1`,
      [row.id, status],
    );
  }

  private ledger(
    em: EntityManager,
    tenantId: string,
    branchId: string,
    sku: string,
    changeQty: number,
    balanceAfter: number,
    refType: string,
    refId: string,
  ) {
    return em.query(
      `INSERT INTO ${qualifiedTable(em.connection, 'inventory_ledger')}
         ("id", "tenant_id", "branch_id", "sku", "change_qty", "balance_after", "ref_type", "ref_id")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        tenantId,
        branchId,
        sku,
        changeQty,
        balanceAfter,
        refType,
        refId,
      ],
    );
  }
}
