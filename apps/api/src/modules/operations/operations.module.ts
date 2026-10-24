import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { jobTypes } from '@erp/contracts';

import { DatabaseModule } from '../../database/database.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { PlatformAdminModule } from '../platform/admin/platform-admin.module.js';
import { JobHandlerRegistry } from '../platform-services/jobs/job-handlers.js';
import { PlatformServicesModule } from '../platform-services/platform-services.module.js';

import { BackupService } from './backup.service.js';
import { CompanyFilesService } from './company-files.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { OperationsController } from './operations.controller.js';

@Module({
  imports: [DatabaseModule, OrganizationModule, PlatformAdminModule, PlatformServicesModule],
  controllers: [OperationsController],
  providers: [BackupService, MaintenanceService, CompanyFilesService],
  exports: [BackupService, MaintenanceService, CompanyFilesService],
})
export class OperationsModule implements OnModuleInit {
  private readonly logger = new Logger(OperationsModule.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly backups: BackupService,
  ) {}

  /** MF-35 — النسخة اليومية المجدولة: معالج الطابور يُسجَّل من هنا لا من ملف عامّ. */
  onModuleInit(): void {
    this.registry.register('maintenance', jobTypes.BACKUP_DAILY, async (context) => {
      const result = await this.backups.dailyBackup(context.tenantId);
      this.logger.log(
        { tenantId: context.tenantId, backupId: result.backupId, totalRows: result.totalRows, pruned: result.pruned },
        'scheduled daily backup finished',
      );
    });
    this.logger.log('backup.daily handler registered on the maintenance queue');
  }
}
