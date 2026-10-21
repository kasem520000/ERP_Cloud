import { Module } from '@nestjs/common';

import { PlatformModule } from '../platform/platform.module.js';
import { PlatformServicesModule } from '../platform-services/platform-services.module.js';

import { PlatformReleasesController } from './platform-releases.controller.js';
import { ReleasesService } from './releases.service.js';
import { TenantReleaseController } from './tenant-release.controller.js';

/**
 * 🗜️ وحدة تحديثات المنصّة.
 *
 * `PlatformModule` يوفّر `PlatformAdminGuard` (سطح اللوحة)، و`PlatformServicesModule`
 * يوفّر `AuditService` (كل رفعٍ وإعلانٍ وسحبٍ يُدقَّق). والوحدة لا تصدّر الخدمة: لا وحدة
 * أخرى تحتاج قراءة سجلّ الإصدارات — والمستأجر يقرأ سطراً واحداً عبر مساره.
 *
 * ولا تعتمد على `ObjectStorage`: الحزمة لا تُخزَّن (انظر رأس `releases.service.ts`).
 */
@Module({
  imports: [PlatformModule, PlatformServicesModule],
  controllers: [PlatformReleasesController, TenantReleaseController],
  providers: [ReleasesService],
})
export class ReleasesModule {}
