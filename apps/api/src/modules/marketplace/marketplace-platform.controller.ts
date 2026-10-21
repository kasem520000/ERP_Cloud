import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { tryGetAuthContext } from '../../request-context/request-context.js';
import { PlatformAdminGuard, RequiresPlatformRole } from '../platform/index.js';

import { MarketplaceService } from './marketplace.service.js';

/** تسعير الكتالوج المُراجَع وإدارة طلبات تفعيل الباقات للمنشآت. */
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

  @Get('requests')
  @RequiresPlatformRole('console.marketplace.manage')
  async listRequests(@Query('status') status?: string) {
    return { data: await this.marketplace.platformListRequests(status) };
  }

  @Post('requests/:id/decide')
  @RequiresPlatformRole('console.marketplace.manage')
  async decideRequest(
    @Param('id') id: string,
    @Body() body: { decision?: 'approved' | 'rejected'; note?: string },
  ) {
    const actorUserId = tryGetAuthContext()?.userId;
    return {
      data: await this.marketplace.platformDecideRequest(
        id,
        actorUserId,
        body?.decision === 'rejected' ? 'rejected' : 'approved',
        body?.note,
      ),
    };
  }

  /**
   * 📊 قياسُ الاستعمال غير المرخّص للباقات القطاعية — القراءة التي يُتّخذ عليها قرارُ قلب
   * ‏`observe` إلى `enforce`: أيّ المنشآت تكتب على سطحٍ بلا باقة، كم مرّةً، ومنذ متى، وكم عملاً
   * حقيقياً في جداول التوزيع سيقف لو فُرض الترخيص غدًا. قراءةٌ فقط، فلا تُغيّر وضع الحارس.
   */
  @Get('unlicensed-usage')
  @RequiresPlatformRole('console.marketplace.manage')
  async unlicensedUsage(@Query('days') days?: string) {
    return { data: await this.marketplace.platformUnlicensedUsage({ days }) };
  }

  @Get('tenants/:tenantId/apps')
  @RequiresPlatformRole('console.marketplace.manage')
  async tenantApps(@Param('tenantId') tenantId: string) {
    return { data: await this.marketplace.platformTenantApps(tenantId) };
  }

  @Put('tenants/:tenantId/apps/:code')
  @RequiresPlatformRole('console.marketplace.manage')
  async toggleTenantApp(
    @Param('tenantId') tenantId: string,
    @Param('code') code: string,
    @Body() body: { enabled?: boolean },
  ) {
    const actorUserId = tryGetAuthContext()?.userId;
    return {
      data: await this.marketplace.platformToggleTenantApp(
        tenantId,
        actorUserId,
        code,
        body?.enabled !== false,
      ),
    };
  }
}
