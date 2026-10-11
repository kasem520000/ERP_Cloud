import { Module } from '@nestjs/common';

import { VanSalesController } from './van-sales.controller.js';
import { VanSalesService } from './van-sales.service.js';

@Module({
  controllers: [VanSalesController],
  providers: [VanSalesService],
  exports: [VanSalesService],
})
export class VanSalesModule {}
