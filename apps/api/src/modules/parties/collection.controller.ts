import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { getTenantContext } from '../platform/context/tenant-context.js';
import { RequiresPermission } from '../platform/decorators/requires-permission.decorator.js';

import {
  CollectionService,
  type ProvisionInput,
  type RecoveryInput,
  type ReminderRuleInput,
  type SendReminderInput,
  type WriteoffInput,
} from './collection.service.js';

/**
 * MF-17 / D9 — إدارة التحصيل (r43 §3): صلاحيات بلا إضافة —
 * قواعد/تذكير/مسوّدة = parties.manage · اعتماد وقيد = accounting.journal.post ·
 * استرداد = treasury.voucher.create · عرض = parties.view / accounting.reports.view.
 */
@Controller()
export class CollectionController {
  constructor(private readonly collection: CollectionService) {}

  @Get('ar-reminders')
  @RequiresPermission('parties.view')
  listRules() {
    return this.collection.listRules(getTenantContext().tenantId);
  }

  @Post('ar-reminders')
  @RequiresPermission('parties.manage')
  createRule(@Body() body: ReminderRuleInput) {
    return this.collection.createRule(getTenantContext().tenantId, body);
  }

  @Patch('ar-reminders/:id')
  @RequiresPermission('parties.manage')
  updateRule(@Param('id') id: string, @Body() body: Partial<ReminderRuleInput>) {
    return this.collection.updateRule(getTenantContext().tenantId, id, body);
  }

  @Post('parties/:id/send-reminder')
  @RequiresPermission('parties.manage')
  sendReminder(@Param('id') id: string, @Body() body: SendReminderInput) {
    return this.collection.sendReminder(getTenantContext().tenantId, id, body ?? {});
  }

  @Post('ar-provisions')
  @RequiresPermission('accounting.journal.post')
  createProvision(@Body() body: ProvisionInput) {
    return this.collection.createProvision(getTenantContext().tenantId, body);
  }

  @Get('ar-provisions')
  @RequiresPermission('accounting.reports.view')
  listProvisions() {
    return this.collection.listProvisions(getTenantContext().tenantId);
  }

  @Post('ar-writeoffs')
  @RequiresPermission('parties.manage')
  createWriteoff(@Body() body: WriteoffInput) {
    return this.collection.createWriteoff(getTenantContext().tenantId, body);
  }

  @Get('ar-writeoffs')
  @RequiresPermission('accounting.reports.view')
  listWriteoffs() {
    return this.collection.listWriteoffs(getTenantContext().tenantId);
  }

  @Post('ar-writeoffs/:id/approve')
  @RequiresPermission('accounting.journal.post')
  approve(@Param('id') id: string) {
    return this.collection.approveWriteoff(getTenantContext().tenantId, id);
  }

  @Post('ar-writeoffs/:id/recovery')
  @RequiresPermission('treasury.voucher.create')
  recovery(@Param('id') id: string, @Body() body: RecoveryInput) {
    return this.collection.recovery(getTenantContext().tenantId, id, body);
  }
}
