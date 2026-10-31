import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Relation,
} from 'typeorm';
import { bigintNumber, OrderEntity } from './order.entity';

/** A payment (positive) or a refund (negative) recorded on an order */
@Entity('order_payment')
@Index('IDX_order_payment_tenant_order', ['tenantId', 'orderId'])
export class OrderPaymentEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_order_payment_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ type: 'varchar', length: 20 })
  method!: string;

  /** Integer VND; negative for a refund */
  @Column({ type: 'bigint', transformer: bigintNumber })
  amount!: number;

  @Column({ name: 'paid_at', type: 'timestamptz', default: () => 'now()' })
  paidAt!: Date;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @ManyToOne(() => OrderEntity, (order) => order.payments)
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'FK_order_payment_order',
  })
  order?: Relation<OrderEntity>;
}
