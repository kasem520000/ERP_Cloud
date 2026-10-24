import { Module } from '@nestjs/common';

import { AmortizationController } from './amortization.controller.js';
import { AmortizationService } from './amortization.service.js';
import { AccountingController } from './accounting.controller.js';
import { AccountingService } from './accounting.service.js';
import { FixedAssetsController } from './fixed-assets.controller.js';
import { FixedAssetsService } from './fixed-assets.service.js';

@Module({
  controllers: [AccountingController, AmortizationController, FixedAssetsController],
  providers: [AccountingService, AmortizationService, FixedAssetsService],
  exports: [AccountingService, AmortizationService, FixedAssetsService],
})
export class AccountingModule {}
