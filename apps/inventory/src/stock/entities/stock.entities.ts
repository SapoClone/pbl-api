import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Stock of one SKU in one branch. The database refuses `onHand < reserved` or a negative hold. */
@Entity('stock_item')
@Index('UQ_stock_item_tenant_branch_sku', ['tenantId', 'branchId', 'sku'], {
  unique: true,
})
export class StockItemEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_stock_item_id' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ type: 'varchar', length: 64 })
  sku!: string;

  @Column({ name: 'quantity_on_hand', type: 'int', default: 0 })
  quantityOnHand!: number;

  /** Held for orders that are not completed yet */
  @Column({ name: 'quantity_reserved', type: 'int', default: 0 })
  quantityReserved!: number;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

export type ReservationStatus = 'held' | 'committed' | 'released' | 'expired';

/** The hold of one order; `(tenantId, orderId)` is its idempotency key */
@Entity('stock_reservation')
@Index('UQ_stock_reservation_tenant_order', ['tenantId', 'orderId'], {
  unique: true,
})
export class StockReservationEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_stock_reservation_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: ReservationStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}

@Entity('stock_reservation_item')
@Index('IDX_stock_reservation_item_reservation', ['reservationId'])
export class StockReservationItemEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_stock_reservation_item_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'reservation_id', type: 'uuid' })
  reservationId!: string;

  @Column({ type: 'varchar', length: 64 })
  sku!: string;

  @Column({ type: 'int' })
  quantity!: number;
}

/** Every change of `quantity_on_hand`, with the balance after it */
@Entity('inventory_ledger')
@Index('IDX_inventory_ledger_tenant_branch_sku', [
  'tenantId',
  'branchId',
  'sku',
  'createdAt',
])
export class InventoryLedgerEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_inventory_ledger_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ type: 'varchar', length: 64 })
  sku!: string;

  @Column({ name: 'change_qty', type: 'int' })
  changeQty!: number;

  @Column({ name: 'balance_after', type: 'int' })
  balanceAfter!: number;

  /** `receipt` or `sale` */
  @Column({ name: 'ref_type', type: 'varchar', length: 20 })
  refType!: string;

  @Column({ name: 'ref_id', type: 'uuid' })
  refId!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
