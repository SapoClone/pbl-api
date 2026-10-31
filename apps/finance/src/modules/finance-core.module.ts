import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { M5_FINANCE_ENTITIES } from '../infrastructure/persistence/finance.entities';

import { CashAccountsController } from './cash-accounts/cash-accounts.controller';
import { CashAccountsService } from './cash-accounts/cash-accounts.service';
import { CashbookController } from './cashbook/cashbook.controller';
import { CashbookService } from './cashbook/cashbook.service';
import { CodController } from './cod/cod.controller';
import { CodService } from './cod/cod.service';
import { CreditAuthorizationController } from './credit-authorization/credit-authorization.controller';
import { CreditAuthorizationService } from './credit-authorization/credit-authorization.service';
import { FinancialJournalController } from './financial-journal/financial-journal.controller';
import { FinancialJournalService } from './financial-journal/financial-journal.service';
import { PayablesController } from './payables/payables.controller';
import { PayablesService } from './payables/payables.service';
import { ReceivablesController } from './receivables/receivables.controller';
import { ReceivablesService } from './receivables/receivables.service';
import { ReconciliationController } from './reconciliation/reconciliation.controller';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { RefundsController } from './refunds/refunds.controller';
import { RefundsService } from './refunds/refunds.service';
import { SettlementsController } from './settlements/settlements.controller';
import { SettlementsService } from './settlements/settlements.service';

@Module({
  imports: [TypeOrmModule.forFeature(M5_FINANCE_ENTITIES)],
  controllers: [
    FinancialJournalController,
    CashAccountsController,
    CashbookController,
    CreditAuthorizationController,
    ReceivablesController,
    PayablesController,
    SettlementsController,
    RefundsController,
    CodController,
    ReconciliationController,
  ],
  providers: [
    FinancialJournalService,
    CashAccountsService,
    CashbookService,
    CreditAuthorizationService,
    ReceivablesService,
    PayablesService,
    SettlementsService,
    RefundsService,
    CodService,
    ReconciliationService,
  ],
  exports: [
    FinancialJournalService,
    CashAccountsService,
    CashbookService,
    CreditAuthorizationService,
    ReceivablesService,
    PayablesService,
    SettlementsService,
    RefundsService,
    CodService,
    ReconciliationService,
  ],
})
export class FinanceCoreModule {}
