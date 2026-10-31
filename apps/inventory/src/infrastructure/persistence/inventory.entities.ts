import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('catalog_sku_projection')
export class CatalogSkuProjectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'sku_code', type: 'varchar', length: 64 })
  skuCode!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'base_unit', type: 'varchar', length: 32, default: 'PCS' })
  baseUnit!: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

  @Column({ name: 'aggregate_version', type: 'int', default: 1 })
  aggregateVersion!: number;

  @Column({ name: 'source_updated_at', type: 'timestamptz' })
  sourceUpdatedAt!: Date;

  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' })
  syncedAt!: Date;
}

@Entity('stock_threshold')
export class StockThresholdEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({
    name: 'min_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '0.000',
  })
  minQty!: string;

  @Column({
    name: 'max_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    nullable: true,
  })
  maxQty!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('supplier')
export class SupplierEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('purchase_order')
export class PurchaseOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 24, default: 'DRAFT' })
  status!:
    | 'DRAFT'
    | 'APPROVED'
    | 'PARTIALLY_RECEIVED'
    | 'RECEIVED'
    | 'CANCELLED';

  @Column({
    name: 'total_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  totalAmount!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'approved_by', type: 'varchar', length: 64, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('purchase_order_item')
export class PurchaseOrderItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'purchase_order_id', type: 'uuid' })
  purchaseOrderId!: string;

  @Column({ name: 'line_no', type: 'int' })
  lineNo!: number;

  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({ name: 'ordered_qty', type: 'numeric', precision: 18, scale: 3 })
  orderedQty!: string;

  @Column({
    name: 'received_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '0.000',
  })
  receivedQty!: string;

  @Column({
    name: 'unit_cost',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  unitCost!: string;

  @Column({ name: 'unit_name', type: 'varchar', length: 32, default: 'PCS' })
  unitName!: string;

  @Column({
    name: 'conversion_factor',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: '1.0000',
  })
  conversionFactor!: string;
}

@Entity('stock_receipt')
export class StockReceiptEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({
    name: 'source_type',
    type: 'varchar',
    length: 24,
    default: 'MANUAL',
  })
  sourceType!: 'MANUAL' | 'PURCHASE_ORDER' | 'RETURN' | 'ADJUSTMENT';

  @Column({ name: 'purchase_order_id', type: 'uuid', nullable: true })
  purchaseOrderId!: string | null;

  @Column({ name: 'supplier_id', type: 'uuid', nullable: true })
  supplierId!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'DRAFT' })
  status!: 'DRAFT' | 'POSTED' | 'CANCELLED';

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  idempotencyKey!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'posted_by', type: 'varchar', length: 64, nullable: true })
  postedBy!: string | null;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('stock_receipt_item')
export class StockReceiptItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'receipt_id', type: 'uuid' })
  receiptId!: string;

  @Column({ name: 'line_no', type: 'int' })
  lineNo!: number;

  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3 })
  qty!: string;

  @Column({
    name: 'unit_cost',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  unitCost!: string;

  @Column({ name: 'unit_name', type: 'varchar', length: 32, default: 'PCS' })
  unitName!: string;

  @Column({
    name: 'conversion_factor',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: '1.0000',
  })
  conversionFactor!: string;
}

@Entity('stock_issue')
export class StockIssueEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({
    name: 'reason_code',
    type: 'varchar',
    length: 32,
    default: 'MANUAL_WITHDRAWAL',
  })
  reasonCode!:
    | 'MANUAL_WITHDRAWAL'
    | 'DAMAGED'
    | 'DISPOSAL'
    | 'SAMPLE'
    | 'SUPPLIER_RETURN';

  @Column({ type: 'varchar', length: 16, default: 'DRAFT' })
  status!: 'DRAFT' | 'POSTED' | 'CANCELLED';

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  idempotencyKey!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'posted_by', type: 'varchar', length: 64, nullable: true })
  postedBy!: string | null;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('stock_issue_item')
export class StockIssueItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'issue_id', type: 'uuid' })
  issueId!: string;

  @Column({ name: 'line_no', type: 'int' })
  lineNo!: number;

  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3 })
  qty!: string;

  @Column({
    name: 'unit_cost',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  unitCost!: string;
}

@Entity('stock_transfer')
export class StockTransferEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ name: 'from_warehouse_id', type: 'uuid' })
  fromWarehouseId!: string;

  @Column({ name: 'to_warehouse_id', type: 'uuid' })
  toWarehouseId!: string;

  @Column({ type: 'varchar', length: 24, default: 'DRAFT' })
  status!:
    | 'DRAFT'
    | 'DISPATCHED'
    | 'PARTIALLY_RECEIVED'
    | 'RECEIVED'
    | 'DISCREPANCY'
    | 'CANCELLED';

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({
    name: 'dispatched_by',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  dispatchedBy!: string | null;

  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatchedAt!: Date | null;

  @Column({ name: 'received_by', type: 'varchar', length: 64, nullable: true })
  receivedBy!: string | null;

  @Column({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt!: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('stock_transfer_item')
export class StockTransferItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'transfer_id', type: 'uuid' })
  transferId!: string;

  @Column({ name: 'line_no', type: 'int' })
  lineNo!: number;

  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({ name: 'transfer_qty', type: 'numeric', precision: 18, scale: 3 })
  transferQty!: string;

  @Column({
    name: 'dispatched_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '0.000',
  })
  dispatchedQty!: string;

  @Column({
    name: 'received_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '0.000',
  })
  receivedQty!: string;

  @Column({
    name: 'discrepancy_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '0.000',
  })
  discrepancyQty!: string;

  @Column({
    name: 'unit_cost',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  unitCost!: string;

  @Column({ name: 'discrepancy_reason', type: 'text', nullable: true })
  discrepancyReason!: string | null;
}

@Entity('stock_take')
export class StockTakeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status!: 'DRAFT' | 'COUNTING' | 'APPROVED' | 'CANCELLED';

  @Column({ name: 'freeze_movement', type: 'boolean', default: false })
  freezeMovement!: boolean;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'approved_by', type: 'varchar', length: 64, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('stock_take_item')
export class StockTakeItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'stock_take_id', type: 'uuid' })
  stockTakeId!: string;

  @Column({ name: 'line_no', type: 'int' })
  lineNo!: number;

  @Column({ name: 'sku_id', type: 'uuid' })
  skuId!: string;

  @Column({
    name: 'snapshot_on_hand_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '0.000',
  })
  snapshotOnHandQty!: string;

  @Column({
    name: 'snapshot_reserved_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    default: '0.000',
  })
  snapshotReservedQty!: string;

  @Column({ name: 'snapshot_version', type: 'bigint', default: '0' })
  snapshotVersion!: string;

  @Column({
    name: 'counted_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    nullable: true,
  })
  countedQty!: string | null;

  @Column({
    name: 'variance_qty',
    type: 'numeric',
    precision: 18,
    scale: 3,
    nullable: true,
  })
  varianceQty!: string | null;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;
}

export const M2_INVENTORY_ENTITIES = [
  CatalogSkuProjectionEntity,
  StockThresholdEntity,
  SupplierEntity,
  PurchaseOrderEntity,
  PurchaseOrderItemEntity,
  StockReceiptEntity,
  StockReceiptItemEntity,
  StockIssueEntity,
  StockIssueItemEntity,
  StockTransferEntity,
  StockTransferItemEntity,
  StockTakeEntity,
  StockTakeItemEntity,
];
