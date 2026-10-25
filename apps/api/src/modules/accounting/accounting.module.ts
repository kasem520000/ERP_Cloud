import { Module } from '@nestjs/common';

import { ReportingModule } from '../reporting/reporting.module.js';

import { AmortizationController } from './amortization.controller.js';
import { AmortizationService } from './amortization.service.js';
import { AccountingController } from './accounting.controller.js';
import { AccountingService } from './accounting.service.js';
import { FixedAssetsController } from './fixed-assets.controller.js';
import { FixedAssetsService } from './fixed-assets.service.js';
import { FxRevaluationController } from './fx-revaluation.controller.js';
import { FxRevaluationService } from './fx-revaluation.service.js';
import { TaxFilingsController } from './tax-filings.controller.js';
import { TaxFilingsService } from './tax-filings.service.js';

@Module({
  // MF-18 / r45 — التقرير الرسمي هو مصدر أرقام الإقرار (مصدر واحد AC2).
  imports: [ReportingModule],
  controllers: [AccountingController, AmortizationController, FixedAssetsController, FxRevaluationController, TaxFilingsController],
  providers: [AccountingService, AmortizationService, FixedAssetsService, FxRevaluationService, TaxFilingsService],
  exports: [AccountingService, AmortizationService, FixedAssetsService, TaxFilingsService],
})
export class AccountingModule {}
