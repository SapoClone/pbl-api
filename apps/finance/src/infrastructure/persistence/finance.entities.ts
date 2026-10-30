import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('finance_code_sequence')
export class FinanceCodeSequenceEntity {
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

@Entity('financial_accounts')
export class FinancialAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'account_type', type: 'varchar', length: 24 })
  accountType!:
    | 'ASSET'
    | 'LIABILITY'
    | 'EQUITY'
    | 'REVENUE'
    | 'CONTRA_REVENUE'
    | 'EXPENSE';

  @Column({ name: 'normal_side', type: 'varchar', length: 8 })
  normalSide!: 'DEBIT' | 'CREDIT';

  @Column({ type: 'varchar', length: 8, default: 'VND' })
  currency!: string;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('financial_journals')
export class FinancialJournalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'journal_type', type: 'varchar', length: 32 })
  journalType!: string;

  @Column({ name: 'source_type', type: 'varchar', length: 48 })
  sourceType!: string;

  @Column({ name: 'source_id', type: 'varchar', length: 128 })
  sourceId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'varchar', length: 8, default: 'VND' })
  currency!: string;

  @Column({ name: 'total_debit', type: 'numeric', precision: 18, scale: 2 })
  totalDebit!: string;

  @Column({ name: 'total_credit', type: 'numeric', precision: 18, scale: 2 })
  totalCredit!: string;

  @Column({ type: 'varchar', length: 16, default: 'POSTED' })
  status!: 'POSTED' | 'REVERSED';

  @Column({ name: 'reversal_of_journal_id', type: 'uuid', nullable: true })
  reversalOfJournalId!: string | null;

  @Column({ name: 'reversed_by_journal_id', type: 'uuid', nullable: true })
  reversedByJournalId!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'effective_date', type: 'timestamptz' })
  effectiveDate!: Date;

  @Column({ name: 'posted_by', type: 'varchar', length: 64 })
  postedBy!: string;

  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  correlationId!: string | null;

  @Column({ name: 'posted_at', type: 'timestamptz' })
  postedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('financial_journal_lines')
