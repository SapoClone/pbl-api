import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** One row per status change on one of the three axes */
@Entity('order_status_history')
@Index('IDX_order_status_history_tenant_order', [
  'tenantId',
  'orderId',
  'createdAt',
])
export class OrderStatusHistoryEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_order_status_history_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  /** `order`, `fulfillment` or `payment` */
  @Column({ name: 'status_type', type: 'varchar', length: 20 })
  statusType!: string;

  @Column({ name: 'old_status', type: 'varchar', length: 20, nullable: true })
  oldStatus!: string | null;

  @Column({ name: 'new_status', type: 'varchar', length: 20 })
  newStatus!: string;

  /** Account id; null for the system */
  @Column({ name: 'changed_by', type: 'uuid', nullable: true })
  changedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
