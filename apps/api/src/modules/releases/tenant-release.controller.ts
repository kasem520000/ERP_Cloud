import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { TenantReleaseInfo } from '@erp/contracts';

import { ReleasesService } from './releases.service.js';

/**
 * 🗜️ «أيُّ إصدارٍ أعمل عليه؟» — سؤالٌ يُسأل للدعم في كل تذكرة، فجوابه في مسارٍ يقرؤه
 * أي مستخدمٍ مسجّل، بلا رمز منصّة.
 *
 * وبلا `PlatformAdminGuard` **عمداً**: المستأجر يرى الإصدار وأربعة حقولٍ عنه، ولا يرى
 * السجلّ ولا البصمة ولا اسم ملفّ الحزمة — وقراءةُ السطر الواحد تقع في الخدمة لا هنا،
 * فالاستعلام لا يُمرَّر من الطلب.
 *
 * والمسار `/releases/current` لا تحت `platform/`: الإصدار إصدارُ المنصّة لا إصدارُ منشأة،
 * لكنّ قراءته ليست صلاحية منصّة — من يفتح تذكرة دعم يحتاج رقمه، لا سجلَّ النشر.
 */
@ApiTags('releases')
@ApiBearerAuth()
@Controller('releases')
export class TenantReleaseController {
  constructor(private readonly releases: ReleasesService) {}

  @Get('current')
  @ApiOperation({ summary: 'الإصدار المعروض الآن على المنصّة (كما في «حول النظام»)' })
  @ApiOkResponse({ description: 'Current release, or null before the first accepted bundle' })
  async current(): Promise<{ data: TenantReleaseInfo }> {
    return { data: await this.releases.currentForTenants() };
  }
}
