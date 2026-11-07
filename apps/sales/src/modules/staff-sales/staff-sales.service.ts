import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { toMoney } from '../../common/money';
import { inTenantTx } from '../../common/tenant-tx';
import { getSchemaPrefix } from '../../infrastructure/persistence/sales-code.generator';
import { BranchScope, branchFilter } from '../../presentation/access';
import { parseRange } from '../screen/order-query.service';
import { StaffSalesQueryDto } from './staff-sales.dto';

export type StaffSalesRow = {
  staffId: string;
  ordersCount: number;
  /** Units sold, in base units */
  itemsSold: number;
  /** Integer VND: the grand total of their orders */
  revenue: number;
  firstSaleAt: string;
  lastSaleAt: string;
};

export type StaffProductRow = {
  productId: string | null;
  variantId: string | null;
  sku: string;
  name: string;
  variantLabel: string | null;
  quantity: number;
  /** Integer VND, after discounts */
  revenue: number;
  ordersCount: number;
};

const num = (value: unknown): number => Number(value ?? 0);

/**
 * Who sold what: completed orders grouped by the staff member who rang them up (`orders.created_by`), with the
 * shift they were rung up in. Gross sales: returns are not netted. Names live in platform, so rows carry ids.
 */
@Injectable()
export class StaffSalesService {
  constructor(private readonly dataSource: DataSource) {}

  async byStaff(
    query: StaffSalesQueryDto,
    scope: BranchScope,
  ): Promise<{
    data: StaffSalesRow[];
    totals: Pick<StaffSalesRow, 'ordersCount' | 'itemsSold' | 'revenue'>;
  }> {
    const branches = branchFilter(scope, query.branchId);
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      const { where, params } = this.filters(tenantId, query, branches);
      const prefix = getSchemaPrefix(em);
      const rows: Record<string, unknown>[] = await em.query(
        `SELECT o.created_by AS staff_id,
           count(*)::int AS orders_count,
           COALESCE(SUM(o.grand_total), 0) AS revenue,
           COALESCE(SUM(q.qty), 0) AS items_sold,
           min(o.created_at) AS first_sale_at,
           max(o.created_at) AS last_sale_at
         FROM ${prefix}"orders" o
         LEFT JOIN LATERAL (
           SELECT SUM(i.base_qty) AS qty FROM ${prefix}"order_items" i
           WHERE i.tenant_id = o.tenant_id AND i.order_id = o.id
         ) q ON true
         WHERE ${where}
         GROUP BY o.created_by
         ORDER BY SUM(o.grand_total) DESC, o.created_by`,
        params,
      );
      const data = rows.map((r) => ({
        staffId: r.staff_id as string,
        ordersCount: num(r.orders_count),
        itemsSold: num(r.items_sold),
        revenue: toMoney(r.revenue as string | number),
        firstSaleAt: new Date(r.first_sale_at as string).toISOString(),
        lastSaleAt: new Date(r.last_sale_at as string).toISOString(),
      }));
      return {
        data,
        totals: {
          ordersCount: data.reduce((n, r) => n + r.ordersCount, 0),
          itemsSold: data.reduce((n, r) => n + r.itemsSold, 0),
          revenue: data.reduce((n, r) => n + r.revenue, 0),
        },
      };
    });
  }

  /** What one staff member sold, product by product, best sellers first */
  async productsOf(
    staffId: string,
    query: StaffSalesQueryDto,
    scope: BranchScope,
  ): Promise<{ staffId: string; data: StaffProductRow[] }> {
    const branches = branchFilter(scope, query.branchId);
    return inTenantTx(this.dataSource, async (em, tenantId) => {
      const { where, params } = this.filters(tenantId, query, branches);
      params.push(staffId);
      const prefix = getSchemaPrefix(em);
      const rows: Record<string, unknown>[] = await em.query(
        `SELECT i.product_id, i.variant_id, i.sku, max(i.name) AS name, max(i.variant_label) AS variant_label,
           SUM(i.base_qty) AS quantity, SUM(i.line_net) AS revenue, count(DISTINCT o.id)::int AS orders_count
         FROM ${prefix}"orders" o
         JOIN ${prefix}"order_items" i ON i.tenant_id = o.tenant_id AND i.order_id = o.id
         WHERE ${where} AND o.created_by = $${params.length}
         GROUP BY i.product_id, i.variant_id, i.sku
         ORDER BY SUM(i.line_net) DESC, i.sku`,
        params,
      );
      return {
        staffId,
        data: rows.map((r) => ({
          productId: (r.product_id as string) ?? null,
          variantId: (r.variant_id as string) ?? null,
          sku: r.sku as string,
          name: r.name as string,
          variantLabel: (r.variant_label as string) ?? null,
          quantity: num(r.quantity),
          revenue: toMoney(r.revenue as string | number),
          ordersCount: num(r.orders_count),
        })),
      };
    });
  }

  private filters(
    tenantId: string,
    query: StaffSalesQueryDto,
    branches: string[] | null,
  ): { where: string; params: unknown[] } {
    const params: unknown[] = [tenantId];
    const where = [`o.tenant_id = $1`, `o.order_status = 'COMPLETED'`];
    if ((query.channelType ?? 'POS') === 'POS') {
      where.push(`o.channel_type = 'POS'`);
    }
    if (branches) {
      params.push(branches);
      where.push(`o.branch_id = ANY($${params.length})`);
    }
    if (query.shiftId) {
      params.push(query.shiftId);
      where.push(`o.shift_id = $${params.length}`);
    }
    const { from, to } = parseRange(query.from, query.to);
    if (from) {
      params.push(from);
      where.push(`o.created_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`o.created_at < $${params.length}`);
    }
    return { where: where.join(' AND '), params };
  }
}
