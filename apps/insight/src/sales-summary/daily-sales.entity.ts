import { Column, Entity, PrimaryColumn } from 'typeorm';

const bigintNumber = {
  to: (value?: number) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : Number(value),
};

/**
 * Revenue and order count per store, branch and day, built from
 * `sales.order.completed` events (a read model: nothing here is a source of truth).
 */
@Entity('daily_sales')
export class DailySalesEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  /** The calendar day in the store's timezone (Asia/Ho_Chi_Minh) */
  @PrimaryColumn({ name: 'sales_date', type: 'date' })
  salesDate!: string;

  @Column({ name: 'order_count', type: 'int', default: 0 })
  orderCount!: number;

  /** Integer VND */
  @Column({ type: 'bigint', default: 0, transformer: bigintNumber })
  revenue!: number;
}
