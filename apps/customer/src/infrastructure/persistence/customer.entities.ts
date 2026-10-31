import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { moneyTransformer } from '../../common/money';

@Entity('customer_code_sequence')
export class CustomerCodeSequenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'seq_key', type: 'varchar', length: 64 })
  seqKey!: string;

  @Column({ name: 'last_value', type: 'bigint', default: 0 })
  lastValue!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('customer_groups')
export class CustomerGroupEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    name: 'default_discount_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: '0.00',
  })
  defaultDiscountRate!: string;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('membership_tiers')
export class MembershipTierEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'min_points', type: 'int', default: 0 })
  minPoints!: number;

  @Column({
    name: 'discount_rate',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: '0.00',
  })
  discountRate!: string;

  @Column({
    name: 'benefits_json',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  benefitsJson!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('customers')
export class CustomerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'customer_group_id', type: 'uuid', nullable: true })
  customerGroupId!: string | null;

  @Column({ name: 'membership_tier_id', type: 'uuid', nullable: true })
  membershipTierId!: string | null;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({
    name: 'phone_normalized',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  phoneNormalized!: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  gender!: string | null;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'POS' })
  source!: string;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE' | 'ANONYMIZED';

  @Column({
    name: 'debt_limit',
    type: 'bigint',
    default: 2000000,
    transformer: moneyTransformer,
  })
  debtLimit!: number;

  @Column({
    name: 'current_debt',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  currentDebt!: number;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'merged_into_customer_id', type: 'uuid', nullable: true })
  mergedIntoCustomerId!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

@Entity('customer_addresses')
export class CustomerAddressEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'recipient_name', type: 'varchar', length: 160 })
  recipientName!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({
    name: 'phone_normalized',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  phoneNormalized!: string | null;

  @Column({ name: 'address_line', type: 'varchar', length: 255 })
  addressLine!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  ward!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  district!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  province!: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('loyalty_settings')
export class LoyaltySettingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean;

  @Column({
    name: 'earn_amount_per_point',
    type: 'bigint',
    default: 10000,
    transformer: moneyTransformer,
  })
  earnAmountPerPoint!: number;

  @Column({
    name: 'redeem_value_per_point',
    type: 'bigint',
    default: 1000,
    transformer: moneyTransformer,
  })
  redeemValuePerPoint!: number;

  @Column({ name: 'min_redeem_points', type: 'int', default: 10 })
  minRedeemPoints!: number;

  @Column({
    name: 'max_redeem_points_per_order',
    type: 'int',
    nullable: true,
    default: 10000,
  })
  maxRedeemPointsPerOrder!: number | null;

  @Column({ name: 'hold_ttl_seconds', type: 'int', default: 900 })
  holdTtlSeconds!: number;

  @Column({ name: 'points_expiration_days', type: 'int', nullable: true })
  pointsExpirationDays!: number | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'updated_by', type: 'varchar', length: 64, nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('loyalty_accounts')
export class LoyaltyAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'posted_points_balance', type: 'int', default: 0 })
  postedPointsBalance!: number;

  @Column({ name: 'held_points', type: 'int', default: 0 })
  heldPoints!: number;

  @Column({ name: 'lifetime_earned_points', type: 'int', default: 0 })
  lifetimeEarnedPoints!: number;

  @Column({ name: 'lifetime_redeemed_points', type: 'int', default: 0 })
  lifetimeRedeemedPoints!: number;

  @Column({ name: 'qualifying_points', type: 'int', default: 0 })
  qualifyingPoints!: number;

  @Column({ name: 'tier_id', type: 'uuid', nullable: true })
  tierId!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('loyalty_transactions')
export class LoyaltyTransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'loyalty_account_id', type: 'uuid' })
  loyaltyAccountId!: string;

  @Column({ name: 'transaction_type', type: 'varchar', length: 32 })
  transactionType!:
    | 'EARN'
    | 'REDEEM'
    | 'EARN_REVERSAL'
    | 'REDEMPTION_REVERSAL'
    | 'MANUAL_ADJUSTMENT'
    | 'EXPIRE'
    | 'MERGE_IN'
    | 'MERGE_OUT';

  @Column({ name: 'points_delta', type: 'int' })
  pointsDelta!: number;

  @Column({ name: 'balance_before', type: 'int' })
  balanceBefore!: number;

  @Column({ name: 'balance_after', type: 'int' })
  balanceAfter!: number;

  @Column({ name: 'source_type', type: 'varchar', length: 32 })
  sourceType!: string;

  @Column({ name: 'source_ref_id', type: 'varchar', length: 128 })
  sourceRefId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 })
  idempotencyKey!: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ name: 'return_id', type: 'uuid', nullable: true })
  returnId!: string | null;

  @Column({ name: 'hold_id', type: 'uuid', nullable: true })
  holdId!: string | null;

  @Column({ name: 'original_transaction_id', type: 'uuid', nullable: true })
  originalTransactionId!: string | null;

  @Column({
    name: 'eligible_spend_amount',
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  })
  eligibleSpendAmount!: number | null;

  @Column({
    name: 'applied_rate_amount_per_point',
    type: 'bigint',
    nullable: true,
    transformer: moneyTransformer,
  })
  appliedRateAmountPerPoint!: number | null;

  @Column({ name: 'reversed_points_total', type: 'int', default: 0 })
  reversedPointsTotal!: number;

  @Column({ name: 'actor_id', type: 'varchar', length: 64, nullable: true })
  actorId!: string | null;

  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  correlationId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('loyalty_holds')
