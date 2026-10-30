import { WarehouseReservationState } from '@pbl/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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

@Entity('warehouse')
export class WarehouseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('stock_balance')
export class StockBalanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({
    name: 'on_hand_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '0.000',
  })
  onHandQty!: string;

  @Column({
    name: 'reserved_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '0.000',
  })
  reservedQty!: string;

  @Column({
    name: 'in_transit_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '0.000',
  })
  inTransitQty!: string;

  @Column({ type: 'bigint', default: '0' })
  version!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('warehouse_reservation')
export class WarehouseReservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'caller_service', type: 'varchar', length: 32 })
  callerService!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'request_sha256', type: 'char', length: 64 })
  requestSha256!: string;

  @Column({ name: 'source_ref_type', type: 'varchar', length: 32 })
  sourceRefType!: 'ORDER' | 'TRANSFER' | 'RETURN';

  @Column({ name: 'source_ref_id', type: 'uuid' })
  sourceRefId!: string;

  @Column({ type: 'varchar', length: 16 })
  state!: WarehouseReservationState;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => WarehouseReservationLineEntity, (line) => line.reservation)
  lines?: WarehouseReservationLineEntity[];
}

@Entity('warehouse_reservation_line')
export class WarehouseReservationLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'reservation_id', type: 'uuid' })
  reservationId!: string;

  @Column({ name: 'line_no', type: 'int' })
  lineNo!: number;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3 })
  qty!: string;

  @ManyToOne(() => WarehouseReservationEntity, (res) => res.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'reservation_id' })
  reservation?: WarehouseReservationEntity;
}

@Entity('stock_balance_ledger')
export class StockBalanceLedgerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({ name: 'movement_type', type: 'varchar', length: 32 })
  movementType!: string;

  @Column({ name: 'qty_delta', type: 'numeric', precision: 18, scale: 3 })
  qtyDelta!: string;

  @Column({ name: 'on_hand_after', type: 'numeric', precision: 18, scale: 3 })
  onHandAfter!: string;

  @Column({ name: 'reserved_after', type: 'numeric', precision: 18, scale: 3 })
  reservedAfter!: string;

  @Column({ name: 'reference_type', type: 'varchar', length: 32 })
  referenceType!: string;

  @Column({ name: 'reference_id', type: 'uuid' })
  referenceId!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const WAREHOUSE_STOCK_ENTITIES = [
  WarehouseEntity,
  StockBalanceEntity,
  WarehouseReservationEntity,
  WarehouseReservationLineEntity,
  StockBalanceLedgerEntity,
];
