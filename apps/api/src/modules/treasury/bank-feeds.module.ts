import { Module } from '@nestjs/common';

import { BankFeedsController } from './bank-feeds.controller.js';
import { BankFeedsService } from './bank-feeds.service.js';
import { TreasuryModule } from './treasury.module.js';

@Module({
  imports: [TreasuryModule], // MF-15 (D4): سند الرسوم يُنشأ ويُرحَّل عبر TreasuryService
  controllers: [BankFeedsController],
  providers: [BankFeedsService],
  exports: [BankFeedsService],
})
export class BankFeedsModule {}
