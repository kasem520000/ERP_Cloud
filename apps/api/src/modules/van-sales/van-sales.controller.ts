import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { getTenantContext } from '../platform/context/tenant-context.js';
import { RequiresPermission } from '../platform/decorators/requires-permission.decorator.js';

import { VanSalesService } from './van-sales.service.js';

@ApiTags('van-sales')
@ApiBearerAuth()
@Controller('van-sales')
export class VanSalesController {
  constructor(private readonly vanSales: VanSalesService) {}

  @Get('dashboard')
  @RequiresPermission('sales.view')
  async dashboard() {
    const { tenantId } = getTenantContext();
    return { data: await this.vanSales.dashboard(tenantId) };
  }

  @Post('production-batches')
  @RequiresPermission('sales.invoice.create')
  async createProductionBatch(
    @Body()
    body: {
      batchNo?: string;
      itemId?: string | null;
      itemName?: string;
      producedQty?: string;
      unitCost?: string;
      supervisorName?: string;
      notes?: string;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.createProductionBatch(tenantId, userId, body ?? {}) };
  }

  @Post('customer-prices')
  @RequiresPermission('sales.invoice.create')
  async upsertCustomerPrice(
    @Body()
    body: {
      partyId?: string;
      itemId?: string | null;
      priceTierLabel?: string;
      unitPrice?: string;
      maxBonusPct?: string;
      maxBonusKgPerInvoice?: string;
      preferredInvoiceMode?: 'zatca_tax' | 'internal_delivery';
      creditLimit?: string;
      paymentTermsDays?: number;
      lockPrice?: boolean;
      maxDiscountPct?: string;
      notes?: string;
    },
  ) {
    const { tenantId } = getTenantContext();
    return { data: await this.vanSales.upsertCustomerPrice(tenantId, body ?? {}) };
  }

  @Post('load-orders')
  @RequiresPermission('sales.invoice.create')
  async createLoadOrder(
    @Body()
    body: {
      salesmanId?: string;
      branchId?: string | null;
      warehouseId?: string | null;
      itemId?: string | null;
      vehiclePlate?: string;
      productionBatchNo?: string;
      loadedQty?: string;
      maxBonusQty?: string;
      maxBonusPct?: string;
      notes?: string;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.createLoadOrder(tenantId, userId, body ?? {}) };
  }

  @Post('documents')
  @RequiresPermission('sales.invoice.create')
  async createDocument(
    @Body()
    body: {
      loadOrderId?: string;
      partyId?: string | null;
      customerName?: string;
      itemId?: string | null;
      invoiceMode?: 'zatca_tax' | 'internal_delivery';
      paymentMethod?: 'cash' | 'card' | 'credit';
      soldQty?: string;
      bonusQty?: string;
      bonusReason?: string;
      unitPrice?: string;
      discountAmount?: string;
      discountReason?: string;
      allowPriceDiscountOverride?: boolean;
      customerBonusConfirmed?: boolean;
      customerConfirmationCode?: string;
      allowBonusOverride?: boolean;
      notes?: string;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.createDocument(tenantId, userId, body ?? {}) };
  }

  @Post('load-orders/:id/submit-closing')
  @RequiresPermission('sales.invoice.create')
  async submitClosing(
    @Param('id') id: string,
    @Body()
    body: {
      returnedQty?: string;
      damagedQty?: string;
      damageReason?: string;
      collectedCash?: string;
      closingNotes?: string;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.submitClosing(tenantId, userId, id, body ?? {}) };
  }

  @Post('load-orders/:id/approve-closing')
  @RequiresPermission('sales.invoice.create')
  async approveClosing(
    @Param('id') id: string,
    @Body()
    body: {
      returnedQty?: string;
      damagedQty?: string;
      collectedCash?: string;
      damageInspected?: boolean;
      salaryDeductionApproved?: boolean;
      notes?: string;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.approveClosing(tenantId, userId, id, body ?? {}) };
  }

  @Post('load-orders/:id/settle')
  @RequiresPermission('sales.invoice.create')
  async settleLoadOrder(
    @Param('id') id: string,
    @Body() body: { returnedQty?: string; damagedQty?: string; collectedCash?: string; notes?: string },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.settleLoadOrder(tenantId, id, body ?? {}, userId) };
  }

  @Post('collections')
  @RequiresPermission('sales.invoice.create')
  async collectCustomerDebt(
    @Body()
    body: {
      documentId?: string;
      collectedAmount?: string;
      notes?: string;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.collectCustomerDebt(tenantId, userId, body ?? {}) };
  }
}