export class LoyaltyHoldEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'loyalty_account_id', type: 'uuid' })
  loyaltyAccountId!: string;

  @Column({
    name: 'caller_service',
    type: 'varchar',
    length: 32,
    default: 'sales',
  })
  callerService!: string;

  @Column({ type: 'varchar', length: 32, default: 'HOLD' })
  operation!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({
    name: 'source_ref_type',
    type: 'varchar',
    length: 32,
    default: 'CHECKOUT',
  })
  sourceRefType!: string;

  @Column({ name: 'source_ref_id', type: 'varchar', length: 128 })
  sourceRefId!: string;

  @Column({ type: 'int' })
  points!: number;

  @Column({
    name: 'discount_value_vnd',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  discountValueVnd!: number;

  @Column({ type: 'varchar', length: 24, default: 'HELD' })
  state!: 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'committed_at', type: 'timestamptz', nullable: true })
  committedAt!: Date | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;

  @Column({
    name: 'release_reason',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  releaseReason!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('customer_purchase_projections')
export class CustomerPurchaseProjectionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'order_code', type: 'varchar', length: 64 })
  orderCode!: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'channel_type', type: 'varchar', length: 32, default: 'POS' })
  channelType!: string;

  @Column({
    name: 'order_status',
    type: 'varchar',
    length: 24,
    default: 'COMPLETED',
  })
  orderStatus!: string;

  @Column({
    name: 'original_order_total',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  originalOrderTotal!: number;

  @Column({
    name: 'eligible_net_spend',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  eligibleNetSpend!: number;

  @Column({
    name: 'returned_amount',
    type: 'bigint',
    default: 0,
    transformer: moneyTransformer,
  })
  returnedAmount!: number;

  @Column({ name: 'earned_points', type: 'int', default: 0 })
  earnedPoints!: number;

  @Column({ name: 'reversed_points', type: 'int', default: 0 })
  reversedPoints!: number;

  @Column({ name: 'completed_at', type: 'timestamptz', default: () => 'now()' })
  completedAt!: Date;

  @Column({
    name: 'last_event_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  lastEventId!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('customer_merge_history')
export class CustomerMergeHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'source_customer_id', type: 'uuid' })
  sourceCustomerId!: string;

  @Column({ name: 'target_customer_id', type: 'uuid' })
  targetCustomerId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'transferred_points', type: 'int', default: 0 })
  transferredPoints!: number;

  @Column({ name: 'moved_addresses_count', type: 'int', default: 0 })
  movedAddressesCount!: number;

  @Column({ name: 'moved_orders_count', type: 'int', default: 0 })
  movedOrdersCount!: number;

  @Column({ name: 'actor_id', type: 'varchar', length: 64 })
  actorId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('customer_data_jobs')
export class CustomerDataJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'job_type', type: 'varchar', length: 16 })
  jobType!: 'IMPORT' | 'EXPORT';

  @Column({ type: 'varchar', length: 16, default: 'CSV' })
  format!: 'CSV';

  @Column({ type: 'varchar', length: 16, default: 'COMPLETED' })
  status!: 'PENDING' | 'COMPLETED' | 'FAILED';

  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows!: number;

  @Column({ name: 'success_rows', type: 'int', default: 0 })
  successRows!: number;

  @Column({ name: 'failed_rows', type: 'int', default: 0 })
  failedRows!: number;

  @Column({ name: 'errors_json', type: 'jsonb', default: () => "'[]'::jsonb" })
  errorsJson!: Array<{ row: number; error: string }>;

  @Column({ name: 'result_csv', type: 'text', nullable: true })
  resultCsv!: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64 })
  createdBy!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}

export const M4_CUSTOMER_ENTITIES = [
  CustomerCodeSequenceEntity,
  CustomerGroupEntity,
  MembershipTierEntity,
  CustomerEntity,
  CustomerAddressEntity,
  LoyaltySettingEntity,
  LoyaltyAccountEntity,
  LoyaltyTransactionEntity,
  LoyaltyHoldEntity,
  CustomerPurchaseProjectionEntity,
  CustomerMergeHistoryEntity,
  CustomerDataJobEntity,
];
