import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  Relation,
} from 'typeorm';
import { discountValueTransformer, moneyTransformer } from '../../common/money';
import { OrderItemEntity } from './order-item.entity';

/** Kept for existing imports: bigint money columns share the service's money transformer */
export const bigintNumber = moneyTransformer;

@Entity('orders')
@Index('UQ_orders_tenant_code', ['tenantId', 'code'], { unique: true })
@Index('IDX_orders_tenant_created', ['tenantId', 'createdAt'])
@Index('UQ_orders_tenant_idempotency_key', ['tenantId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL',
})
export class OrderEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_orders_id' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  /** Bare id of a platform branch, checked against the branch projection */
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ type: 'varchar', length: 20, default: 'completed' })
  status!: string;

  @Column({ name: 'payment_method', type: 'varchar', length: 20 })
  paymentMethod!: string;

  @Column({
    name: 'customer_name',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  customerName!: string | null;

  @Column({ name: 'total_amount', type: 'bigint', transformer: bigintNumber })
  totalAmount!: number;

  @Column({ name: 'item_count', type: 'int' })
  itemCount!: number;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  /** The client's Idempotency-Key: one sale attempt is one order */
  @Column({ name: 'idempotency_key', type: 'uuid', nullable: true })
  idempotencyKey!: string | null;

  /** Hash of the request that created the order, to tell a retry from a reused key */
  @Column({ name: 'request_hash', type: 'varchar', length: 64, nullable: true })
  requestHash!: string | null;

  @Column({ name: 'channel_type', type: 'varchar', length: 24, default: 'POS' })
  channelType?: string;

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId?: string | null;

  @Column({
    name: 'source_connection_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  sourceConnectionId?: string | null;

  @Column({
    name: 'external_order_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  externalOrderId?: string | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string | null;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null;

  @Column({ name: 'shift_id', type: 'uuid', nullable: true })
  shiftId?: string | null;

  @Column({
    name: 'order_status',
    type: 'varchar',
    length: 24,
    default: 'COMPLETED',
  })
  orderStatus?: string;

  @Column({
    name: 'payment_status',
    type: 'varchar',
    length: 24,
    default: 'PAID',
  })
  paymentStatus?: string;

  @Column({
    name: 'fulfillment_status',
    type: 'varchar',
    length: 24,
    default: 'FULFILLED',
  })
  fulfillmentStatus?: string;

  @Column({
    name: 'subtotal',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  subtotal?: number;

  @Column({
    name: 'item_discount_total',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  itemDiscountTotal?: number;

  @Column({
    name: 'order_discount_type',
    type: 'varchar',
    length: 16,
    default: 'NONE',
  })
  orderDiscountType?: string;

  /** FIXED: whole VND; PERCENT: a percentage */
  @Column({
    name: 'order_discount_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: discountValueTransformer,
  })
  orderDiscountValue?: number;

  @Column({
    name: 'order_discount_total',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  orderDiscountTotal?: number;

  @Column({
    name: 'promotion_discount_total',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  promotionDiscountTotal?: number;

  @Column({ name: 'coupon_code', type: 'varchar', length: 64, nullable: true })
  couponCode?: string | null;

  @Column({
    name: 'shipping_fee',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  shippingFee?: number;

  @Column({
    name: 'tax_total',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  taxTotal?: number;

  @Column({
    name: 'grand_total',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  grandTotal?: number;

  @Column({
    name: 'paid_amount',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  paidAmount?: number;

  @Column({
    name: 'refunded_amount',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  refundedAmount?: number;

  @Column({ name: 'currency', type: 'varchar', length: 8, default: 'VND' })
  currency?: string;

  @Column({ name: 'reservation_id', type: 'uuid', nullable: true })
  reservationId?: string | null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note?: string | null;

  @Column({
    name: 'cancel_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  cancelReason?: string | null;

  @Column({ name: 'version', type: 'int', default: 1 })
  version?: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt?: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  /** `PACKING` or `SHIPPING` while the order is being handed over; null before and after (screen contract) */
  @Column({
    name: 'fulfillment_stage',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  fulfillmentStage?: string | null;

  /** `sku_unmapped` or `stock_shortage` while a marketplace order needs a human */
  @Column({
    name: 'exception_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  exceptionCode?: string | null;

  @OneToMany(() => OrderItemEntity, (item) => item.order)
  items?: Relation<OrderItemEntity[]>;
}

export type CheckoutWorkflowState =
  | 'PENDING_STOCK'
  | 'RESERVING'
  | 'RESERVING_STOCK'
  | 'STOCK_RESERVED'
  | 'AWAITING_PAYMENT'
  | 'COMMITTING_STOCK'
  | 'FINALIZING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'RECOVERY_PENDING'
  | 'REQUIRES_RECONCILIATION'
  | 'REJECTED'
  | 'CANCELLED';

export interface CheckoutWorkflowLine {
  variantId: string;
  sku: string;
  name: string;
  qty: string;
  unitPrice: number;
}

@Entity('checkout_workflow')
@Index(
  'UQ_checkout_workflow_tenant_idempotency',
  ['tenantId', 'idempotencyKey'],
  { unique: true },
)
export class CheckoutWorkflowEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_checkout_workflow_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'request_sha256', type: 'char', length: 64 })
  requestSha256!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ name: 'payment_method', type: 'varchar', length: 32 })
  paymentMethod!: string;

  @Column({
    name: 'customer_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  customerName!: string | null;

  @Column({ name: 'lines_json', type: 'jsonb' })
  linesJson!: CheckoutWorkflowLine[];

  @Column({
    name: 'total_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  totalAmount!: number;

  @Column({ name: 'state', type: 'varchar', length: 32 })
  state!: CheckoutWorkflowState;

  @Column({
    name: 'reservation_idempotency_key',
    type: 'varchar',
    length: 128,
  })
  reservationIdempotencyKey!: string;

  @Column({ name: 'reservation_id', type: 'uuid', nullable: true })
  reservationId!: string | null;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'shift_id', type: 'uuid', nullable: true })
  shiftId?: string | null;

  @Column({ name: 'draft_id', type: 'uuid', nullable: true })
  draftId?: string | null;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null;

  @Column({ name: 'coupon_code', type: 'varchar', length: 64, nullable: true })
  couponCode?: string | null;

  @Column({ name: 'quote_json', type: 'jsonb', nullable: true })
  quoteJson?: unknown | null;

  @Column({ name: 'tenders_json', type: 'jsonb', nullable: true })
  tendersJson?: unknown | null;

  @Column({ name: 'commit_confirmed', type: 'boolean', default: false })
  commitConfirmed?: boolean;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount?: number;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
