import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  Relation,
} from 'typeorm';
import { OrderItemEntity } from './order-item.entity';
import type { OrderPaymentEntity } from './order-payment.entity';

/** bigint columns come back as strings; money is integer VND (api-conventions §3) */
export const bigintNumber = {
  to: (value?: number) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : Number(value),
};

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

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  /** `payment_status`, `fulfillment_status`: only sales writes them (ADR-0010) */
  @Column({
    name: 'payment_status',
    type: 'varchar',
    length: 20,
    default: 'unpaid',
  })
  paymentStatus!: string;

  @Column({
    name: 'fulfillment_status',
    type: 'varchar',
    length: 20,
    default: 'unfulfilled',
  })
  fulfillmentStatus!: string;

  /** `sku_unmapped` or `stock_shortage` while the order needs action */
  @Column({
    name: 'exception_code',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  exceptionCode!: string | null;

  /** `pos` or `manual` (marketplace orders arrive later) */
  @Column({ type: 'varchar', length: 20, default: 'pos' })
  source!: string;

  /** Stable code of the sales channel (`pos`, `manual`, `website`, ...) */
  @Column({ type: 'varchar', length: 30, default: 'pos' })
  channel!: string;

  /** Bare id of a customer-service customer */
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({
    name: 'customer_phone',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  customerPhone!: string | null;

  @Column({
    name: 'shipping_recipient',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  shippingRecipient!: string | null;

  @Column({
    name: 'shipping_phone',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  shippingPhone!: string | null;

  @Column({
    name: 'shipping_address_line',
    type: 'varchar',
    length: 250,
    nullable: true,
  })
  shippingAddressLine!: string | null;

  @Column({
    name: 'shipping_ward',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  shippingWard!: string | null;

  @Column({
    name: 'shipping_district',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  shippingDistrict!: string | null;

  @Column({
    name: 'shipping_province',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  shippingProvince!: string | null;

  @Column({
    name: 'shipping_provider_code',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  shippingProviderCode!: string | null;

  @Column({
    name: 'tracking_code',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  trackingCode!: string | null;

  /** `customer` or `shop` */
  @Column({
    name: 'shipping_fee_payer',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  shippingFeePayer!: string | null;

  @Column({
    type: 'bigint',
    default: 0,
    transformer: bigintNumber,
  })
  subtotal!: number;

  @Column({
    name: 'discount_amount',
    type: 'bigint',
    default: 0,
    transformer: bigintNumber,
  })
  discountAmount!: number;

  @Column({
    name: 'shipping_fee',
    type: 'bigint',
    default: 0,
    transformer: bigintNumber,
  })
  shippingFee!: number;

  @Column({
    name: 'paid_amount',
    type: 'bigint',
    default: 0,
    transformer: bigintNumber,
  })
  paidAmount!: number;

  /** Cash handed back at a POS checkout (paid more than the total) */
  @Column({
    name: 'change_amount',
    type: 'bigint',
    default: 0,
    transformer: bigintNumber,
  })
  changeAmount!: number;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason!: string | null;

  @Column({
    name: 'external_order_code',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  externalOrderCode!: string | null;

  /** Optimistic lock: every write through an action bumps it */
  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'shift_id', type: 'uuid', nullable: true })
  shiftId!: string | null;

  @Column({ name: 'register_id', type: 'uuid', nullable: true })
  registerId!: string | null;

  /** True while inventory holds this order's stock (so cancel knows to release) */
  @Column({ name: 'stock_reserved', type: 'boolean', default: false })
  stockReserved!: boolean;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @OneToMany(() => OrderItemEntity, (item) => item.order)
  items?: Relation<OrderItemEntity[]>;

  @OneToMany('OrderPaymentEntity', 'order')
  payments?: Relation<OrderPaymentEntity[]>;
}
