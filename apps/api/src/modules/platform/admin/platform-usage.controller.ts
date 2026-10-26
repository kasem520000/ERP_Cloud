import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  reviewUsageRequestSchema,
  usagePeriodSchema,
  usageRequestStatusSchema,
  uuidSchema,
  type PlatformUsageGridResponse,
  type ReviewUsageRequestInput,
  type UsageRequest,
  type UsageRequestStatus,
  type UsageSnapshot,
} from '@erp/contracts';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { getAuthContext } from '../../../request-context/request-context.js';
import { UsageService } from '../../usage/index.js';
import { RequiresPlatformRole } from '../decorators/requires-platform-role.decorator.js';
import { PlatformAdminGuard } from '../guards/platform-admin.guard.js';

@ApiTags('platform-usage')
@ApiBearerAuth()
@Controller('platform/usage')
@UseGuards(PlatformAdminGuard)
export class PlatformUsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  @RequiresPlatformRole('console.tenants.view')
  @ApiQuery({ name: 'tenantId', required: false, description: 'عميلٌ واحد؛ وبغيابه الشبكة كلها' })
  @ApiQuery({ name: 'period', required: false, description: 'الشهر بصيغة YYYY-MM' })
  @ApiOperation({ summary: 'شبكة الاستخدام عبر العملاء، أو لقطة عميلٍ واحد' })
  @ApiOkResponse({ description: 'Usage grid (or a single tenant snapshot when tenantId is given)' })
  async grid(
    @Query('tenantId', new ZodValidationPipe(uuidSchema.optional())) tenantId?: string,
    @Query('period', new ZodValidationPipe(usagePeriodSchema.optional())) period?: string,
  ): Promise<{ data: PlatformUsageGridResponse | UsageSnapshot }> {
    if (tenantId) return { data: await this.usage.snapshotForPlatform(tenantId, period) };
    return { data: await this.usage.grid(period) };
  }

  @Get('requests')
  @RequiresPlatformRole('console.tenants.view')
  @ApiQuery({ name: 'status', required: false, description: 'pending | approved | rejected' })
  @ApiOperation({ summary: 'طلبات المنشآت لاعتماد رفع الحصص وتفعيل المزايا وترقية الباقات' })
  async listRequests(
    @Query('status', new ZodValidationPipe(usageRequestStatusSchema.optional())) status?: UsageRequestStatus,
  ): Promise<{ data: UsageRequest[] }> {
    return { data: await this.usage.listRequestsForPlatform(status) };
  }

  @Post('requests/:id/review')
  @RequiresPlatformRole('console.billing.manage')
  @ApiOperation({ summary: 'اعتماد أو رفض طلب حصة/ترقية منشأة مع تطبيق الحصة المعتمدة تلقائياً' })
  async reviewRequest(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(reviewUsageRequestSchema)) body: ReviewUsageRequestInput,
  ): Promise<{ data: UsageRequest }> {
    const auth = getAuthContext();
    return { data: await this.usage.reviewRequest(id, auth.userId, body) };
  }

  @Get('export.csv')
  @RequiresPlatformRole('console.billing.manage')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="platform-usage.csv"')
  @ApiProduces('text/csv')
  @ApiQuery({ name: 'period', required: false, description: 'الشهر بصيغة YYYY-MM' })
  @ApiOperation({ summary: 'بيان الاستخدام الشهري (كل عميل × كل مقياس) ملفَّ CSV' })
  async exportCsv(
    @Query('period', new ZodValidationPipe(usagePeriodSchema.optional())) period?: string,
  ): Promise<string> {
    const rows = await this.usage.exportRows(period);
    return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
