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

@Entity('order_items')
@Index('IDX_order_items_tenant_order', ['tenantId', 'orderId'])
export class OrderItemEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_order_items_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  /** Bare catalog variant id; stored as sent, not validated (catalog is another service) */
  @Column({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  sku!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ name: 'unit_price', type: 'bigint', transformer: bigintNumber })
  unitPrice!: number;

  @Column({ name: 'line_total', type: 'bigint', transformer: bigintNumber })
  lineTotal!: number;

  @ManyToOne(() => OrderEntity, (order) => order.items)
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'FK_order_items_order',
  })
  order?: Relation<OrderEntity>;
}
