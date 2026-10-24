import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { getTenantContext } from '../platform/context/tenant-context.js';
import { RequiresPermission } from '../platform/decorators/requires-permission.decorator.js';

import { AssetDisposalService, type AssetDisposalInput } from './asset-disposal.service.js';

/**
 * MF-21 — مسارات استبعاد/بيع الأصول الثابتة. بوحدة الخزينة عمداً: البيع
 * يستدعي سند القبض نفسه (treasury→accounting وحيد الاتجاه) — انظر
 * `asset-disposal.service.ts` للتدفّق والضمانات.
 */
@ApiTags('accounting')
@Controller()
export class AssetDisposalController {
  constructor(private readonly disposals: AssetDisposalService) {}

  @Post('fixed-assets/:id/disposals')
  @RequiresPermission('accounting.journal.post')
  @ApiOperation({ summary: 'بيع (عائد ⇐ سند قبض) أو تخفيض أصل ثابت — كامل أو بنسبة' })
  async createDisposal(@Param('id') id: string, @Body() body: AssetDisposalInput) {
    return { data: await this.disposals.createDisposal(getTenantContext().tenantId, id, body) };
  }

  @Get('fixed-assets/:id/disposals')
  @RequiresPermission('accounting.reports.view')
  async listDisposals(@Param('id') id: string) {
    return { data: await this.disposals.listDisposals(getTenantContext().tenantId, id) };
  }
}
