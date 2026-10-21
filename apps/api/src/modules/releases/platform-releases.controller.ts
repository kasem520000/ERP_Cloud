import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  idParamSchema,
  platformReleaseReasonSchema,
  platformReleaseUploadSchema,
  type IdParam,
  type PlatformRelease,
  type PlatformReleaseList,
  type PlatformReleaseReason,
  type PlatformReleaseUpload,
} from '@erp/contracts';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { getAuthContext } from '../../request-context/request-context.js';
import { RequiresPlatformRole } from '../platform/decorators/requires-platform-role.decorator.js';
import { PlatformAdminGuard } from '../platform/guards/platform-admin.guard.js';

import { ReleasesService } from './releases.service.js';

/**
 * 🗜️ لوحة تحديثات المنصّة — أربعة مسارات:
 *
 *   `GET  /platform/releases`              — السجلّ (والحالي)؛    `console.releases.view`
 *   `POST /platform/releases`              — رفع حزمة؛            `console.releases.manage`
 *   `POST /platform/releases/:id/promote`  — إعلانها للمستأجرين؛  `console.releases.manage`
 *   `POST /platform/releases/:id/revoke`   — سحبها؛                `console.releases.manage`
 *
 * **ولا مسار حذف**، ولا مسار «تنزيل الحزمة»: لا نحتفظ بالبايتات أصلاً (انظر
 * `releases.service.ts`). الحزمة تُقاس وتُسجَّل، والملفّ يبقى عند من بناه.
 *
 * والرمزين مفصولان لأن **من يرفع ليس بالضرورة من يعلن**: التشغيل يرفع حزمةَ الليل
 * للتجربة، وصاحب المنصّة يقرّر أن يراها كل المستأجرين. وهذا هو نفس الفصل الذي فرضه
 * `console.content.view/manage` و`console.leads.view/manage`.
 */
@ApiTags('platform-releases')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform/releases')
export class PlatformReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get()
  @RequiresPlatformRole('console.releases.view')
  @ApiOperation({ summary: 'سجلّ حزم التحديث، والحاليّة المعروضة على المستأجرين' })
  @ApiOkResponse({ description: 'Release ledger' })
  async list(): Promise<{ data: PlatformReleaseList }> {
    return { data: await this.releases.list() };
  }

  @Post()
  @HttpCode(201)
  @RequiresPlatformRole('console.releases.manage')
  @ApiOperation({ summary: 'رفع حزمة تحديث (ZIP يحمل release.json) — تُقاس ولا تُنفَّذ' })
  @ApiResponse({ status: 201, description: 'الحزمة المقبولة، مقيسةً ومسجَّلة' })
  @ApiResponse({ status: 409, description: 'رقم الإصدار مسجّلٌ مسبقاً على القناة نفسها' })
  @ApiResponse({
    status: 422,
    description: 'حزمةٌ تالفة أو تحمل ما لا يُقبل — يُسجَّل الرفض في السجلّ ويُعاد سببه',
  })
  async upload(
    @Body(new ZodValidationPipe(platformReleaseUploadSchema)) body: PlatformReleaseUpload,
  ): Promise<{ data: PlatformRelease }> {
    return { data: await this.releases.upload(body, getAuthContext().userId) };
  }

  @Post(':id/promote')
  @HttpCode(200)
  @RequiresPlatformRole('console.releases.manage')
  @ApiOperation({ summary: 'إعلان إصدارٍ مقبولٍ حاليّاً على قناته، بسحب العلم من سابقه' })
  async promote(
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(platformReleaseReasonSchema)) body: PlatformReleaseReason,
  ): Promise<{ data: PlatformRelease }> {
    return { data: await this.releases.promote(params.id, body, getAuthContext().userId) };
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequiresPlatformRole('console.releases.manage')
  @ApiOperation({ summary: 'سحب إصدارٍ من العرض، وإعادة إعلان آخر مقبولٍ على قناته' })
  async revoke(
    @Param(new ZodValidationPipe(idParamSchema)) params: IdParam,
    @Body(new ZodValidationPipe(platformReleaseReasonSchema)) body: PlatformReleaseReason,
  ): Promise<{ data: PlatformRelease }> {
    return { data: await this.releases.revoke(params.id, body, getAuthContext().userId) };
  }
}
