import { Module } from '@nestjs/common';

import { AmortizationController } from './amortization.controller.js';
import { AmortizationService } from './amortization.service.js';
import { AccountingController } from './accounting.controller.js';
import { AccountingService } from './accounting.service.js';

@Module({
  controllers: [AccountingController, AmortizationController],
  providers: [AccountingService, AmortizationService],
  exports: [AccountingService, AmortizationService],
})
export class AccountingModule {}
