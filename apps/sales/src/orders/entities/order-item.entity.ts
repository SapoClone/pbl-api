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

  @Column({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null;

  @Column({
    name: 'variant_label',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  variantLabel?: string | null;

  @Column({ name: 'unit_code', type: 'varchar', length: 32, default: 'PCS' })
  unitCode?: string;

  @Column({
    name: 'conversion_factor',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: '1.0000',
  })
  conversionFactor?: string;

  @Column({
    name: 'qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '1.000',
  })
  qty?: string;

  @Column({
    name: 'base_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '1.000',
  })
  baseQty?: string;

  @Column({
    name: 'line_gross',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  lineGross?: string;

  @Column({
    name: 'item_discount_type',
    type: 'varchar',
    length: 16,
    default: 'NONE',
  })
  itemDiscountType?: string;

  @Column({
    name: 'item_discount_value',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  itemDiscountValue?: string;

  @Column({
    name: 'item_discount_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  itemDiscountAmount?: string;

  @Column({
    name: 'allocated_order_discount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  allocatedOrderDiscount?: string;

  @Column({
    name: 'line_net',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  lineNet?: string;

  @Column({
    name: 'tax_rate',
    type: 'numeric',
    precision: 6,
    scale: 2,
    default: '0.00',
  })
  taxRate?: string;

  @Column({
    name: 'tax_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  taxAmount?: string;

  @Column({
    name: 'unit_cost_snapshot',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  unitCostSnapshot?: string;

  @Column({
    name: 'returned_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '0.000',
  })
  returnedQty?: string;

  @Column({
    name: 'refunded_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  refundedAmount?: string;

  @ManyToOne(() => OrderEntity, (order) => order.items)
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'FK_order_items_order',
  })
  order?: Relation<OrderEntity>;
}
