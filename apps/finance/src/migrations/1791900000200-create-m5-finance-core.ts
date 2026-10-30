import { enableTenantRlsPolicy, qualifiedTable } from '@pbl/events';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateM5FinanceCore1791900000200 implements MigrationInterface {
  name = 'CreateM5FinanceCore1791900000200';

  async up(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);

    const codeSeq = t('finance_code_sequence');
    const financialAccounts = t('financial_accounts');
    const financialJournals = t('financial_journals');
    const financialJournalLines = t('financial_journal_lines');
    const cashAccounts = t('cash_accounts');
    const cashbookCategories = t('cashbook_categories');
    const cashbookEntries = t('cashbook_entries');
    const creditProfiles = t('customer_credit_profiles');
    const creditAuths = t('customer_credit_authorizations');
    const receivables = t('customer_receivables');
    const customerDebtLedger = t('customer_debt_ledger');
    const payables = t('supplier_payables');
    const supplierDebtLedger = t('supplier_debt_ledger');
    const settlements = t('payment_settlements');
    const refunds = t('refund_operations');
    const codReceivables = t('cod_receivables');
    const codBatches = t('cod_settlement_batches');
    const codLines = t('cod_settlement_lines');
    const shiftReconciliations = t('shift_cash_reconciliations');
    const adjustments = t('financial_adjustments');
    const reconRuns = t('reconciliation_runs');
    const reconIssues = t('reconciliation_issues');

    // 1. Atomic tenant-scoped sequence counter
    await queryRunner.query(`
      CREATE TABLE ${codeSeq} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "seq_key" character varying(64) NOT NULL,
        "last_value" bigint NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_code_sequence_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_finance_code_sequence_tenant_key" UNIQUE ("tenant_id", "seq_key")
      )
    `);
    await enableTenantRlsPolicy(queryRunner, codeSeq);

    // 2. Financial Accounts (Internal Chart of Accounts)
    await queryRunner.query(`
      CREATE TABLE ${financialAccounts} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(120) NOT NULL,
        "account_type" character varying(24) NOT NULL,
        "normal_side" character varying(8) NOT NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'VND',
        "is_system" boolean NOT NULL DEFAULT false,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_financial_accounts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_financial_accounts_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_financial_accounts_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_financial_accounts_type" CHECK ("account_type" IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'CONTRA_REVENUE', 'EXPENSE')),
        CONSTRAINT "CHK_financial_accounts_normal" CHECK ("normal_side" IN ('DEBIT', 'CREDIT')),
        CONSTRAINT "CHK_financial_accounts_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
      )
    `);
    await enableTenantRlsPolicy(queryRunner, financialAccounts);

    // 3. Financial Journals (Authoritative Double-Entry Header)
    await queryRunner.query(`
      CREATE TABLE ${financialJournals} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "journal_type" character varying(32) NOT NULL,
        "source_type" character varying(48) NOT NULL,
        "source_id" character varying(128) NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "branch_id" uuid NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'VND',
        "total_debit" numeric(18,2) NOT NULL,
        "total_credit" numeric(18,2) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'POSTED',
        "reversal_of_journal_id" uuid NULL,
        "reversed_by_journal_id" uuid NULL,
        "description" text NULL,
        "effective_date" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "posted_by" character varying(64) NOT NULL,
        "correlation_id" character varying(128) NULL,
        "posted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_financial_journals_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_financial_journals_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_financial_journals_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "UQ_financial_journals_tenant_source" UNIQUE ("tenant_id", "source_type", "source_id"),
        CONSTRAINT "UQ_financial_journals_tenant_idem" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "CHK_financial_journals_balanced" CHECK ("total_debit" > 0 AND "total_debit" = "total_credit"),
        CONSTRAINT "CHK_financial_journals_status" CHECK ("status" IN ('POSTED', 'REVERSED'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_financial_journals_reversal_of"
      ON ${financialJournals} ("tenant_id", "reversal_of_journal_id")
      WHERE "reversal_of_journal_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_financial_journals_tenant_posted"
      ON ${financialJournals} ("tenant_id", "posted_at" DESC, "id" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, financialJournals);

    // 4. Financial Journal Lines (Immutable Double-Entry Lines)
    await queryRunner.query(`
      CREATE TABLE ${financialJournalLines} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "journal_id" uuid NOT NULL,
        "line_no" integer NOT NULL,
        "account_id" uuid NOT NULL,
        "account_code" character varying(32) NOT NULL,
        "debit_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "credit_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "branch_id" uuid NULL,
        "party_type" character varying(24) NULL,
        "party_id" character varying(64) NULL,
        "reference_type" character varying(48) NULL,
        "reference_id" character varying(128) NULL,
        "memo" text NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_financial_journal_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_financial_journal_lines_journal_no" UNIQUE ("tenant_id", "journal_id", "line_no"),
        CONSTRAINT "FK_financial_journal_lines_journal" FOREIGN KEY ("tenant_id", "journal_id")
          REFERENCES ${financialJournals} ("tenant_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_financial_journal_lines_side" CHECK (
          ("debit_amount" > 0 AND "credit_amount" = 0) OR
          ("credit_amount" > 0 AND "debit_amount" = 0)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_financial_journal_lines_tenant_journal"
      ON ${financialJournalLines} ("tenant_id", "journal_id", "line_no" ASC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_financial_journal_lines_tenant_account"
      ON ${financialJournalLines} ("tenant_id", "account_code", "created_at" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, financialJournalLines);

    // 5. Cash Accounts (Cash Drawers, Safes, Bank Accounts, E-Wallets)
    await queryRunner.query(`
      CREATE TABLE ${cashAccounts} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(120) NOT NULL,
        "account_type" character varying(24) NOT NULL DEFAULT 'CASH_DRAWER',
        "currency" character varying(8) NOT NULL DEFAULT 'VND',
        "gl_account_code" character varying(32) NOT NULL DEFAULT '1110',
        "current_balance" numeric(18,2) NOT NULL DEFAULT 0,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "bank_name" character varying(120) NULL,
        "masked_account_number" character varying(64) NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cash_accounts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cash_accounts_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_cash_accounts_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_cash_accounts_type" CHECK ("account_type" IN ('CASH_DRAWER', 'SAFE', 'BANK', 'E_WALLET')),
        CONSTRAINT "CHK_cash_accounts_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'CLOSED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_cash_accounts_tenant_branch"
      ON ${cashAccounts} ("tenant_id", "branch_id", "status")
    `);
    await enableTenantRlsPolicy(queryRunner, cashAccounts);

    // 6. Cashbook Categories
    await queryRunner.query(`
      CREATE TABLE ${cashbookCategories} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(120) NOT NULL,
        "direction" character varying(16) NOT NULL,
        "gl_account_code" character varying(32) NOT NULL,
        "is_system" boolean NOT NULL DEFAULT false,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cashbook_categories_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cashbook_categories_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_cashbook_categories_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_cashbook_categories_dir" CHECK ("direction" IN ('RECEIPT', 'EXPENSE')),
        CONSTRAINT "CHK_cashbook_categories_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
      )
    `);
    await enableTenantRlsPolicy(queryRunner, cashbookCategories);

    // 7. Cashbook Entries (Receipt & Expense Vouchers)
    await queryRunner.query(`
      CREATE TABLE ${cashbookEntries} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "branch_id" uuid NULL,
        "cash_account_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        "direction" character varying(16) NOT NULL,
        "voucher_type" character varying(32) NOT NULL DEFAULT 'MANUAL',
        "amount" numeric(18,2) NOT NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'VND',
        "status" character varying(16) NOT NULL DEFAULT 'DRAFT',
        "source_type" character varying(48) NULL,
        "source_id" character varying(128) NULL,
        "party_type" character varying(24) NULL,
        "party_id" character varying(64) NULL,
        "shift_id" uuid NULL,
        "journal_id" uuid NULL,
        "reversal_of_entry_id" uuid NULL,
        "reversed_by_entry_id" uuid NULL,
        "idempotency_key" character varying(128) NULL,
        "request_hash" character varying(128) NULL,
        "description" text NULL,
        "reference_doc" character varying(128) NULL,
        "created_by" character varying(64) NOT NULL,
        "approved_by" character varying(64) NULL,
        "posted_by" character varying(64) NULL,
        "reversed_by" character varying(64) NULL,
        "approved_at" TIMESTAMPTZ NULL,
        "posted_at" TIMESTAMPTZ NULL,
        "reversed_at" TIMESTAMPTZ NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cashbook_entries_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cashbook_entries_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_cashbook_entries_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "CHK_cashbook_entries_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_cashbook_entries_dir" CHECK ("direction" IN ('RECEIPT', 'EXPENSE')),
        CONSTRAINT "CHK_cashbook_entries_status" CHECK ("status" IN ('DRAFT', 'APPROVED', 'POSTED', 'REVERSED', 'CANCELLED'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_cashbook_entries_tenant_idem"
      ON ${cashbookEntries} ("tenant_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_cashbook_entries_reversal_of"
      ON ${cashbookEntries} ("tenant_id", "reversal_of_entry_id")
      WHERE "reversal_of_entry_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_cashbook_entries_tenant_created"
      ON ${cashbookEntries} ("tenant_id", "created_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_cashbook_entries_tenant_account"
      ON ${cashbookEntries} ("tenant_id", "cash_account_id", "status", "posted_at" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, cashbookEntries);

    // 8. Customer Credit Profiles (Authoritative Credit Limit, Posted Debt, Held Exposure)
    await queryRunner.query(`
      CREATE TABLE ${creditProfiles} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "credit_limit" numeric(18,2) NOT NULL DEFAULT 2000000.00,
        "posted_debt" numeric(18,2) NOT NULL DEFAULT 0,
        "held_credit" numeric(18,2) NOT NULL DEFAULT 0,
        "prepayment_balance" numeric(18,2) NOT NULL DEFAULT 0,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "version" integer NOT NULL DEFAULT 1,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_credit_profiles_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_credit_profiles_tenant_customer" UNIQUE ("tenant_id", "customer_id"),
        CONSTRAINT "CHK_customer_credit_profiles_nonneg" CHECK (
          "credit_limit" >= 0 AND "posted_debt" >= 0 AND "held_credit" >= 0 AND "prepayment_balance" >= 0
        )
      )
    `);
    await enableTenantRlsPolicy(queryRunner, creditProfiles);

    // 9. Customer Credit Authorizations (Pessimistic Credit Exposure Holds)
    await queryRunner.query(`
      CREATE TABLE ${creditAuths} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "customer_id" uuid NOT NULL,
        "order_id" uuid NULL,
        "branch_id" uuid NULL,
        "authorized_amount" numeric(18,2) NOT NULL,
        "state" character varying(16) NOT NULL DEFAULT 'HELD',
        "override_approved_by" character varying(64) NULL,
        "override_reason" text NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "request_hash" character varying(128) NOT NULL,
        "caller_service" character varying(32) NOT NULL DEFAULT 'sales',
        "expires_at" TIMESTAMPTZ NOT NULL,
        "committed_receivable_id" uuid NULL,
        "released_reason" text NULL,
        "created_by" character varying(64) NOT NULL,
        "committed_at" TIMESTAMPTZ NULL,
        "released_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_credit_authorizations_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_credit_auth_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_customer_credit_auth_tenant_idem" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "CHK_customer_credit_auth_amount" CHECK ("authorized_amount" > 0),
        CONSTRAINT "CHK_customer_credit_auth_state" CHECK ("state" IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_customer_credit_auth_customer_state"
      ON ${creditAuths} ("tenant_id", "customer_id", "state", "expires_at")
    `);
    await enableTenantRlsPolicy(queryRunner, creditAuths);

    // 10. Customer Receivables (Accounts Receivable Invoices)
    await queryRunner.query(`
      CREATE TABLE ${receivables} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "customer_id" uuid NOT NULL,
        "order_id" uuid NULL,
        "branch_id" uuid NULL,
        "credit_authorization_id" uuid NULL,
        "original_amount" numeric(18,2) NOT NULL,
        "paid_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "adjusted_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "outstanding_amount" numeric(18,2) NOT NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'VND',
        "status" character varying(20) NOT NULL DEFAULT 'OPEN',
        "due_date" TIMESTAMPTZ NULL,
        "source_type" character varying(48) NOT NULL,
        "source_id" character varying(128) NOT NULL,
        "journal_id" uuid NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_receivables_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_receivables_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_customer_receivables_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "UQ_customer_receivables_tenant_source" UNIQUE ("tenant_id", "source_type", "source_id"),
        CONSTRAINT "UQ_customer_receivables_tenant_idem" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "CHK_customer_receivables_math" CHECK (
          "original_amount" > 0 AND
          "paid_amount" >= 0 AND
          "outstanding_amount" >= 0 AND
          ("paid_amount" + "adjusted_amount" + "outstanding_amount" = "original_amount")
        ),
        CONSTRAINT "CHK_customer_receivables_status" CHECK ("status" IN ('OPEN', 'PARTIALLY_PAID', 'PAID', 'WRITTEN_OFF', 'REVERSED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_customer_receivables_customer_status"
      ON ${receivables} ("tenant_id", "customer_id", "status", "created_at" ASC)
    `);
    await enableTenantRlsPolicy(queryRunner, receivables);

    // 11. Customer Debt Ledger (Immutable Receivable Subledger)
    await queryRunner.query(`
      CREATE TABLE ${customerDebtLedger} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "receivable_id" uuid NOT NULL,
        "entry_type" character varying(32) NOT NULL,
        "amount_delta" numeric(18,2) NOT NULL,
        "balance_before" numeric(18,2) NOT NULL,
        "balance_after" numeric(18,2) NOT NULL,
        "payment_method" character varying(24) NULL,
        "cashbook_entry_id" uuid NULL,
        "journal_id" uuid NOT NULL,
        "reference_type" character varying(48) NOT NULL,
        "reference_id" character varying(128) NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "note" text NULL,
        "actor_id" character varying(64) NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_debt_ledger_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_debt_ledger_tenant_idem" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "CHK_customer_debt_ledger_delta" CHECK ("amount_delta" <> 0 AND "balance_after" >= 0),
        CONSTRAINT "CHK_customer_debt_ledger_type" CHECK ("entry_type" IN ('DEBT_RECOGNIZED', 'PAYMENT_APPLIED', 'WRITE_OFF', 'ADJUSTMENT', 'REVERSAL'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_customer_debt_ledger_customer_occurred"
      ON ${customerDebtLedger} ("tenant_id", "customer_id", "occurred_at" DESC, "id" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, customerDebtLedger);

    // 12. Supplier Payables (Accounts Payable Obligations)
    await queryRunner.query(`
      CREATE TABLE ${payables} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "supplier_id" uuid NOT NULL,
        "purchase_order_id" uuid NULL,
        "receipt_id" uuid NULL,
        "warehouse_id" uuid NULL,
        "original_amount" numeric(18,2) NOT NULL,
        "paid_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "adjusted_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "outstanding_amount" numeric(18,2) NOT NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'VND',
        "status" character varying(20) NOT NULL DEFAULT 'OPEN',
        "due_date" TIMESTAMPTZ NULL,
        "source_type" character varying(48) NOT NULL,
        "source_id" character varying(128) NOT NULL,
        "journal_id" uuid NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplier_payables_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_supplier_payables_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_supplier_payables_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "UQ_supplier_payables_tenant_source" UNIQUE ("tenant_id", "source_type", "source_id"),
        CONSTRAINT "UQ_supplier_payables_tenant_idem" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "CHK_supplier_payables_math" CHECK (
          "original_amount" > 0 AND
          "paid_amount" >= 0 AND
          "outstanding_amount" >= 0 AND
          ("paid_amount" + "adjusted_amount" + "outstanding_amount" = "original_amount")
        ),
        CONSTRAINT "CHK_supplier_payables_status" CHECK ("status" IN ('OPEN', 'PARTIALLY_PAID', 'PAID', 'ADJUSTED', 'REVERSED'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_supplier_payables_tenant_po"
      ON ${payables} ("tenant_id", "purchase_order_id")
      WHERE "purchase_order_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_supplier_payables_supplier_status"
      ON ${payables} ("tenant_id", "supplier_id", "status", "created_at" ASC)
    `);
    await enableTenantRlsPolicy(queryRunner, payables);

    // 13. Supplier Debt Ledger (Immutable Payable Subledger)
    await queryRunner.query(`
      CREATE TABLE ${supplierDebtLedger} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "payable_id" uuid NOT NULL,
        "entry_type" character varying(32) NOT NULL,
        "amount_delta" numeric(18,2) NOT NULL,
        "balance_before" numeric(18,2) NOT NULL,
        "balance_after" numeric(18,2) NOT NULL,
        "payment_method" character varying(24) NULL,
        "cashbook_entry_id" uuid NULL,
        "journal_id" uuid NOT NULL,
        "reference_type" character varying(48) NOT NULL,
        "reference_id" character varying(128) NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "note" text NULL,
        "actor_id" character varying(64) NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplier_debt_ledger_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_supplier_debt_ledger_tenant_idem" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "CHK_supplier_debt_ledger_delta" CHECK ("amount_delta" <> 0 AND "balance_after" >= 0),
        CONSTRAINT "CHK_supplier_debt_ledger_type" CHECK ("entry_type" IN ('PAYABLE_RECOGNIZED', 'PAYMENT_APPLIED', 'SUPPLIER_RETURN_CREDIT', 'ADJUSTMENT', 'REVERSAL'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_supplier_debt_ledger_supplier_occurred"
      ON ${supplierDebtLedger} ("tenant_id", "supplier_id", "occurred_at" DESC, "id" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, supplierDebtLedger);

    // 14. Payment Settlements (Sales Tenders & External Payment Reconciliation)
    await queryRunner.query(`
      CREATE TABLE ${settlements} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "order_id" uuid NOT NULL,
        "checkout_id" uuid NULL,
        "branch_id" uuid NULL,
        "shift_id" uuid NULL,
        "tender_ref" character varying(128) NOT NULL,
        "payment_method" character varying(24) NOT NULL,
        "provider" character varying(32) NOT NULL DEFAULT 'INTERNAL_POS',
        "external_tx_id" character varying(128) NULL,
        "requested_amount" numeric(18,2) NOT NULL,
        "confirmed_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "settled_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "refunded_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "currency" character varying(8) NOT NULL DEFAULT 'VND',
        "provider_status" character varying(32) NOT NULL DEFAULT 'CONFIRMED',
        "settlement_status" character varying(32) NOT NULL DEFAULT 'SETTLED',
        "cashbook_entry_id" uuid NULL,
        "journal_id" uuid NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "settled_at" TIMESTAMPTZ NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_settlements_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_payment_settlements_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_payment_settlements_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "UQ_payment_settlements_tenant_idem" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "UQ_payment_settlements_tenant_tender" UNIQUE ("tenant_id", "order_id", "tender_ref"),
        CONSTRAINT "CHK_payment_settlements_amounts" CHECK (
          "requested_amount" > 0 AND
          "confirmed_amount" >= 0 AND
          "settled_amount" >= 0 AND
          "refunded_amount" >= 0 AND
          "refunded_amount" <= "confirmed_amount"
        ),
        CONSTRAINT "CHK_payment_settlements_status" CHECK (
          "settlement_status" IN ('PENDING', 'AUTHORIZED', 'CAPTURED', 'SETTLEMENT_PENDING', 'SETTLED', 'FAILED', 'REVERSED', 'RECONCILIATION_REQUIRED')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_payment_settlements_provider_tx"
      ON ${settlements} ("tenant_id", "provider", "external_tx_id")
      WHERE "external_tx_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_payment_settlements_order"
      ON ${settlements} ("tenant_id", "order_id", "created_at" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, settlements);

    // 15. Refund Operations (Distributed Refund State Machine)
    await queryRunner.query(`
      CREATE TABLE ${refunds} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "sales_refund_request_id" uuid NULL,
        "return_id" uuid NULL,
        "order_id" uuid NOT NULL,
        "settlement_id" uuid NULL,
        "branch_id" uuid NULL,
        "shift_id" uuid NULL,
        "cash_account_id" uuid NULL,
        "amount" numeric(18,2) NOT NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'VND',
        "method" character varying(24) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'REQUESTED',
        "provider" character varying(32) NOT NULL DEFAULT 'MANUAL_CASH',
        "provider_idempotency_key" character varying(128) NOT NULL,
        "external_refund_ref" character varying(128) NULL,
        "cashbook_entry_id" uuid NULL,
        "journal_id" uuid NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "request_hash" character varying(128) NOT NULL,
        "failure_reason" text NULL,
        "requested_by" character varying(64) NOT NULL,
        "approved_by" character varying(64) NULL,
        "executed_by" character varying(64) NULL,
        "approved_at" TIMESTAMPTZ NULL,
        "executed_at" TIMESTAMPTZ NULL,
        "completed_at" TIMESTAMPTZ NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refund_operations_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_refund_operations_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_refund_operations_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "UQ_refund_operations_tenant_idem" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "UQ_refund_operations_provider_idem" UNIQUE ("tenant_id", "provider_idempotency_key"),
        CONSTRAINT "CHK_refund_operations_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_refund_operations_status" CHECK (
          "status" IN ('REQUESTED', 'APPROVED', 'EXECUTING', 'PENDING_CONFIRMATION', 'COMPLETED', 'REJECTED', 'FAILED', 'RECONCILIATION_REQUIRED')
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_refund_operations_order"
      ON ${refunds} ("tenant_id", "order_id", "created_at" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, refunds);

    // 16. COD Receivables (Carrier COD Obligations)
    await queryRunner.query(`
      CREATE TABLE ${codReceivables} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "order_id" uuid NOT NULL,
        "fulfillment_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "carrier_code" character varying(32) NOT NULL,
        "tracking_number" character varying(64) NOT NULL,
        "expected_cod_amount" numeric(18,2) NOT NULL,
        "reported_collected_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "carrier_fee_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "adjustment_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "expected_net_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "actual_remitted_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "discrepancy_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "status" character varying(32) NOT NULL DEFAULT 'COD_RECEIVABLE_RECOGNIZED',
        "settlement_batch_id" uuid NULL,
        "journal_id" uuid NULL,
        "delivered_at" TIMESTAMPTZ NULL,
        "reconciled_at" TIMESTAMPTZ NULL,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cod_receivables_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cod_receivables_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_cod_receivables_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "UQ_cod_receivables_tenant_fulfillment" UNIQUE ("tenant_id", "fulfillment_id"),
        CONSTRAINT "UQ_cod_receivables_tenant_tracking" UNIQUE ("tenant_id", "carrier_code", "tracking_number"),
        CONSTRAINT "CHK_cod_receivables_amount" CHECK ("expected_cod_amount" > 0),
        CONSTRAINT "CHK_cod_receivables_status" CHECK (
          "status" IN ('COD_RECEIVABLE_RECOGNIZED', 'SETTLEMENT_EXPECTED', 'SETTLEMENT_RECEIVED', 'RECONCILED', 'DISCREPANCY')
        )
      )
    `);
    await enableTenantRlsPolicy(queryRunner, codReceivables);

    // 17. COD Settlement Batches & 18. COD Settlement Lines
    await queryRunner.query(`
      CREATE TABLE ${codBatches} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "carrier_code" character varying(32) NOT NULL,
        "statement_ref" character varying(128) NOT NULL,
        "file_checksum" character varying(128) NOT NULL,
        "cash_account_id" uuid NULL,
        "period_from" TIMESTAMPTZ NULL,
        "period_to" TIMESTAMPTZ NULL,
        "total_expected_cod" numeric(18,2) NOT NULL DEFAULT 0,
        "total_reported_cod" numeric(18,2) NOT NULL DEFAULT 0,
        "total_carrier_fee" numeric(18,2) NOT NULL DEFAULT 0,
        "total_net_payout" numeric(18,2) NOT NULL DEFAULT 0,
        "total_discrepancy" numeric(18,2) NOT NULL DEFAULT 0,
        "line_count" integer NOT NULL DEFAULT 0,
        "matched_count" integer NOT NULL DEFAULT 0,
        "discrepancy_count" integer NOT NULL DEFAULT 0,
        "status" character varying(32) NOT NULL DEFAULT 'IMPORTED',
        "journal_id" uuid NULL,
        "cashbook_entry_id" uuid NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "imported_by" character varying(64) NOT NULL,
        "reconciled_by" character varying(64) NULL,
        "reconciled_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cod_settlement_batches_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cod_settlement_batches_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_cod_settlement_batches_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "UQ_cod_settlement_batches_statement" UNIQUE ("tenant_id", "carrier_code", "statement_ref"),
        CONSTRAINT "UQ_cod_settlement_batches_checksum" UNIQUE ("tenant_id", "file_checksum"),
        CONSTRAINT "UQ_cod_settlement_batches_idem" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "CHK_cod_settlement_batches_status" CHECK (
          "status" IN ('IMPORTED', 'RECONCILED', 'DISCREPANCY_DETECTED')
        )
      )
    `);
    await enableTenantRlsPolicy(queryRunner, codBatches);

    await queryRunner.query(`
      CREATE TABLE ${codLines} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "batch_id" uuid NOT NULL,
        "line_no" integer NOT NULL,
        "cod_receivable_id" uuid NULL,
        "fulfillment_id" uuid NULL,
        "order_id" uuid NULL,
        "tracking_number" character varying(64) NOT NULL,
        "expected_cod_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "reported_cod_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "carrier_fee_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "net_payout_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "discrepancy_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "line_status" character varying(32) NOT NULL DEFAULT 'MATCHED',
        "discrepancy_reason" text NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cod_settlement_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cod_settlement_lines_batch_no" UNIQUE ("tenant_id", "batch_id", "line_no"),
        CONSTRAINT "FK_cod_settlement_lines_batch" FOREIGN KEY ("tenant_id", "batch_id")
          REFERENCES ${codBatches} ("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "CHK_cod_settlement_lines_status" CHECK (
          "line_status" IN ('MATCHED', 'DISCREPANCY', 'UNKNOWN_SHIPMENT', 'DUPLICATE_IN_BATCH', 'ALREADY_SETTLED')
        )
      )
    `);
    await enableTenantRlsPolicy(queryRunner, codLines);

    // 19. Shift Cash Reconciliations
    await queryRunner.query(`
      CREATE TABLE ${shiftReconciliations} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "shift_id" uuid NOT NULL,
        "shift_code" character varying(32) NOT NULL,
        "branch_id" uuid NOT NULL,
        "cash_account_id" uuid NULL,
        "staff_id" character varying(64) NOT NULL,
        "opening_cash" numeric(18,2) NOT NULL,
        "confirmed_cash_sales" numeric(18,2) NOT NULL,
        "confirmed_cash_refunds" numeric(18,2) NOT NULL,
        "other_cash_receipts" numeric(18,2) NOT NULL DEFAULT 0,
        "other_cash_expenses" numeric(18,2) NOT NULL DEFAULT 0,
        "expected_closing_cash" numeric(18,2) NOT NULL,
        "actual_counted_cash" numeric(18,2) NOT NULL,
        "variance_amount" numeric(18,2) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'RECONCILED',
        "variance_journal_id" uuid NULL,
        "reconciliation_issue_id" uuid NULL,
        "reconciled_by" character varying(64) NOT NULL,
        "reconciled_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shift_cash_reconciliations_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_shift_cash_reconciliations_shift" UNIQUE ("tenant_id", "shift_id"),
        CONSTRAINT "CHK_shift_cash_reconciliations_status" CHECK ("status" IN ('RECONCILED', 'VARIANCE_DETECTED'))
      )
    `);
    await enableTenantRlsPolicy(queryRunner, shiftReconciliations);

    // 20. Financial Adjustments (Maker-Checker Separation of Duties)
    await queryRunner.query(`
      CREATE TABLE ${adjustments} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "adjustment_type" character varying(32) NOT NULL,
        "target_type" character varying(32) NOT NULL,
        "target_id" uuid NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "direction" character varying(16) NOT NULL,
        "reason_code" character varying(48) NOT NULL,
        "explanation" text NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'PENDING_APPROVAL',
        "journal_id" uuid NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "requested_by" character varying(64) NOT NULL,
        "approved_by" character varying(64) NULL,
        "rejected_by" character varying(64) NULL,
        "approved_at" TIMESTAMPTZ NULL,
        "posted_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_financial_adjustments_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_financial_adjustments_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "UQ_financial_adjustments_tenant_code" UNIQUE ("tenant_id", "code"),
        CONSTRAINT "UQ_financial_adjustments_tenant_idem" UNIQUE ("tenant_id", "idempotency_key"),
        CONSTRAINT "CHK_financial_adjustments_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_financial_adjustments_maker_checker" CHECK (
          "approved_by" IS NULL OR "approved_by" <> "requested_by"
        ),
        CONSTRAINT "CHK_financial_adjustments_status" CHECK (
          "status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED')
        )
      )
    `);
    await enableTenantRlsPolicy(queryRunner, adjustments);

    // 21. Reconciliation Runs & 22. Reconciliation Issues
    await queryRunner.query(`
      CREATE TABLE ${reconRuns} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "code" character varying(32) NOT NULL,
        "reconciliation_type" character varying(32) NOT NULL DEFAULT 'FULL_SYSTEM',
        "status" character varying(24) NOT NULL DEFAULT 'COMPLETED',
        "processed_count" integer NOT NULL DEFAULT 0,
        "matched_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "mismatched_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "issue_count" integer NOT NULL DEFAULT 0,
        "started_by" character varying(64) NOT NULL,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMPTZ NULL,
        CONSTRAINT "PK_reconciliation_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_reconciliation_runs_tenant_id" UNIQUE ("tenant_id", "id")
      )
    `);
    await enableTenantRlsPolicy(queryRunner, reconRuns);

    await queryRunner.query(`
      CREATE TABLE ${reconIssues} (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "run_id" uuid NULL,
        "issue_type" character varying(48) NOT NULL,
        "severity" character varying(16) NOT NULL DEFAULT 'HIGH',
        "source_type" character varying(48) NOT NULL,
        "source_id" character varying(128) NOT NULL,
        "expected_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "actual_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "difference_amount" numeric(18,2) NOT NULL DEFAULT 0,
        "status" character varying(24) NOT NULL DEFAULT 'OPEN',
        "description" text NOT NULL,
        "resolution_note" text NULL,
        "resolved_by" character varying(64) NULL,
        "resolved_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reconciliation_issues_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_reconciliation_issues_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_reconciliation_issues_status" CHECK ("status" IN ('OPEN', 'INVESTIGATING', 'RESOLVED', 'IGNORED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_reconciliation_issues_tenant_status"
      ON ${reconIssues} ("tenant_id", "status", "created_at" DESC)
    `);
    await enableTenantRlsPolicy(queryRunner, reconIssues);

    // Immutability triggers for financial_journals and financial_journal_lines
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_financial_journal_immutability()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Cannot delete posted financial journal or journal line records';
        END IF;
        IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'financial_journal_lines' THEN
          RAISE EXCEPTION 'Cannot modify posted financial_journal_lines';
        END IF;
        IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'financial_journals' THEN
          IF OLD.total_debit <> NEW.total_debit OR
             OLD.total_credit <> NEW.total_credit OR
             OLD.source_type <> NEW.source_type OR
             OLD.source_id <> NEW.source_id THEN
            RAISE EXCEPTION 'Cannot mutate monetary or source fields on a posted financial_journal';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_financial_journals_immutability
      BEFORE UPDATE OR DELETE ON ${financialJournals}
      FOR EACH ROW EXECUTE FUNCTION enforce_financial_journal_immutability();
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_financial_journal_lines_immutability
      BEFORE UPDATE OR DELETE ON ${financialJournalLines}
      FOR EACH ROW EXECUTE FUNCTION enforce_financial_journal_immutability();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const t = (name: string) => qualifiedTable(queryRunner, name);
    const tables = [
      'reconciliation_issues',
      'reconciliation_runs',
      'financial_adjustments',
      'shift_cash_reconciliations',
      'cod_settlement_lines',
      'cod_settlement_batches',
      'cod_receivables',
      'refund_operations',
      'payment_settlements',
      'supplier_debt_ledger',
      'supplier_payables',
      'customer_debt_ledger',
      'customer_receivables',
      'customer_credit_authorizations',
      'customer_credit_profiles',
      'cashbook_entries',
      'cashbook_categories',
      'cash_accounts',
      'financial_journal_lines',
      'financial_journals',
      'financial_accounts',
      'finance_code_sequence',
    ];
    for (const name of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${t(name)} CASCADE`);
    }
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS enforce_financial_journal_immutability CASCADE`,
    );
  }
}