export class FinancialJournalLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'journal_id', type: 'uuid' })
  journalId!: string;

  @Column({ name: 'line_no', type: 'int' })
  lineNo!: number;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'account_code', type: 'varchar', length: 32 })
  accountCode!: string;

  @Column({
    name: 'debit_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  debitAmount!: string;

  @Column({
    name: 'credit_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  creditAmount!: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'party_type', type: 'varchar', length: 24, nullable: true })
  partyType!: string | null;

  @Column({ name: 'party_id', type: 'varchar', length: 64, nullable: true })
  partyId!: string | null;

  @Column({
    name: 'reference_type',
    type: 'varchar',
    length: 48,
    nullable: true,
  })
  referenceType!: string | null;

  @Column({
    name: 'reference_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  referenceId!: string | null;

  @Column({ type: 'text', nullable: true })
  memo!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('cash_accounts')
export class CashAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({
    name: 'account_type',
    type: 'varchar',
    length: 24,
    default: 'CASH_DRAWER',
  })
  accountType!: 'CASH_DRAWER' | 'SAFE' | 'BANK' | 'E_WALLET';

  @Column({ type: 'varchar', length: 8, default: 'VND' })
  currency!: string;

  @Column({
    name: 'gl_account_code',
    type: 'varchar',
    length: 32,
    default: '1110',
  })
  glAccountCode!: string;

  @Column({
    name: 'current_balance',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  currentBalance!: string;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE' | 'CLOSED';

  @Column({ name: 'bank_name', type: 'varchar', length: 120, nullable: true })
  bankName!: string | null;

  @Column({
    name: 'masked_account_number',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  maskedAccountNumber!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('cashbook_categories')
export class CashbookCategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 16 })
  direction!: 'RECEIPT' | 'EXPENSE';

  @Column({ name: 'gl_account_code', type: 'varchar', length: 32 })
  glAccountCode!: string;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('cashbook_entries')
export class CashbookEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'cash_account_id', type: 'uuid' })
  cashAccountId!: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @Column({ type: 'varchar', length: 16 })
  direction!: 'RECEIPT' | 'EXPENSE';

  @Column({
    name: 'voucher_type',
    type: 'varchar',
    length: 32,
    default: 'MANUAL',
  })
  voucherType!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 8, default: 'VND' })
  currency!: string;

  @Column({ type: 'varchar', length: 16, default: 'DRAFT' })
  status!: 'DRAFT' | 'APPROVED' | 'POSTED' | 'REVERSED' | 'CANCELLED';

  @Column({ name: 'source_type', type: 'varchar', length: 48, nullable: true })
  sourceType!: string | null;

  @Column({ name: 'source_id', type: 'varchar', length: 128, nullable: true })
  sourceId!: string | null;

  @Column({ name: 'party_type', type: 'varchar', length: 24, nullable: true })
  partyType!: string | null;

  @Column({ name: 'party_id', type: 'varchar', length: 64, nullable: true })
  partyId!: string | null;

  @Column({ name: 'shift_id', type: 'uuid', nullable: true })
  shiftId!: string | null;

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'reversal_of_entry_id', type: 'uuid', nullable: true })
  reversalOfEntryId!: string | null;

  @Column({ name: 'reversed_by_entry_id', type: 'uuid', nullable: true })
  reversedByEntryId!: string | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  idempotencyKey!: string | null;

  @Column({
    name: 'request_hash',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  requestHash!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    name: 'reference_doc',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  referenceDoc!: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64 })
  createdBy!: string;

  @Column({ name: 'approved_by', type: 'varchar', length: 64, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'posted_by', type: 'varchar', length: 64, nullable: true })
  postedBy!: string | null;

  @Column({ name: 'reversed_by', type: 'varchar', length: 64, nullable: true })
  reversedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt!: Date | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('customer_credit_profiles')
export class CustomerCreditProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({
    name: 'credit_limit',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 2000000,
  })
  creditLimit!: string;

  @Column({
    name: 'posted_debt',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  postedDebt!: string;

  @Column({
    name: 'held_credit',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  heldCredit!: string;

  @Column({
    name: 'prepayment_balance',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  prepaymentBalance!: string;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('customer_credit_authorizations')
export class CustomerCreditAuthorizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({
    name: 'authorized_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  authorizedAmount!: string;

  @Column({ type: 'varchar', length: 16, default: 'HELD' })
  state!: 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';

  @Column({
    name: 'override_approved_by',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  overrideApprovedBy!: string | null;

  @Column({ name: 'override_reason', type: 'text', nullable: true })
  overrideReason!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 128 })
  requestHash!: string;

  @Column({
    name: 'caller_service',
    type: 'varchar',
    length: 32,
    default: 'sales',
  })
  callerService!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'committed_receivable_id', type: 'uuid', nullable: true })
  committedReceivableId!: string | null;

  @Column({ name: 'released_reason', type: 'text', nullable: true })
  releasedReason!: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64 })
  createdBy!: string;

  @Column({ name: 'committed_at', type: 'timestamptz', nullable: true })
  committedAt!: Date | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('customer_receivables')
export class CustomerReceivableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'credit_authorization_id', type: 'uuid', nullable: true })
  creditAuthorizationId!: string | null;

  @Column({ name: 'original_amount', type: 'numeric', precision: 18, scale: 2 })
  originalAmount!: string;

  @Column({
    name: 'paid_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  paidAmount!: string;

  @Column({
    name: 'adjusted_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  adjustedAmount!: string;

  @Column({
    name: 'outstanding_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  outstandingAmount!: string;

  @Column({ type: 'varchar', length: 8, default: 'VND' })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status!: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'WRITTEN_OFF' | 'REVERSED';

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate!: Date | null;

  @Column({ name: 'source_type', type: 'varchar', length: 48 })
  sourceType!: string;

  @Column({ name: 'source_id', type: 'varchar', length: 128 })
  sourceId!: string;

  @Column({ name: 'journal_id', type: 'uuid' })
  journalId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('customer_debt_ledger')
export class CustomerDebtLedgerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ name: 'receivable_id', type: 'uuid' })
  receivableId!: string;

  @Column({ name: 'entry_type', type: 'varchar', length: 32 })
  entryType!:
    | 'DEBT_RECOGNIZED'
    | 'PAYMENT_APPLIED'
    | 'WRITE_OFF'
    | 'ADJUSTMENT'
    | 'REVERSAL';

  @Column({ name: 'amount_delta', type: 'numeric', precision: 18, scale: 2 })
  amountDelta!: string;

  @Column({ name: 'balance_before', type: 'numeric', precision: 18, scale: 2 })
  balanceBefore!: string;

  @Column({ name: 'balance_after', type: 'numeric', precision: 18, scale: 2 })
  balanceAfter!: string;

  @Column({
    name: 'payment_method',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  paymentMethod!: string | null;

  @Column({ name: 'cashbook_entry_id', type: 'uuid', nullable: true })
  cashbookEntryId!: string | null;

  @Column({ name: 'journal_id', type: 'uuid' })
  journalId!: string;

  @Column({ name: 'reference_type', type: 'varchar', length: 48 })
  referenceType!: string;

  @Column({ name: 'reference_id', type: 'varchar', length: 128 })
  referenceId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'actor_id', type: 'varchar', length: 64 })
  actorId!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}

@Entity('supplier_payables')
export class SupplierPayableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId!: string;

  @Column({ name: 'purchase_order_id', type: 'uuid', nullable: true })
  purchaseOrderId!: string | null;

  @Column({ name: 'receipt_id', type: 'uuid', nullable: true })
  receiptId!: string | null;

  @Column({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId!: string | null;

  @Column({ name: 'original_amount', type: 'numeric', precision: 18, scale: 2 })
  originalAmount!: string;

  @Column({
    name: 'paid_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  paidAmount!: string;

  @Column({
    name: 'adjusted_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  adjustedAmount!: string;

  @Column({
    name: 'outstanding_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  outstandingAmount!: string;

  @Column({ type: 'varchar', length: 8, default: 'VND' })
  currency!: string;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status!: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'ADJUSTED' | 'REVERSED';

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate!: Date | null;

  @Column({ name: 'source_type', type: 'varchar', length: 48 })
  sourceType!: string;

  @Column({ name: 'source_id', type: 'varchar', length: 128 })
  sourceId!: string;

  @Column({ name: 'journal_id', type: 'uuid' })
  journalId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('supplier_debt_ledger')
export class SupplierDebtLedgerEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId!: string;

  @Column({ name: 'payable_id', type: 'uuid' })
  payableId!: string;

  @Column({ name: 'entry_type', type: 'varchar', length: 32 })
  entryType!:
    | 'PAYABLE_RECOGNIZED'
    | 'PAYMENT_APPLIED'
    | 'SUPPLIER_RETURN_CREDIT'
    | 'ADJUSTMENT'
    | 'REVERSAL';

  @Column({ name: 'amount_delta', type: 'numeric', precision: 18, scale: 2 })
  amountDelta!: string;

  @Column({ name: 'balance_before', type: 'numeric', precision: 18, scale: 2 })
  balanceBefore!: string;

  @Column({ name: 'balance_after', type: 'numeric', precision: 18, scale: 2 })
  balanceAfter!: string;

  @Column({
    name: 'payment_method',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  paymentMethod!: string | null;

  @Column({ name: 'cashbook_entry_id', type: 'uuid', nullable: true })
  cashbookEntryId!: string | null;

  @Column({ name: 'journal_id', type: 'uuid' })
  journalId!: string;

  @Column({ name: 'reference_type', type: 'varchar', length: 48 })
  referenceType!: string;

  @Column({ name: 'reference_id', type: 'varchar', length: 128 })
  referenceId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'actor_id', type: 'varchar', length: 64 })
  actorId!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}

@Entity('payment_settlements')
export class PaymentSettlementEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'checkout_id', type: 'uuid', nullable: true })
  checkoutId!: string | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'shift_id', type: 'uuid', nullable: true })
  shiftId!: string | null;

  @Column({ name: 'tender_ref', type: 'varchar', length: 128 })
  tenderRef!: string;

  @Column({ name: 'payment_method', type: 'varchar', length: 24 })
  paymentMethod!: string;

  @Column({ type: 'varchar', length: 32, default: 'INTERNAL_POS' })
  provider!: string;

  @Column({
    name: 'external_tx_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  externalTxId!: string | null;

  @Column({
    name: 'requested_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  requestedAmount!: string;

  @Column({
    name: 'confirmed_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  confirmedAmount!: string;

  @Column({
    name: 'settled_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  settledAmount!: string;

  @Column({
    name: 'refunded_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  refundedAmount!: string;

  @Column({ type: 'varchar', length: 8, default: 'VND' })
  currency!: string;

  @Column({
    name: 'provider_status',
    type: 'varchar',
    length: 32,
    default: 'CONFIRMED',
  })
  providerStatus!: string;

  @Column({
    name: 'settlement_status',
    type: 'varchar',
    length: 32,
    default: 'SETTLED',
  })
  settlementStatus!:
    | 'PENDING'
    | 'AUTHORIZED'
    | 'CAPTURED'
    | 'SETTLEMENT_PENDING'
    | 'SETTLED'
    | 'FAILED'
    | 'REVERSED'
    | 'RECONCILIATION_REQUIRED';

  @Column({ name: 'cashbook_entry_id', type: 'uuid', nullable: true })
  cashbookEntryId!: string | null;

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt!: Date | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('refund_operations')
export class RefundOperationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'sales_refund_request_id', type: 'uuid', nullable: true })
  salesRefundRequestId!: string | null;

  @Column({ name: 'return_id', type: 'uuid', nullable: true })
  returnId!: string | null;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'settlement_id', type: 'uuid', nullable: true })
  settlementId!: string | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'shift_id', type: 'uuid', nullable: true })
  shiftId!: string | null;

  @Column({ name: 'cash_account_id', type: 'uuid', nullable: true })
  cashAccountId!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 8, default: 'VND' })
  currency!: string;

  @Column({ type: 'varchar', length: 24 })
  method!: string;

  @Column({ type: 'varchar', length: 32, default: 'REQUESTED' })
  status!:
    | 'REQUESTED'
    | 'APPROVED'
    | 'EXECUTING'
    | 'PENDING_CONFIRMATION'
    | 'COMPLETED'
    | 'REJECTED'
    | 'FAILED'
    | 'RECONCILIATION_REQUIRED';

  @Column({ type: 'varchar', length: 32, default: 'MANUAL_CASH' })
  provider!: string;

  @Column({ name: 'provider_idempotency_key', type: 'varchar', length: 128 })
  providerIdempotencyKey!: string;

  @Column({
    name: 'external_refund_ref',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  externalRefundRef!: string | null;

  @Column({ name: 'cashbook_entry_id', type: 'uuid', nullable: true })
  cashbookEntryId!: string | null;

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 128 })
  requestHash!: string;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'requested_by', type: 'varchar', length: 64 })
  requestedBy!: string;

  @Column({ name: 'approved_by', type: 'varchar', length: 64, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'executed_by', type: 'varchar', length: 64, nullable: true })
  executedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('cod_receivables')
export class CodReceivableEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'fulfillment_id', type: 'uuid' })
  fulfillmentId!: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ name: 'carrier_code', type: 'varchar', length: 32 })
  carrierCode!: string;

  @Column({ name: 'tracking_number', type: 'varchar', length: 64 })
  trackingNumber!: string;

  @Column({
    name: 'expected_cod_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  expectedCodAmount!: string;

  @Column({
    name: 'reported_collected_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  reportedCollectedAmount!: string;

  @Column({
    name: 'carrier_fee_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  carrierFeeAmount!: string;

  @Column({
    name: 'adjustment_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  adjustmentAmount!: string;

  @Column({
    name: 'expected_net_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  expectedNetAmount!: string;

  @Column({
    name: 'actual_remitted_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  actualRemittedAmount!: string;

  @Column({
    name: 'discrepancy_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  discrepancyAmount!: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: 'COD_RECEIVABLE_RECOGNIZED',
  })
  status!:
    | 'COD_RECEIVABLE_RECOGNIZED'
    | 'SETTLEMENT_EXPECTED'
    | 'SETTLEMENT_RECEIVED'
    | 'RECONCILED'
    | 'DISCREPANCY';

  @Column({ name: 'settlement_batch_id', type: 'uuid', nullable: true })
  settlementBatchId!: string | null;

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'reconciled_at', type: 'timestamptz', nullable: true })
  reconciledAt!: Date | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('cod_settlement_batches')
export class CodSettlementBatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'carrier_code', type: 'varchar', length: 32 })
  carrierCode!: string;

  @Column({ name: 'statement_ref', type: 'varchar', length: 128 })
  statementRef!: string;

  @Column({ name: 'file_checksum', type: 'varchar', length: 128 })
  fileChecksum!: string;

  @Column({ name: 'cash_account_id', type: 'uuid', nullable: true })
  cashAccountId!: string | null;

  @Column({ name: 'period_from', type: 'timestamptz', nullable: true })
  periodFrom!: Date | null;

  @Column({ name: 'period_to', type: 'timestamptz', nullable: true })
  periodTo!: Date | null;

  @Column({
    name: 'total_expected_cod',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalExpectedCod!: string;

  @Column({
    name: 'total_reported_cod',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalReportedCod!: string;

  @Column({
    name: 'total_carrier_fee',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalCarrierFee!: string;

  @Column({
    name: 'total_net_payout',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalNetPayout!: string;

  @Column({
    name: 'total_discrepancy',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalDiscrepancy!: string;

  @Column({ name: 'line_count', type: 'int', default: 0 })
  lineCount!: number;

  @Column({ name: 'matched_count', type: 'int', default: 0 })
  matchedCount!: number;

  @Column({ name: 'discrepancy_count', type: 'int', default: 0 })
  discrepancyCount!: number;

  @Column({ type: 'varchar', length: 32, default: 'IMPORTED' })
  status!: 'IMPORTED' | 'RECONCILED' | 'DISCREPANCY_DETECTED';

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'cashbook_entry_id', type: 'uuid', nullable: true })
  cashbookEntryId!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'imported_by', type: 'varchar', length: 64 })
  importedBy!: string;

  @Column({
    name: 'reconciled_by',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  reconciledBy!: string | null;

  @Column({ name: 'reconciled_at', type: 'timestamptz', nullable: true })
  reconciledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('cod_settlement_lines')
export class CodSettlementLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId!: string;

  @Column({ name: 'line_no', type: 'int' })
  lineNo!: number;

  @Column({ name: 'cod_receivable_id', type: 'uuid', nullable: true })
  codReceivableId!: string | null;

  @Column({ name: 'fulfillment_id', type: 'uuid', nullable: true })
  fulfillmentId!: string | null;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ name: 'tracking_number', type: 'varchar', length: 64 })
  trackingNumber!: string;

  @Column({
    name: 'expected_cod_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  expectedCodAmount!: string;

  @Column({
    name: 'reported_cod_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  reportedCodAmount!: string;

  @Column({
    name: 'carrier_fee_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  carrierFeeAmount!: string;

  @Column({
    name: 'net_payout_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  netPayoutAmount!: string;

  @Column({
    name: 'discrepancy_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  discrepancyAmount!: string;

  @Column({
    name: 'line_status',
    type: 'varchar',
    length: 32,
    default: 'MATCHED',
  })
  lineStatus!:
    | 'MATCHED'
    | 'DISCREPANCY'
    | 'UNKNOWN_SHIPMENT'
    | 'DUPLICATE_IN_BATCH'
    | 'ALREADY_SETTLED';

  @Column({ name: 'discrepancy_reason', type: 'text', nullable: true })
  discrepancyReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('shift_cash_reconciliations')
export class ShiftCashReconciliationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'shift_id', type: 'uuid' })
  shiftId!: string;

  @Column({ name: 'shift_code', type: 'varchar', length: 32 })
  shiftCode!: string;

  @Column({ name: 'branch_id', type: 'uuid' })
  branchId!: string;

  @Column({ name: 'cash_account_id', type: 'uuid', nullable: true })
  cashAccountId!: string | null;

  @Column({ name: 'staff_id', type: 'varchar', length: 64 })
  staffId!: string;

  @Column({ name: 'opening_cash', type: 'numeric', precision: 18, scale: 2 })
  openingCash!: string;

  @Column({
    name: 'confirmed_cash_sales',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  confirmedCashSales!: string;

  @Column({
    name: 'confirmed_cash_refunds',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  confirmedCashRefunds!: string;

  @Column({
    name: 'other_cash_receipts',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  otherCashReceipts!: string;

  @Column({
    name: 'other_cash_expenses',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  otherCashExpenses!: string;

  @Column({
    name: 'expected_closing_cash',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  expectedClosingCash!: string;

  @Column({
    name: 'actual_counted_cash',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  actualCountedCash!: string;

  @Column({ name: 'variance_amount', type: 'numeric', precision: 18, scale: 2 })
  varianceAmount!: string;

  @Column({ type: 'varchar', length: 24, default: 'RECONCILED' })
  status!: 'RECONCILED' | 'VARIANCE_DETECTED';

  @Column({ name: 'variance_journal_id', type: 'uuid', nullable: true })
  varianceJournalId!: string | null;

  @Column({ name: 'reconciliation_issue_id', type: 'uuid', nullable: true })
  reconciliationIssueId!: string | null;

  @Column({ name: 'reconciled_by', type: 'varchar', length: 64 })
  reconciledBy!: string;

  @Column({ name: 'reconciled_at', type: 'timestamptz' })
  reconciledAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

@Entity('financial_adjustments')
export class FinancialAdjustmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ name: 'adjustment_type', type: 'varchar', length: 32 })
  adjustmentType!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 32 })
  targetType!: 'RECEIVABLE' | 'PAYABLE' | 'CASH_ACCOUNT';

  @Column({ name: 'target_id', type: 'uuid' })
  targetId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 16 })
  direction!: 'DECREASE' | 'INCREASE';

  @Column({ name: 'reason_code', type: 'varchar', length: 48 })
  reasonCode!: string;

  @Column({ type: 'text' })
  explanation!: string;

  @Column({ type: 'varchar', length: 24, default: 'PENDING_APPROVAL' })
  status!: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'POSTED' | 'REJECTED';

  @Column({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'requested_by', type: 'varchar', length: 64 })
  requestedBy!: string;

  @Column({ name: 'approved_by', type: 'varchar', length: 64, nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'rejected_by', type: 'varchar', length: 64, nullable: true })
  rejectedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('reconciliation_runs')
export class ReconciliationRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({
    name: 'reconciliation_type',
    type: 'varchar',
    length: 32,
    default: 'FULL_SYSTEM',
  })
  reconciliationType!: string;

  @Column({ type: 'varchar', length: 24, default: 'COMPLETED' })
  status!: string;

  @Column({ name: 'processed_count', type: 'int', default: 0 })
  processedCount!: number;

  @Column({
    name: 'matched_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  matchedAmount!: string;

  @Column({
    name: 'mismatched_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  mismatchedAmount!: string;

  @Column({ name: 'issue_count', type: 'int', default: 0 })
  issueCount!: number;

  @Column({ name: 'started_by', type: 'varchar', length: 64 })
  startedBy!: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}

@Entity('reconciliation_issues')
export class ReconciliationIssueEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId!: string | null;

  @Column({ name: 'issue_type', type: 'varchar', length: 48 })
  issueType!: string;

  @Column({ type: 'varchar', length: 16, default: 'HIGH' })
  severity!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @Column({ name: 'source_type', type: 'varchar', length: 48 })
  sourceType!: string;

  @Column({ name: 'source_id', type: 'varchar', length: 128 })
  sourceId!: string;

  @Column({
    name: 'expected_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  expectedAmount!: string;

  @Column({
    name: 'actual_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  actualAmount!: string;

  @Column({
    name: 'difference_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
  })
  differenceAmount!: string;

  @Column({ type: 'varchar', length: 24, default: 'OPEN' })
  status!: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'IGNORED';

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote!: string | null;

  @Column({ name: 'resolved_by', type: 'varchar', length: 64, nullable: true })
  resolvedBy!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

export const M5_FINANCE_ENTITIES = [
  FinanceCodeSequenceEntity,
  FinancialAccountEntity,
  FinancialJournalEntity,
  FinancialJournalLineEntity,
  CashAccountEntity,
  CashbookCategoryEntity,
  CashbookEntryEntity,
  CustomerCreditProfileEntity,
  CustomerCreditAuthorizationEntity,
  CustomerReceivableEntity,
  CustomerDebtLedgerEntity,
  SupplierPayableEntity,
  SupplierDebtLedgerEntity,
  PaymentSettlementEntity,
  RefundOperationEntity,
  CodReceivableEntity,
  CodSettlementBatchEntity,
  CodSettlementLineEntity,
  ShiftCashReconciliationEntity,
  FinancialAdjustmentEntity,
  ReconciliationRunEntity,
  ReconciliationIssueEntity,
];
