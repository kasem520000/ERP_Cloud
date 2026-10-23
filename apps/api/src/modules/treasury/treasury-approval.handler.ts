import { Injectable, type OnModuleInit } from '@nestjs/common';
import { APPROVAL_APPROVED_EVENT } from '@erp/contracts';

import { DomainEventsService } from '../../events/domain-events.service.js';

import { TreasuryService, type VoucherPostInput } from './treasury.service.js';

/** Completes the voucher posting only after the final approval transaction commits. */
@Injectable()
export class TreasuryApprovalHandler implements OnModuleInit {
  constructor(
    private readonly events: DomainEventsService,
    private readonly treasury: TreasuryService,
  ) {}

  onModuleInit(): void {
    this.events.on(APPROVAL_APPROVED_EVENT, async (event) => {
      if (event.payload.entityType !== 'voucher' || !event.tenantId) return;
      const posting =
        event.payload.posting && typeof event.payload.posting === 'object'
          ? (event.payload.posting as VoucherPostInput)
          : {};
      await this.treasury.postApprovedVoucher(event.tenantId, String(event.payload.entityId), posting);
    });
  }
}
