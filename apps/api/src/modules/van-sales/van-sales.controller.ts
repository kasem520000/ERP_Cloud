import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DomainError, errorCodes, permissionGrants } from '@erp/contracts';

import { getTenantContext } from '../platform/context/tenant-context.js';
import { RequiresPermission } from '../platform/decorators/requires-permission.decorator.js';

import { VanSalesService } from './van-sales.service.js';

@ApiTags('van-sales')
@ApiBearerAuth()
@Controller('van-sales')
export class VanSalesController {
  constructor(private readonly vanSales: VanSalesService) {}

  @Get('dashboard')
  @RequiresPermission('van_sales.view')
  async dashboard() {
    const { tenantId } = getTenantContext();
    return { data: await this.vanSales.dashboard(tenantId) };
  }

  @Get('reports')
  @RequiresPermission('van_sales.view')
  async reports(
    @Query('salesmanId') salesmanId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const { tenantId } = getTenantContext();
    return {
      data: await this.vanSales.getReports(tenantId, {
        salesmanId: salesmanId?.trim() || undefined,
        fromDate: fromDate?.trim() || undefined,
        toDate: toDate?.trim() || undefined,
      }),
    };
  }

  @Post('production-batches')
  @RequiresPermission('van_sales.production.manage')
  async createProductionBatch(
    @Body()
    body: {
      batchNo?: string;
      itemId?: string | null;
      warehouseId?: string | null;
      bomId?: string | null;
      components?: Array<{ itemId: string; qty: string; unitId?: string }>;
      itemName?: string;
      producedQty?: string;
      scrapQty?: string;
      unitCost?: string;
      supervisorName?: string;
      notes?: string;
      idempotencyKey?: string;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.createProductionBatch(tenantId, userId, body ?? {}) };
  }

  @Post('customer-prices')
  @RequiresPermission('van_sales.pricing.manage')
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
      effectiveFrom?: string;
      effectiveTo?: string | null;
      changeReason?: string;
      notes?: string;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.upsertCustomerPrice(tenantId, body ?? {}, userId) };
  }

  @Post('load-orders')
  @RequiresPermission('van_sales.load.manage')
  async createLoadOrder(
    @Body()
    body: {
      salesmanId?: string;
      branchId?: string | null;
      warehouseId?: string | null;
      vanWarehouseId?: string | null;
      itemId?: string | null;
      vehiclePlate?: string;
      productionBatchNo?: string;
      loadedQty?: string;
      maxBonusQty?: string;
      maxBonusPct?: string;
      notes?: string;
      idempotencyKey?: string;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.createLoadOrder(tenantId, userId, body ?? {}) };
  }

  @Post('documents')
  @RequiresPermission('van_sales.invoice.create')
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
      idempotencyKey?: string;
    },
  ) {
    const { tenantId, userId, permissions } = getTenantContext();
    if (body?.allowPriceDiscountOverride || body?.allowBonusOverride) {
      const canOverride =
        permissionGrants(permissions, 'van_sales.override.approve') ||
        permissionGrants(permissions, 'sales.discount.override');
      if (!canOverride) {
        throw new DomainError(
          errorCodes.FORBIDDEN,
          'permission van_sales.override.approve required',
          403,
          { field: 'permission', message: 'van_sales.override.approve' },
        );
      }
    }
    return { data: await this.vanSales.createDocument(tenantId, userId, body ?? {}) };
  }

  @Post('load-orders/:id/submit-closing')
  @RequiresPermission('van_sales.closing.submit')
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
  @RequiresPermission('van_sales.closing.approve')
  async approveClosing(
    @Param('id') id: string,
    @Body()
    body: {
      returnedQty?: string;
      damagedQty?: string;
      collectedCash?: string;
      damageInspected?: boolean;
      salaryDeductionApproved?: boolean;
      selfApprovalOverride?: boolean;
      notes?: string;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.approveClosing(tenantId, userId, id, body ?? {}) };
  }

  @Post('load-orders/:id/settle')
  @RequiresPermission('van_sales.closing.approve')
  async settleLoadOrder(
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
    return { data: await this.vanSales.settleLoadOrder(tenantId, id, body ?? {}, userId) };
  }

  @Post('collections')
  @RequiresPermission('van_sales.collection.create')
  async collectCustomerDebt(
    @Body()
    body: {
      documentId?: string;
      collectedAmount?: string;
      cashLocationId?: string;
      offsetAccountId?: string;
      notes?: string;
      idempotencyKey?: string;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return { data: await this.vanSales.collectCustomerDebt(tenantId, userId, body ?? {}) };
  }

  @Post('legacy-reconciliation')
  @RequiresPermission('van_sales.override.approve')
  async reconcileLegacyData(
    @Body()
    body: {
      mode?: 'dry_run' | 'execute';
      resumeFromId?: string;
      batchLimit?: number;
    },
  ) {
    const { tenantId, userId } = getTenantContext();
    return {
      data: await this.vanSales.reconcileLegacyData(tenantId, userId, {
        mode: body?.mode === 'execute' ? 'execute' : 'dry_run',
        resumeFromId: body?.resumeFromId,
        batchLimit: body?.batchLimit,
      }),
    };
  }
}

