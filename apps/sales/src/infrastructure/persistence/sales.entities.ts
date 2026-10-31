import { Column, Entity, PrimaryColumn } from 'typeorm';
import { discountValueTransformer, moneyTransformer } from '../../common/money';

@Entity({ name: 'sales_code_sequence' })
export class SalesCodeSequenceEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'seq_key', type: 'varchar', length: 64 })
  seqKey!: string;

  @Column({ name: 'last_value', type: 'bigint', default: 0 })
  lastValue!: string;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity({ name: 'catalog_variant_projection' })
export class CatalogVariantProjectionEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'variant_id', type: 'uuid' })
  variantId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @Column({ name: 'sku_code', type: 'varchar', length: 64 })
  skuCode!: string;

  @Column({ name: 'barcode', type: 'varchar', length: 64, nullable: true })
  barcode!: string | null;

  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  productName!: string;

  @Column({ name: 'variant_name', type: 'varchar', length: 255 })
  variantName!: string;

  @Column({ name: 'unit_code', type: 'varchar', length: 32, default: 'PCS' })
  unitCode!: string;

  @Column({
    name: 'conversion_factor',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: '1.0000',
  })
  conversionFactor!: string;

  @Column({
    name: 'unit_price',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  unitPrice!: number;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: string;

  @Column({ name: 'aggregate_version', type: 'int', default: 1 })
  aggregateVersion!: number;

  @Column({ name: 'source_updated_at', type: 'timestamptz' })
  sourceUpdatedAt!: Date;

  @Column({ name: 'synced_at', type: 'timestamptz' })
  syncedAt!: Date;
}

@Entity({ name: 'order_status_history' })
export class OrderStatusHistoryEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({
    name: 'from_order_status',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  fromOrderStatus!: string | null;

  @Column({ name: 'to_order_status', type: 'varchar', length: 24 })
  toOrderStatus!: string;

  @Column({
    name: 'from_payment_status',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  fromPaymentStatus!: string | null;

  @Column({ name: 'to_payment_status', type: 'varchar', length: 24 })
  toPaymentStatus!: string;

  @Column({
    name: 'from_fulfillment_status',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  fromFulfillmentStatus!: string | null;

  @Column({ name: 'to_fulfillment_status', type: 'varchar', length: 24 })
  toFulfillmentStatus!: string;

  @Column({ name: 'reason', type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ name: 'actor_id', type: 'varchar', length: 64, nullable: true })
  actorId!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity({ name: 'pos_shifts' })
export class PosShiftEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'code', type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({
    name: 'register_code',
    type: 'varchar',
    length: 32,
    default: 'REG-01',
  })
  registerCode!: string;

  @Column({ name: 'staff_id', type: 'uuid' })
  staffId!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'OPEN' })
  status!: string;

  @Column({
    name: 'opening_cash',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  openingCash!: number;

  @Column({
    name: 'cash_sales_total',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  cashSalesTotal!: number;

  @Column({
    name: 'cash_refunds_total',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  cashRefundsTotal!: number;

  @Column({
    name: 'expected_cash',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  expectedCash!: number;

  @Column({
    name: 'actual_cash',
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  })
  actualCash!: number | null;

  @Column({
    name: 'variance',
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  })
  variance!: number | null;

  @Column({ name: 'open_note', type: 'text', nullable: true })
  openNote!: string | null;

  @Column({ name: 'close_note', type: 'text', nullable: true })
  closeNote!: string | null;

  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy!: string | null;

  @Column({ name: 'opened_at', type: 'timestamptz' })
  openedAt!: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'version', type: 'int', default: 1 })
  version!: number;
}

@Entity({ name: 'pos_drafts' })
export class PosDraftEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId!: string | null;

  @Column({ name: 'shift_id', type: 'uuid', nullable: true })
  shiftId!: string | null;

  @Column({ name: 'staff_id', type: 'uuid' })
  staffId!: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({
    name: 'customer_name',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  customerName!: string | null;

  @Column({ name: 'title', type: 'varchar', length: 120, nullable: true })
  title!: string | null;

  @Column({ name: 'lines_json', type: 'jsonb' })
  linesJson!: unknown[];

  @Column({
    name: 'order_discount_type',
    type: 'varchar',
    length: 16,
    default: 'NONE',
  })
  orderDiscountType!: string;

  /** FIXED: whole VND; PERCENT: a percentage (see discountValueTransformer) */
  @Column({
    name: 'order_discount_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: discountValueTransformer,
  })
  orderDiscountValue!: number;

  @Column({ name: 'coupon_code', type: 'varchar', length: 64, nullable: true })
  couponCode!: string | null;

  @Column({
    name: 'payment_method',
    type: 'varchar',
    length: 32,
    default: 'CASH',
  })
  paymentMethod!: string;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity({ name: 'order_tenders' })
export class OrderTenderEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'checkout_id', type: 'uuid', nullable: true })
  checkoutId!: string | null;

  @Column({ name: 'shift_id', type: 'uuid', nullable: true })
  shiftId!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'method', type: 'varchar', length: 24 })
  method!: string;

  @Column({
    name: 'amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  amount!: number;

  @Column({
    name: 'tendered_cash',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  tenderedCash!: number;

  @Column({
    name: 'change_due',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  changeDue!: number;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'CONFIRMED' })
  status!: string;

  @Column({
    name: 'external_ref',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  externalRef!: string | null;

  @Column({
    name: 'confirmed_by',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  confirmedBy!: string | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity({ name: 'sales_returns' })
export class SalesReturnEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'code', type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId!: string | null;

  @Column({ name: 'shift_id', type: 'uuid', nullable: true })
  shiftId!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 24, default: 'REQUESTED' })
  status!: string;

  @Column({
    name: 'total_refund_amount',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  totalRefundAmount!: number;

  @Column({ name: 'inventory_receipt_id', type: 'uuid', nullable: true })
  inventoryReceiptId!: string | null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'requested_by', type: 'varchar', length: 64 })
  requestedBy!: string;

  @Column({ name: 'approved_by', type: 'varchar', length: 64, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'received_by', type: 'varchar', length: 64, nullable: true })
  receivedBy!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity({ name: 'sales_return_items' })
export class SalesReturnItemEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'return_id', type: 'uuid' })
  returnId!: string;

  @Column({ name: 'order_item_id', type: 'uuid' })
  orderItemId!: string;

  @Column({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId!: string | null;

  @Column({ name: 'sku_code', type: 'varchar', length: 64 })
  skuCode!: string;

  @Column({ name: 'product_name', type: 'varchar', length: 200 })
  productName!: string;

  @Column({ name: 'return_qty', type: 'numeric', precision: 18, scale: 3 })
  returnQty!: string;

  @Column({
    name: 'unit_refund_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  unitRefundAmount!: number;

  @Column({
    name: 'refund_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  refundAmount!: number;

  @Column({
    name: 'disposition',
    type: 'varchar',
    length: 24,
    default: 'RESTOCK',
  })
  disposition!: string;

  @Column({ name: 'reason', type: 'varchar', length: 255, nullable: true })
  reason!: string | null;
}

@Entity({ name: 'refund_requests' })
export class RefundRequestEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'return_id', type: 'uuid' })
  returnId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'shift_id', type: 'uuid', nullable: true })
  shiftId!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({
    name: 'amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  amount!: number;

  @Column({ name: 'method', type: 'varchar', length: 24, default: 'CASH' })
  method!: string;

  @Column({ name: 'status', type: 'varchar', length: 24, default: 'PENDING' })
  status!: string;

  @Column({
    name: 'external_settlement_ref',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  externalSettlementRef!: string | null;

  @Column({ name: 'requested_by', type: 'varchar', length: 64 })
  requestedBy!: string;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity({ name: 'order_fulfillments' })
export class OrderFulfillmentEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'code', type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId!: string | null;

  @Column({ name: 'reservation_id', type: 'uuid', nullable: true })
  reservationId!: string | null;

  @Column({
    name: 'fulfillment_type',
    type: 'varchar',
    length: 24,
    default: 'POS_PICKUP',
  })
  fulfillmentType!: string;

  @Column({ name: 'status', type: 'varchar', length: 24, default: 'PENDING' })
  status!: string;

  @Column({
    name: 'carrier_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  carrierCode!: string | null;

  @Column({
    name: 'tracking_number',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  trackingNumber!: string | null;

  @Column({ name: 'shipped_at', type: 'timestamptz', nullable: true })
  shippedAt!: Date | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64, nullable: true })
  createdBy!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity({ name: 'fulfillment_items' })
export class FulfillmentItemEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'fulfillment_id', type: 'uuid' })
  fulfillmentId!: string;

  @Column({ name: 'order_item_id', type: 'uuid' })
  orderItemId!: string;

  @Column({ name: 'sku_code', type: 'varchar', length: 64 })
  skuCode!: string;

  @Column({ name: 'qty', type: 'numeric', precision: 18, scale: 3 })
  qty!: string;
}

@Entity({ name: 'promotions' })
export class PromotionEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'code', type: 'varchar', length: 48 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 160 })
  name!: string;

  @Column({ name: 'discount_type', type: 'varchar', length: 16 })
  discountType!: string;

  /** FIXED: whole VND; PERCENT: a percentage (see discountValueTransformer) */
  @Column({
    name: 'discount_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: discountValueTransformer,
  })
  discountValue!: number;

  @Column({
    name: 'min_order_amount',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  minOrderAmount!: number;

  @Column({
    name: 'max_discount_amount',
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  })
  maxDiscountAmount!: number | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt!: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt!: Date | null;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity({ name: 'coupons' })
export class CouponEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'promotion_id', type: 'uuid' })
  promotionId!: string;

  @Column({ name: 'code', type: 'varchar', length: 48 })
  code!: string;

  @Column({ name: 'max_uses', type: 'int', nullable: true })
  maxUses!: number | null;

  @Column({ name: 'max_uses_per_customer', type: 'int', nullable: true })
  maxUsesPerCustomer!: number | null;

  @Column({ name: 'used_count', type: 'int', default: 0 })
  usedCount!: number;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity({ name: 'coupon_usages' })
export class CouponUsageEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'coupon_id', type: 'uuid' })
  couponId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({
    name: 'discount_amount',
    type: 'bigint',
    transformer: moneyTransformer,
  })
  discountAmount!: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export const M3_SALES_ENTITIES = [
  SalesCodeSequenceEntity,
  CatalogVariantProjectionEntity,
  OrderStatusHistoryEntity,
  PosShiftEntity,
  PosDraftEntity,
  OrderTenderEntity,
  SalesReturnEntity,
  SalesReturnItemEntity,
  RefundRequestEntity,
  OrderFulfillmentEntity,
  FulfillmentItemEntity,
  PromotionEntity,
  CouponEntity,
  CouponUsageEntity,
];
