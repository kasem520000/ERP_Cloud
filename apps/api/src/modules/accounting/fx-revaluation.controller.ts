import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { getTenantContext } from '../platform/context/tenant-context.js';
import { RequiresPermission } from '../platform/decorators/requires-permission.decorator.js';

import { FxRevaluationService } from './fx-revaluation.service.js';

/**
 * MF-28 / r46 / D12 — `POST /accounting/fx-revaluation-runs` تشغيل تاريخ (قيد غير محقَّق +
 * عكس آلي) · `GET` السجل · `GET :id`. الأذونات بلا إضافة: التشغيل = `accounting.journal.post`
 * (يقيّد) · القراءة = `organization.currency.view` (نطاق العملات) — clerk بلاهما ⇒ 403.
 */
@ApiTags('accounting')
@Controller('accounting/fx-revaluation-runs')
export class FxRevaluationController {
  constructor(private readonly revaluation: FxRevaluationService) {}

  @Post()
  @HttpCode(201)
  @RequiresPermission('accounting.journal.post')
  @ApiOperation({ summary: 'تشغيل إعادة تقييم عملاتي ليوم: قيد غير محقَّق + عكسه الآلي (صفر بلا قيد)' })
  async run(@Body() body: { date?: string; branchId?: string }) {
    const context = getTenantContext();
    return {
      data: await this.revaluation.createRun(context.tenantId, body ?? {}),
    };
  }

  @Get()
  @RequiresPermission('organization.currency.view')
  @ApiOperation({ summary: 'سجل عمليات إعادة التقييم' })
  async list() {
    return { data: await this.revaluation.list(getTenantContext().tenantId) };
  }

  @Get(':id')
  @RequiresPermission('organization.currency.view')
  @ApiOperation({ summary: 'تفاصيل تشغيل إعادة تقييم (القيود واللقطة)' })
  async detail(@Param('id') id: string) {
    return { data: await this.revaluation.detail(getTenantContext().tenantId, id) };
  }
}
