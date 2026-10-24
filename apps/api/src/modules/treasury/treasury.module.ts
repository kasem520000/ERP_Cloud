import { Module } from '@nestjs/common';

import { AccountingModule } from '../accounting/accounting.module.js';
import { OrganizationModule } from '../organization/organization.module.js';
import { DeveloperModule } from '../developer/developer.module.js';
import { ApprovalModule } from '../approvals/approvals.module.js';

import { TreasuryController } from './treasury.controller.js';
import { TreasuryService } from './treasury.service.js';
import { TreasuryApprovalHandler } from './treasury-approval.handler.js';
import { AssetDisposalController } from './asset-disposal.controller.js';
import { AssetDisposalService } from './asset-disposal.service.js';

@Module({
  imports: [AccountingModule, OrganizationModule, DeveloperModule, ApprovalModule],
  controllers: [TreasuryController, AssetDisposalController],
  providers: [TreasuryService, TreasuryApprovalHandler, AssetDisposalService],
  exports: [TreasuryService, AssetDisposalService],
})
export class TreasuryModule {}
