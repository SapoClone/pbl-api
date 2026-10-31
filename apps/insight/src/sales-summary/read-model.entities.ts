import { Column, Entity, PrimaryColumn } from 'typeorm';

const bigintNumber = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : Number(value),
};

/** Orders and revenue per branch, channel, day and hour (hour 0-23 in UTC+7) */
@Entity('hourly_sales')
export class HourlySalesEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @PrimaryColumn({ type: 'varchar', length: 30 })
  channel!: string;

  @PrimaryColumn({ name: 'sales_date', type: 'date' })
  salesDate!: string;

  @PrimaryColumn({ type: 'smallint' })
  hour!: number;

  @Column({ name: 'order_count', type: 'int', default: 0 })
  orderCount!: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintNumber })
  revenue!: number;

  /** Sum of the costs that were known; null while no order of the hour had one */
  @Column({
    type: 'bigint',
    nullable: true,
    transformer: bigintNumber,
  })
  cost!: number | null;

  /** Revenue of the orders whose cost was known (gross profit = costed_revenue - cost) */
  @Column({
    name: 'costed_revenue',
    type: 'bigint',
    default: 0,
    transformer: bigintNumber,
  })
  costedRevenue!: number;
}

/** Units and revenue per branch, day and SKU */
@Entity('product_sales_daily')
export class ProductSalesDailyEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @PrimaryColumn({ name: 'sales_date', type: 'date' })
  salesDate!: string;

  @PrimaryColumn({ type: 'varchar', length: 100 })
  sku!: string;

  @Column({ type: 'varchar', length: 300 })
  name!: string;

  @Column({ type: 'bigint', default: 0, transformer: bigintNumber })
  quantity!: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintNumber })
  revenue!: number;
}

/** One row per customer who bought in a branch on a day (for distinct-customer counts) */
@Entity('customer_sales_daily')
export class CustomerSalesDailyEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @PrimaryColumn({ name: 'sales_date', type: 'date' })
  salesDate!: string;

  @PrimaryColumn({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  /** The earliest hour (UTC+7) of the customer's orders that day: "same time yesterday" counts */
  @Column({ name: 'first_hour', type: 'smallint' })
  firstHour!: number;
}
