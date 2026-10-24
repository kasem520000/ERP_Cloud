import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { getTenantContext } from '../platform/context/tenant-context.js';
import { RequiresPermission } from '../platform/decorators/requires-permission.decorator.js';

import {
  FixedAssetsService,
  type AssetCategoryInput,
  type DepreciationRunInput,
  type FixedAssetInput,
} from './fixed-assets.service.js';

/**
 * MF-21 — الأصول الثابتة (دفقة D8): فئات، سجل أصول برسملة، تشغيلات إهلاك
 * شهرية (معاينة ثم ترحيل)، وتحرّك الإهلاك. الاستبعاد/البيع يُعالج في مسار
 * منفصل (`asset-disposal.controller` بوحدة الخزينة) لأنه يستدعي سند القبض
 * نفسه — الاتجاه الوحيد المسموح treasury→accounting بلا دورة.
 */
@ApiTags('accounting')
@Controller()
export class FixedAssetsController {
  constructor(private readonly fixedAssets: FixedAssetsService) {}

  @Post('asset-categories')
  @RequiresPermission('accounting.journal.post')
  @ApiOperation({ summary: 'تعريف فئة أصول ثابتة (حسابات + طريقة الإهلاك + العمر)' })
  async createCategory(@Body() body: AssetCategoryInput) {
    return { data: await this.fixedAssets.createCategory(getTenantContext().tenantId, body) };
  }

  @Get('asset-categories')
  @RequiresPermission('accounting.reports.view')
  async listCategories() {
    return { data: await this.fixedAssets.listCategories(getTenantContext().tenantId) };
  }

  @Post('fixed-assets')
  @RequiresPermission('accounting.journal.post')
  @ApiOperation({ summary: 'تسجيل أصل (يدوي/من قيد/من فاتورة شراء مع انقلال اختياري)' })
  async createAsset(@Body() body: FixedAssetInput) {
    return { data: await this.fixedAssets.createAsset(getTenantContext().tenantId, body) };
  }

  @Get('fixed-assets')
  @RequiresPermission('accounting.reports.view')
  @ApiOperation({ summary: 'سجل الأصول بأرصدته المشتقة (مُهلك/صافي)' })
  async listAssets() {
    return { data: await this.fixedAssets.listAssets(getTenantContext().tenantId) };
  }

  @Post('fixed-assets/depreciation-runs')
  @RequiresPermission('accounting.journal.post')
  @ApiOperation({ summary: 'معاينة تشغيل إهلاك شهر (بلا قيد — يُرحَّل بخطوة منفصلة)' })
  async createRun(@Body() body: DepreciationRunInput) {
    return { data: await this.fixedAssets.createRun(getTenantContext().tenantId, body) };
  }

  @Get('fixed-assets/depreciation-runs')
  @RequiresPermission('accounting.reports.view')
  async listRuns() {
    return { data: await this.fixedAssets.listRuns(getTenantContext().tenantId) };
  }

  @Get('fixed-assets/depreciation-runs/:id')
  @RequiresPermission('accounting.reports.view')
  async getRun(@Param('id') id: string) {
    return { data: await this.fixedAssets.getRun(getTenantContext().tenantId, id) };
  }

  @Post('fixed-assets/depreciation-runs/:id/post')
  @RequiresPermission('accounting.journal.post')
  @ApiOperation({ summary: 'ترحيل تشغيل الإهلاك (قيد واحد مجمَّع — بلا تكرار وبلا فترة مغلقة)' })
  async postRun(@Param('id') id: string) {
    return { data: await this.fixedAssets.postRun(getTenantContext().tenantId, id) };
  }

  @Get('statements/fixed-asset-register')
  @RequiresPermission('accounting.reports.view')
  @ApiOperation({ summary: 'تقرير سجل الأصول الثابتة (تكلفة/مُهلك/صافي)' })
  async registerStatement() {
    return this.fixedAssets.registerStatement(getTenantContext().tenantId);
  }

  @Get('statements/depreciation-movement')
  @RequiresPermission('accounting.reports.view')
  @ApiOperation({ summary: 'تقرير حركة الإهلاك (أسطر التشغيلات المرحَّلة)' })
  async movementStatement(@Query('from') from?: string, @Query('to') to?: string) {
    return this.fixedAssets.movementStatement(getTenantContext().tenantId, from, to);
  }
}
