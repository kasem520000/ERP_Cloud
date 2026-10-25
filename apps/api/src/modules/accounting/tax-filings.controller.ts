import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { getTenantContext, tryGetAuthContext } from '../platform/context/tenant-context.js';
import { RequiresPermission } from '../platform/decorators/requires-permission.decorator.js';

import { TaxFilingsService } from './tax-filings.service.js';

/**
 * MF-18 / r45 / D11 — `POST /tax/filings` تقديم إقرار (تجميد + تسوية + قفل الفترة) ·
 * `GET /tax/filings` السجل · `GET /tax/filings/:id` اللقطة المجمَّدة (AC1).
 * الصلاحيات بلا إضافة: التقديم = `accounting.period.close` (يقيّد ويقفل كما هو) ·
 * القراءة = `accounting.period.view` · المعاينة من `GET /reports/vat-return-period`.
 */
@ApiTags('tax')
@Controller('tax')
export class TaxFilingsController {
  constructor(private readonly filings: TaxFilingsService) {}

  @Post('filings')
  @HttpCode(201)
  @RequiresPermission('accounting.period.close')
  @ApiOperation({ summary: 'تقديم إقرار ضريبي: يجمّد التقرير ويقيّد الصافي ويقفل الفترة' })
  async file(
    @Body() body: { from?: string; to?: string; payableAccountId?: string; refundableAccountId?: string },
  ) {
    const context = getTenantContext();
    return {
      data: await this.filings.file(context.tenantId, tryGetAuthContext()?.userId ?? null, body ?? {}),
    };
  }

  @Get('filings')
  @RequiresPermission('accounting.period.view')
  @ApiOperation({ summary: 'سجل الإقرارات المقدَّمة' })
  async list() {
    return { data: await this.filings.list(getTenantContext().tenantId) };
  }

  @Get('filings/:id')
  @RequiresPermission('accounting.period.view')
  @ApiOperation({ summary: 'تفاصيل إقرار مقدَّم (اللقطة المجمَّدة)' })
  async detail(@Param('id') id: string) {
    return { data: await this.filings.detail(getTenantContext().tenantId, id) };
  }
}
