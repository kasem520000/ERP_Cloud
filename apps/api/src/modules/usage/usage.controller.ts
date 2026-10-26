import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  createUsageRequestSchema,
  usagePeriodSchema,
  type CreateUsageRequestInput,
  type UsageAvailablePlan,
  type UsageRequest,
  type UsageSnapshot,
} from '@erp/contracts';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { getAuthContext } from '../../request-context/request-context.js';
import { getTenantContext } from '../platform/context/tenant-context.js';
import { RequiresPermission } from '../platform/decorators/requires-permission.decorator.js';

import { UsageService } from './usage.service.js';

@ApiTags('usage')
@ApiBearerAuth()
@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  @RequiresPermission('tenant.view')
  @ApiQuery({ name: 'period', required: false, description: 'الشهر بصيغة YYYY-MM (افتراضاً: هذا الشهر)' })
  @ApiOperation({ summary: 'استهلاك منشأتي مقابل حدودها وباقتها الحالية' })
  @ApiOkResponse({ description: 'Usage snapshot for the calling tenant' })
  async snapshot(
    @Query('period', new ZodValidationPipe(usagePeriodSchema.optional())) period?: string,
  ): Promise<{ data: UsageSnapshot }> {
    const tenant = getTenantContext();
    return { data: await this.usage.snapshotForTenant(tenant.tenantId, period) };
  }

  @Get('plans')
  @RequiresPermission('tenant.view')
  @ApiOperation({ summary: 'الباقات النشطة المتاحة لطلب الترقية من المنشأة' })
  async plans(): Promise<{ data: UsageAvailablePlan[] }> {
    return { data: await this.usage.listAvailablePlansForTenant() };
  }

  @Get('requests')
  @RequiresPermission('tenant.view')
  @ApiOperation({ summary: 'طلبات المنشأة لرفع الحصص أو تفعيل المزايا أو ترقية الباقة' })
  async listRequests(): Promise<{ data: UsageRequest[] }> {
    const tenant = getTenantContext();
    return { data: await this.usage.listRequestsForTenant(tenant.tenantId) };
  }

  @Post('requests')
  @RequiresPermission('tenant.view')
  @ApiOperation({ summary: 'تقديم طلب لإدارة المنصة لاعتماد رفع حصة أو تفعيل ميزة أو ترقية باقة' })
  async createRequest(
    @Body(new ZodValidationPipe(createUsageRequestSchema)) body: CreateUsageRequestInput,
  ): Promise<{ data: UsageRequest }> {
    const tenant = getTenantContext();
    const auth = getAuthContext();
    return { data: await this.usage.createRequest(tenant.tenantId, auth.userId, body) };
  }
}
