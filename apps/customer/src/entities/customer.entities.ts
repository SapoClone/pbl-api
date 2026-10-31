import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { bigintNumber } from '../common/errors';

export const GENDERS = ['female', 'male', 'other'] as const;
export const SOURCES = [
  'store',
  'shopee',
  'facebook',
  'website',
  'other',
] as const;
export const CUSTOMER_STATUSES = ['active', 'inactive'] as const;
export type Gender = (typeof GENDERS)[number];
export type CustomerSource = (typeof SOURCES)[number];
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** The four groups every store starts with (D5); `code` is stable, `name` can be renamed */
export const DEFAULT_GROUPS = [
  { code: 'retail', name: 'Khách lẻ' },
  { code: 'member', name: 'Thành viên' },
  { code: 'vip', name: 'VIP' },
  { code: 'wholesale', name: 'Sỉ' },
] as const;

/** Per-tenant counters behind the readable codes (D4) */
@Entity('code_sequence')
export class CodeSequenceEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'varchar', length: 30 })
  key!: string;

  @Column({ type: 'bigint', transformer: bigintNumber })
  value!: number;
}

@Entity('customer_group')
@Index('UQ_customer_group_tenant_code', ['tenantId', 'code'], { unique: true })
export class CustomerGroupEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_customer_group_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 40 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** One of the four defaults: it cannot be deleted */
  @Column({ name: 'is_seeded', type: 'boolean', default: false })
  isSeeded!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}

@Entity('customer')
@Index('UQ_customer_tenant_code', ['tenantId', 'code'], { unique: true })
@Index('IDX_customer_tenant_group', ['tenantId', 'groupId'])
export class CustomerEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_customer_id' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** KH000218, from the tenant's counter */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  /** Set when the member card is switched on; unique per tenant */
  @Column({ name: 'member_code', type: 'varchar', length: 20, nullable: true })
  memberCode!: string | null;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId!: string | null;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 20 })
  phone!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender!: Gender | null;

  @Column({ type: 'date', nullable: true })
  dob!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'store' })
  source!: CustomerSource;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: CustomerStatus;

  /** Read model of sales.order.completed */
  @Column({ name: 'order_count', type: 'int', default: 0 })
  orderCount!: number;

  @Column({
    name: 'total_spent',
    type: 'bigint',
    default: 0,
    transformer: bigintNumber,
  })
  totalSpent!: number;

  @Column({ name: 'last_purchase_at', type: 'timestamptz', nullable: true })
  lastPurchaseAt!: Date | null;

  /** The database refuses a negative balance */
  @Column({ name: 'points_balance', type: 'int', default: 0 })
  pointsBalance!: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt!: Date | null;
}

@Entity('customer_tag')
export class CustomerTagEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_customer_tag_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 60 })
  name!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}

@Entity('customer_tag_link')
export class CustomerTagLinkEntity {
  @PrimaryColumn({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @PrimaryColumn({ name: 'tag_id', type: 'uuid' })
  tagId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;
}

@Entity('customer_address')
@Index('IDX_customer_address_customer', ['customerId'])
export class CustomerAddressEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_customer_address_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'recipient_name', type: 'varchar', length: 150 })
  recipientName!: string;

  @Column({ type: 'varchar', length: 20 })
  phone!: string;

  @Column({ name: 'address_line', type: 'varchar', length: 255 })
  addressLine!: string;

  @Column({ type: 'varchar', length: 100 })
  ward!: string;

  @Column({ type: 'varchar', length: 100 })
  district!: string;

  @Column({ type: 'varchar', length: 100 })
  province!: string;

  /** At most one per customer (partial unique index) */
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}

export type LoyaltyTransactionType = 'earn' | 'redeem' | 'adjust';

@Entity('loyalty_transaction')
@Index('IDX_loyalty_transaction_customer', [
  'tenantId',
  'customerId',
  'createdAt',
])
export class LoyaltyTransactionEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_loyalty_transaction_id',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'varchar', length: 10 })
  type!: LoyaltyTransactionType;

  /** Signed: negative for a redeem or a deduction */
  @Column({ type: 'int' })
  points!: number;

  @Column({ name: 'balance_after', type: 'int' })
  balanceAfter!: number;

  /** What caused it (`order` for an earn), as a bare id of another service */
  @Column({ name: 'ref_type', type: 'varchar', length: 20, nullable: true })
  refType!: string | null;

  @Column({ name: 'ref_id', type: 'uuid', nullable: true })
  refId!: string | null;

  /** Readable code of the reference (the order code), for display */
  @Column({ name: 'ref_code', type: 'varchar', length: 30, nullable: true })
  refCode!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}

export const DEFAULT_AMOUNT_PER_POINT = 10000;

@Entity('loyalty_setting')
export class LoyaltySettingEntity {
  @PrimaryColumn({
    name: 'tenant_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_loyalty_setting_tenant',
  })
  tenantId!: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean;

  /** Integer VND spent for one point */
  @Column({
    name: 'amount_per_point',
    type: 'bigint',
    default: DEFAULT_AMOUNT_PER_POINT,
    transformer: bigintNumber,
  })
  amountPerPoint!: number;

  /** Stored for the screen; redeeming is not built yet */
  @Column({ name: 'redeem_value_per_point', type: 'int', default: 1000 })
  redeemValuePerPoint!: number;

  @Column({ name: 'points_expire_months', type: 'int', nullable: true })
  pointsExpireMonths!: number | null;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

export const CUSTOMER_APP_ENTITIES = [
  CodeSequenceEntity,
  CustomerGroupEntity,
  CustomerEntity,
  CustomerTagEntity,
  CustomerTagLinkEntity,
  CustomerAddressEntity,
  LoyaltyTransactionEntity,
  LoyaltySettingEntity,
];
