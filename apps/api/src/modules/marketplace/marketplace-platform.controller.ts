import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';

import { PlatformAdminGuard, RequiresPlatformRole } from '../platform/index.js';

import { MarketplaceService } from './marketplace.service.js';

/** تسعير الكتالوج المُراجَع. لا مسار يسجّل كود طرف ثالث. */
@Controller('platform/marketplace')
@UseGuards(PlatformAdminGuard)
export class MarketplacePlatformController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('apps')
  @RequiresPlatformRole('console.marketplace.manage')
  async list() {
    return { data: await this.marketplace.platformList() };
  }

  @Put('apps/:code')
  @RequiresPlatformRole('console.marketplace.manage')
  async update(@Param('code') code: string, @Body() body: { monthlyPrice?: string; isActive?: boolean }) {
    return { data: await this.marketplace.platformUpdate(code, body ?? {}) };
  }
}
