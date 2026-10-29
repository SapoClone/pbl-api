import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  Relation,
} from 'typeorm';
import { OrderItemEntity } from './order-item.entity';

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

  @OneToMany(() => OrderItemEntity, (item) => item.order)
  items?: Relation<OrderItemEntity[]>;
}

export type CheckoutWorkflowState =
  | 'PENDING_STOCK'
  | 'RESERVING'
  | 'STOCK_RESERVED'
  | 'CONFIRMED'
  | 'RECOVERY_PENDING'
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

  @Column({ name: 'total_amount', type: 'int' })
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

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
