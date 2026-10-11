import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { sql } from 'drizzle-orm';
import { DomainError, errorCodes, newId } from '@erp/contracts';
import { withTenantTx, type DatabaseHandle } from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';

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

@Injectable()
export class VanSalesService {
  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle) {}

  async dashboard(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const loadOrders = rows(await tx.execute(sql`
        SELECT l.id::text, l.number, l.load_date::text, l.production_batch_no,
               l.vehicle_plate, l.status,
               l.loaded_qty::text, l.sold_qty::text, l.bonus_qty::text,
               l.returned_qty::text, l.max_bonus_qty::text, l.max_bonus_pct::text,
               l.expected_cash::text, l.collected_cash::text, l.notes,
               l.salesman_id::text, COALESCE(s.name, 'مندوب توزيع') AS salesman_name,
               l.item_id::text, COALESCE(i.name_ar, 'رقائق سمبوسة وفطائر') AS item_name
        FROM van_load_orders l
        LEFT JOIN salesmen s ON s.id = l.salesman_id
        LEFT JOIN items i ON i.id = l.item_id
        WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
        ORDER BY l.created_at DESC
        LIMIT 50
      `));

      const customerPrices = rows(await tx.execute(sql`
        SELECT cp.id::text, cp.party_id::text, p.name AS party_name, p.code AS party_code, p.tax_no AS party_tax_no,
               cp.item_id::text, COALESCE(i.name_ar, 'جميع أصناف المخبز') AS item_name,
               cp.price_tier_label, cp.unit_price::text, cp.max_bonus_pct::text,
               cp.max_bonus_kg_per_invoice::text, cp.preferred_invoice_mode, cp.notes
        FROM van_sales_customer_prices cp
        JOIN parties p ON p.id = cp.party_id
        LEFT JOIN items i ON i.id = cp.item_id
        WHERE cp.tenant_id = ${tenantId}::uuid AND cp.deleted_at IS NULL
        ORDER BY p.name ASC
      `));

      const documents = rows(await tx.execute(sql`
        SELECT d.id::text, d.number, d.doc_date::text, d.invoice_mode, d.payment_method,
               d.production_batch_no, d.sold_qty::text, d.bonus_qty::text,
               d.unit_price::text, d.subtotal::text, d.tax_rate::text,
               d.tax_total::text, d.total::text, d.paid_amount::text,
               d.customer_bonus_confirmed, d.customer_confirmation_code,
               d.bonus_anomaly, d.anomaly_reason, d.notes, d.created_at,
               d.load_order_id::text,
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
        LIMIT 100
      `));

      // Anti-fraud summary metrics
      let totalLoadedKg = new Decimal(0);
      let totalSoldKg = new Decimal(0);
      let totalBonusKg = new Decimal(0);
      let totalReturnedKg = new Decimal(0);
      let totalZatcaSalesSar = new Decimal(0);
      let totalInternalSalesSar = new Decimal(0);
      let anomalyCount = 0;

      for (const l of loadOrders) {
        totalLoadedKg = totalLoadedKg.plus(dec(l.loaded_qty));
        totalSoldKg = totalSoldKg.plus(dec(l.sold_qty));
        totalBonusKg = totalBonusKg.plus(dec(l.bonus_qty));
        totalReturnedKg = totalReturnedKg.plus(dec(l.returned_qty));
      }
      for (const d of documents) {
        if (str(d.invoice_mode) === 'zatca_tax') {
          totalZatcaSalesSar = totalZatcaSalesSar.plus(dec(d.total));
        } else {
          totalInternalSalesSar = totalInternalSalesSar.plus(dec(d.total));
        }
        if (d.bonus_anomaly === true) anomalyCount += 1;
      }

      return {
        summary: {
          totalLoadedKg: totalLoadedKg.toFixed(2),
          totalSoldKg: totalSoldKg.toFixed(2),
          totalBonusKg: totalBonusKg.toFixed(2),
          totalReturnedKg: totalReturnedKg.toFixed(2),
          remainingInVansKg: totalLoadedKg
            .minus(totalSoldKg)
            .minus(totalBonusKg)
            .minus(totalReturnedKg)
            .toFixed(2),
          totalZatcaSalesSar: totalZatcaSalesSar.toFixed(2),
          totalInternalSalesSar: totalInternalSalesSar.toFixed(2),
          totalRevenueSar: totalZatcaSalesSar.plus(totalInternalSalesSar).toFixed(2),
          anomalyCount,
        },
        loadOrders: loadOrders.map((row) => {
          const loaded = dec(row.loaded_qty);
          const sold = dec(row.sold_qty);
          const bonus = dec(row.bonus_qty);
          const returned = dec(row.returned_qty);
          const remaining = loaded.minus(sold).minus(bonus).minus(returned);
          return {
            id: str(row.id),
            number: str(row.number),
            loadDate: str(row.load_date),
            productionBatchNo: str(row.production_batch_no),
            vehiclePlate: str(row.vehicle_plate),
            status: str(row.status),
            salesmanId: str(row.salesman_id),
            salesmanName: str(row.salesman_name),
            itemId: row.item_id ? str(row.item_id) : null,
            itemName: str(row.item_name),
            loadedQty: loaded.toFixed(2),
            soldQty: sold.toFixed(2),
            bonusQty: bonus.toFixed(2),
            returnedQty: returned.toFixed(2),
            remainingQty: remaining.toFixed(2),
            maxBonusQty: dec(row.max_bonus_qty).toFixed(2),
            maxBonusPct: dec(row.max_bonus_pct).toFixed(2),
            expectedCash: dec(row.expected_cash).toFixed(2),
            collectedCash: dec(row.collected_cash).toFixed(2),
            cashVariance: dec(row.collected_cash).minus(dec(row.expected_cash)).toFixed(2),
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
          preferredInvoiceMode: str(row.preferred_invoice_mode) as 'zatca_tax' | 'internal_delivery',
          notes: str(row.notes),
        })),
        documents: documents.map((row) => ({
          id: str(row.id),
          number: str(row.number),
          docDate: str(row.doc_date),
          invoiceMode: str(row.invoice_mode) as 'zatca_tax' | 'internal_delivery',
          paymentMethod: str(row.payment_method),
          productionBatchNo: str(row.production_batch_no),
          loadOrderId: row.load_order_id ? str(row.load_order_id) : null,
          salesmanId: row.salesman_id ? str(row.salesman_id) : null,
          salesmanName: str(row.salesman_name),
          partyId: row.party_id ? str(row.party_id) : null,
          customerName: str(row.customer_name),
          customerTaxNo: str(row.customer_tax_no),
          itemId: row.item_id ? str(row.item_id) : null,
          itemName: str(row.item_name),
          soldQty: dec(row.sold_qty).toFixed(2),
          bonusQty: dec(row.bonus_qty).toFixed(2),
          unitPrice: dec(row.unit_price).toFixed(2),
          subtotal: dec(row.subtotal).toFixed(2),
          taxRate: dec(row.tax_rate).toFixed(2),
          taxTotal: dec(row.tax_total).toFixed(2),
          total: dec(row.total).toFixed(2),
          paidAmount: dec(row.paid_amount).toFixed(2),
          customerBonusConfirmed: Boolean(row.customer_bonus_confirmed),
          customerConfirmationCode: str(row.customer_confirmation_code),
          bonusAnomaly: Boolean(row.bonus_anomaly),
          anomalyReason: str(row.anomaly_reason),
          notes: str(row.notes),
          createdAt: iso(row.created_at),
        })),
      };
    });
  }

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
      notes?: string;
    },
  ) {
    const partyId = str(body.partyId).trim();
    if (!partyId) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'اختر العميل لتحديد سعره المخصص', 422, {
        field: 'partyId',
      });
    }
    const unitPrice = dec(body.unitPrice);
    if (unitPrice.lte(0)) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'سعر الكيلو للعميل يجب أن يكون أكبر من صفر', 422, {
        field: 'unitPrice',
      });
    }
    const maxBonusPct = dec(body.maxBonusPct ?? '5');
    const maxBonusKg = dec(body.maxBonusKgPerInvoice ?? '2');
    const mode = body.preferredInvoiceMode === 'internal_delivery' ? 'internal_delivery' : 'zatca_tax';
    const label = String(body.priceTierLabel ?? '').trim() || `شريحة ${unitPrice.toFixed(2)} ريال/كجم`;
    const itemId = body.itemId ? String(body.itemId).trim() || null : null;

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const existing = first(await tx.execute(sql`
        SELECT id::text FROM van_sales_customer_prices
        WHERE tenant_id = ${tenantId}::uuid
          AND party_id = ${partyId}::uuid
          AND ((${itemId}::uuid IS NULL AND item_id IS NULL) OR item_id = ${itemId}::uuid)
          AND deleted_at IS NULL
        LIMIT 1
      `));
      if (existing) {
        await tx.execute(sql`
          UPDATE van_sales_customer_prices
          SET price_tier_label = ${label},
              unit_price = ${unitPrice.toFixed(4)}::numeric,
              max_bonus_pct = ${maxBonusPct.toFixed(2)}::numeric,
              max_bonus_kg_per_invoice = ${maxBonusKg.toFixed(4)}::numeric,
              preferred_invoice_mode = ${mode},
              notes = ${body.notes?.trim() || null},
              updated_at = now()
          WHERE id = ${str(existing.id)}::uuid AND tenant_id = ${tenantId}::uuid
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO van_sales_customer_prices (
            id, tenant_id, party_id, item_id, price_tier_label, unit_price,
            max_bonus_pct, max_bonus_kg_per_invoice, preferred_invoice_mode, notes
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, ${partyId}::uuid, ${itemId}::uuid,
            ${label}, ${unitPrice.toFixed(4)}::numeric,
            ${maxBonusPct.toFixed(2)}::numeric, ${maxBonusKg.toFixed(4)}::numeric,
            ${mode}, ${body.notes?.trim() || null}
          )
        `);
      }
    });
    return this.dashboard(tenantId);
  }

  async createLoadOrder(
    tenantId: string,
    userId: string,
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
    const salesmanId = str(body.salesmanId).trim();
    if (!salesmanId) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'اختر المندوب لأمر التحميل', 422, {
        field: 'salesmanId',
      });
    }
    const loadedQty = dec(body.loadedQty);
    if (loadedQty.lte(0)) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'الكمية المحمّلة للمندوب يجب أن تكون أكبر من صفر', 422, {
        field: 'loadedQty',
      });
    }
    const maxBonusQty = dec(body.maxBonusQty ?? '5');
    const maxBonusPct = dec(body.maxBonusPct ?? '5');
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const batchNo =
      String(body.productionBatchNo ?? '').trim() ||
      `BATCH-${datePart}-${Math.floor(100 + Math.random() * 900)}`;

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const countRow = first(await tx.execute(sql`
        SELECT count(*)::int AS cnt FROM van_load_orders WHERE tenant_id = ${tenantId}::uuid
      `));
      const seq = Number(countRow?.cnt ?? 0) + 1;
      const number = `VLO-${String(seq).padStart(4, '0')}`;
      await tx.execute(sql`
        INSERT INTO van_load_orders (
          id, tenant_id, number, salesman_id, branch_id, warehouse_id, item_id,
          vehicle_plate, load_date, production_batch_no, status,
          loaded_qty, sold_qty, bonus_qty, returned_qty,
          max_bonus_qty, max_bonus_pct, notes, created_by
        ) VALUES (
          ${newId()}::uuid, ${tenantId}::uuid, ${number}, ${salesmanId}::uuid,
          ${body.branchId || null}::uuid, ${body.warehouseId || null}::uuid, ${body.itemId || null}::uuid,
          ${body.vehiclePlate?.trim() || null}, CURRENT_DATE, ${batchNo}, 'loaded',
          ${loadedQty.toFixed(4)}::numeric, 0, 0, 0,
          ${maxBonusQty.toFixed(4)}::numeric, ${maxBonusPct.toFixed(2)}::numeric,
          ${body.notes?.trim() || null}, ${userId}::uuid
        )
      `);
    });

    return this.dashboard(tenantId);
  }

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
      unitPrice?: string;
      customerBonusConfirmed?: boolean;
      customerConfirmationCode?: string;
      allowBonusOverride?: boolean;
      notes?: string;
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

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const loadOrder = first(await tx.execute(sql`
        SELECT * FROM van_load_orders
        WHERE id = ${loadOrderId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `));
      if (!loadOrder) {
        throw new DomainError(errorCodes.NOT_FOUND, 'أمر التحميل غير موجود', 404);
      }
      if (str(loadOrder.status) === 'settled') {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'أمر التحميل هذا تم إغلاقه وتصفيته مسبقاً', 422);
      }

      const loaded = dec(loadOrder.loaded_qty);
      const currentSold = dec(loadOrder.sold_qty);
      const currentBonus = dec(loadOrder.bonus_qty);
      const currentReturned = dec(loadOrder.returned_qty);
      const remaining = loaded.minus(currentSold).minus(currentBonus).minus(currentReturned);
      const totalOutThisDoc = soldQty.plus(bonusQty);

      // 1) Anti-outside-sourcing guard: rep cannot sell more than what was loaded from the factory batch!
      if (totalOutThisDoc.gt(remaining)) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          `رفض أمني لمنع خلط بضاعة خارجية: الكمية المطلوبة (${totalOutThisDoc.toFixed(2)} كجم) تتجاوز الرصيد المتبقي في سيارة المندوب من دفعة المخبز رقم ${str(loadOrder.production_batch_no)} (${remaining.toFixed(2)} كجم متبقي).`,
          422,
          { field: 'soldQty' },
        );
      }

      // 2) Customer price tier resolution
      const partyId = body.partyId ? str(body.partyId).trim() || null : null;
      let customerRule: Record<string, unknown> | undefined;
      if (partyId) {
        customerRule = first(await tx.execute(sql`
          SELECT * FROM van_sales_customer_prices
          WHERE tenant_id = ${tenantId}::uuid AND party_id = ${partyId}::uuid AND deleted_at IS NULL
          ORDER BY updated_at DESC LIMIT 1
        `));
      }

      const resolvedUnitPrice = customerRule
        ? dec(customerRule.unit_price)
        : dec(body.unitPrice ?? '6.50');
      if (resolvedUnitPrice.lte(0)) {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'حدد سعر البيع للكيلو', 422, {
          field: 'unitPrice',
        });
      }

      // 3) Bonus / Free quantity anti-fraud check
      const loadMaxBonusRemaining = dec(loadOrder.max_bonus_qty).minus(currentBonus);
      const customerMaxBonusKg = customerRule ? dec(customerRule.max_bonus_kg_per_invoice) : new Decimal('5');
      const customerMaxBonusPct = customerRule ? dec(customerRule.max_bonus_pct) : dec(loadOrder.max_bonus_pct);
      const bonusPctOfSale = soldQty.gt(0) ? bonusQty.div(soldQty).mul('100') : new Decimal('100');

      let bonusAnomaly = false;
      const anomalyReasons: string[] = [];

      if (bonusQty.gt(0)) {
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
            `تنبيه رقابة البونص المجاني: ${anomalyReasons.join(' · ')}. يُرجى إدخال رمز تأكيد استلام العميل للكمية المجانية أو تقليل البونص.`,
            422,
            { field: 'bonusQty' },
          );
        }
      }

      // 4) Dual Invoice Mode: 'zatca_tax' (15% VAT + ZATCA) vs 'internal_delivery' (Non-ZATCA Commercial Receipt)
      const invoiceMode =
        body.invoiceMode ??
        (customerRule ? (str(customerRule.preferred_invoice_mode) as 'zatca_tax' | 'internal_delivery') : 'zatca_tax');
      const subtotal = soldQty.mul(resolvedUnitPrice);
      const taxRate = invoiceMode === 'zatca_tax' ? new Decimal('15') : new Decimal('0');
      const taxTotal = invoiceMode === 'zatca_tax' ? subtotal.mul('0.15') : new Decimal('0');
      const grandTotal = subtotal.plus(taxTotal);
      const paymentMethod = body.paymentMethod ?? 'cash';
      const paidAmount = paymentMethod === 'credit' ? new Decimal('0') : grandTotal;

      const countRow = first(await tx.execute(sql`
        SELECT count(*)::int AS cnt FROM van_sales_documents WHERE tenant_id = ${tenantId}::uuid
      `));
      const seq = Number(countRow?.cnt ?? 0) + 1;
      const prefix = invoiceMode === 'zatca_tax' ? 'VTX' : 'VDL';
      const number = `${prefix}-${String(seq).padStart(5, '0')}`;

      await tx.execute(sql`
        INSERT INTO van_sales_documents (
          id, tenant_id, number, load_order_id, salesman_id, party_id, customer_name,
          item_id, invoice_mode, payment_method, doc_date, production_batch_no,
          sold_qty, bonus_qty, unit_price, subtotal, tax_rate, tax_total, total, paid_amount,
          customer_bonus_confirmed, customer_confirmation_code, bonus_anomaly, anomaly_reason,
          notes, created_by
        ) VALUES (
          ${newId()}::uuid, ${tenantId}::uuid, ${number}, ${loadOrderId}::uuid,
          ${str(loadOrder.salesman_id)}::uuid, ${partyId}::uuid,
          ${body.customerName?.trim() || null},
          ${body.itemId || (loadOrder.item_id ? str(loadOrder.item_id) : null)}::uuid,
          ${invoiceMode}, ${paymentMethod}, CURRENT_DATE, ${str(loadOrder.production_batch_no)},
          ${soldQty.toFixed(4)}::numeric, ${bonusQty.toFixed(4)}::numeric,
          ${resolvedUnitPrice.toFixed(4)}::numeric, ${subtotal.toFixed(4)}::numeric,
          ${taxRate.toFixed(2)}::numeric, ${taxTotal.toFixed(4)}::numeric,
          ${grandTotal.toFixed(4)}::numeric, ${paidAmount.toFixed(4)}::numeric,
          ${Boolean(body.customerBonusConfirmed)},
          ${body.customerConfirmationCode?.trim() || null},
          ${bonusAnomaly},
          ${anomalyReasons.length ? anomalyReasons.join(' | ') : null},
          ${body.notes?.trim() || null},
          ${userId}::uuid
        )
      `);

      // Update load order cumulative sold, bonus, and expected cash
      const nextSold = currentSold.plus(soldQty);
      const nextBonus = currentBonus.plus(bonusQty);
      const nextExpectedCash = dec(loadOrder.expected_cash).plus(paidAmount);

      await tx.execute(sql`
        UPDATE van_load_orders
        SET sold_qty = ${nextSold.toFixed(4)}::numeric,
            bonus_qty = ${nextBonus.toFixed(4)}::numeric,
            expected_cash = ${nextExpectedCash.toFixed(4)}::numeric,
            updated_at = now()
        WHERE id = ${loadOrderId}::uuid AND tenant_id = ${tenantId}::uuid
      `);
    });

    return this.dashboard(tenantId);
  }

  async settleLoadOrder(
    tenantId: string,
    loadOrderId: string,
    body: { returnedQty?: string; collectedCash?: string; notes?: string },
  ) {
    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const loadOrder = first(await tx.execute(sql`
        SELECT * FROM van_load_orders
        WHERE id = ${loadOrderId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `));
      if (!loadOrder) throw new DomainError(errorCodes.NOT_FOUND, 'أمر التحميل غير موجود', 404);
      const returnedQty = dec(body.returnedQty ?? loadOrder.returned_qty);
      const collectedCash = dec(body.collectedCash ?? loadOrder.expected_cash);

      await tx.execute(sql`
        UPDATE van_load_orders
        SET returned_qty = ${returnedQty.toFixed(4)}::numeric,
            collected_cash = ${collectedCash.toFixed(4)}::numeric,
            status = 'settled',
            notes = COALESCE(${body.notes?.trim() || null}, notes),
            updated_at = now()
        WHERE id = ${loadOrderId}::uuid AND tenant_id = ${tenantId}::uuid
      `);
    });
    return this.dashboard(tenantId);
  }
}
