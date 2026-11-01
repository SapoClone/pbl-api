import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { moneyTransformer } from '../../common/money';

@Entity('insight_dimension_caches')
export class InsightDimensionCacheEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'dimension_type', type: 'varchar', length: 32 })
  dimensionType!: 'PRODUCT' | 'VARIANT' | 'CUSTOMER' | 'BRANCH';

  @Column({ name: 'entity_id', type: 'varchar', length: 128 })
  entityId!: string;

  @Column({ name: 'code', type: 'varchar', length: 128 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'parent_id', type: 'varchar', length: 128, nullable: true })
  parentId!: string | null;

  @Column({ name: 'category_id', type: 'varchar', length: 128, nullable: true })
  categoryId!: string | null;

  @Column({ name: 'brand_id', type: 'varchar', length: 128, nullable: true })
  brandId!: string | null;

  @Column({
    name: 'customer_group_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  customerGroupId!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'aggregate_version', type: 'integer', default: 1 })
  aggregateVersion!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('sales_order_facts')
export class SalesOrderFactEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'order_code', type: 'varchar', length: 64 })
  orderCode!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'channel_type', type: 'varchar', length: 32, default: 'POS' })
  channelType!: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({
    name: 'customer_group_id',
    type: 'varchar',
    length: 64,
    default: 'WALK_IN',
  })
  customerGroupId!: string;

  @Column({
    name: 'seller_staff_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  sellerStaffId!: string | null;

  @Column({ name: 'order_status', type: 'varchar', length: 32 })
  orderStatus!: string;

  @Column({
    name: 'payment_status',
    type: 'varchar',
    length: 32,
    default: 'UNPAID',
  })
  paymentStatus!: string;

  @Column({
    name: 'fulfillment_status',
    type: 'varchar',
    length: 32,
    default: 'UNFULFILLED',
  })
  fulfillmentStatus!: string;

  @Column({ name: 'date_bucket', type: 'date' })
  dateBucket!: string;

  @Column({ name: 'subtotal', type: 'bigint', transformer: moneyTransformer })
  subtotal!: number;

  @Column({
    name: 'discount_total',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  discountTotal!: number;

  @Column({ name: 'tax_total', type: 'bigint', transformer: moneyTransformer })
  taxTotal!: number;

  @Column({
    name: 'grand_total',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grandTotal!: number;

  @Column({ name: 'cogs_total', type: 'bigint', transformer: moneyTransformer })
  cogsTotal!: number;

  @Column({ name: 'units_total', type: 'numeric', precision: 18, scale: 4 })
  unitsTotal!: string;

  @Column({
    name: 'cost_status',
    type: 'varchar',
    length: 16,
    default: 'VERIFIED',
  })
  costStatus!: 'VERIFIED' | 'PENDING';

  @Column({
    name: 'contributed_gmv',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  contributedGmv!: number;

  @Column({
    name: 'contributed_gross_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  contributedGrossRevenue!: number;

  @Column({
    name: 'contributed_discount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  contributedDiscount!: number;

  @Column({
    name: 'contributed_net_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  contributedNetRevenue!: number;

  @Column({
    name: 'contributed_cogs',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  contributedCogs!: number;

  @Column({
    name: 'contributed_units_sold',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  contributedUnitsSold!: string;

  @Column({ name: 'contributed_order_count', type: 'integer', default: 0 })
  contributedOrderCount!: number;

  @Column({ name: 'contributed_completed_count', type: 'integer', default: 0 })
  contributedCompletedCount!: number;

  @Column({ name: 'contributed_cancelled_count', type: 'integer', default: 0 })
  contributedCancelledCount!: number;

  @Column({ name: 'last_aggregate_version', type: 'integer', default: 1 })
  lastAggregateVersion!: number;

  @Column({ name: 'last_event_id', type: 'uuid', nullable: true })
  lastEventId!: string | null;

  @Column({ name: 'raw_payload', type: 'jsonb', default: () => "'{}'::jsonb" })
  rawPayload!: Record<string, unknown>;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('sales_order_line_facts')
export class SalesOrderLineFactEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'line_key', type: 'varchar', length: 128 })
  lineKey!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'channel_type', type: 'varchar', length: 32, default: 'POS' })
  channelType!: string;

  @Column({
    name: 'customer_group_id',
    type: 'varchar',
    length: 64,
    default: 'WALK_IN',
  })
  customerGroupId!: string;

  @Column({
    name: 'seller_staff_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  sellerStaffId!: string | null;

  @Column({ name: 'date_bucket', type: 'date' })
  dateBucket!: string;

  @Column({ name: 'variant_id', type: 'varchar', length: 128 })
  variantId!: string;

  @Column({ name: 'product_id', type: 'varchar', length: 128, nullable: true })
  productId!: string | null;

  @Column({ name: 'sku_code', type: 'varchar', length: 128 })
  skuCode!: string;

  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  productName!: string;

  @Column({ name: 'category_id', type: 'varchar', length: 128, nullable: true })
  categoryId!: string | null;

  @Column({ name: 'brand_id', type: 'varchar', length: 128, nullable: true })
  brandId!: string | null;

  @Column({ name: 'quantity', type: 'numeric', precision: 18, scale: 4 })
  quantity!: string;

  @Column({ name: 'unit_price', type: 'bigint', transformer: moneyTransformer })
  unitPrice!: number;

  @Column({
    name: 'line_subtotal',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  lineSubtotal!: number;

  @Column({
    name: 'line_discount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  lineDiscount!: number;

  @Column({
    name: 'line_net_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  lineNetRevenue!: number;

  @Column({
    name: 'unit_cost_snapshot',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  unitCostSnapshot!: number;

  @Column({
    name: 'cogs_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  cogsAmount!: number;

  @Column({
    name: 'gross_profit_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grossProfitAmount!: number;

  @Column({
    name: 'cost_status',
    type: 'varchar',
    length: 16,
    default: 'VERIFIED',
  })
  costStatus!: 'VERIFIED' | 'PENDING';

  @Column({
    name: 'contributed_gross_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  contributedGrossRevenue!: number;

  @Column({
    name: 'contributed_discount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  contributedDiscount!: number;

  @Column({
    name: 'contributed_net_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  contributedNetRevenue!: number;

  @Column({
    name: 'contributed_cogs',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  contributedCogs!: number;

  @Column({
    name: 'contributed_units_sold',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  contributedUnitsSold!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('sales_return_facts')
export class SalesReturnFactEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'return_id', type: 'uuid' })
  returnId!: string;

  @Column({ name: 'return_code', type: 'varchar', length: 64 })
  returnCode!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'channel_type', type: 'varchar', length: 32, default: 'POS' })
  channelType!: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({
    name: 'customer_group_id',
    type: 'varchar',
    length: 64,
    default: 'WALK_IN',
  })
  customerGroupId!: string;

  @Column({
    name: 'seller_staff_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  sellerStaffId!: string | null;

  @Column({ name: 'date_bucket', type: 'date' })
  dateBucket!: string;

  @Column({
    name: 'refund_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  refundAmount!: number;

  @Column({ name: 'returned_units', type: 'numeric', precision: 18, scale: 4 })
  returnedUnits!: string;

  @Column({
    name: 'returned_cogs_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  returnedCogsAmount!: number;

  @Column({ name: 'restocked', type: 'boolean', default: true })
  restocked!: boolean;

  @Column({ name: 'return_lines', type: 'jsonb', default: () => "'[]'::jsonb" })
  returnLines!: Record<string, unknown>[];

  @Column({ name: 'last_event_id', type: 'uuid', nullable: true })
  lastEventId!: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('daily_sales_summaries')
export class DailySalesSummaryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({
    name: 'generation_id',
    type: 'varchar',
    length: 64,
    default: 'gen-active',
  })
  generationId!: string;

  @Column({ name: 'date_bucket', type: 'date' })
  dateBucket!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'gmv', type: 'bigint', transformer: moneyTransformer })
  gmv!: number;

  @Column({
    name: 'gross_sales_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grossSalesRevenue!: number;

  @Column({
    name: 'discount_total',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  discountTotal!: number;

  @Column({
    name: 'returns_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  returnsAmount!: number;

  @Column({
    name: 'net_sales_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  netSalesRevenue!: number;

  @Column({ name: 'tax_total', type: 'bigint', transformer: moneyTransformer })
  taxTotal!: number;

  @Column({
    name: 'cogs_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  cogsAmount!: number;

  @Column({
    name: 'returned_cogs_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  returnedCogsAmount!: number;

  @Column({
    name: 'net_cogs_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  netCogsAmount!: number;

  @Column({
    name: 'gross_profit',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grossProfit!: number;

  @Column({ name: 'order_count', type: 'integer', default: 0 })
  orderCount!: number;

  @Column({ name: 'completed_order_count', type: 'integer', default: 0 })
  completedOrderCount!: number;

  @Column({ name: 'cancelled_order_count', type: 'integer', default: 0 })
  cancelledOrderCount!: number;

  @Column({ name: 'return_count', type: 'integer', default: 0 })
  returnCount!: number;

  @Column({ name: 'units_sold', type: 'numeric', precision: 18, scale: 4 })
  unitsSold!: string;

  @Column({ name: 'units_returned', type: 'numeric', precision: 18, scale: 4 })
  unitsReturned!: string;

  @Column({ name: 'pending_cost_lines_count', type: 'integer', default: 0 })
  pendingCostLinesCount!: number;

  @Column({
    name: 'cash_inflow_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  cashInflowAmount!: number;

  @Column({
    name: 'cash_outflow_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  cashOutflowAmount!: number;

  @Column({
    name: 'debt_collected_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  debtCollectedAmount!: number;

  @Column({ name: 'projection_version', type: 'bigint', default: 1 })
  projectionVersion!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('product_sales_summaries')
export class ProductSalesSummaryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({
    name: 'generation_id',
    type: 'varchar',
    length: 64,
    default: 'gen-active',
  })
  generationId!: string;

  @Column({ name: 'date_bucket', type: 'date' })
  dateBucket!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'variant_id', type: 'varchar', length: 128 })
  variantId!: string;

  @Column({ name: 'product_id', type: 'varchar', length: 128, nullable: true })
  productId!: string | null;

  @Column({ name: 'sku_code', type: 'varchar', length: 128 })
  skuCode!: string;

  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  productName!: string;

  @Column({ name: 'category_id', type: 'varchar', length: 128, nullable: true })
  categoryId!: string | null;

  @Column({ name: 'brand_id', type: 'varchar', length: 128, nullable: true })
  brandId!: string | null;

  @Column({ name: 'units_sold', type: 'numeric', precision: 18, scale: 4 })
  unitsSold!: string;

  @Column({ name: 'units_returned', type: 'numeric', precision: 18, scale: 4 })
  unitsReturned!: string;

  @Column({
    name: 'gross_sales_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grossSalesRevenue!: number;

  @Column({
    name: 'discount_total',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  discountTotal!: number;

  @Column({
    name: 'returns_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  returnsAmount!: number;

  @Column({
    name: 'net_sales_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  netSalesRevenue!: number;

  @Column({
    name: 'cogs_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  cogsAmount!: number;

  @Column({
    name: 'returned_cogs_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  returnedCogsAmount!: number;

  @Column({
    name: 'net_cogs_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  netCogsAmount!: number;

  @Column({
    name: 'gross_profit',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grossProfit!: number;

  @Column({ name: 'order_count', type: 'integer', default: 0 })
  orderCount!: number;

  @Column({ name: 'pending_cost_lines_count', type: 'integer', default: 0 })
  pendingCostLinesCount!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('employee_sales_summaries')
export class EmployeeSalesSummaryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({
    name: 'generation_id',
    type: 'varchar',
    length: 64,
    default: 'gen-active',
  })
  generationId!: string;

  @Column({ name: 'date_bucket', type: 'date' })
  dateBucket!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'employee_id', type: 'varchar', length: 128 })
  employeeId!: string;

  @Column({
    name: 'gross_sales_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grossSalesRevenue!: number;

  @Column({
    name: 'discount_total',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  discountTotal!: number;

  @Column({
    name: 'returns_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  returnsAmount!: number;

  @Column({
    name: 'net_sales_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  netSalesRevenue!: number;

  @Column({
    name: 'gross_profit',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grossProfit!: number;

  @Column({ name: 'completed_order_count', type: 'integer', default: 0 })
  completedOrderCount!: number;

  @Column({ name: 'return_count', type: 'integer', default: 0 })
  returnCount!: number;

  @Column({ name: 'units_sold', type: 'numeric', precision: 18, scale: 4 })
  unitsSold!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('channel_sales_summaries')
export class ChannelSalesSummaryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({
    name: 'generation_id',
    type: 'varchar',
    length: 64,
    default: 'gen-active',
  })
  generationId!: string;

  @Column({ name: 'date_bucket', type: 'date' })
  dateBucket!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'channel_type', type: 'varchar', length: 32 })
  channelType!: string;

  @Column({ name: 'gmv', type: 'bigint', transformer: moneyTransformer })
  gmv!: number;

  @Column({
    name: 'gross_sales_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grossSalesRevenue!: number;

  @Column({
    name: 'discount_total',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  discountTotal!: number;

  @Column({
    name: 'returns_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  returnsAmount!: number;

  @Column({
    name: 'net_sales_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  netSalesRevenue!: number;

  @Column({
    name: 'gross_profit',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grossProfit!: number;

  @Column({ name: 'order_count', type: 'integer', default: 0 })
  orderCount!: number;

  @Column({ name: 'completed_order_count', type: 'integer', default: 0 })
  completedOrderCount!: number;

  @Column({ name: 'cancelled_order_count', type: 'integer', default: 0 })
  cancelledOrderCount!: number;

  @Column({ name: 'units_sold', type: 'numeric', precision: 18, scale: 4 })
  unitsSold!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('customer_group_sales_summaries')
export class CustomerGroupSalesSummaryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({
    name: 'generation_id',
    type: 'varchar',
    length: 64,
    default: 'gen-active',
  })
  generationId!: string;

  @Column({ name: 'date_bucket', type: 'date' })
  dateBucket!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'customer_group_id', type: 'varchar', length: 64 })
  customerGroupId!: string;

  @Column({
    name: 'gross_sales_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grossSalesRevenue!: number;

  @Column({
    name: 'discount_total',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  discountTotal!: number;

  @Column({
    name: 'returns_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  returnsAmount!: number;

  @Column({
    name: 'net_sales_revenue',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  netSalesRevenue!: number;

  @Column({
    name: 'gross_profit',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  grossProfit!: number;

  @Column({ name: 'completed_order_count', type: 'integer', default: 0 })
  completedOrderCount!: number;

  @Column({ name: 'units_sold', type: 'numeric', precision: 18, scale: 4 })
  unitsSold!: string;

  @Column({ name: 'loyalty_points_earned', type: 'bigint', default: 0 })
  loyaltyPointsEarned!: string;

  @Column({ name: 'loyalty_points_redeemed', type: 'bigint', default: 0 })
  loyaltyPointsRedeemed!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('inventory_stock_projections')
export class InventoryStockProjectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'sku_code', type: 'varchar', length: 128 })
  skuCode!: string;

  @Column({ name: 'variant_id', type: 'varchar', length: 128, nullable: true })
  variantId!: string | null;

  @Column({ name: 'product_name', type: 'varchar', length: 255, default: '' })
  productName!: string;

  @Column({ name: 'category_id', type: 'varchar', length: 128, nullable: true })
  categoryId!: string | null;

  @Column({ name: 'on_hand_qty', type: 'numeric', precision: 18, scale: 4 })
  onHandQty!: string;

  @Column({ name: 'reserved_qty', type: 'numeric', precision: 18, scale: 4 })
  reservedQty!: string;

  @Column({ name: 'available_qty', type: 'numeric', precision: 18, scale: 4 })
  availableQty!: string;

  @Column({ name: 'in_transit_qty', type: 'numeric', precision: 18, scale: 4 })
  inTransitQty!: string;

  @Column({
    name: 'avg_unit_cost',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  avgUnitCost!: number;

  @Column({
    name: 'inventory_valuation',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  inventoryValuation!: number;

  @Column({
    name: 'in_transit_valuation',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  inTransitValuation!: number;

  @Column({
    name: 'low_stock_threshold',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 5,
  })
  lowStockThreshold!: string;

  @Column({ name: 'is_low_stock', type: 'boolean', default: false })
  isLowStock!: boolean;

  @Column({ name: 'last_movement_at', type: 'timestamptz', nullable: true })
  lastMovementAt!: Date | null;

  @Column({ name: 'last_sale_at', type: 'timestamptz', nullable: true })
  lastSaleAt!: Date | null;

  @Column({ name: 'projection_version', type: 'bigint', default: 1 })
  projectionVersion!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('inventory_value_snapshots')
export class InventoryValueSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'snapshot_date', type: 'date' })
  snapshotDate!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'sku_count', type: 'integer', default: 0 })
  skuCount!: number;

  @Column({
    name: 'total_on_hand_qty',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  totalOnHandQty!: string;

  @Column({
    name: 'total_reserved_qty',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  totalReservedQty!: string;

  @Column({
    name: 'total_available_qty',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  totalAvailableQty!: string;

  @Column({
    name: 'total_in_transit_qty',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  totalInTransitQty!: string;

  @Column({
    name: 'on_hand_valuation',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  onHandValuation!: number;

  @Column({
    name: 'in_transit_valuation',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  inTransitValuation!: number;

  @Column({
    name: 'total_valuation',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  totalValuation!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('inventory_movement_projections')
export class InventoryMovementProjectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'date_bucket', type: 'date' })
  dateBucket!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'sku_code', type: 'varchar', length: 128 })
  skuCode!: string;

  @Column({ name: 'movement_type', type: 'varchar', length: 64 })
  movementType!: string;

  @Column({ name: 'qty_delta', type: 'numeric', precision: 18, scale: 4 })
  qtyDelta!: string;

  @Column({ name: 'unit_cost', type: 'bigint', transformer: moneyTransformer })
  unitCost!: number;

  @Column({
    name: 'value_delta',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  valueDelta!: number;

  @Column({ name: 'on_hand_after', type: 'numeric', precision: 18, scale: 4 })
  onHandAfter!: string;

  @Column({ name: 'reserved_after', type: 'numeric', precision: 18, scale: 4 })
  reservedAfter!: string;

  @Column({ name: 'reference_type', type: 'varchar', length: 64 })
  referenceType!: string;

  @Column({ name: 'reference_id', type: 'varchar', length: 128 })
  referenceId!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('projection_checkpoints')
export class ProjectionCheckpointEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'projection_name', type: 'varchar', length: 64 })
  projectionName!: string;

  @Column({
    name: 'active_generation_id',
    type: 'varchar',
    length: 64,
    default: 'gen-active',
  })
  activeGenerationId!: string;

  @Column({ name: 'last_event_id', type: 'uuid', nullable: true })
  lastEventId!: string | null;

  @Column({
    name: 'last_event_type',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  lastEventType!: string | null;

  @Column({
    name: 'last_event_occurred_at',
    type: 'timestamptz',
    nullable: true,
  })
  lastEventOccurredAt!: Date | null;

  @Column({ name: 'last_processed_at', type: 'timestamptz' })
  lastProcessedAt!: Date;

  @Column({ name: 'projection_version', type: 'bigint', default: 1 })
  projectionVersion!: string;

  @Column({ name: 'events_processed_count', type: 'bigint', default: 0 })
  eventsProcessedCount!: string;

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'HEALTHY' })
  status!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('projection_generations')
export class ProjectionGenerationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'projection_name', type: 'varchar', length: 64 })
  projectionName!: string;

  @Column({ name: 'generation_id', type: 'varchar', length: 64 })
  generationId!: string;

  @Column({
    name: 'previous_generation_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  previousGenerationId!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'BUILDING' })
  status!: 'BUILDING' | 'ACTIVE' | 'SUPERSEDED' | 'FAILED';

  @Column({ name: 'from_date', type: 'date', nullable: true })
  fromDate!: string | null;

  @Column({ name: 'to_date', type: 'date', nullable: true })
  toDate!: string | null;

  @Column({ name: 'orders_replayed', type: 'integer', default: 0 })
  ordersReplayed!: number;

  @Column({ name: 'returns_replayed', type: 'integer', default: 0 })
  returnsReplayed!: number;

  @Column({ name: 'triggered_by', type: 'varchar', length: 128 })
  triggeredBy!: string;

  @Column({ name: 'reason', type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;
}

@Entity('reconciliation_runs')
export class InsightReconciliationRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'scope', type: 'varchar', length: 64 })
  scope!: string;

  @Column({ name: 'from_date', type: 'date' })
  fromDate!: string;

  @Column({ name: 'to_date', type: 'date' })
  toDate!: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'RUNNING' })
  status!: 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ISSUES' | 'FAILED';

  @Column({ name: 'metrics_checked', type: 'integer', default: 0 })
  metricsChecked!: number;

  @Column({ name: 'discrepancies_found', type: 'integer', default: 0 })
  discrepanciesFound!: number;

  @Column({
    name: 'summary_report',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  summaryReport!: Record<string, unknown>;

  @Column({ name: 'triggered_by', type: 'varchar', length: 128 })
  triggeredBy!: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}

@Entity('reconciliation_issues')
export class InsightReconciliationIssueEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ name: 'scope', type: 'varchar', length: 64 })
  scope!: string;

  @Column({ name: 'metric_name', type: 'varchar', length: 64 })
  metricName!: string;

  @Column({ name: 'dimension_key', type: 'varchar', length: 255 })
  dimensionKey!: string;

  @Column({ name: 'expected_value', type: 'numeric', precision: 18, scale: 4 })
  expectedValue!: string;

  @Column({ name: 'actual_value', type: 'numeric', precision: 18, scale: 4 })
  actualValue!: string;

  @Column({ name: 'delta_value', type: 'numeric', precision: 18, scale: 4 })
  deltaValue!: string;

  @Column({ name: 'severity', type: 'varchar', length: 16, default: 'HIGH' })
  severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @Column({ name: 'details', type: 'jsonb', default: () => "'{}'::jsonb" })
  details!: Record<string, unknown>;

  @Column({ name: 'detected_at', type: 'timestamptz' })
  detectedAt!: Date;
}

@Entity('report_export_jobs')
export class ReportExportJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'report_type', type: 'varchar', length: 64 })
  reportType!: string;

  @Column({ name: 'format', type: 'varchar', length: 16 })
  format!: 'CSV' | 'XLSX' | 'PDF';

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'PENDING' })
  status!: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

  @Column({ name: 'filters', type: 'jsonb', default: () => "'{}'::jsonb" })
  filters!: Record<string, unknown>;

  @Column({ name: 'allowed_branch_ids', type: 'jsonb', nullable: true })
  allowedBranchIds!: string[] | null;

  @Column({
    name: 'snapshot_generation_id',
    type: 'varchar',
    length: 64,
    default: 'gen-active',
  })
  snapshotGenerationId!: string;

  @Column({ name: 'snapshot_version', type: 'bigint', default: 1 })
  snapshotVersion!: string;

  @Column({ name: 'snapshot_as_of', type: 'timestamptz' })
  snapshotAsOf!: Date;

  @Column({ name: 'row_count', type: 'integer', default: 0 })
  rowCount!: number;

  @Column({ name: 'byte_size', type: 'integer', default: 0 })
  byteSize!: number;

  @Column({
    name: 'content_type',
    type: 'varchar',
    length: 128,
    default: 'text/csv',
  })
  contentType!: string;

  @Column({
    name: 'file_name',
    type: 'varchar',
    length: 255,
    default: 'export.csv',
  })
  fileName!: string;

  @Column({ name: 'file_content_base64', type: 'text', nullable: true })
  fileContentBase64!: string | null;

  @Column({
    name: 'checksum_sha256',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  checksumSha256!: string | null;

  @Column({ name: 'requested_by', type: 'varchar', length: 128 })
  requestedBy!: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;
}

export const M7_INSIGHT_ENTITIES = [
  InsightDimensionCacheEntity,
  SalesOrderFactEntity,
  SalesOrderLineFactEntity,
  SalesReturnFactEntity,
  DailySalesSummaryEntity,
  ProductSalesSummaryEntity,
  EmployeeSalesSummaryEntity,
  ChannelSalesSummaryEntity,
  CustomerGroupSalesSummaryEntity,
  InventoryStockProjectionEntity,
  InventoryValueSnapshotEntity,
  InventoryMovementProjectionEntity,
  ProjectionCheckpointEntity,
  ProjectionGenerationEntity,
  InsightReconciliationRunEntity,
  InsightReconciliationIssueEntity,
  ReportExportJobEntity,
];
