import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { getTenantContext } from '../platform/context/tenant-context.js';
import { RequiresPermission } from '../platform/decorators/requires-permission.decorator.js';

import {
  AmortizationService,
  type AmortizationScheduleInput,
  type GenerateInstallmentInput,
} from './amortization.service.js';

/**
 * MF-22 — جداول المصروفات المقدّمة والمستحقة (دفقة D7).
 *
 * ثلاثة مسارات فقط: إنشاء الجدول من سند/فاتورة/بمفرده، عرض الأرصدة، وتوليد قسط
 * فترة محددة (POST واحدة لكل فترة — لا توليد دفعة يخفي فترة مقفلة داخلها).
 */
@ApiTags('accounting')
@Controller()
export class AmortizationController {
  constructor(private readonly amortization: AmortizationService) {}

  @Post('amortization-schedules')
  @RequiresPermission('accounting.journal.post')
  @ApiOperation({ summary: 'إنشاء جدول إطفاء/استحقاق من سند صرف أو فاتورة شراء أو بمفرده' })
  async createSchedule(@Body() body: AmortizationScheduleInput) {
    return { data: await this.amortization.createSchedule(getTenantContext().tenantId, body) };
  }

  @Get('amortization-schedules')
  @RequiresPermission('accounting.reports.view')
  @ApiOperation({ summary: 'قوائم الجداول بأرصدتها (مقدّم/مستحق)' })
  async listSchedules() {
    return { data: await this.amortization.listSchedules(getTenantContext().tenantId) };
  }

  @Post('amortization-schedules/:id/generate')
  @RequiresPermission('accounting.journal.post')
  @ApiOperation({ summary: 'توليد قيد قسط فترة معيّنة (مرفوض مع تكرار أو فترة مغلقة)' })
  async generateSchedule(@Param('id') id: string, @Body() body: GenerateInstallmentInput) {
    return { data: await this.amortization.generate(getTenantContext().tenantId, id, body ?? {}) };
  }
}
