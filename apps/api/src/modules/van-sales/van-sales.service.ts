import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { sql } from 'drizzle-orm';
import { DomainError, errorCodes, newId } from '@erp/contracts';
import { withTenantTx, type DatabaseHandle, type DrizzleTx } from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ProductionOrdersService } from '../inventory/production-orders.service.js';
import { WmsBomService } from '../inventory/wms-bom.service.js';
import { NotificationsService, SequencesService } from '../platform-services/index.js';
import { SalesService, type SalesLineInput } from '../sales/sales.service.js';
import { TreasuryService } from '../treasury/treasury.service.js';

function rows(result: unknown): Array<Record<string, unknown>> {
  return Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []);
}

function first(result: unknown): Record<string, unknown> | undefined {
  return rows(result)[0];
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function dec(value: unknown): Decimal {
  try {
    return new Decimal(value === null || value === undefined || value === '' ? 0 : String(value));
  } catch {
    return new Decimal(0);
  }
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

function buildZatcaTlvBase64(params: {
  sellerName: string;
  vatNumber: string;
  timestampIso: string;
  invoiceTotal: string;
  vatTotal: string;
}): string {
  const fields: Array<[number, string]> = [
    [1, params.sellerName || 'مصنع ومخابز التوزيع'],
    [2, params.vatNumber || '300000000000003'],
    [3, params.timestampIso],
    [4, Number(params.invoiceTotal || 0).toFixed(2)],
    [5, Number(params.vatTotal || 0).toFixed(2)],
  ];
  const chunks: Buffer[] = [];
  for (const [tag, val] of fields) {
    const valBuf = Buffer.from(val, 'utf8');
    const len = Math.min(valBuf.length, 255);
    chunks.push(Buffer.from([tag, len]), valBuf.subarray(0, len));
  }
  return Buffer.concat(chunks).toString('base64');
}

export type VanSalesTenantPolicy = {
  allowInternalDeliveryWithoutTax?: boolean;
  preventSelfApproval?: boolean;
  shortageValuationBasis?: 'unconfigured' | 'unit_cost' | 'selling_price';
  shortageUnitPrice?: string;
  defaultMaxBonusPct?: string;
  defaultMaxBonusQty?: string;
  defaultCreditLimit?: string;
};

@Injectable()
export class VanSalesService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly sequences: SequencesService,
    private readonly notifications: NotificationsService,
    private readonly inventory: InventoryService,
    private readonly productionOrders: ProductionOrdersService,
    private readonly wmsBom: WmsBomService,
    private readonly sales: SalesService,
    private readonly treasury: TreasuryService,
    private readonly accounting: AccountingService,
  ) {}

  private async loadTenantPolicyInTx(
    tx: DrizzleTx,
    tenantId: string,
  ): Promise<VanSalesTenantPolicy> {
    const row = first(
      await tx.execute(sql`
        SELECT value FROM tenant_settings
        WHERE tenant_id = ${tenantId}::uuid AND key = 'van_sales.policy'
        LIMIT 1
      `),
    );
    if (!row || !row.value || typeof row.value !== 'object') {
      return {};
    }
    return row.value as VanSalesTenantPolicy;
  }

  private async resolveDefaultBranchIdInTx(
    tx: DrizzleTx,
    tenantId: string,
    requestedBranchId?: string | null,
    warehouseId?: string | null,
  ): Promise<string | null> {
    if (requestedBranchId && requestedBranchId.trim()) {
      return requestedBranchId.trim();
    }
    if (warehouseId && warehouseId.trim()) {
      const whRow = first(
        await tx.execute(sql`
          SELECT branch_id::text FROM warehouses
          WHERE id = ${warehouseId.trim()}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          LIMIT 1
        `),
      );
      if (whRow?.branch_id) return str(whRow.branch_id);
    }
    const branchRow = first(
      await tx.execute(sql`
        SELECT id::text FROM branches
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        ORDER BY is_default DESC NULLS LAST, created_at ASC
        LIMIT 1
      `),
    );
    return branchRow?.id ? str(branchRow.id) : null;
  }

  async dashboard(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const policy = await this.loadTenantPolicyInTx(tx, tenantId);

      const productionBatches = rows(
        await tx.execute(sql`
          SELECT b.id::text, b.batch_no, b.production_date::text, b.item_id::text,
                 b.warehouse_id::text, b.production_order_id::text, b.manufacturing_order_id::text,
                 b.lot_id::text, b.inventory_transaction_id::text,
                 COALESCE(i.name_ar, b.item_name, 'رقائق سمبوسة وفطائر طازجة') AS item_name,
                 b.produced_qty::text, b.scrap_qty::text, b.issued_qty::text, b.returned_good_qty::text,
                 b.damaged_qty::text, b.unit_cost::text, b.total_cost::text,
                 b.status, b.supervisor_name, b.notes, b.created_at
          FROM factory_production_batches b
          LEFT JOIN items i ON i.id = b.item_id
          WHERE b.tenant_id = ${tenantId}::uuid AND b.deleted_at IS NULL
          ORDER BY b.production_date DESC, b.created_at DESC
          LIMIT 50
        `),
      );

      const loadOrders = rows(
        await tx.execute(sql`
          SELECT l.id::text, l.number, l.load_date::text, l.production_batch_no,
                 l.vehicle_plate, l.status,
                 l.warehouse_id::text, l.van_warehouse_id::text,
                 l.stock_transfer_id::text, l.return_transfer_id::text,
                 l.damage_voucher_id::text, l.approval_request_id::text,
                 l.shortage_policy_status,
                 l.loaded_qty::text, l.loaded_total_value::text,
                 l.sold_qty::text, l.bonus_qty::text,
                 l.returned_qty::text, l.damaged_qty::text,
                 l.shortage_qty::text, l.shortage_value::text,
                 l.max_bonus_qty::text, l.max_bonus_pct::text,
                 l.expected_cash::text, l.collected_cash::text,
                 l.damage_reason, l.damage_inspected, l.salary_deduction_approved,
                 l.closing_notes, l.closing_submitted_at, l.approved_at, l.settled_at, l.notes,
                 l.salesman_id::text, COALESCE(s.name, 'مندوب توزيع') AS salesman_name,
                 l.item_id::text, COALESCE(i.name_ar, 'رقائق سمبوسة وفطائر') AS item_name,
                 COALESCE(u_app.full_name, u_app.email) AS approved_by_label
          FROM van_load_orders l
          LEFT JOIN salesmen s ON s.id = l.salesman_id
          LEFT JOIN items i ON i.id = l.item_id
          LEFT JOIN users u_app ON u_app.id = l.approved_by
          WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
          ORDER BY l.created_at DESC
          LIMIT 60
        `),
      );

      const customerPrices = rows(
        await tx.execute(sql`
          SELECT cp.id::text, cp.party_id::text, p.name AS party_name, p.code AS party_code, p.tax_no AS party_tax_no,
                 cp.item_id::text, COALESCE(i.name_ar, 'جميع أصناف المخبز') AS item_name,
                 cp.price_tier_label, cp.unit_price::text, cp.max_bonus_pct::text,
                 cp.max_bonus_kg_per_invoice::text, cp.preferred_invoice_mode,
                 cp.credit_limit::text, cp.payment_terms_days, cp.lock_price, cp.max_discount_pct::text,
                 cp.effective_from::text, cp.effective_to::text, cp.change_reason, cp.notes
          FROM van_sales_customer_prices cp
          JOIN parties p ON p.id = cp.party_id
          LEFT JOIN items i ON i.id = cp.item_id
          WHERE cp.tenant_id = ${tenantId}::uuid AND cp.deleted_at IS NULL
          ORDER BY p.name ASC
        `),
      );

      const customerPriceHistory = rows(
        await tx.execute(sql`
          SELECT h.id::text, h.customer_price_id::text, h.party_id::text, p.name AS party_name,
                 h.item_id::text, COALESCE(i.name_ar, 'جميع أصناف المخبز') AS item_name,
                 h.previous_unit_price::text, h.new_unit_price::text,
                 h.max_bonus_pct::text, h.max_bonus_kg_per_invoice::text,
                 h.max_discount_pct::text, h.lock_price,
                 h.effective_from::text, h.effective_to::text, h.change_reason,
                 COALESCE(u.full_name, u.email, 'النظام') AS changed_by_label,
                 h.created_at
          FROM van_sales_customer_price_history h
          JOIN parties p ON p.id = h.party_id
          LEFT JOIN items i ON i.id = h.item_id
          LEFT JOIN users u ON u.id = h.changed_by
          WHERE h.tenant_id = ${tenantId}::uuid
          ORDER BY h.created_at DESC
          LIMIT 50
        `),
      );

      const documents = rows(
        await tx.execute(sql`
          SELECT d.id::text, d.number, d.doc_date::text, d.invoice_mode, d.tax_policy_status, d.payment_method,
                 d.production_batch_no, d.sold_qty::text, d.bonus_qty::text, d.bonus_reason,
                 d.unit_price::text, d.discount_amount::text, d.discount_reason,
                 d.subtotal::text, d.tax_rate::text,
                 d.tax_total::text, d.total::text, d.paid_amount::text,
                 d.unit_cost::text, d.net_profit::text,
                 d.customer_bonus_confirmed, d.customer_confirmation_code,
                 d.bonus_anomaly, d.anomaly_reason, d.notes, d.created_at,
                 d.load_order_id::text,
                 d.sales_invoice_id::text, d.receipt_voucher_id::text, d.stock_delivery_id::text,
                 d.salesman_id::text, COALESCE(s.name, 'مندوب') AS salesman_name,
                 d.party_id::text, COALESCE(p.name, d.customer_name, 'عميل توزيع') AS customer_name,
                 p.tax_no AS customer_tax_no,
                 d.item_id::text, COALESCE(i.name_ar, 'رقائق سمبوسة وفطائر') AS item_name
          FROM van_sales_documents d
          LEFT JOIN salesmen s ON s.id = d.salesman_id
          LEFT JOIN parties p ON p.id = d.party_id
          LEFT JOIN items i ON i.id = d.item_id
          WHERE d.tenant_id = ${tenantId}::uuid AND d.deleted_at IS NULL
          ORDER BY d.created_at DESC
          LIMIT 120
        `),
      );

      const movements = rows(
        await tx.execute(sql`
          SELECT m.id::text, m.movement_type, m.batch_no, m.qty::text, m.unit_price::text, m.amount::text,
                 m.reason, m.created_at,
                 m.inventory_transaction_id::text, m.voucher_id::text,
                 COALESCE(s.name, '—') AS salesman_name,
                 COALESCE(p.name, '—') AS customer_name,
                 COALESCE(u_act.full_name, u_act.email, 'النظام') AS actor_label,
                 COALESCE(u_app.full_name, u_app.email) AS approved_by_label
          FROM van_stock_movements m
          LEFT JOIN salesmen s ON s.id = m.salesman_id
          LEFT JOIN parties p ON p.id = m.party_id
          LEFT JOIN users u_act ON u_act.id = m.actor_user_id
          LEFT JOIN users u_app ON u_app.id = m.approved_by_user_id
          WHERE m.tenant_id = ${tenantId}::uuid
          ORDER BY m.created_at DESC
          LIMIT 80
        `),
      );

      let totalProducedKg = new Decimal(0);
      let totalScrapKg = new Decimal(0);
      let totalProductionCostSar = new Decimal(0);
      for (const b of productionBatches) {
        totalProducedKg = totalProducedKg.plus(dec(b.produced_qty));
        totalScrapKg = totalScrapKg.plus(dec(b.scrap_qty));
        totalProductionCostSar = totalProductionCostSar.plus(dec(b.total_cost));
      }

      let totalLoadedKg = new Decimal(0);
      let totalSoldKg = new Decimal(0);
      let totalBonusKg = new Decimal(0);
      let totalReturnedKg = new Decimal(0);
      let totalDamagedKg = new Decimal(0);
      let totalShortageKg = new Decimal(0);
      let totalShortageSar = new Decimal(0);
      let totalZatcaSalesSar = new Decimal(0);
      let totalInternalSalesSar = new Decimal(0);
      let totalCollectedCashSar = new Decimal(0);
      let totalCreditReceivablesSar = new Decimal(0);
      let totalNetProfitSar = new Decimal(0);
      let anomalyCount = 0;
      let pendingClosingsCount = 0;

      const repMap = new Map<
        string,
        {
          salesmanId: string;
          salesmanName: string;
          loadedKg: Decimal;
          soldKg: Decimal;
          bonusKg: Decimal;
          returnedKg: Decimal;
          damagedKg: Decimal;
          shortageKg: Decimal;
          shortageSar: Decimal;
          custodyRemainingKg: Decimal;
          revenueSar: Decimal;
          collectedSar: Decimal;
          creditDebtSar: Decimal;
          netProfitSar: Decimal;
          pendingClosings: number;
        }
      >();

      for (const l of loadOrders) {
        const loaded = dec(l.loaded_qty);
        const sold = dec(l.sold_qty);
        const bonus = dec(l.bonus_qty);
        const returned = dec(l.returned_qty);
        const damaged = dec(l.damaged_qty);
        const shortage = dec(l.shortage_qty);
        const shortageVal = dec(l.shortage_value);
        const isSettled = str(l.status) === 'settled';
        const isPending = str(l.status) === 'pending_closing';
        if (isPending) pendingClosingsCount += 1;

        totalLoadedKg = totalLoadedKg.plus(loaded);
        totalSoldKg = totalSoldKg.plus(sold);
        totalBonusKg = totalBonusKg.plus(bonus);
        totalReturnedKg = totalReturnedKg.plus(returned);
        totalDamagedKg = totalDamagedKg.plus(damaged);
        totalShortageKg = totalShortageKg.plus(shortage);
        totalShortageSar = totalShortageSar.plus(shortageVal);

        const sid = str(l.salesman_id);
        const sname = str(l.salesman_name);
        const entry = repMap.get(sid) ?? {
          salesmanId: sid,
          salesmanName: sname,
          loadedKg: new Decimal(0),
          soldKg: new Decimal(0),
          bonusKg: new Decimal(0),
          returnedKg: new Decimal(0),
          damagedKg: new Decimal(0),
          shortageKg: new Decimal(0),
          shortageSar: new Decimal(0),
          custodyRemainingKg: new Decimal(0),
          revenueSar: new Decimal(0),
          collectedSar: new Decimal(0),
          creditDebtSar: new Decimal(0),
          netProfitSar: new Decimal(0),
          pendingClosings: 0,
        };
        entry.loadedKg = entry.loadedKg.plus(loaded);
        entry.soldKg = entry.soldKg.plus(sold);
        entry.bonusKg = entry.bonusKg.plus(bonus);
        entry.returnedKg = entry.returnedKg.plus(returned);
        entry.damagedKg = entry.damagedKg.plus(damaged);
        entry.shortageKg = entry.shortageKg.plus(shortage);
        entry.shortageSar = entry.shortageSar.plus(shortageVal);
        if (!isSettled) {
          const rem = loaded
            .minus(sold)
            .minus(bonus)
            .minus(returned)
            .minus(damaged)
            .minus(shortage);
          entry.custodyRemainingKg = entry.custodyRemainingKg.plus(Decimal.max(0, rem));
        }
        if (isPending) entry.pendingClosings += 1;
        repMap.set(sid, entry);
      }

      for (const d of documents) {
        const docTotal = dec(d.total);
        const docPaid = dec(d.paid_amount);
        const docDebt = Decimal.max(0, docTotal.minus(docPaid));
        const docProfit = dec(d.net_profit);

        if (str(d.invoice_mode) === 'zatca_tax') {
          totalZatcaSalesSar = totalZatcaSalesSar.plus(docTotal);
        } else {
          totalInternalSalesSar = totalInternalSalesSar.plus(docTotal);
        }
        totalCollectedCashSar = totalCollectedCashSar.plus(docPaid);
        totalCreditReceivablesSar = totalCreditReceivablesSar.plus(docDebt);
        totalNetProfitSar = totalNetProfitSar.plus(docProfit);
        if (d.bonus_anomaly === true) anomalyCount += 1;

        const sid = str(d.salesman_id);
        const entry = repMap.get(sid);
        if (entry) {
          entry.revenueSar = entry.revenueSar.plus(docTotal);
          entry.collectedSar = entry.collectedSar.plus(docPaid);
          entry.creditDebtSar = entry.creditDebtSar.plus(docDebt);
          entry.netProfitSar = entry.netProfitSar.plus(docProfit);
        }
      }

      const mainWarehouseBalanceKg = Decimal.max(
        0,
        totalProducedKg.minus(totalLoadedKg).plus(totalReturnedKg),
      );
      const remainingInVansKg = Decimal.max(
        0,
        totalLoadedKg
          .minus(totalSoldKg)
          .minus(totalBonusKg)
          .minus(totalReturnedKg)
          .minus(totalDamagedKg)
          .minus(totalShortageKg),
      );

      return {
        policy: {
          allowInternalDeliveryWithoutTax: Boolean(policy.allowInternalDeliveryWithoutTax),
          preventSelfApproval: Boolean(policy.preventSelfApproval),
          shortageValuationBasis: policy.shortageValuationBasis ?? 'unconfigured',
        },
        summary: {
          totalProducedKg: totalProducedKg.toFixed(2),
          totalScrapKg: totalScrapKg.toFixed(2),
          mainWarehouseBalanceKg: mainWarehouseBalanceKg.toFixed(2),
          totalProductionCostSar: totalProductionCostSar.toFixed(2),
          totalLoadedKg: totalLoadedKg.toFixed(2),
          totalSoldKg: totalSoldKg.toFixed(2),
          totalBonusKg: totalBonusKg.toFixed(2),
          totalReturnedKg: totalReturnedKg.toFixed(2),
          totalDamagedKg: totalDamagedKg.toFixed(2),
          totalShortageKg: totalShortageKg.toFixed(2),
          totalShortageSar: totalShortageSar.toFixed(2),
          remainingInVansKg: remainingInVansKg.toFixed(2),
          totalZatcaSalesSar: totalZatcaSalesSar.toFixed(2),
          totalInternalSalesSar: totalInternalSalesSar.toFixed(2),
          totalRevenueSar: totalZatcaSalesSar.plus(totalInternalSalesSar).toFixed(2),
          totalCollectedCashSar: totalCollectedCashSar.toFixed(2),
          totalCreditReceivablesSar: totalCreditReceivablesSar.toFixed(2),
          totalNetProfitSar: totalNetProfitSar.toFixed(2),
          anomalyCount,
          pendingClosingsCount,
        },
        productionBatches: productionBatches.map((b) => {
          const produced = dec(b.produced_qty);
          const scrap = dec(b.scrap_qty);
          const issued = dec(b.issued_qty);
          const retGood = dec(b.returned_good_qty);
          const dmg = dec(b.damaged_qty);
          const avail = Decimal.max(0, produced.minus(issued).plus(retGood).minus(dmg));
          return {
            id: str(b.id),
            batchNo: str(b.batch_no),
            productionDate: str(b.production_date),
            itemId: b.item_id ? str(b.item_id) : null,
            warehouseId: b.warehouse_id ? str(b.warehouse_id) : null,
            productionOrderId: b.production_order_id ? str(b.production_order_id) : null,
            manufacturingOrderId: b.manufacturing_order_id ? str(b.manufacturing_order_id) : null,
            lotId: b.lot_id ? str(b.lot_id) : null,
            inventoryTransactionId: b.inventory_transaction_id
              ? str(b.inventory_transaction_id)
              : null,
            itemName: str(b.item_name),
            producedQty: produced.toFixed(2),
            scrapQty: scrap.toFixed(2),
            issuedQty: issued.toFixed(2),
            returnedGoodQty: retGood.toFixed(2),
            damagedQty: dmg.toFixed(2),
            availableWarehouseQty: avail.toFixed(2),
            unitCost: dec(b.unit_cost).toFixed(2),
            totalCost: dec(b.total_cost).toFixed(2),
            status: str(b.status),
            supervisorName: str(b.supervisor_name),
            notes: str(b.notes),
          };
        }),
        repPerformance: [...repMap.values()].map((r) => ({
          salesmanId: r.salesmanId,
          salesmanName: r.salesmanName,
          loadedKg: r.loadedKg.toFixed(2),
          soldKg: r.soldKg.toFixed(2),
          bonusKg: r.bonusKg.toFixed(2),
          returnedKg: r.returnedKg.toFixed(2),
          damagedKg: r.damagedKg.toFixed(2),
          shortageKg: r.shortageKg.toFixed(2),
          shortageSar: r.shortageSar.toFixed(2),
          custodyRemainingKg: r.custodyRemainingKg.toFixed(2),
          revenueSar: r.revenueSar.toFixed(2),
          collectedSar: r.collectedSar.toFixed(2),
          creditDebtSar: r.creditDebtSar.toFixed(2),
          netProfitSar: r.netProfitSar.toFixed(2),
          pendingClosings: r.pendingClosings,
        })),
        loadOrders: loadOrders.map((row) => {
          const loaded = dec(row.loaded_qty);
          const sold = dec(row.sold_qty);
          const bonus = dec(row.bonus_qty);
          const returned = dec(row.returned_qty);
          const damaged = dec(row.damaged_qty);
          const shortage = dec(row.shortage_qty);
          const isSettled = str(row.status) === 'settled';
          const remaining = isSettled
            ? new Decimal(0)
            : Decimal.max(
                0,
                loaded.minus(sold).minus(bonus).minus(returned).minus(damaged).minus(shortage),
              );
          return {
            id: str(row.id),
            number: str(row.number),
            loadDate: str(row.load_date),
            productionBatchNo: str(row.production_batch_no),
            vehiclePlate: str(row.vehicle_plate),
            status: str(row.status),
            salesmanId: str(row.salesman_id),
            salesmanName: str(row.salesman_name),
            warehouseId: row.warehouse_id ? str(row.warehouse_id) : null,
            vanWarehouseId: row.van_warehouse_id ? str(row.van_warehouse_id) : null,
            stockTransferId: row.stock_transfer_id ? str(row.stock_transfer_id) : null,
            returnTransferId: row.return_transfer_id ? str(row.return_transfer_id) : null,
            damageVoucherId: row.damage_voucher_id ? str(row.damage_voucher_id) : null,
            approvalRequestId: row.approval_request_id ? str(row.approval_request_id) : null,
            shortagePolicyStatus: str(row.shortage_policy_status || 'pending_policy_approval'),
            itemId: row.item_id ? str(row.item_id) : null,
            itemName: str(row.item_name),
            loadedQty: loaded.toFixed(2),
            soldQty: sold.toFixed(2),
            bonusQty: bonus.toFixed(2),
            returnedQty: returned.toFixed(2),
            damagedQty: damaged.toFixed(2),
            shortageQty: shortage.toFixed(2),
            shortageValue: dec(row.shortage_value).toFixed(2),
            remainingQty: remaining.toFixed(2),
            maxBonusQty: dec(row.max_bonus_qty).toFixed(2),
            maxBonusPct: dec(row.max_bonus_pct).toFixed(2),
            expectedCash: dec(row.expected_cash).toFixed(2),
            collectedCash: dec(row.collected_cash).toFixed(2),
            cashVariance: dec(row.collected_cash).minus(dec(row.expected_cash)).toFixed(2),
            damageReason: str(row.damage_reason),
            damageInspected: Boolean(row.damage_inspected),
            salaryDeductionApproved: Boolean(row.salary_deduction_approved),
            closingNotes: str(row.closing_notes),
            closingSubmittedAt: row.closing_submitted_at ? iso(row.closing_submitted_at) : null,
            approvedAt: row.approved_at ? iso(row.approved_at) : null,
            approvedByLabel: str(row.approved_by_label),
            notes: str(row.notes),
          };
        }),
        customerPrices: customerPrices.map((row) => ({
          id: str(row.id),
          partyId: str(row.party_id),
          partyName: str(row.party_name),
          partyCode: str(row.party_code),
          partyTaxNo: str(row.party_tax_no),
          itemId: row.item_id ? str(row.item_id) : null,
          itemName: str(row.item_name),
          priceTierLabel: str(row.price_tier_label),
          unitPrice: dec(row.unit_price).toFixed(2),
          maxBonusPct: dec(row.max_bonus_pct).toFixed(2),
          maxBonusKgPerInvoice: dec(row.max_bonus_kg_per_invoice).toFixed(2),
          preferredInvoiceMode: str(row.preferred_invoice_mode) as
            | 'zatca_tax'
            | 'internal_delivery',
          creditLimit: dec(row.credit_limit).toFixed(2),
          paymentTermsDays: Number(row.payment_terms_days ?? 15),
          lockPrice: row.lock_price !== false,
          maxDiscountPct: dec(row.max_discount_pct).toFixed(2),
          effectiveFrom: str(row.effective_from),
          effectiveTo: row.effective_to ? str(row.effective_to) : null,
          changeReason: str(row.change_reason),
          notes: str(row.notes),
        })),
        customerPriceHistory: customerPriceHistory.map((h) => ({
          id: str(h.id),
          customerPriceId: str(h.customer_price_id),
          partyId: str(h.party_id),
          partyName: str(h.party_name),
          itemId: h.item_id ? str(h.item_id) : null,
          itemName: str(h.item_name),
          previousUnitPrice: h.previous_unit_price ? dec(h.previous_unit_price).toFixed(2) : null,
          newUnitPrice: dec(h.new_unit_price).toFixed(2),
          maxBonusPct: dec(h.max_bonus_pct).toFixed(2),
          maxBonusKgPerInvoice: dec(h.max_bonus_kg_per_invoice).toFixed(2),
          maxDiscountPct: dec(h.max_discount_pct).toFixed(2),
          lockPrice: Boolean(h.lock_price),
          effectiveFrom: str(h.effective_from),
          effectiveTo: h.effective_to ? str(h.effective_to) : null,
          changeReason: str(h.change_reason),
          changedByLabel: str(h.changed_by_label),
          createdAt: iso(h.created_at),
        })),
        documents: documents.map((row) => ({
          id: str(row.id),
          number: str(row.number),
          docDate: str(row.doc_date),
          invoiceMode: str(row.invoice_mode) as 'zatca_tax' | 'internal_delivery',
          taxPolicyStatus: str(row.tax_policy_status || 'standard_vat'),
          paymentMethod: str(row.payment_method),
          productionBatchNo: str(row.production_batch_no),
          loadOrderId: row.load_order_id ? str(row.load_order_id) : null,
          salesInvoiceId: row.sales_invoice_id ? str(row.sales_invoice_id) : null,
          receiptVoucherId: row.receipt_voucher_id ? str(row.receipt_voucher_id) : null,
          stockDeliveryId: row.stock_delivery_id ? str(row.stock_delivery_id) : null,
          salesmanId: row.salesman_id ? str(row.salesman_id) : null,
          salesmanName: str(row.salesman_name),
          partyId: row.party_id ? str(row.party_id) : null,
          customerName: str(row.customer_name),
          customerTaxNo: str(row.customer_tax_no),
          itemId: row.item_id ? str(row.item_id) : null,
          itemName: str(row.item_name),
          soldQty: dec(row.sold_qty).toFixed(2),
          bonusQty: dec(row.bonus_qty).toFixed(2),
          bonusReason: str(row.bonus_reason),
          unitPrice: dec(row.unit_price).toFixed(2),
          discountAmount: dec(row.discount_amount).toFixed(2),
          discountReason: str(row.discount_reason),
          subtotal: dec(row.subtotal).toFixed(2),
          taxRate: dec(row.tax_rate).toFixed(2),
          taxTotal: dec(row.tax_total).toFixed(2),
          total: dec(row.total).toFixed(2),
          paidAmount: dec(row.paid_amount).toFixed(2),
          unitCost: dec(row.unit_cost).toFixed(2),
          netProfit: dec(row.net_profit).toFixed(2),
          customerBonusConfirmed: Boolean(row.customer_bonus_confirmed),
          customerConfirmationCode: str(row.customer_confirmation_code),
          bonusAnomaly: Boolean(row.bonus_anomaly),
          anomalyReason: str(row.anomaly_reason),
          notes: str(row.notes),
          createdAt: iso(row.created_at),
        })),
        movements: movements.map((m) => ({
          id: str(m.id),
          movementType: str(m.movement_type),
          batchNo: str(m.batch_no),
          qty: dec(m.qty).toFixed(2),
          unitPrice: dec(m.unit_price).toFixed(2),
          amount: dec(m.amount).toFixed(2),
          reason: str(m.reason),
          inventoryTransactionId: m.inventory_transaction_id
            ? str(m.inventory_transaction_id)
            : null,
          voucherId: m.voucher_id ? str(m.voucher_id) : null,
          salesmanName: str(m.salesman_name),
          customerName: str(m.customer_name),
          actorLabel: str(m.actor_label),
          approvedByLabel: str(m.approved_by_label),
          createdAt: iso(m.created_at),
        })),
      };
    });
  }

  /**
   * Phase 5: Comprehensive Analytical Reports for Reps, Custody, Transfers, Collections & Production.
   */
  async getReports(
    tenantId: string,
    filters: { salesmanId?: string; fromDate?: string; toDate?: string } = {},
  ) {
    const dash = await this.dashboard(tenantId);
    const filteredLoadOrders = filters.salesmanId
      ? dash.loadOrders.filter((l) => l.salesmanId === filters.salesmanId)
      : dash.loadOrders;
    const filteredDocs = filters.salesmanId
      ? dash.documents.filter((d) => d.salesmanId === filters.salesmanId)
      : dash.documents;

    return {
      generatedAt: new Date().toISOString(),
      policy: dash.policy,
      summary: dash.summary,
      repCustodyReport: dash.repPerformance.filter(
        (r) => !filters.salesmanId || r.salesmanId === filters.salesmanId,
      ),
      transfersReport: filteredLoadOrders.map((l) => ({
        loadOrderId: l.id,
        loadOrderNumber: l.number,
        loadDate: l.loadDate,
        salesmanId: l.salesmanId,
        salesmanName: l.salesmanName,
        productionBatchNo: l.productionBatchNo,
        warehouseId: l.warehouseId,
        vanWarehouseId: l.vanWarehouseId,
        stockTransferId: l.stockTransferId,
        returnTransferId: l.returnTransferId,
        loadedQty: l.loadedQty,
        soldQty: l.soldQty,
        bonusQty: l.bonusQty,
        returnedQty: l.returnedQty,
        damagedQty: l.damagedQty,
        shortageQty: l.shortageQty,
        shortageValue: l.shortageValue,
        shortagePolicyStatus: l.shortagePolicyStatus,
        remainingQty: l.remainingQty,
        status: l.status,
      })),
      collectionsReport: filteredDocs.map((d) => ({
        documentId: d.id,
        documentNumber: d.number,
        salesInvoiceId: d.salesInvoiceId,
        receiptVoucherId: d.receiptVoucherId,
        docDate: d.docDate,
        salesmanName: d.salesmanName,
        customerName: d.customerName,
        paymentMethod: d.paymentMethod,
        grandTotal: d.total,
        paidAmount: d.paidAmount,
        outstandingBalance: Decimal.max(0, dec(d.total).minus(dec(d.paidAmount))).toFixed(2),
      })),
      productionReport: dash.productionBatches,
      customerPriceAuditReport: dash.customerPriceHistory,
    };
  }

  /**
   * Pillar 1 (Phase 2 & 3): Record daily factory/bakery production batch (`إنتاج يومي للمصنع والمخبز`),
   * linking to official `ProductionOrdersService`, `WmsBomService`, or `InventoryService.recordInTx` + `item_lots`.
   */
  async createProductionBatch(
    tenantId: string,
    userId: string,
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
    const producedQty = dec(body.producedQty);
    if (producedQty.lte(0)) {
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        'أدخل كمية الإنتاج اليومية بالكيلو (أكبر من صفر)',
        422,
        { field: 'producedQty' },
      );
    }
    const scrapQty = Decimal.max(0, dec(body.scrapQty ?? '0'));
    const idempotencyKey = body.idempotencyKey?.trim() || null;

    if (idempotencyKey) {
      const existing = await withTenantTx(this.database.db, tenantId, async (tx) =>
        first(
          await tx.execute(sql`
            SELECT id::text FROM factory_production_batches
            WHERE tenant_id = ${tenantId}::uuid
              AND idempotency_key = ${idempotencyKey}
              AND deleted_at IS NULL
            LIMIT 1
          `),
        ),
      );
      if (existing) {
        return this.dashboard(tenantId);
      }
    }

    const warehouseId = body.warehouseId?.trim() || null;
    const itemId = body.itemId?.trim() || null;
    const bomId = body.bomId?.trim() || null;

    let linkedProductionOrderId: string | null = null;
    let linkedManufacturingOrderId: string | null = null;
    let resolvedUnitCostFromOrder: Decimal | null = null;

    // Official manufacturing/production order integration (executed before opening inner tx)
    if (bomId && warehouseId) {
      const mfgOrder = await this.wmsBom.createOrder(tenantId, {
        bomId,
        warehouseId,
        qty: producedQty.toFixed(4),
      });
      if (mfgOrder?.id) {
        const producedOrder = await this.wmsBom.produce(tenantId, mfgOrder.id, {
          qty: producedQty.toFixed(4),
        });
        if (producedOrder) {
          linkedManufacturingOrderId = producedOrder.id;
          if (producedOrder.actualUnitCost) {
            resolvedUnitCostFromOrder = dec(producedOrder.actualUnitCost);
          }
        }
      }
    } else if (warehouseId && itemId && body.components && body.components.length > 0) {
      const prodOrder = await this.productionOrders.create(tenantId, {
        warehouseId,
        outputItemId: itemId,
        outputQty: producedQty.toFixed(4),
        components: body.components,
        notes: body.notes,
      });
      const completedOrder = await this.productionOrders.complete(tenantId, prodOrder.id);
      linkedProductionOrderId = completedOrder.id;
      if (completedOrder.unitCost) {
        resolvedUnitCostFromOrder = dec(completedOrder.unitCost);
      }
    }

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      let itemRow: Record<string, unknown> | undefined;
      if (itemId) {
        itemRow = first(
          await tx.execute(sql`
            SELECT id::text, name_ar, purchase_price::text AS cost_price, track_lot
            FROM items
            WHERE id = ${itemId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
            LIMIT 1
          `),
        );
      }

      const unitCost =
        resolvedUnitCostFromOrder ??
        (body.unitCost !== undefined && String(body.unitCost).trim() !== ''
          ? dec(body.unitCost)
          : itemRow?.cost_price
            ? dec(itemRow.cost_price)
            : new Decimal(0));
      const totalCost = producedQty.mul(unitCost);

      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const branchId = await this.resolveDefaultBranchIdInTx(tx, tenantId, null, warehouseId);
      const allocatedBatchNo =
        String(body.batchNo ?? '').trim() ||
        (
          await this.sequences.next(
            {
              tenantId,
              branchId: branchId ?? undefined,
              docType: 'factory_production_batch',
            },
            tx,
            { prefix: `PROD-${datePart}-`, padding: 4 },
          )
        ).display;

      const itemName =
        String(body.itemName ?? '').trim() ||
        (itemRow?.name_ar ? str(itemRow.name_ar) : 'رقائق سمبوسة وفطائر طازجة');
      const batchId = newId();

      // Official Lot creation & Inventory receipt when warehouseId + itemId are present and not already moved by BOM/ProductionOrder
      let linkedLotId: string | null = null;
      let linkedInventoryTxId: string | null = null;

      if (itemId && itemRow?.track_lot === true) {
        const existingLot = first(
          await tx.execute(sql`
            SELECT id::text FROM item_lots
            WHERE tenant_id = ${tenantId}::uuid AND item_id = ${itemId}::uuid AND lot_no = ${allocatedBatchNo} AND deleted_at IS NULL
            LIMIT 1
          `),
        );
        if (existingLot?.id) {
          linkedLotId = str(existingLot.id);
        } else {
          linkedLotId = newId();
          await tx.execute(sql`
            INSERT INTO item_lots (id, tenant_id, item_id, lot_no, production_date, received_at)
            VALUES (${linkedLotId}::uuid, ${tenantId}::uuid, ${itemId}::uuid, ${allocatedBatchNo}, CURRENT_DATE, now())
          `);
        }
      }

      if (warehouseId && itemId && !linkedProductionOrderId && !linkedManufacturingOrderId) {
        const rec = await this.inventory.recordInTx(tx, tenantId, [
          {
            itemId,
            warehouseId,
            qty: producedQty.toFixed(4),
            unitCost: unitCost.toFixed(4),
            lotId: linkedLotId ?? undefined,
            direction: 'in',
            docType: 'factory_production_batch',
            docId: batchId,
            lineId: batchId,
          },
        ]);
        linkedInventoryTxId = rec.transactionIds[0] ?? null;
      }

      await tx.execute(sql`
        INSERT INTO factory_production_batches (
          id, tenant_id, batch_no, production_date, item_id, item_name, warehouse_id,
          production_order_id, manufacturing_order_id, lot_id, inventory_transaction_id,
          produced_qty, scrap_qty, issued_qty, returned_good_qty, damaged_qty,
          unit_cost, total_cost, status, supervisor_name, notes, idempotency_key, created_by
        ) VALUES (
          ${batchId}::uuid, ${tenantId}::uuid, ${allocatedBatchNo}, CURRENT_DATE,
          ${itemId}::uuid, ${itemName}, ${warehouseId}::uuid,
          ${linkedProductionOrderId}::uuid, ${linkedManufacturingOrderId}::uuid,
          ${linkedLotId}::uuid, ${linkedInventoryTxId}::uuid,
          ${producedQty.toFixed(4)}::numeric, ${scrapQty.toFixed(4)}::numeric, 0, 0, 0,
          ${unitCost.toFixed(4)}::numeric, ${totalCost.toFixed(4)}::numeric,
          'active', ${body.supervisorName?.trim() || 'مشرف الإنتاج'},
          ${body.notes?.trim() || null}, ${idempotencyKey}, ${userId}::uuid
        )
      `);

      await tx.execute(sql`
        INSERT INTO van_stock_movements (
          id, tenant_id, movement_type, batch_no, item_id, inventory_transaction_id,
          qty, unit_price, amount, reason, idempotency_key, actor_user_id
        ) VALUES (
          ${newId()}::uuid, ${tenantId}::uuid, 'production_in', ${allocatedBatchNo},
          ${itemId}::uuid, ${linkedInventoryTxId}::uuid,
          ${producedQty.toFixed(4)}::numeric,
          ${unitCost.toFixed(4)}::numeric, ${totalCost.toFixed(4)}::numeric,
          ${`إنتاج يومي جديد وتوريد للمستودع الرئيسي — ${itemName}`},
          ${idempotencyKey ? `prod-move:${idempotencyKey}` : null},
          ${userId}::uuid
        )
      `);
    });

    return this.dashboard(tenantId);
  }

  /**
   * Pillar 4 & 5 (Phase 5): Customer Price Tiers with Effective Dating & Immutable Price Audit History.
   */
  async upsertCustomerPrice(
    tenantId: string,
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
    userId?: string,
  ) {
    const partyId = str(body.partyId).trim();
    if (!partyId) {
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        'اختر العميل لتحديد سعره المخصص',
        422,
        { field: 'partyId' },
      );
    }
    const unitPrice = dec(body.unitPrice);
    if (unitPrice.lte(0)) {
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        'سعر الكيلو للعميل يجب أن يكون أكبر من صفر',
        422,
        { field: 'unitPrice' },
      );
    }

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const policy = await this.loadTenantPolicyInTx(tx, tenantId);
      const partyRow = first(
        await tx.execute(sql`
          SELECT credit_limit::text FROM parties
          WHERE id = ${partyId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          LIMIT 1
        `),
      );

      const maxBonusPct = dec(body.maxBonusPct ?? policy.defaultMaxBonusPct ?? '5');
      const maxBonusKg = dec(body.maxBonusKgPerInvoice ?? policy.defaultMaxBonusQty ?? '2');
      const creditLimit = dec(
        body.creditLimit ?? partyRow?.credit_limit ?? policy.defaultCreditLimit ?? '5000',
      );
      const paymentTermsDays = Number(body.paymentTermsDays ?? 15);
      const lockPrice = body.lockPrice !== false;
      const maxDiscountPct = dec(body.maxDiscountPct ?? '0');
      const mode =
        body.preferredInvoiceMode === 'internal_delivery' ? 'internal_delivery' : 'zatca_tax';
      const label =
        String(body.priceTierLabel ?? '').trim() || `شريحة ${unitPrice.toFixed(2)} ريال/كجم`;
      const itemId = body.itemId ? String(body.itemId).trim() || null : null;
      const effectiveFrom = body.effectiveFrom?.trim() || new Date().toISOString().slice(0, 10);
      const effectiveTo = body.effectiveTo?.trim() || null;
      const changeReason = body.changeReason?.trim() || body.notes?.trim() || null;

      const existing = first(
        await tx.execute(sql`
          SELECT id::text, unit_price::text FROM van_sales_customer_prices
          WHERE tenant_id = ${tenantId}::uuid
            AND party_id = ${partyId}::uuid
            AND ((${itemId}::uuid IS NULL AND item_id IS NULL) OR item_id = ${itemId}::uuid)
            AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE
        `),
      );

      let customerPriceId: string;
      let previousUnitPrice: string | null = null;

      if (existing) {
        customerPriceId = str(existing.id);
        previousUnitPrice = existing.unit_price ? dec(existing.unit_price).toFixed(4) : null;
        await tx.execute(sql`
          UPDATE van_sales_customer_prices
          SET price_tier_label = ${label},
              unit_price = ${unitPrice.toFixed(4)}::numeric,
              max_bonus_pct = ${maxBonusPct.toFixed(2)}::numeric,
              max_bonus_kg_per_invoice = ${maxBonusKg.toFixed(4)}::numeric,
              preferred_invoice_mode = ${mode},
              credit_limit = ${creditLimit.toFixed(4)}::numeric,
              payment_terms_days = ${paymentTermsDays},
              lock_price = ${lockPrice},
              max_discount_pct = ${maxDiscountPct.toFixed(2)}::numeric,
              effective_from = ${effectiveFrom}::date,
              effective_to = ${effectiveTo}::date,
              updated_by = ${userId ?? null}::uuid,
              change_reason = ${changeReason},
              notes = ${body.notes?.trim() || null},
              updated_at = now()
          WHERE id = ${customerPriceId}::uuid AND tenant_id = ${tenantId}::uuid
        `);
      } else {
        customerPriceId = newId();
        await tx.execute(sql`
          INSERT INTO van_sales_customer_prices (
            id, tenant_id, party_id, item_id, price_tier_label, unit_price,
            max_bonus_pct, max_bonus_kg_per_invoice, preferred_invoice_mode,
            credit_limit, payment_terms_days, lock_price, max_discount_pct,
            effective_from, effective_to, updated_by, change_reason, notes
          ) VALUES (
            ${customerPriceId}::uuid, ${tenantId}::uuid, ${partyId}::uuid, ${itemId}::uuid,
            ${label}, ${unitPrice.toFixed(4)}::numeric,
            ${maxBonusPct.toFixed(2)}::numeric, ${maxBonusKg.toFixed(4)}::numeric,
            ${mode}, ${creditLimit.toFixed(4)}::numeric, ${paymentTermsDays},
            ${lockPrice}, ${maxDiscountPct.toFixed(2)}::numeric,
            ${effectiveFrom}::date, ${effectiveTo}::date, ${userId ?? null}::uuid,
            ${changeReason}, ${body.notes?.trim() || null}
          )
        `);
      }

      await tx.execute(sql`
        INSERT INTO van_sales_customer_price_history (
          id, tenant_id, customer_price_id, party_id, item_id,
          previous_unit_price, new_unit_price,
          max_bonus_pct, max_bonus_kg_per_invoice, max_discount_pct, lock_price,
          effective_from, effective_to, change_reason, changed_by
        ) VALUES (
          ${newId()}::uuid, ${tenantId}::uuid, ${customerPriceId}::uuid, ${partyId}::uuid, ${itemId}::uuid,
          ${previousUnitPrice}::numeric, ${unitPrice.toFixed(4)}::numeric,
          ${maxBonusPct.toFixed(2)}::numeric, ${maxBonusKg.toFixed(4)}::numeric,
          ${maxDiscountPct.toFixed(2)}::numeric, ${lockPrice},
          ${effectiveFrom}::date, ${effectiveTo}::date, ${changeReason}, ${userId ?? null}::uuid
        )
      `);
    });
    return this.dashboard(tenantId);
  }

  /**
   * Pillar 1 & 2 (Phase 2 & 3): Issue goods from Factory Warehouse to Sales Rep Custody (`أمر تحميل وصرف عهدة لمندوب`),
   * using atomic `SequencesService.next` and linking to official `stock_transfers` / `InventoryService.recordInTx`.
   */
  async createLoadOrder(
    tenantId: string,
    userId: string,
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
    const salesmanId = str(body.salesmanId).trim();
    if (!salesmanId) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'اختر المندوب لأمر التحميل', 422, {
        field: 'salesmanId',
      });
    }
    const loadedQty = dec(body.loadedQty);
    if (loadedQty.lte(0)) {
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        'الكمية المحمّلة للمندوب يجب أن تكون أكبر من صفر',
        422,
        { field: 'loadedQty' },
      );
    }

    const idempotencyKey = body.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = await withTenantTx(this.database.db, tenantId, async (tx) =>
        first(
          await tx.execute(sql`
            SELECT id::text FROM van_load_orders
            WHERE tenant_id = ${tenantId}::uuid
              AND idempotency_key = ${idempotencyKey}
              AND deleted_at IS NULL
            LIMIT 1
          `),
        ),
      );
      if (existing) {
        return this.dashboard(tenantId);
      }
    }

    const warehouseId = body.warehouseId?.trim() || null;
    const vanWarehouseId = body.vanWarehouseId?.trim() || null;
    const itemId = body.itemId?.trim() || null;

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const policy = await this.loadTenantPolicyInTx(tx, tenantId);
      const maxBonusQty = dec(body.maxBonusQty ?? policy.defaultMaxBonusQty ?? '20');
      const maxBonusPct = dec(body.maxBonusPct ?? policy.defaultMaxBonusPct ?? '20');

      const resolvedBranchId = await this.resolveDefaultBranchIdInTx(
        tx,
        tenantId,
        body.branchId,
        warehouseId,
      );

      const allocated = await this.sequences.next(
        {
          tenantId,
          branchId: resolvedBranchId ?? undefined,
          docType: 'van_load_order',
        },
        tx,
        { prefix: 'VLO-', padding: 4 },
      );
      const number = allocated.display;
      const loadOrderId = newId();

      // Resolve batch number & unit cost/price without hardcoding
      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const batchNo =
        String(body.productionBatchNo ?? '').trim() || `PROD-${datePart}-0001`;

      const batchRow = first(
        await tx.execute(sql`
          SELECT item_id::text, warehouse_id::text, unit_cost::text
          FROM factory_production_batches
          WHERE tenant_id = ${tenantId}::uuid AND batch_no = ${batchNo} AND deleted_at IS NULL
          LIMIT 1
        `),
      );
      const effectiveItemId =
        itemId || (batchRow?.item_id ? str(batchRow.item_id) : null);
      const effectiveWarehouseId =
        warehouseId || (batchRow?.warehouse_id ? str(batchRow.warehouse_id) : null);

      let referenceUnitPrice = batchRow?.unit_cost ? dec(batchRow.unit_cost) : new Decimal(0);
      if (effectiveItemId) {
        const itemRow = first(
          await tx.execute(sql`
            SELECT sale_price::text, purchase_price::text AS cost_price FROM items
            WHERE id = ${effectiveItemId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
            LIMIT 1
          `),
        );
        if (itemRow?.sale_price && dec(itemRow.sale_price).gt(0)) {
          referenceUnitPrice = dec(itemRow.sale_price);
        } else if (referenceUnitPrice.lte(0) && itemRow?.cost_price) {
          referenceUnitPrice = dec(itemRow.cost_price);
        }
      }
      const estimatedValue = loadedQty.mul(referenceUnitPrice);
      const batchUnitCost = batchRow?.unit_cost ? dec(batchRow.unit_cost) : new Decimal(0);

      let linkedStockTransferId: string | null = null;
      let linkedInventoryTxId: string | null = null;

      // Official stock transfer & inventory movement inside the same atomic transaction
      if (
        effectiveWarehouseId &&
        vanWarehouseId &&
        effectiveWarehouseId !== vanWarehouseId &&
        effectiveItemId &&
        resolvedBranchId
      ) {
        const trAlloc = await this.sequences.next(
          { tenantId, branchId: resolvedBranchId, docType: 'stock_transfer' },
          tx,
          { prefix: 'TR-', padding: 6 },
        );
        linkedStockTransferId = newId();
        await tx.execute(sql`
          INSERT INTO stock_transfers (
            id, tenant_id, number, branch_id, from_warehouse_id, to_warehouse_id,
            status, sent_at, received_at
          ) VALUES (
            ${linkedStockTransferId}::uuid, ${tenantId}::uuid, ${trAlloc.display},
            ${resolvedBranchId}::uuid, ${effectiveWarehouseId}::uuid, ${vanWarehouseId}::uuid,
            'received', now(), now()
          )
        `);
        await tx.execute(sql`
          INSERT INTO stock_transfer_lines (
            transfer_id, tenant_id, line_no, item_id, qty, sent_qty, received_qty, unit_cost, batch_no
          ) VALUES (
            ${linkedStockTransferId}::uuid, ${tenantId}::uuid, 1,
            ${effectiveItemId}::uuid, ${loadedQty.toFixed(4)}::numeric,
            ${loadedQty.toFixed(4)}::numeric, ${loadedQty.toFixed(4)}::numeric,
            ${batchUnitCost.toFixed(4)}::numeric, ${batchNo}
          )
        `);
        const moveOut = await this.inventory.recordInTx(
          tx,
          tenantId,
          [
            {
              itemId: effectiveItemId,
              warehouseId: effectiveWarehouseId,
              qty: loadedQty.toFixed(4),
              unitCost: batchUnitCost.toFixed(4),
              direction: 'out',
              docType: 'stock_transfer',
              docId: linkedStockTransferId,
              lineId: newId(),
            },
            {
              itemId: effectiveItemId,
              warehouseId: vanWarehouseId,
              qty: loadedQty.toFixed(4),
              unitCost: batchUnitCost.toFixed(4),
              direction: 'in',
              docType: 'stock_transfer_receipt',
              docId: linkedStockTransferId,
              lineId: newId(),
            },
          ],
          { allowNegative: true },
        );
        linkedInventoryTxId = moveOut.transactionIds[0] ?? null;
      } else if (effectiveWarehouseId && effectiveItemId) {
        const moveOut = await this.inventory.recordInTx(
          tx,
          tenantId,
          [
            {
              itemId: effectiveItemId,
              warehouseId: effectiveWarehouseId,
              qty: loadedQty.toFixed(4),
              unitCost: batchUnitCost.toFixed(4),
              direction: 'out',
              docType: 'van_load_order',
              docId: loadOrderId,
              lineId: loadOrderId,
            },
          ],
          { allowNegative: true },
        );
        linkedInventoryTxId = moveOut.transactionIds[0] ?? null;
      }

      await tx.execute(sql`
        INSERT INTO van_load_orders (
          id, tenant_id, number, salesman_id, branch_id, warehouse_id, van_warehouse_id,
          stock_transfer_id, item_id,
          vehicle_plate, load_date, production_batch_no, status,
          loaded_qty, loaded_total_value, unit_cost,
          sold_qty, bonus_qty, returned_qty, damaged_qty, shortage_qty,
          max_bonus_qty, max_bonus_pct, notes, idempotency_key, created_by
        ) VALUES (
          ${loadOrderId}::uuid, ${tenantId}::uuid, ${number}, ${salesmanId}::uuid,
          ${resolvedBranchId}::uuid, ${effectiveWarehouseId}::uuid, ${vanWarehouseId}::uuid,
          ${linkedStockTransferId}::uuid, ${effectiveItemId}::uuid,
          ${body.vehiclePlate?.trim() || null}, CURRENT_DATE, ${batchNo}, 'loaded',
          ${loadedQty.toFixed(4)}::numeric, ${estimatedValue.toFixed(4)}::numeric,
          ${batchUnitCost.toFixed(4)}::numeric,
          0, 0, 0, 0, 0,
          ${maxBonusQty.toFixed(4)}::numeric, ${maxBonusPct.toFixed(2)}::numeric,
          ${body.notes?.trim() || null}, ${idempotencyKey}, ${userId}::uuid
        )
      `);

      await tx.execute(sql`
        UPDATE factory_production_batches
        SET issued_qty = issued_qty + ${loadedQty.toFixed(4)}::numeric,
            updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND batch_no = ${batchNo} AND deleted_at IS NULL
      `);

      await tx.execute(sql`
        INSERT INTO van_stock_movements (
          id, tenant_id, movement_type, batch_no, load_order_id, salesman_id, item_id,
          inventory_transaction_id, qty, unit_price, amount, reason, idempotency_key, actor_user_id
        ) VALUES (
          ${newId()}::uuid, ${tenantId}::uuid, 'van_load', ${batchNo}, ${loadOrderId}::uuid,
          ${salesmanId}::uuid, ${effectiveItemId}::uuid,
          ${linkedInventoryTxId}::uuid,
          ${loadedQty.toFixed(4)}::numeric, ${referenceUnitPrice.toFixed(4)}::numeric,
          ${estimatedValue.toFixed(4)}::numeric,
          ${`صرف وتحميل عهدة للمندوب بموجب أمر التحميل ${number}`},
          ${idempotencyKey ? `load-move:${idempotencyKey}` : null},
          ${userId}::uuid
        )
      `);
    });

    return this.dashboard(tenantId);
  }

  /**
   * Pillar 3, 4, 5, 7, 8 (Phase 2, 3, 5): Issue Van Sales Document
   * with 5-level price priority, atomic sequence numbering, idempotency,
   * tax policy verification, and official `SalesService.createInTx` / `postInTx` linking.
   */
  async createDocument(
    tenantId: string,
    userId: string,
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
    const loadOrderId = str(body.loadOrderId).trim();
    if (!loadOrderId) {
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        'يجب اختيار أمر التحميل / دفعة الإنتاج الخاصة بالمندوب لمنع بيع بضاعة من خارج المخبز',
        422,
        { field: 'loadOrderId' },
      );
    }
    const soldQty = dec(body.soldQty);
    const bonusQty = dec(body.bonusQty ?? '0');
    if (soldQty.lte(0) && bonusQty.lte(0)) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'أدخل الكمية المباعة بالكيلو', 422, {
        field: 'soldQty',
      });
    }

    const idempotencyKey = body.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = await withTenantTx(this.database.db, tenantId, async (tx) =>
        first(
          await tx.execute(sql`
            SELECT id::text FROM van_sales_documents
            WHERE tenant_id = ${tenantId}::uuid
              AND idempotency_key = ${idempotencyKey}
              AND deleted_at IS NULL
            LIMIT 1
          `),
        ),
      );
      if (existing) {
        return this.dashboard(tenantId);
      }
    }

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const policy = await this.loadTenantPolicyInTx(tx, tenantId);

      const loadOrder = first(
        await tx.execute(sql`
          SELECT * FROM van_load_orders
          WHERE id = ${loadOrderId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          FOR UPDATE
        `),
      );
      if (!loadOrder) {
        throw new DomainError(errorCodes.NOT_FOUND, 'أمر التحميل غير موجود', 404);
      }
      if (str(loadOrder.status) === 'settled') {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          'أمر التحميل هذا تم إغلاقه وتصفيته مسبقاً',
          422,
        );
      }

      const loaded = dec(loadOrder.loaded_qty);
      const currentSold = dec(loadOrder.sold_qty);
      const currentBonus = dec(loadOrder.bonus_qty);
      const currentReturned = dec(loadOrder.returned_qty);
      const currentDamaged = dec(loadOrder.damaged_qty);
      const remaining = loaded
        .minus(currentSold)
        .minus(currentBonus)
        .minus(currentReturned)
        .minus(currentDamaged);
      const totalOutThisDoc = soldQty.plus(bonusQty);

      if (totalOutThisDoc.gt(remaining)) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          `رفض أمني لمنع خلط بضاعة خارجية: الكمية المطلوبة (${totalOutThisDoc.toFixed(2)} كجم) تتجاوز الرصيد المتبقي في سيارة المندوب من دفعة المخبز رقم ${str(loadOrder.production_batch_no)} (${remaining.toFixed(2)} كجم متبقي).`,
          422,
          { field: 'soldQty' },
        );
      }

      const partyId = body.partyId ? str(body.partyId).trim() || null : null;
      const effectiveItemId =
        body.itemId?.trim() || (loadOrder.item_id ? str(loadOrder.item_id) : null);

      // 5-Level Price Priority Hierarchy (Phase 5):
      // 1. Customer + Item active price rule (`van_sales_customer_prices` where item_id = effectiveItemId)
      // 2. Customer general active price rule (`van_sales_customer_prices` where item_id IS NULL)
      // 3. Default Price List (`price_list_items` on default `price_lists`)
      // 4. Item card `sale_price` (`items.sale_price`)
      // 5. Supplied `body.unitPrice`
      let customerRule: Record<string, unknown> | undefined;
      if (partyId) {
        customerRule = first(
          await tx.execute(sql`
            SELECT * FROM van_sales_customer_prices
            WHERE tenant_id = ${tenantId}::uuid
              AND party_id = ${partyId}::uuid
              AND deleted_at IS NULL
              AND effective_from <= CURRENT_DATE
              AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
              AND (${effectiveItemId}::uuid IS NULL OR item_id = ${effectiveItemId}::uuid OR item_id IS NULL)
            ORDER BY (CASE WHEN item_id IS NOT NULL THEN 0 ELSE 1 END) ASC, updated_at DESC
            LIMIT 1
          `),
        );
      }

      let baseCatalogPrice: Decimal | null = null;
      let itemTaxRate: Decimal | null = null;
      let itemTaxGroupId: string | undefined;
      if (effectiveItemId) {
        const plRow = first(
          await tx.execute(sql`
            SELECT pli.unit_price::text AS price
            FROM price_list_items pli
            JOIN price_lists pl ON pl.id = pli.price_list_id
            WHERE pli.tenant_id = ${tenantId}::uuid
              AND pli.item_id = ${effectiveItemId}::uuid
              AND pl.is_default = true
              AND pl.deleted_at IS NULL
            LIMIT 1
          `),
        );
        const itemCard = first(
          await tx.execute(sql`
            SELECT i.sale_price::text, i.tax_group_id::text, tg.rate::text AS tax_rate
            FROM items i
            LEFT JOIN tax_groups tg ON tg.id = i.tax_group_id
            WHERE i.id = ${effectiveItemId}::uuid AND i.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NULL
            LIMIT 1
          `),
        );
        if (plRow?.price && dec(plRow.price).gt(0)) {
          baseCatalogPrice = dec(plRow.price);
        } else if (itemCard?.sale_price && dec(itemCard.sale_price).gt(0)) {
          baseCatalogPrice = dec(itemCard.sale_price);
        }
        if (itemCard?.tax_rate !== undefined && itemCard?.tax_rate !== null) {
          itemTaxRate = dec(itemCard.tax_rate);
        }
        if (itemCard?.tax_group_id) {
          itemTaxGroupId = str(itemCard.tax_group_id);
        }
      }

      const tierUnitPrice = customerRule ? dec(customerRule.unit_price) : null;
      const fallbackPrice = tierUnitPrice ?? baseCatalogPrice;
      const requestedUnitPrice =
        body.unitPrice !== undefined && String(body.unitPrice).trim() !== ''
          ? dec(body.unitPrice)
          : (fallbackPrice ?? new Decimal(0));

      if (
        tierUnitPrice &&
        customerRule?.lock_price !== false &&
        requestedUnitPrice.lt(tierUnitPrice) &&
        !body.allowPriceDiscountOverride
      ) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          `منع تغيير السعر غير المصرح به: سعر هذا العميل مثبّت في النظام عند (${tierUnitPrice.toFixed(2)} ريال/كجم). لا يُسمح للمندوب بالبيع بسعر أقل (${requestedUnitPrice.toFixed(2)} ريال/كجم) إلا بموافقة الإدارة.`,
          422,
          { field: 'unitPrice' },
        );
      }
      const resolvedUnitPrice =
        tierUnitPrice && customerRule?.lock_price !== false && !body.allowPriceDiscountOverride
          ? tierUnitPrice
          : requestedUnitPrice;
      if (resolvedUnitPrice.lte(0)) {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'حدد سعر البيع للكيلو', 422, {
          field: 'unitPrice',
        });
      }

      const discountAmount = Decimal.max(0, dec(body.discountAmount ?? '0'));
      const grossBeforeDiscount = soldQty.mul(resolvedUnitPrice);
      const maxDiscountPct = customerRule ? dec(customerRule.max_discount_pct) : new Decimal(0);
      const discountPct = grossBeforeDiscount.gt(0)
        ? discountAmount.div(grossBeforeDiscount).mul(100)
        : new Decimal(0);
      if (
        discountAmount.gt(0) &&
        discountPct.gt(maxDiscountPct) &&
        !body.allowPriceDiscountOverride
      ) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          `منع الخصم غير المصرح به: قيمة الخصم (${discountAmount.toFixed(2)} ريال — ${discountPct.toFixed(1)}%) تتجاوز السقف المسموح للعميل (${maxDiscountPct.toFixed(1)}%). يتطلب اعتماد صاحب المصنع أو المحاسب.`,
          422,
          { field: 'discountAmount' },
        );
      }

      // Bonus anti-fraud controls
      const loadMaxBonusRemaining = dec(loadOrder.max_bonus_qty).minus(currentBonus);
      const customerMaxBonusKg = customerRule
        ? dec(customerRule.max_bonus_kg_per_invoice)
        : dec(loadOrder.max_bonus_qty);
      const customerMaxBonusPct = customerRule
        ? dec(customerRule.max_bonus_pct)
        : dec(loadOrder.max_bonus_pct);
      const bonusPctOfSale = soldQty.gt(0)
        ? bonusQty.div(soldQty).mul('100')
        : new Decimal('100');

      let bonusAnomaly = false;
      const anomalyReasons: string[] = [];

      if (bonusQty.gt(0)) {
        if (!body.bonusReason || !body.bonusReason.trim()) {
          throw new DomainError(
            errorCodes.VALIDATION_FAILED,
            'يجب تحديد سبب منح الكمية المجانية / البونص (ترويجي، عينات، تعويض تلف…)',
            422,
            { field: 'bonusReason' },
          );
        }
        if (bonusQty.gt(loadMaxBonusRemaining)) {
          bonusAnomaly = true;
          anomalyReasons.push(
            `تجاوز سقف البونص المتبقي لأمر التحميل (${loadMaxBonusRemaining.toFixed(2)} كجم)`,
          );
        }
        if (bonusQty.gt(customerMaxBonusKg)) {
          bonusAnomaly = true;
          anomalyReasons.push(
            `الكمية المجانية (${bonusQty.toFixed(2)} كجم) تتجاوز الحد المسموح للعميل في الفاتورة (${customerMaxBonusKg.toFixed(2)} كجم)`,
          );
        }
        if (bonusPctOfSale.gt(customerMaxBonusPct)) {
          bonusAnomaly = true;
          anomalyReasons.push(
            `نسبة البونص (${bonusPctOfSale.toFixed(1)}%) أعلى من النسبة المعتمدة (${customerMaxBonusPct.toFixed(1)}%)`,
          );
        }
        if (bonusAnomaly && !body.customerBonusConfirmed && !body.allowBonusOverride) {
          throw new DomainError(
            errorCodes.VALIDATION_FAILED,
            `تنبيه رقابة البونص المجاني: ${anomalyReasons.join(' · ')}. يُرجى إدخال رمز تأكيد استلام العميل للكمية المجانية أو اعتماد الإدارة.`,
            422,
            { field: 'bonusQty' },
          );
        }
      }

      // Tax & Invoice Mode Policy Guard (Phase 5 & Section 3: never assume tax exemption without approved policy)
      const invoiceMode =
        body.invoiceMode ??
        (customerRule &&
        str(customerRule.preferred_invoice_mode) === 'internal_delivery' &&
        policy.allowInternalDeliveryWithoutTax
          ? 'internal_delivery'
          : 'zatca_tax');

      if (invoiceMode === 'internal_delivery' && !policy.allowInternalDeliveryWithoutTax) {
        throw new DomainError(
          'VAN_SALES_INTERNAL_DELIVERY_POLICY_REQUIRED',
          'وضع إشعار التسليم الداخلي بدون ضريبة غير مفعل افتراضياً. يتطلب اعتماد السياسة الضريبية والمحاسبية في إعدادات المنشأة (van_sales.policy.allowInternalDeliveryWithoutTax) قبل الاستخدام.',
          422,
          { field: 'invoiceMode' },
        );
      }

      // Resolve VAT rate from item tax group or tenant default tax group
      let resolvedVatRate = itemTaxRate;
      if (resolvedVatRate === null) {
        const defaultTaxGroup = first(
          await tx.execute(sql`
            SELECT id::text, rate::text FROM tax_groups
            WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
            ORDER BY rate DESC
            LIMIT 1
          `),
        );
        if (defaultTaxGroup?.rate !== undefined && defaultTaxGroup?.rate !== null) {
          resolvedVatRate = dec(defaultTaxGroup.rate);
          if (!itemTaxGroupId && defaultTaxGroup.id) {
            itemTaxGroupId = str(defaultTaxGroup.id);
          }
        } else {
          resolvedVatRate = new Decimal('15');
        }
      }

      const subtotal = Decimal.max(0, grossBeforeDiscount.minus(discountAmount));
      const taxRate = invoiceMode === 'zatca_tax' ? resolvedVatRate : new Decimal('0');
      const taxTotal =
        invoiceMode === 'zatca_tax' ? subtotal.mul(taxRate.div(100)) : new Decimal('0');
      const grandTotal = subtotal.plus(taxTotal);
      const paymentMethod = body.paymentMethod ?? 'cash';
      const paidAmount = paymentMethod === 'credit' ? new Decimal('0') : grandTotal;
      const taxPolicyStatus =
        invoiceMode === 'zatca_tax' ? 'standard_vat' : 'pending_tax_policy';

      // Credit limit enforcement (checking both customerRule.credit_limit and parties.credit_limit)
      if (paymentMethod === 'credit' && partyId) {
        const partyRow = first(
          await tx.execute(sql`
            SELECT credit_limit::text FROM parties
            WHERE id = ${partyId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
            LIMIT 1
          `),
        );
        const creditLimit = customerRule
          ? dec(customerRule.credit_limit)
          : partyRow?.credit_limit
            ? dec(partyRow.credit_limit)
            : null;
        if (creditLimit && creditLimit.gt(0)) {
          const unpaidRow = first(
            await tx.execute(sql`
              SELECT COALESCE(SUM(total - paid_amount), 0)::text AS unpaid
              FROM van_sales_documents
              WHERE tenant_id = ${tenantId}::uuid AND party_id = ${partyId}::uuid AND deleted_at IS NULL
            `),
          );
          const currentDebt = dec(unpaidRow?.unpaid);
          if (
            currentDebt.plus(grandTotal).gt(creditLimit) &&
            !body.allowPriceDiscountOverride
          ) {
            throw new DomainError(
              errorCodes.VALIDATION_FAILED,
              `تجاوز الحد الائتماني للعميل: مديونية العميل بعد هذه الفاتورة (${currentDebt.plus(grandTotal).toFixed(2)} ريال) تتجاوز سقف الائتمان المسموح (${creditLimit.toFixed(2)} ريال).`,
              422,
              { field: 'paymentMethod' },
            );
          }
        }
      }

      // Cost & Net Profit calculation
      const batchRow = first(
        await tx.execute(sql`
          SELECT unit_cost::text FROM factory_production_batches
          WHERE tenant_id = ${tenantId}::uuid
            AND batch_no = ${str(loadOrder.production_batch_no)}
            AND deleted_at IS NULL
          LIMIT 1
        `),
      );
      const unitCost = batchRow
        ? dec(batchRow.unit_cost)
        : dec(loadOrder.unit_cost).gt(0)
          ? dec(loadOrder.unit_cost)
          : new Decimal('0');
      const totalCogs = soldQty.plus(bonusQty).mul(unitCost);
      const netProfit = subtotal.minus(totalCogs);

      const resolvedBranchId = await this.resolveDefaultBranchIdInTx(
        tx,
        tenantId,
        loadOrder.branch_id ? str(loadOrder.branch_id) : null,
        loadOrder.van_warehouse_id
          ? str(loadOrder.van_warehouse_id)
          : loadOrder.warehouse_id
            ? str(loadOrder.warehouse_id)
            : null,
      );

      const prefix = invoiceMode === 'zatca_tax' ? 'VTX-' : 'VDL-';
      const allocated = await this.sequences.next(
        {
          tenantId,
          branchId: resolvedBranchId ?? undefined,
          docType: invoiceMode === 'zatca_tax' ? 'van_sales_tax_doc' : 'van_sales_delivery_doc',
        },
        tx,
        { prefix, padding: 5 },
      );
      const number = allocated.display;
      const docId = newId();

      // Official Sales Invoice creation (`sales_invoices` + `sales_invoice_lines`) via `SalesService.createInTx`
      let linkedSalesInvoiceId: string | null = null;
      if (resolvedBranchId && (partyId || body.customerName?.trim())) {
        const invoiceWarehouseId = loadOrder.van_warehouse_id
          ? str(loadOrder.van_warehouse_id)
          : loadOrder.warehouse_id
            ? str(loadOrder.warehouse_id)
            : undefined;
        const salesLines: SalesLineInput[] = [];
        if (soldQty.gt(0)) {
          salesLines.push({
            itemId: effectiveItemId ?? undefined,
            description: `مبيعات توزيع — دفعة ${str(loadOrder.production_batch_no)} (${number})`,
            quantity: soldQty.toFixed(4),
            unitPrice: resolvedUnitPrice.toFixed(4),
            discountAmount: discountAmount.toFixed(4),
            taxRate: taxRate.toFixed(4),
            taxGroupId: itemTaxGroupId,
            batchNo: str(loadOrder.production_batch_no),
            metadata: {
              isBonus: false,
              vanDocumentId: docId,
              vanDocumentNumber: number,
              loadOrderId,
              productionBatchNo: str(loadOrder.production_batch_no),
            },
          });
        }
        if (bonusQty.gt(0)) {
          salesLines.push({
            itemId: effectiveItemId ?? undefined,
            description: `بونص مجاني — ${body.bonusReason?.trim() || 'ترويجي'} (${number})`,
            quantity: bonusQty.toFixed(4),
            unitPrice: '0.0000',
            discountAmount: '0.0000',
            taxRate: '0.0000',
            batchNo: str(loadOrder.production_batch_no),
            metadata: {
              isBonus: true,
              bonusReason: body.bonusReason?.trim() || 'ترويجي',
              customerBonusConfirmed: Boolean(body.customerBonusConfirmed),
              customerConfirmationCode: body.customerConfirmationCode?.trim() || null,
              vanDocumentId: docId,
              vanDocumentNumber: number,
              loadOrderId,
              productionBatchNo: str(loadOrder.production_batch_no),
            },
          });
        }
        if (salesLines.length > 0) {
          linkedSalesInvoiceId = await this.sales.createInTx(tx, tenantId, {
            branchId: resolvedBranchId,
            warehouseId: invoiceWarehouseId,
            partyId: partyId ?? undefined,
            salesmanId: str(loadOrder.salesman_id),
            cashCustomerName: !partyId ? body.customerName?.trim() || 'عميل توزيع' : undefined,
            kind: 'sale',
            lines: salesLines,
          });
        }
      }

      const companyProfile = first(
        await tx.execute(sql`
          SELECT name_ar, tax_no FROM company_profiles
          WHERE tenant_id = ${tenantId}::uuid
          LIMIT 1
        `),
      );
      const qrTlv = buildZatcaTlvBase64({
        sellerName: str(companyProfile?.name_ar) || 'مصنع ومخابز التوزيع',
        vatNumber: str(companyProfile?.tax_no) || '300000000000003',
        timestampIso: new Date().toISOString(),
        invoiceTotal: grandTotal.toFixed(2),
        vatTotal: taxTotal.toFixed(2),
      });

      await tx.execute(sql`
        INSERT INTO van_sales_documents (
          id, tenant_id, branch_id, number, load_order_id, salesman_id, party_id, customer_name,
          item_id, doc_mode, invoice_mode, tax_policy_status, payment_method, doc_date,
          batch_code, production_batch_no,
          sold_qty, bonus_qty, bonus_reason, unit_price, discount_amount, discount_reason,
          discount_approved_by, subtotal, tax_rate, tax_total, total, paid_amount,
          unit_cost, net_profit, qr_payload, zatca_qr_tlv, sales_invoice_id,
          customer_bonus_confirmed, customer_confirmation_code, bonus_anomaly, anomaly_reason,
          notes, idempotency_key, created_by
        ) VALUES (
          ${docId}::uuid, ${tenantId}::uuid, ${resolvedBranchId}::uuid, ${number}, ${loadOrderId}::uuid,
          ${str(loadOrder.salesman_id)}::uuid, ${partyId}::uuid,
          ${body.customerName?.trim() || null},
          ${effectiveItemId}::uuid,
          ${invoiceMode}, ${invoiceMode}, ${taxPolicyStatus}, ${paymentMethod}, CURRENT_DATE,
          ${str(loadOrder.production_batch_no)}, ${str(loadOrder.production_batch_no)},
          ${soldQty.toFixed(4)}::numeric, ${bonusQty.toFixed(4)}::numeric,
          ${body.bonusReason?.trim() || null},
          ${resolvedUnitPrice.toFixed(4)}::numeric,
          ${discountAmount.toFixed(4)}::numeric,
          ${body.discountReason?.trim() || null},
          ${body.allowPriceDiscountOverride ? userId : null}::uuid,
          ${subtotal.toFixed(4)}::numeric,
          ${taxRate.toFixed(2)}::numeric, ${taxTotal.toFixed(4)}::numeric,
          ${grandTotal.toFixed(4)}::numeric, ${paidAmount.toFixed(4)}::numeric,
          ${unitCost.toFixed(4)}::numeric, ${netProfit.toFixed(4)}::numeric,
          ${qrTlv}, ${qrTlv}, ${linkedSalesInvoiceId}::uuid,
          ${Boolean(body.customerBonusConfirmed)},
          ${body.customerConfirmationCode?.trim() || null},
          ${bonusAnomaly},
          ${anomalyReasons.length > 0 ? anomalyReasons.join(' · ') : null},
          ${body.notes?.trim() || null},
          ${idempotencyKey},
          ${userId}::uuid
        )
      `);

      const cashAdd = paymentMethod === 'cash' ? grandTotal : new Decimal('0');
      await tx.execute(sql`
        UPDATE van_load_orders
        SET sold_qty = sold_qty + ${soldQty.toFixed(4)}::numeric,
            bonus_qty = bonus_qty + ${bonusQty.toFixed(4)}::numeric,
            expected_cash = expected_cash + ${cashAdd.toFixed(4)}::numeric,
            status = 'in_route',
            updated_at = now()
        WHERE id = ${loadOrderId}::uuid AND tenant_id = ${tenantId}::uuid
      `);

      if (soldQty.gt(0)) {
        await tx.execute(sql`
          INSERT INTO van_stock_movements (
            id, tenant_id, movement_type, batch_no, load_order_id, salesman_id, party_id, item_id,
            qty, unit_price, amount, reason, idempotency_key, actor_user_id
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, 'van_sale', ${str(loadOrder.production_batch_no)},
            ${loadOrderId}::uuid, ${str(loadOrder.salesman_id)}::uuid, ${partyId}::uuid,
            ${effectiveItemId}::uuid,
            ${soldQty.toFixed(4)}::numeric, ${resolvedUnitPrice.toFixed(4)}::numeric,
            ${grandTotal.toFixed(4)}::numeric,
            ${`بيع للعميل بموجب فاتورة ${number}`},
            ${idempotencyKey ? `sale-move:${idempotencyKey}` : null},
            ${userId}::uuid
          )
        `);
      }
      if (bonusQty.gt(0)) {
        await tx.execute(sql`
          INSERT INTO van_stock_movements (
            id, tenant_id, movement_type, batch_no, load_order_id, salesman_id, party_id, item_id,
            qty, unit_price, amount, reason, idempotency_key, actor_user_id
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, 'van_bonus', ${str(loadOrder.production_batch_no)},
            ${loadOrderId}::uuid, ${str(loadOrder.salesman_id)}::uuid, ${partyId}::uuid,
            ${effectiveItemId}::uuid,
            ${bonusQty.toFixed(4)}::numeric, 0, 0,
            ${`كمية مجانية / بونص (${body.bonusReason?.trim() || 'ترويجي'}) في فاتورة ${number}`},
            ${idempotencyKey ? `bonus-move:${idempotencyKey}` : null},
            ${userId}::uuid
          )
        `);
      }
    });

    return this.dashboard(tenantId);
  }

  private async resolveShortageUnitPriceInTx(
    tx: DrizzleTx,
    tenantId: string,
    loadOrder: Record<string, unknown>,
    policy: VanSalesTenantPolicy,
  ): Promise<Decimal> {
    if (policy.shortageUnitPrice && dec(policy.shortageUnitPrice).gt(0)) {
      return dec(policy.shortageUnitPrice);
    }
    if (policy.shortageValuationBasis === 'unit_cost' && dec(loadOrder.unit_cost).gt(0)) {
      return dec(loadOrder.unit_cost);
    }
    const avgDocRow = first(
      await tx.execute(sql`
        SELECT AVG(unit_price)::text AS avg_price
        FROM van_sales_documents
        WHERE tenant_id = ${tenantId}::uuid
          AND load_order_id = ${str(loadOrder.id)}::uuid
          AND deleted_at IS NULL
          AND unit_price > 0
      `),
    );
    if (avgDocRow?.avg_price && dec(avgDocRow.avg_price).gt(0)) {
      return dec(avgDocRow.avg_price);
    }
    if (loadOrder.item_id) {
      const itemRow = first(
        await tx.execute(sql`
          SELECT sale_price::text, purchase_price::text AS cost_price FROM items
          WHERE id = ${str(loadOrder.item_id)}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          LIMIT 1
        `),
      );
      if (itemRow?.sale_price && dec(itemRow.sale_price).gt(0)) {
        return dec(itemRow.sale_price);
      }
      if (itemRow?.cost_price && dec(itemRow.cost_price).gt(0)) {
        return dec(itemRow.cost_price);
      }
    }
    const loadedQty = dec(loadOrder.loaded_qty);
    const loadedVal = dec(loadOrder.loaded_total_value);
    if (loadedQty.gt(0) && loadedVal.gt(0)) {
      return loadedVal.div(loadedQty);
    }
    return dec(loadOrder.unit_cost);
  }

  /**
   * Pillar 2 (Stage 1 — Phase 3 & 4): Sales Rep submits End-of-Day Shift Closing (`تقديم إغلاق الوردية للمحاسب`).
   */
  async submitClosing(
    tenantId: string,
    userId: string,
    loadOrderId: string,
    body: {
      returnedQty?: string;
      damagedQty?: string;
      damageReason?: string;
      collectedCash?: string;
      closingNotes?: string;
    },
  ) {
    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const policy = await this.loadTenantPolicyInTx(tx, tenantId);
      const loadOrder = first(
        await tx.execute(sql`
          SELECT l.*, COALESCE(s.name, 'مندوب') AS salesman_name
          FROM van_load_orders l
          LEFT JOIN salesmen s ON s.id = l.salesman_id
          WHERE l.id = ${loadOrderId}::uuid AND l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
          FOR UPDATE OF l
        `),
      );
      if (!loadOrder) {
        throw new DomainError(errorCodes.NOT_FOUND, 'أمر التحميل غير موجود', 404);
      }
      if (str(loadOrder.status) === 'settled') {
        throw new DomainError(
          'VAN_LOAD_ORDER_ALREADY_SETTLED',
          'تم اعتماد وتصفية هذه الوردية مسبقاً',
          409,
        );
      }

      const loaded = dec(loadOrder.loaded_qty);
      const sold = dec(loadOrder.sold_qty);
      const bonus = dec(loadOrder.bonus_qty);
      const returnedQty = Decimal.max(0, dec(body.returnedQty ?? '0'));
      const damagedQty = Decimal.max(0, dec(body.damagedQty ?? '0'));
      const collectedCash = Decimal.max(0, dec(body.collectedCash ?? loadOrder.expected_cash));

      if (damagedQty.gt(0) && (!body.damageReason || !body.damageReason.trim())) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          'عند تسجيل كمية تالفة يجب كتابة سبب التلف بوضوح لإحالته للفحص الفعلي من المحاسب وأمين المستودع',
          422,
          { field: 'damageReason' },
        );
      }

      const accountedQty = sold.plus(bonus).plus(returnedQty).plus(damagedQty);
      if (accountedQty.gt(loaded)) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          `مجموع الكميات (المباع ${sold.toFixed(2)} + البونص ${bonus.toFixed(2)} + المرتجع السليم ${returnedQty.toFixed(2)} + التالف ${damagedQty.toFixed(2)} = ${accountedQty.toFixed(2)} كجم) يتجاوز الكمية المستلمة أصلاً (${loaded.toFixed(2)} كجم).`,
          422,
        );
      }

      const shortageQty = Decimal.max(0, loaded.minus(accountedQty));
      const unitChargePrice = await this.resolveShortageUnitPriceInTx(
        tx,
        tenantId,
        loadOrder,
        policy,
      );
      const shortageValue = shortageQty.mul(unitChargePrice);
      const shortagePolicyStatus =
        policy.shortageValuationBasis && policy.shortageValuationBasis !== 'unconfigured'
          ? 'policy_configured'
          : 'pending_policy_approval';

      await tx.execute(sql`
        UPDATE van_load_orders
        SET status = 'pending_closing',
            returned_qty = ${returnedQty.toFixed(4)}::numeric,
            damaged_qty = ${damagedQty.toFixed(4)}::numeric,
            shortage_qty = ${shortageQty.toFixed(4)}::numeric,
            shortage_value = ${shortageValue.toFixed(4)}::numeric,
            shortage_policy_status = ${shortagePolicyStatus},
            collected_cash = ${collectedCash.toFixed(4)}::numeric,
            damage_reason = ${body.damageReason?.trim() || null},
            closing_notes = ${body.closingNotes?.trim() || null},
            closing_submitted_at = now(),
            closing_submitted_by = ${userId}::uuid,
            updated_at = now()
        WHERE id = ${loadOrderId}::uuid AND tenant_id = ${tenantId}::uuid
      `);

      const recipients = rows(
        await tx.execute(sql`
          SELECT id::text AS membership_id
          FROM memberships
          WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status = 'active'
          LIMIT 10
        `),
      );
      const title = `🚚 طلب اعتماد إغلاق وردية المندوب (${str(loadOrder.salesman_name)}) — ${str(loadOrder.number)}`;
      const msgBody = `المستلم: ${loaded.toFixed(1)} كجم | المباع: ${sold.toFixed(1)} كجم | البونص: ${bonus.toFixed(1)} كجم | تالف للفحص: ${damagedQty.toFixed(1)} كجم | عجز على المندوب: ${shortageQty.toFixed(1)} كجم (${shortageValue.toFixed(2)} ريال). بانتظار اعتماد المحاسب.`;
      for (const r of recipients) {
        await this.notifications.createInTx(tx, {
          tenantId,
          membershipId: str(r.membership_id),
          type: 'van_sales_closing_request',
          payload: { title, body: msgBody, href: '/van-sales?tab=loads' },
        });
      }
    });

    return this.dashboard(tenantId);
  }

  /**
   * Pillar 2 (Stage 2 — Phase 2, 3, 4) & Pillar 7: Accountant inspects damaged goods,
   * enforces idempotency and segregation of duties, records official inventory movements,
   * and zeroes out rep custody (`0.00 kg`).
   */
  async approveClosing(
    tenantId: string,
    userId: string,
    loadOrderId: string,
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
    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const policy = await this.loadTenantPolicyInTx(tx, tenantId);
      const loadOrder = first(
        await tx.execute(sql`
          SELECT l.*, COALESCE(s.name, 'مندوب') AS salesman_name
          FROM van_load_orders l
          LEFT JOIN salesmen s ON s.id = l.salesman_id
          WHERE l.id = ${loadOrderId}::uuid AND l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
          FOR UPDATE OF l
        `),
      );
      if (!loadOrder) {
        throw new DomainError(errorCodes.NOT_FOUND, 'أمر التحميل غير موجود', 404);
      }

      // Phase 3 Idempotency Guard: never allow settling an already settled load order
      if (str(loadOrder.status) === 'settled') {
        throw new DomainError(
          'VAN_LOAD_ORDER_ALREADY_SETTLED',
          'تم اعتماد وتصفية أمر التحميل هذا مسبقاً ولا يمكن إعادة ترحيله',
          409,
        );
      }

      // Phase 4 Segregation of Duties Guard: prevent non-owner self-approval or when policy enforces strict separation
      if (
        loadOrder.closing_submitted_by &&
        str(loadOrder.closing_submitted_by) === userId &&
        !body.selfApprovalOverride
      ) {
        const membershipRow = first(
          await tx.execute(sql`
            SELECT is_owner FROM memberships
            WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL
            LIMIT 1
          `),
        );
        const isOwner = Boolean(membershipRow?.is_owner);
        if (policy.preventSelfApproval || !isOwner) {
          throw new DomainError(
            'SELF_APPROVAL_FORBIDDEN',
            'منع الاعتماد الذاتي: لا يجوز لنفس مدخل طلب إغلاق العهدة اعتماد تسويته مالياً؛ يجب اعتماده من المحاسب أو مدير المستودع.',
            403,
          );
        }
      }

      const loaded = dec(loadOrder.loaded_qty);
      const sold = dec(loadOrder.sold_qty);
      const bonus = dec(loadOrder.bonus_qty);
      const returnedQty =
        body.returnedQty !== undefined
          ? Decimal.max(0, dec(body.returnedQty))
          : dec(loadOrder.returned_qty);
      const damagedQty =
        body.damagedQty !== undefined
          ? Decimal.max(0, dec(body.damagedQty))
          : dec(loadOrder.damaged_qty);
      const collectedCash =
        body.collectedCash !== undefined
          ? Decimal.max(0, dec(body.collectedCash))
          : dec(loadOrder.collected_cash);

      // Phase 4: Never assume damage is inspected without explicit confirmation when damagedQty > 0
      if (damagedQty.gt(0) && body.damageInspected !== true) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          'لا يمكن اعتماد إغلاق الوردية بوجود كميات تالفة دون تأكيد الفحص الفعلي للتالف (damageInspected: true) من المحاسب أو أمين المستودع',
          422,
          { field: 'damageInspected' },
        );
      }

      const accountedQty = sold.plus(bonus).plus(returnedQty).plus(damagedQty);
      if (accountedQty.gt(loaded)) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          `مجموع الكميات (${accountedQty.toFixed(2)} كجم) يتجاوز الكمية المحمّلة (${loaded.toFixed(2)} كجم).`,
          422,
        );
      }

      const shortageQty = Decimal.max(0, loaded.minus(accountedQty));
      const unitChargePrice = await this.resolveShortageUnitPriceInTx(
        tx,
        tenantId,
        loadOrder,
        policy,
      );
      const shortageValue = shortageQty.mul(unitChargePrice);
      const damageInspected = damagedQty.gt(0) ? body.damageInspected === true : false;
      // Phase 4: Never assume salary deduction is approved unless explicitly passed as true
      const salaryDeductionApproved =
        shortageQty.gt(0) ? body.salaryDeductionApproved === true : false;
      const shortagePolicyStatus =
        policy.shortageValuationBasis && policy.shortageValuationBasis !== 'unconfigured'
          ? 'policy_configured'
          : 'pending_policy_approval';

      const warehouseId = loadOrder.warehouse_id ? str(loadOrder.warehouse_id) : null;
      const vanWarehouseId = loadOrder.van_warehouse_id ? str(loadOrder.van_warehouse_id) : null;
      const itemId = loadOrder.item_id ? str(loadOrder.item_id) : null;
      const batchUnitCost = dec(loadOrder.unit_cost).gt(0)
        ? dec(loadOrder.unit_cost)
        : new Decimal('0');

      let returnInventoryTxId: string | null = null;
      let damageInventoryTxId: string | null = null;

      // Official inventory movements for returned good stock & inspected damaged stock
      if (returnedQty.gt(0) && warehouseId && itemId) {
        if (vanWarehouseId && vanWarehouseId !== warehouseId) {
          const retMoves = await this.inventory.recordInTx(
            tx,
            tenantId,
            [
              {
                itemId,
                warehouseId: vanWarehouseId,
                qty: returnedQty.toFixed(4),
                unitCost: batchUnitCost.toFixed(4),
                direction: 'out',
                docType: 'van_return',
                docId: loadOrderId,
                lineId: newId(),
              },
              {
                itemId,
                warehouseId,
                qty: returnedQty.toFixed(4),
                unitCost: batchUnitCost.toFixed(4),
                direction: 'in',
                docType: 'van_return',
                docId: loadOrderId,
                lineId: newId(),
              },
            ],
            { allowNegative: true },
          );
          returnInventoryTxId = retMoves.transactionIds[1] ?? retMoves.transactionIds[0] ?? null;
        } else {
          const retMoves = await this.inventory.recordInTx(tx, tenantId, [
            {
              itemId,
              warehouseId,
              qty: returnedQty.toFixed(4),
              unitCost: batchUnitCost.toFixed(4),
              direction: 'in',
              docType: 'van_return',
              docId: loadOrderId,
              lineId: newId(),
            },
          ]);
          returnInventoryTxId = retMoves.transactionIds[0] ?? null;
        }
      }

      if (damagedQty.gt(0) && vanWarehouseId && itemId) {
        const dmgMoves = await this.inventory.recordInTx(
          tx,
          tenantId,
          [
            {
              itemId,
              warehouseId: vanWarehouseId,
              qty: damagedQty.toFixed(4),
              unitCost: batchUnitCost.toFixed(4),
              direction: 'out',
              docType: 'van_damage_writeoff',
              docId: loadOrderId,
              lineId: newId(),
            },
          ],
          { allowNegative: true },
        );
        damageInventoryTxId = dmgMoves.transactionIds[0] ?? null;
      }

      await tx.execute(sql`
        UPDATE van_load_orders
        SET status = 'settled',
            returned_qty = ${returnedQty.toFixed(4)}::numeric,
            damaged_qty = ${damagedQty.toFixed(4)}::numeric,
            shortage_qty = ${shortageQty.toFixed(4)}::numeric,
            shortage_value = ${shortageValue.toFixed(4)}::numeric,
            shortage_policy_status = ${shortagePolicyStatus},
            collected_cash = ${collectedCash.toFixed(4)}::numeric,
            damage_inspected = ${damageInspected},
            damage_inspected_by = ${damageInspected ? userId : null}::uuid,
            salary_deduction_approved = ${salaryDeductionApproved},
            approved_at = now(),
            approved_by = ${userId}::uuid,
            settled_at = now(),
            notes = COALESCE(${body.notes?.trim() || null}, notes),
            updated_at = now()
        WHERE id = ${loadOrderId}::uuid AND tenant_id = ${tenantId}::uuid
      `);

      await tx.execute(sql`
        UPDATE factory_production_batches
        SET returned_good_qty = returned_good_qty + ${returnedQty.toFixed(4)}::numeric,
            damaged_qty = damaged_qty + ${damagedQty.toFixed(4)}::numeric,
            updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid
          AND batch_no = ${str(loadOrder.production_batch_no)}
          AND deleted_at IS NULL
      `);

      if (returnedQty.gt(0)) {
        await tx.execute(sql`
          INSERT INTO van_stock_movements (
            id, tenant_id, movement_type, batch_no, load_order_id, salesman_id, item_id,
            inventory_transaction_id, qty, unit_price, amount, reason, idempotency_key,
            actor_user_id, approved_by_user_id
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, 'van_return', ${str(loadOrder.production_batch_no)},
            ${loadOrderId}::uuid, ${str(loadOrder.salesman_id)}::uuid, ${itemId}::uuid,
            ${returnInventoryTxId}::uuid,
            ${returnedQty.toFixed(4)}::numeric, 0, 0,
            ${`إرجاع بضاعة سليمة للمستودع الرئيسي عند إغلاق الوردية ${str(loadOrder.number)}`},
            ${`closing-return:${loadOrderId}`},
            ${userId}::uuid, ${userId}::uuid
          )
        `);
      }
      if (damagedQty.gt(0)) {
        const batchRow = first(
          await tx.execute(sql`
            SELECT unit_cost::text FROM factory_production_batches
            WHERE tenant_id = ${tenantId}::uuid
              AND batch_no = ${str(loadOrder.production_batch_no)}
              AND deleted_at IS NULL
            LIMIT 1
          `),
        );
        const damageUnitCost = batchRow ? dec(batchRow.unit_cost) : batchUnitCost;
        await tx.execute(sql`
          INSERT INTO van_stock_movements (
            id, tenant_id, movement_type, batch_no, load_order_id, salesman_id, item_id,
            inventory_transaction_id, qty, unit_price, amount, reason, idempotency_key,
            actor_user_id, approved_by_user_id
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, 'van_damage', ${str(loadOrder.production_batch_no)},
            ${loadOrderId}::uuid, ${str(loadOrder.salesman_id)}::uuid, ${itemId}::uuid,
            ${damageInventoryTxId}::uuid,
            ${damagedQty.toFixed(4)}::numeric,
            ${damageUnitCost.toFixed(4)}::numeric,
            ${damagedQty.mul(damageUnitCost).toFixed(4)}::numeric,
            ${`بضاعة تالفة تم فحصها فعلياً واعتمادها (${str(loadOrder.damage_reason) || 'تلف نقل'}) — ${str(loadOrder.number)}`},
            ${`closing-damage:${loadOrderId}`},
            ${userId}::uuid, ${userId}::uuid
          )
        `);
      }
      if (shortageQty.gt(0)) {
        await tx.execute(sql`
          INSERT INTO van_stock_movements (
            id, tenant_id, movement_type, batch_no, load_order_id, salesman_id, item_id,
            qty, unit_price, amount, reason, idempotency_key, actor_user_id, approved_by_user_id
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, 'van_shortage', ${str(loadOrder.production_batch_no)},
            ${loadOrderId}::uuid, ${str(loadOrder.salesman_id)}::uuid, ${itemId}::uuid,
            ${shortageQty.toFixed(4)}::numeric,
            ${unitChargePrice.toFixed(4)}::numeric,
            ${shortageValue.toFixed(4)}::numeric,
            ${`عجز عهدة محسوب على المندوب (${shortageQty.toFixed(2)} كجم = ${shortageValue.toFixed(2)} ريال) — ${str(loadOrder.number)}`},
            ${`closing-shortage:${loadOrderId}`},
            ${userId}::uuid, ${userId}::uuid
          )
        `);
      }

      const recipients = rows(
        await tx.execute(sql`
          SELECT id::text AS membership_id
          FROM memberships
          WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status = 'active'
          LIMIT 10
        `),
      );
      const title = `✅ تم اعتماد إغلاق وردية المندوب (${str(loadOrder.salesman_name)}) وتصفير العهدة`;
      const msgBody = `أمر التحميل ${str(loadOrder.number)}: رصيد العهدة الآن 0.00 كجم.${shortageQty.gt(0) ? ` تم قيد عجز ${shortageQty.toFixed(1)} كجم (${shortageValue.toFixed(2)} ريال).` : ''}`;
      for (const r of recipients) {
        await this.notifications.createInTx(tx, {
          tenantId,
          membershipId: str(r.membership_id),
          type: 'van_sales_closing_approved',
          payload: { title, body: msgBody, href: '/van-sales?tab=loads' },
        });
      }
    });

    return this.dashboard(tenantId);
  }

  /**
   * Direct settlement endpoint — delegates to `approveClosing` without silently assuming
   * damage inspection if damagedQty > 0 unless caller explicitly confirms `damageInspected`.
   */
  async settleLoadOrder(
    tenantId: string,
    id: string,
    body: {
      returnedQty?: string;
      damagedQty?: string;
      collectedCash?: string;
      damageInspected?: boolean;
      salaryDeductionApproved?: boolean;
      notes?: string;
    },
    userId?: string,
  ) {
    const damaged = dec(body.damagedQty ?? '0');
    return this.approveClosing(tenantId, userId ?? newId(), id, {
      returnedQty: body.returnedQty,
      damagedQty: body.damagedQty,
      collectedCash: body.collectedCash,
      damageInspected: damaged.gt(0) ? body.damageInspected : true,
      salaryDeductionApproved: body.salaryDeductionApproved,
      notes: body.notes,
    });
  }

  /**
   * Pillar 5 (Phase 2 & 3): Record Customer Collection Receipt (`سند تحصيل مديونية من عميل`),
   * enforcing idempotency, balance bounds, and linking to official `sales_invoices` payments & `TreasuryService` vouchers.
   */
  async collectCustomerDebt(
    tenantId: string,
    userId: string,
    body: {
      documentId?: string;
      collectedAmount?: string;
      cashLocationId?: string;
      offsetAccountId?: string;
      notes?: string;
      idempotencyKey?: string;
    },
  ) {
    const documentId = str(body.documentId).trim();
    const collectedAmount = dec(body.collectedAmount);
    if (!documentId || collectedAmount.lte(0)) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'حدد الفاتورة الآجلة ومبلغ التحصيل', 422);
    }

    const idempotencyKey = body.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = await withTenantTx(this.database.db, tenantId, async (tx) =>
        first(
          await tx.execute(sql`
            SELECT id::text FROM van_stock_movements
            WHERE tenant_id = ${tenantId}::uuid
              AND idempotency_key = ${idempotencyKey}
              AND movement_type = 'collection_receipt'
            LIMIT 1
          `),
        ),
      );
      if (existing) {
        return this.dashboard(tenantId);
      }
    }

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const doc = first(
        await tx.execute(sql`
          SELECT * FROM van_sales_documents
          WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          FOR UPDATE
        `),
      );
      if (!doc) throw new DomainError(errorCodes.NOT_FOUND, 'الفاتورة غير موجودة', 404);

      const docTotal = dec(doc.total);
      const currentPaid = dec(doc.paid_amount);
      const remainingDebt = Decimal.max(0, docTotal.minus(currentPaid));

      if (remainingDebt.lte(0)) {
        throw new DomainError(
          'INVOICE_ALREADY_PAID',
          'هذه الفاتورة مسددة بالكامل مسبقاً ولا يمكن تسجيل تحصيل إضافي عليها',
          409,
        );
      }
      if (collectedAmount.gt(remainingDebt)) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          `مبلغ التحصيل (${collectedAmount.toFixed(2)} ريال) يتجاوز الرصيد المتبقي على الفاتورة (${remainingDebt.toFixed(2)} ريال)`,
          422,
          { field: 'collectedAmount' },
        );
      }

      const nextPaid = currentPaid.plus(collectedAmount);
      let linkedVoucherId: string | null = null;

      // Link to official TreasuryService voucher if cashLocationId and offsetAccountId are provided
      if (body.cashLocationId?.trim() && body.offsetAccountId?.trim() && doc.branch_id) {
        const salesmanRow = doc.salesman_id
          ? first(
              await tx.execute(sql`
                SELECT employee_id::text FROM salesmen
                WHERE id = ${str(doc.salesman_id)}::uuid AND tenant_id = ${tenantId}::uuid
                LIMIT 1
              `),
            )
          : undefined;
        const employeeSalesmanId = salesmanRow?.employee_id
          ? str(salesmanRow.employee_id)
          : undefined;

        const createdVoucher = await this.treasury.createVoucherInTx(tx, tenantId, {
          branchId: str(doc.branch_id),
          kind: 'receipt',
          subtype: doc.party_id ? 'customer' : 'account',
          date: new Date().toISOString().slice(0, 10),
          method: 'cash',
          cashLocationId: body.cashLocationId.trim(),
          partyId: doc.party_id ? str(doc.party_id) : undefined,
          salesmanId: employeeSalesmanId,
          counterAccountId: body.offsetAccountId.trim(),
          amount: collectedAmount.toFixed(4),
          description: `سند قبض وتحصيل مديونية للفاتورة ${str(doc.number)}`,
        });
        if (createdVoucher?.id) {
          linkedVoucherId = createdVoucher.id;
        }
      }

      // Sync official `sales_invoices` and `invoice_payments` if linked
      if (doc.sales_invoice_id) {
        const salesInvoiceId = str(doc.sales_invoice_id);
        await tx.execute(sql`
          INSERT INTO invoice_payments (
            id, tenant_id, invoice_type, invoice_id, method, amount, reference
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, 'sales', ${salesInvoiceId}::uuid,
            'cash', ${collectedAmount.toFixed(4)}::numeric, ${`تحصيل فاتورة توزيع ${str(doc.number)}`}
          )
        `);
        const paymentStatus = nextPaid.gte(docTotal) ? 'paid' : 'partial';
        await tx.execute(sql`
          UPDATE sales_invoices
          SET paid_total = ${nextPaid.toFixed(4)}::numeric,
              payment_status = ${paymentStatus},
              updated_at = now()
          WHERE id = ${salesInvoiceId}::uuid AND tenant_id = ${tenantId}::uuid
        `);
      }

      await tx.execute(sql`
        UPDATE van_sales_documents
        SET paid_amount = ${nextPaid.toFixed(4)}::numeric,
            receipt_voucher_id = COALESCE(${linkedVoucherId}::uuid, receipt_voucher_id)
        WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid
      `);

      await tx.execute(sql`
        INSERT INTO van_stock_movements (
          id, tenant_id, movement_type, batch_no, load_order_id, salesman_id, party_id,
          voucher_id, qty, unit_price, amount, reason, idempotency_key, actor_user_id
        ) VALUES (
          ${newId()}::uuid, ${tenantId}::uuid, 'collection_receipt', ${str(doc.production_batch_no)},
          ${doc.load_order_id ? str(doc.load_order_id) : null}::uuid,
          ${doc.salesman_id ? str(doc.salesman_id) : null}::uuid,
          ${doc.party_id ? str(doc.party_id) : null}::uuid,
          ${linkedVoucherId}::uuid,
          0, 0, ${collectedAmount.toFixed(4)}::numeric,
          ${`سند قبض وتحصيل مديونية للفاتورة ${str(doc.number)} ${body.notes ? `— ${body.notes.trim()}` : ''}`},
          ${idempotencyKey},
          ${userId}::uuid
        )
      `);
    });

    return this.dashboard(tenantId);
  }

  /**
   * Phase 6: Resumable Dry-Run & Safe Backfill Tool for Legacy Van Sales Data (`أداة فحص ومطابقة البيانات القديمة`).
   * - Defaults strictly to `mode: 'dry_run'` (zero writes).
   * - Never classifies or deletes records by name, date, or missing audit logs.
   * - Previews counts, differences, conflicts, and resumable backfill plan.
   */
  async reconcileLegacyData(
    tenantId: string,
    userId: string,
    options: {
      mode?: 'dry_run' | 'execute';
      resumeFromId?: string;
      batchLimit?: number;
    } = {},
  ) {
    const mode = options.mode === 'execute' ? 'execute' : 'dry_run';
    const batchLimit = Math.max(1, Math.min(200, Number(options.batchLimit ?? 50)));
    const resumeFromId = options.resumeFromId?.trim() || null;

    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const batchCounts = first(
        await tx.execute(sql`
          SELECT
            COUNT(*)::int AS total_batches,
            COUNT(*) FILTER (
              WHERE inventory_transaction_id IS NOT NULL
                 OR production_order_id IS NOT NULL
                 OR manufacturing_order_id IS NOT NULL
            )::int AS linked_batches,
            COUNT(*) FILTER (
              WHERE inventory_transaction_id IS NULL
                AND production_order_id IS NULL
                AND manufacturing_order_id IS NULL
            )::int AS unlinked_batches
          FROM factory_production_batches
          WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        `),
      );

      const loadCounts = first(
        await tx.execute(sql`
          SELECT
            COUNT(*)::int AS total_loads,
            COUNT(*) FILTER (WHERE stock_transfer_id IS NOT NULL)::int AS linked_loads,
            COUNT(*) FILTER (WHERE stock_transfer_id IS NULL)::int AS unlinked_loads,
            COUNT(*) FILTER (WHERE shortage_qty > 0 AND shortage_policy_status = 'pending_policy_approval')::int AS pending_shortage_policy
          FROM van_load_orders
          WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        `),
      );

      const docCounts = first(
        await tx.execute(sql`
          SELECT
            COUNT(*)::int AS total_docs,
            COUNT(*) FILTER (WHERE sales_invoice_id IS NOT NULL)::int AS linked_docs,
            COUNT(*) FILTER (WHERE sales_invoice_id IS NULL)::int AS unlinked_docs,
            COUNT(*) FILTER (WHERE invoice_mode = 'internal_delivery')::int AS internal_delivery_docs
          FROM van_sales_documents
          WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        `),
      );

      const priceWithoutHistoryRows = rows(
        await tx.execute(sql`
          SELECT cp.*
          FROM van_sales_customer_prices cp
          WHERE cp.tenant_id = ${tenantId}::uuid
            AND cp.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM van_sales_customer_price_history h
              WHERE h.tenant_id = cp.tenant_id AND h.customer_price_id = cp.id
            )
          ORDER BY cp.id ASC
          LIMIT ${batchLimit}
        `),
      );

      const unlinkedDocsRows = rows(
        await tx.execute(sql`
          SELECT d.*
          FROM van_sales_documents d
          WHERE d.tenant_id = ${tenantId}::uuid
            AND d.deleted_at IS NULL
            AND d.sales_invoice_id IS NULL
            AND (${resumeFromId}::uuid IS NULL OR d.id > ${resumeFromId}::uuid)
          ORDER BY d.id ASC
          LIMIT ${batchLimit}
        `),
      );

      const duplicateDocNumbers = rows(
        await tx.execute(sql`
          SELECT number, COUNT(*)::int AS cnt
          FROM van_sales_documents
          WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
          GROUP BY number
          HAVING COUNT(*) > 1
        `),
      );

      const resolvedBranchId = await this.resolveDefaultBranchIdInTx(tx, tenantId);
      const conflicts: Array<{ entityType: string; entityId: string; code: string; detail: string }> =
        [];
      const plan: Array<{
        entityType: string;
        entityId: string;
        number: string;
        action: string;
        canBackfillSafely: boolean;
        blockingReason: string | null;
      }> = [];

      for (const dup of duplicateDocNumbers) {
        conflicts.push({
          entityType: 'van_sales_documents',
          entityId: str(dup.number),
          code: 'DUPLICATE_DOCUMENT_NUMBER',
          detail: `رقم الفاتورة (${str(dup.number)}) مكرر ${Number(dup.cnt)} مرات ويحتاج مراجعة يدوية دون إعادة ترقيم تلقائي.`,
        });
      }

      const succeeded: Array<{ entityType: string; entityId: string; linkedId: string }> = [];
      const failed: Array<{ entityType: string; entityId: string; reason: string }> = [];
      let nextResumeCursor: string | null = null;

      for (const cp of priceWithoutHistoryRows) {
        const cpId = str(cp.id);
        plan.push({
          entityType: 'van_sales_customer_prices',
          entityId: cpId,
          number: str(cp.price_tier_label),
          action: 'backfill_price_audit_history',
          canBackfillSafely: true,
          blockingReason: null,
        });
        if (mode === 'execute') {
          const histId = newId();
          await tx.execute(sql`
            INSERT INTO van_sales_customer_price_history (
              id, tenant_id, customer_price_id, party_id, item_id,
              previous_unit_price, new_unit_price,
              max_bonus_pct, max_bonus_kg_per_invoice, max_discount_pct, lock_price,
              effective_from, effective_to, change_reason, changed_by
            ) VALUES (
              ${histId}::uuid, ${tenantId}::uuid, ${cpId}::uuid, ${str(cp.party_id)}::uuid,
              ${cp.item_id ? str(cp.item_id) : null}::uuid,
              NULL, ${dec(cp.unit_price).toFixed(4)}::numeric,
              ${dec(cp.max_bonus_pct).toFixed(2)}::numeric,
              ${dec(cp.max_bonus_kg_per_invoice).toFixed(4)}::numeric,
              ${dec(cp.max_discount_pct).toFixed(2)}::numeric,
              ${cp.lock_price !== false},
              COALESCE(${cp.effective_from ? str(cp.effective_from) : null}::date, CURRENT_DATE),
              ${cp.effective_to ? str(cp.effective_to) : null}::date,
              'تأريخ أولي للبيانات السابقة (Backfill)',
              ${userId}::uuid
            )
          `);
          succeeded.push({
            entityType: 'van_sales_customer_prices',
            entityId: cpId,
            linkedId: histId,
          });
        }
      }

      for (const doc of unlinkedDocsRows) {
        const docId = str(doc.id);
        nextResumeCursor = docId;
        const docNumber = str(doc.number);
        const docMode = str(doc.invoice_mode || doc.doc_mode || 'zatca_tax');
        const branchId = doc.branch_id ? str(doc.branch_id) : resolvedBranchId;
        const hasCustomer = Boolean(doc.party_id || (doc.customer_name && str(doc.customer_name).trim()));

        if (docMode === 'internal_delivery') {
          conflicts.push({
            entityType: 'van_sales_documents',
            entityId: docId,
            code: 'INTERNAL_DELIVERY_TAX_POLICY_PENDING',
            detail: `المستند ${docNumber} من نوع internal_delivery؛ متوقف عن الترحيل الرسمي حتى اعتماد السياسة الضريبية.`,
          });
          plan.push({
            entityType: 'van_sales_documents',
            entityId: docId,
            number: docNumber,
            action: 'skip_pending_tax_policy',
            canBackfillSafely: false,
            blockingReason: 'INTERNAL_DELIVERY_TAX_POLICY_PENDING',
          });
          if (mode === 'execute') {
            failed.push({
              entityType: 'van_sales_documents',
              entityId: docId,
              reason: 'INTERNAL_DELIVERY_TAX_POLICY_PENDING',
            });
          }
          continue;
        }

        if (!branchId || !hasCustomer) {
          const reason = !branchId ? 'MISSING_BRANCH_ID' : 'MISSING_CUSTOMER';
          conflicts.push({
            entityType: 'van_sales_documents',
            entityId: docId,
            code: reason,
            detail: `المستند ${docNumber} يفتقد الفرع أو العميل اللازم لربطه بجدول sales_invoices.`,
          });
          plan.push({
            entityType: 'van_sales_documents',
            entityId: docId,
            number: docNumber,
            action: 'skip_missing_master_ref',
            canBackfillSafely: false,
            blockingReason: reason,
          });
          if (mode === 'execute') {
            failed.push({ entityType: 'van_sales_documents', entityId: docId, reason });
          }
          continue;
        }

        plan.push({
          entityType: 'van_sales_documents',
          entityId: docId,
          number: docNumber,
          action: 'create_linked_draft_sales_invoice',
          canBackfillSafely: true,
          blockingReason: null,
        });

        if (mode === 'execute') {
          const soldQty = dec(doc.sold_qty);
          const bonusQty = dec(doc.bonus_qty);
          const lines: SalesLineInput[] = [];
          if (soldQty.gt(0)) {
            lines.push({
              itemId: doc.item_id ? str(doc.item_id) : undefined,
              description: `فاتورة توزيع مرحلة (${docNumber})`,
              quantity: soldQty.toFixed(4),
              unitPrice: dec(doc.unit_price).toFixed(4),
              discountAmount: dec(doc.discount_amount).toFixed(4),
              taxRate: dec(doc.tax_rate).toFixed(4),
              batchNo: str(doc.production_batch_no),
              metadata: {
                isBonus: false,
                legacyBackfill: true,
                vanDocumentId: docId,
                vanDocumentNumber: docNumber,
              },
            });
          }
          if (bonusQty.gt(0)) {
            lines.push({
              itemId: doc.item_id ? str(doc.item_id) : undefined,
              description: `بونص مجاني (${docNumber})`,
              quantity: bonusQty.toFixed(4),
              unitPrice: '0.0000',
              discountAmount: '0.0000',
              taxRate: '0.0000',
              batchNo: str(doc.production_batch_no),
              metadata: {
                isBonus: true,
                legacyBackfill: true,
                bonusReason: str(doc.bonus_reason) || 'ترويجي',
                vanDocumentId: docId,
                vanDocumentNumber: docNumber,
              },
            });
          }
          const createdInvoiceId = await this.sales.createInTx(tx, tenantId, {
            branchId,
            partyId: doc.party_id ? str(doc.party_id) : undefined,
            salesmanId: doc.salesman_id ? str(doc.salesman_id) : undefined,
            cashCustomerName: !doc.party_id
              ? str(doc.customer_name) || 'عميل توزيع'
              : undefined,
            kind: 'sale',
            lines,
          });
          await tx.execute(sql`
            UPDATE van_sales_documents
            SET branch_id = COALESCE(branch_id, ${branchId}::uuid),
                sales_invoice_id = ${createdInvoiceId}::uuid
            WHERE id = ${docId}::uuid AND tenant_id = ${tenantId}::uuid
          `);
          succeeded.push({
            entityType: 'van_sales_documents',
            entityId: docId,
            linkedId: createdInvoiceId,
          });
        }
      }

      return {
        mode,
        executedAt: new Date().toISOString(),
        counts: {
          totalProductionBatches: Number(batchCounts?.total_batches ?? 0),
          linkedProductionBatches: Number(batchCounts?.linked_batches ?? 0),
          unlinkedProductionBatches: Number(batchCounts?.unlinked_batches ?? 0),
          totalLoadOrders: Number(loadCounts?.total_loads ?? 0),
          linkedLoadOrders: Number(loadCounts?.linked_loads ?? 0),
          unlinkedLoadOrders: Number(loadCounts?.unlinked_loads ?? 0),
          pendingShortagePolicyOrders: Number(loadCounts?.pending_shortage_policy ?? 0),
          totalDocuments: Number(docCounts?.total_docs ?? 0),
          linkedDocuments: Number(docCounts?.linked_docs ?? 0),
          unlinkedDocuments: Number(docCounts?.unlinked_docs ?? 0),
          internalDeliveryDocuments: Number(docCounts?.internal_delivery_docs ?? 0),
          customerPricesWithoutHistory: priceWithoutHistoryRows.length,
        },
        conflicts,
        plan,
        execution: {
          succeededCount: succeeded.length,
          failedCount: failed.length,
          succeeded,
          failed,
          nextResumeCursor,
        },
      };
    });
  }
}

