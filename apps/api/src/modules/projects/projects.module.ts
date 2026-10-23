import { Module } from '@nestjs/common';

import { AccountingModule } from '../accounting/accounting.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { PlatformServicesModule } from '../platform-services/index.js';
import { SalesModule } from '../sales/sales.module.js';
import { TreasuryModule } from '../treasury/treasury.module.js';

import { ContractingController } from './contracting.controller.js';
import { ContractingReturnsController } from './contracting-returns.controller.js';
import { ContractingReturnsService } from './contracting-returns.service.js';
import { ContractingService } from './contracting.service.js';
import { ProjectKanbanController } from './project-kanban.controller.js';
import { ProjectKanbanService } from './project-kanban.service.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [DatabaseModule, PlatformServicesModule, SalesModule, TreasuryModule, AccountingModule, OrganizationModule],
  controllers: [ProjectKanbanController, ProjectsController, ContractingController, ContractingReturnsController],
  providers: [ProjectsService, ProjectKanbanService, ContractingService, ContractingReturnsService],
  exports: [ProjectsService, ProjectKanbanService, ContractingService, ContractingReturnsService],
})
export class ProjectsModule {}
