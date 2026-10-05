import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import { getTenantContext } from '../platform/context/tenant-context.js';
import { RequiresPermission } from '../platform/decorators/requires-permission.decorator.js';

import { ProductionOrdersService, type ProductionOrderInput } from './production-orders.service.js';

/**
 * أمر الإنتاج. Completing an order moves stock, so it is gated by its own permission:
 * writing a recipe is planning, consuming the warehouse against it is not.
 */
@Controller('inventory/production-orders')
export class ProductionOrdersController {
  constructor(private readonly production: ProductionOrdersService) {}

  @Get() @RequiresPermission('inventory.view')
  list(@Query('status') status?: string, @Query('warehouse_id') warehouseId?: string) {
    return this.production.list(getTenantContext().tenantId, { status, warehouseId }).then((data) => ({ data }));
  }

  @Post() @RequiresPermission('inventory.production.manage')
  create(@Body() body: ProductionOrderInput) {
    return this.production.create(getTenantContext().tenantId, body).then((data) => ({ data }));
  }

  @Get(':id') @RequiresPermission('inventory.view')
  read(@Param('id') id: string) {
    return this.production.get(getTenantContext().tenantId, id).then((data) => ({ data }));
  }

  @Post(':id/complete') @RequiresPermission('inventory.production.complete')
  complete(@Param('id') id: string) {
    return this.production.complete(getTenantContext().tenantId, id).then((data) => ({ data }));
  }

  @Post(':id/cancel') @RequiresPermission('inventory.production.manage')
  cancel(@Param('id') id: string) {
    return this.production.cancel(getTenantContext().tenantId, id).then((data) => ({ data }));
  }
}
