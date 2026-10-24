import { Module } from '@nestjs/common';

import { AccountingModule } from '../accounting/accounting.module.js';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module.js';
import { WhatsappModule } from '../integrations/whatsapp/whatsapp.module.js';
import { TreasuryModule } from '../treasury/treasury.module.js';

import { CollectionController } from './collection.controller.js';
import { CollectionService } from './collection.service.js';
import { PartiesController } from './parties.controller.js';
import { PartiesService } from './parties.service.js';
@Module({
  imports: [CustomFieldsModule, AccountingModule, TreasuryModule, WhatsappModule],
  controllers: [PartiesController, CollectionController],
  providers: [PartiesService, CollectionService],
  exports: [PartiesService],
})
export class PartiesModule {}
