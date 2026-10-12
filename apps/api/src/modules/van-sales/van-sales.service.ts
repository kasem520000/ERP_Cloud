import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { env } from '@erp/config';
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
  private schemaEnsurePromise: Promise<void> | null = null;

  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle) {}

  /**
   * Idempotent schema guard so that even if a local environment started `apps/api`
   * before running `pnpm db:migrate` (or had an earlier table definition), all
   * tables and columns for the 10-pillar Factory & Van Sales system exist.
   */
  private async ensureSchema(): Promise<void> {
    if (this.schemaEnsurePromise) return this.schemaEnsurePromise;
    this.schemaEnsurePromise = (async () => {
      const pool = new Pool({
        connectionString: env.DATABASE_MIGRATOR_URL ?? env.DATABASE_URL,
      });
      const client = await pool.connect().catch(() => null);
      if (!client) return;
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS van_sales_customer_prices (
            id                       uuid PRIMARY KEY,
            tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            party_id                 uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
            item_id                  uuid REFERENCES items(id) ON DELETE CASCADE,
            price_tier_label         text NOT NULL DEFAULT 'شريحة جملة المخابز',
            unit_price               numeric(18, 4) NOT NULL,
            max_bonus_pct            numeric(5, 2) NOT NULL DEFAULT 5.00,
            max_bonus_kg_per_invoice numeric(18, 4) NOT NULL DEFAULT 2.0000,
            preferred_invoice_mode   text NOT NULL DEFAULT 'zatca_tax'
                                     CHECK (preferred_invoice_mode IN ('zatca_tax', 'internal_delivery')),
            credit_limit             numeric(18, 4) NOT NULL DEFAULT 5000,
            payment_terms_days       integer NOT NULL DEFAULT 15,
            lock_price               boolean NOT NULL DEFAULT true,
            max_discount_pct         numeric(5, 2) NOT NULL DEFAULT 0,
            notes                    text,
            created_at               timestamptz NOT NULL DEFAULT now(),
            updated_at               timestamptz NOT NULL DEFAULT now(),
            deleted_at               timestamptz
          );

          CREATE TABLE IF NOT EXISTS van_load_orders (
            id                        uuid PRIMARY KEY,
            tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            number                    text NOT NULL,
            salesman_id               uuid NOT NULL REFERENCES salesmen(id) ON DELETE RESTRICT,
            branch_id                 uuid REFERENCES branches(id) ON DELETE SET NULL,
            warehouse_id              uuid REFERENCES warehouses(id) ON DELETE SET NULL,
            item_id                   uuid REFERENCES items(id) ON DELETE SET NULL,
            vehicle_plate             text,
            load_date                 date NOT NULL DEFAULT CURRENT_DATE,
            production_batch_no       text NOT NULL,
            status                    text NOT NULL DEFAULT 'loaded',
            loaded_qty                numeric(18, 4) NOT NULL DEFAULT 0,
            loaded_total_value        numeric(18, 4) NOT NULL DEFAULT 0,
            sold_qty                  numeric(18, 4) NOT NULL DEFAULT 0,
            bonus_qty                 numeric(18, 4) NOT NULL DEFAULT 0,
            returned_qty              numeric(18, 4) NOT NULL DEFAULT 0,
            damaged_qty               numeric(18, 4) NOT NULL DEFAULT 0,
            shortage_qty              numeric(18, 4) NOT NULL DEFAULT 0,
            shortage_value            numeric(18, 4) NOT NULL DEFAULT 0,
            max_bonus_qty             numeric(18, 4) NOT NULL DEFAULT 0,
            max_bonus_pct             numeric(5, 2) NOT NULL DEFAULT 5.00,
            expected_cash             numeric(18, 4) NOT NULL DEFAULT 0,
            collected_cash            numeric(18, 4) NOT NULL DEFAULT 0,
            damage_reason             text,
            damage_inspected          boolean NOT NULL DEFAULT false,
            damage_inspected_by       uuid REFERENCES users(id) ON DELETE SET NULL,
            salary_deduction_approved boolean NOT NULL DEFAULT false,
            closing_notes             text,
            closing_submitted_at      timestamptz,
            closing_submitted_by      uuid REFERENCES users(id) ON DELETE SET NULL,
            approved_at               timestamptz,
            approved_by               uuid REFERENCES users(id) ON DELETE SET NULL,
            notes                     text,
            created_by                uuid REFERENCES users(id) ON DELETE SET NULL,
            settled_at                timestamptz,
            created_at                timestamptz NOT NULL DEFAULT now(),
            updated_at                timestamptz NOT NULL DEFAULT now(),
            deleted_at                timestamptz
          );

          ALTER TABLE van_load_orders DROP CONSTRAINT IF EXISTS van_load_orders_status_check;
          ALTER TABLE van_load_orders
            ADD COLUMN IF NOT EXISTS number text NOT NULL DEFAULT 'VLO-0001',
            ADD COLUMN IF NOT EXISTS salesman_id uuid REFERENCES salesmen(id) ON DELETE RESTRICT,
            ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES items(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS vehicle_plate text,
            ADD COLUMN IF NOT EXISTS load_date date NOT NULL DEFAULT CURRENT_DATE,
            ADD COLUMN IF NOT EXISTS production_batch_no text NOT NULL DEFAULT 'BATCH-DEFAULT',
            ADD COLUMN IF NOT EXISTS loaded_qty numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS loaded_total_value numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS sold_qty numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS bonus_qty numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS returned_qty numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS damaged_qty numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS shortage_qty numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS shortage_value numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS max_bonus_qty numeric(18, 4) NOT NULL DEFAULT 5,
            ADD COLUMN IF NOT EXISTS max_bonus_pct numeric(5, 2) NOT NULL DEFAULT 5.00,
            ADD COLUMN IF NOT EXISTS expected_cash numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS collected_cash numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS damage_reason text,
            ADD COLUMN IF NOT EXISTS damage_inspected boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS damage_inspected_by uuid REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS salary_deduction_approved boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS closing_notes text,
            ADD COLUMN IF NOT EXISTS closing_submitted_at timestamptz,
            ADD COLUMN IF NOT EXISTS closing_submitted_by uuid REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS approved_at timestamptz,
            ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS notes text,
            ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS settled_at timestamptz,
            ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

          ALTER TABLE van_sales_customer_prices
            ADD COLUMN IF NOT EXISTS credit_limit numeric(18, 4) NOT NULL DEFAULT 5000,
            ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 15,
            ADD COLUMN IF NOT EXISTS lock_price boolean NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS max_discount_pct numeric(5, 2) NOT NULL DEFAULT 0;

          CREATE TABLE IF NOT EXISTS van_sales_documents (
            id                         uuid PRIMARY KEY,
            tenant_id                  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            number                     text NOT NULL,
            load_order_id              uuid NOT NULL REFERENCES van_load_orders(id) ON DELETE CASCADE,
            salesman_id                uuid NOT NULL REFERENCES salesmen(id) ON DELETE RESTRICT,
            party_id                   uuid REFERENCES parties(id) ON DELETE SET NULL,
            customer_name              text,
            item_id                    uuid REFERENCES items(id) ON DELETE SET NULL,
            invoice_mode               text NOT NULL DEFAULT 'zatca_tax',
            payment_method             text NOT NULL DEFAULT 'cash',
            doc_date                   date NOT NULL DEFAULT CURRENT_DATE,
            production_batch_no        text NOT NULL,
            sold_qty                   numeric(18, 4) NOT NULL DEFAULT 0,
            bonus_qty                  numeric(18, 4) NOT NULL DEFAULT 0,
            bonus_reason               text,
            unit_price                 numeric(18, 4) NOT NULL DEFAULT 0,
            discount_amount            numeric(18, 4) NOT NULL DEFAULT 0,
            discount_reason            text,
            discount_approved_by       uuid REFERENCES users(id) ON DELETE SET NULL,
            subtotal                   numeric(18, 4) NOT NULL DEFAULT 0,
            tax_rate                   numeric(5, 2) NOT NULL DEFAULT 15.00,
            tax_total                  numeric(18, 4) NOT NULL DEFAULT 0,
            total                      numeric(18, 4) NOT NULL DEFAULT 0,
            paid_amount                numeric(18, 4) NOT NULL DEFAULT 0,
            unit_cost                  numeric(18, 4) NOT NULL DEFAULT 3.80,
            net_profit                 numeric(18, 4) NOT NULL DEFAULT 0,
            customer_bonus_confirmed   boolean NOT NULL DEFAULT false,
            customer_confirmation_code text,
            bonus_anomaly              boolean NOT NULL DEFAULT false,
            anomaly_reason             text,
            sales_invoice_id           uuid REFERENCES sales_invoices(id) ON DELETE SET NULL,
            notes                      text,
            created_by                 uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at                 timestamptz NOT NULL DEFAULT now(),
            deleted_at                 timestamptz
          );

          ALTER TABLE van_sales_documents
            ADD COLUMN IF NOT EXISTS bonus_reason text,
            ADD COLUMN IF NOT EXISTS discount_amount numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS discount_reason text,
            ADD COLUMN IF NOT EXISTS discount_approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS unit_cost numeric(18, 4) NOT NULL DEFAULT 3.80,
            ADD COLUMN IF NOT EXISTS net_profit numeric(18, 4) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS zatca_qr_tlv text,
            ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

          CREATE TABLE IF NOT EXISTS factory_production_batches (
            id                uuid PRIMARY KEY,
            tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            batch_no          text NOT NULL,
            production_date   date NOT NULL DEFAULT CURRENT_DATE,
            item_id           uuid REFERENCES items(id) ON DELETE SET NULL,
            item_name         text NOT NULL DEFAULT 'رقائق سمبوسة وفطائر طازجة',
            warehouse_id      uuid REFERENCES warehouses(id) ON DELETE SET NULL,
            produced_qty      numeric(18, 4) NOT NULL DEFAULT 0,
            issued_qty        numeric(18, 4) NOT NULL DEFAULT 0,
            returned_good_qty numeric(18, 4) NOT NULL DEFAULT 0,
            damaged_qty       numeric(18, 4) NOT NULL DEFAULT 0,
            unit_cost         numeric(18, 4) NOT NULL DEFAULT 3.80,
            total_cost        numeric(18, 4) NOT NULL DEFAULT 0,
            status            text NOT NULL DEFAULT 'active',
            supervisor_name   text,
            notes             text,
            created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at        timestamptz NOT NULL DEFAULT now(),
            updated_at        timestamptz NOT NULL DEFAULT now(),
            deleted_at        timestamptz
          );

          CREATE TABLE IF NOT EXISTS van_stock_movements (
            id                  uuid PRIMARY KEY,
            tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            movement_type       text NOT NULL,
            batch_no            text,
            load_order_id       uuid REFERENCES van_load_orders(id) ON DELETE SET NULL,
            salesman_id         uuid REFERENCES salesmen(id) ON DELETE SET NULL,
            party_id            uuid REFERENCES parties(id) ON DELETE SET NULL,
            item_id             uuid REFERENCES items(id) ON DELETE SET NULL,
            qty                 numeric(18, 4) NOT NULL DEFAULT 0,
            unit_price          numeric(18, 4) NOT NULL DEFAULT 0,
            amount              numeric(18, 4) NOT NULL DEFAULT 0,
            reason              text,
            actor_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
            approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at          timestamptz NOT NULL DEFAULT now()
          );

          DO $$
          DECLARE
            target text;
          BEGIN
            FOREACH target IN ARRAY ARRAY[
              'van_sales_customer_prices',
              'van_load_orders',
              'van_sales_documents',
              'factory_production_batches',
              'van_stock_movements'
            ] LOOP
              EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
              EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
              EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
              EXECUTE format(
                'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
                'WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
                target
              );
              EXECUTE format('DROP POLICY IF EXISTS platform_admin_plane ON %I', target);
              EXECUTE format(
                'CREATE POLICY platform_admin_plane ON %I USING '
                '(COALESCE(current_setting(''app.is_platform_admin'', true), ''off'') = ''on'') WITH CHECK '
                '(COALESCE(current_setting(''app.is_platform_admin'', true), ''off'') = ''on'')',
                target
              );
            END LOOP;
          END $$;

          GRANT SELECT, INSERT, UPDATE, DELETE ON
            van_sales_customer_prices,
            van_load_orders,
            van_sales_documents,
            factory_production_batches,
            van_stock_movements
          TO erp_api, erp_migrator;
        `);
      } catch {
        // Ignore if connected without DDL rights; migration runner handles it
      } finally {
        client.release();
        await pool.end().catch(() => undefined);
      }
    })();
    return this.schemaEnsurePromise;
  }

  async dashboard(tenantId: string) {
    await this.ensureSchema();
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const productionBatches = rows(await tx.execute(sql`
        SELECT b.id::text, b.batch_no, b.production_date::text, b.item_id::text,
               COALESCE(i.name_ar, b.item_name, 'رقائق سمبوسة وفطائر طازجة') AS item_name,
               b.produced_qty::text, b.issued_qty::text, b.returned_good_qty::text,
               b.damaged_qty::text, b.unit_cost::text, b.total_cost::text,
               b.status, b.supervisor_name, b.notes, b.created_at
        FROM factory_production_batches b
        LEFT JOIN items i ON i.id = b.item_id
        WHERE b.tenant_id = ${tenantId}::uuid AND b.deleted_at IS NULL
        ORDER BY b.production_date DESC, b.created_at DESC
        LIMIT 50
      `));

      const loadOrders = rows(await tx.execute(sql`
        SELECT l.id::text, l.number, l.load_date::text, l.production_batch_no,
               l.vehicle_plate, l.status,
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
      `));

      const customerPrices = rows(await tx.execute(sql`
        SELECT cp.id::text, cp.party_id::text, p.name AS party_name, p.code AS party_code, p.tax_no AS party_tax_no,
               cp.item_id::text, COALESCE(i.name_ar, 'جميع أصناف المخبز') AS item_name,
               cp.price_tier_label, cp.unit_price::text, cp.max_bonus_pct::text,
               cp.max_bonus_kg_per_invoice::text, cp.preferred_invoice_mode,
               cp.credit_limit::text, cp.payment_terms_days, cp.lock_price, cp.max_discount_pct::text, cp.notes
        FROM van_sales_customer_prices cp
        JOIN parties p ON p.id = cp.party_id
        LEFT JOIN items i ON i.id = cp.item_id
        WHERE cp.tenant_id = ${tenantId}::uuid AND cp.deleted_at IS NULL
        ORDER BY p.name ASC
      `));

      const documents = rows(await tx.execute(sql`
        SELECT d.id::text, d.number, d.doc_date::text, d.invoice_mode, d.payment_method,
               d.production_batch_no, d.sold_qty::text, d.bonus_qty::text, d.bonus_reason,
               d.unit_price::text, d.discount_amount::text, d.discount_reason,
               d.subtotal::text, d.tax_rate::text,
               d.tax_total::text, d.total::text, d.paid_amount::text,
               d.unit_cost::text, d.net_profit::text,
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
        LIMIT 120
      `));

      const movements = rows(await tx.execute(sql`
        SELECT m.id::text, m.movement_type, m.batch_no, m.qty::text, m.unit_price::text, m.amount::text,
               m.reason, m.created_at,
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
      `));

      // Aggregate Factory & Van Sales KPIs
      let totalProducedKg = new Decimal(0);
      let totalProductionCostSar = new Decimal(0);
      for (const b of productionBatches) {
        totalProducedKg = totalProducedKg.plus(dec(b.produced_qty));
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

      // Per-rep performance map
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
          const rem = loaded.minus(sold).minus(bonus).minus(returned).minus(damaged).minus(shortage);
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
        summary: {
          totalProducedKg: totalProducedKg.toFixed(2),
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
          const issued = dec(b.issued_qty);
          const retGood = dec(b.returned_good_qty);
          const dmg = dec(b.damaged_qty);
          const avail = Decimal.max(0, produced.minus(issued).plus(retGood).minus(dmg));
          return {
            id: str(b.id),
            batchNo: str(b.batch_no),
            productionDate: str(b.production_date),
            itemId: b.item_id ? str(b.item_id) : null,
            itemName: str(b.item_name),
            producedQty: produced.toFixed(2),
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
            : Decimal.max(0, loaded.minus(sold).minus(bonus).minus(returned).minus(damaged).minus(shortage));
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
          preferredInvoiceMode: str(row.preferred_invoice_mode) as 'zatca_tax' | 'internal_delivery',
          creditLimit: dec(row.credit_limit).toFixed(2),
          paymentTermsDays: Number(row.payment_terms_days ?? 15),
          lockPrice: row.lock_price !== false,
          maxDiscountPct: dec(row.max_discount_pct).toFixed(2),
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
   * Pillar 1: Record daily factory/bakery production batch (`إنتاج يومي للمصنع والمخبز`).
   */
  async createProductionBatch(
    tenantId: string,
    userId: string,
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
    await this.ensureSchema();
    const producedQty = dec(body.producedQty);
    if (producedQty.lte(0)) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'أدخل كمية الإنتاج اليومية بالكيلو (أكبر من صفر)', 422, {
        field: 'producedQty',
      });
    }
    const unitCost = dec(body.unitCost ?? '3.80');
    const totalCost = producedQty.mul(unitCost);
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const batchNo =
      String(body.batchNo ?? '').trim() ||
      `PROD-${datePart}-${Math.floor(100 + Math.random() * 900)}`;
    const itemName = String(body.itemName ?? '').trim() || 'رقائق سمبوسة وفطائر طازجة';

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO factory_production_batches (
          id, tenant_id, batch_no, production_date, item_id, item_name,
          produced_qty, issued_qty, returned_good_qty, damaged_qty,
          unit_cost, total_cost, status, supervisor_name, notes, created_by
        ) VALUES (
          ${newId()}::uuid, ${tenantId}::uuid, ${batchNo}, CURRENT_DATE,
          ${body.itemId || null}::uuid, ${itemName},
          ${producedQty.toFixed(4)}::numeric, 0, 0, 0,
          ${unitCost.toFixed(4)}::numeric, ${totalCost.toFixed(4)}::numeric,
          'active', ${body.supervisorName?.trim() || 'مشرف الإنتاج'},
          ${body.notes?.trim() || null}, ${userId}::uuid
        )
      `);

      await tx.execute(sql`
        INSERT INTO van_stock_movements (
          id, tenant_id, movement_type, batch_no, item_id, qty, unit_price, amount, reason, actor_user_id
        ) VALUES (
          ${newId()}::uuid, ${tenantId}::uuid, 'production_in', ${batchNo},
          ${body.itemId || null}::uuid, ${producedQty.toFixed(4)}::numeric,
          ${unitCost.toFixed(4)}::numeric, ${totalCost.toFixed(4)}::numeric,
          ${`إنتاج يومي جديد وتوريد للمستودع الرئيسي — ${itemName}`}, ${userId}::uuid
        )
      `);
    });

    return this.dashboard(tenantId);
  }

  /**
   * Pillar 4 & 5: Customer Price Tiers, Price Locking, Credit Limit & Bonus Policy.
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
      notes?: string;
    },
  ) {
    await this.ensureSchema();
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
    const creditLimit = dec(body.creditLimit ?? '5000');
    const paymentTermsDays = Number(body.paymentTermsDays ?? 15);
    const lockPrice = body.lockPrice !== false;
    const maxDiscountPct = dec(body.maxDiscountPct ?? '0');
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
              credit_limit = ${creditLimit.toFixed(4)}::numeric,
              payment_terms_days = ${paymentTermsDays},
              lock_price = ${lockPrice},
              max_discount_pct = ${maxDiscountPct.toFixed(2)}::numeric,
              notes = ${body.notes?.trim() || null},
              updated_at = now()
          WHERE id = ${str(existing.id)}::uuid AND tenant_id = ${tenantId}::uuid
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO van_sales_customer_prices (
            id, tenant_id, party_id, item_id, price_tier_label, unit_price,
            max_bonus_pct, max_bonus_kg_per_invoice, preferred_invoice_mode,
            credit_limit, payment_terms_days, lock_price, max_discount_pct, notes
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, ${partyId}::uuid, ${itemId}::uuid,
            ${label}, ${unitPrice.toFixed(4)}::numeric,
            ${maxBonusPct.toFixed(2)}::numeric, ${maxBonusKg.toFixed(4)}::numeric,
            ${mode}, ${creditLimit.toFixed(4)}::numeric, ${paymentTermsDays},
            ${lockPrice}, ${maxDiscountPct.toFixed(2)}::numeric, ${body.notes?.trim() || null}
          )
        `);
      }
    });
    return this.dashboard(tenantId);
  }

  /**
   * Pillar 1 & 2: Issue goods from Factory Warehouse to Sales Rep Custody (`أمر تحميل وصرف عهدة لمندوب`).
   */
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
    await this.ensureSchema();
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
    const maxBonusQty = dec(body.maxBonusQty ?? '20');
    const maxBonusPct = dec(body.maxBonusPct ?? '20');
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const batchNo =
      String(body.productionBatchNo ?? '').trim() ||
      `PROD-${datePart}-${Math.floor(100 + Math.random() * 900)}`;
    const estimatedValue = loadedQty.mul('6.50');

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const countRow = first(await tx.execute(sql`
        SELECT count(*)::int AS cnt FROM van_load_orders WHERE tenant_id = ${tenantId}::uuid
      `));
      const seq = Number(countRow?.cnt ?? 0) + 1;
      const number = `VLO-${String(seq).padStart(4, '0')}`;
      const loadOrderId = newId();

      await tx.execute(sql`
        INSERT INTO van_load_orders (
          id, tenant_id, number, salesman_id, branch_id, warehouse_id, item_id,
          vehicle_plate, load_date, production_batch_no, status,
          loaded_qty, loaded_total_value, sold_qty, bonus_qty, returned_qty, damaged_qty, shortage_qty,
          max_bonus_qty, max_bonus_pct, notes, created_by
        ) VALUES (
          ${loadOrderId}::uuid, ${tenantId}::uuid, ${number}, ${salesmanId}::uuid,
          ${body.branchId || null}::uuid, ${body.warehouseId || null}::uuid, ${body.itemId || null}::uuid,
          ${body.vehiclePlate?.trim() || null}, CURRENT_DATE, ${batchNo}, 'loaded',
          ${loadedQty.toFixed(4)}::numeric, ${estimatedValue.toFixed(4)}::numeric,
          0, 0, 0, 0, 0,
          ${maxBonusQty.toFixed(4)}::numeric, ${maxBonusPct.toFixed(2)}::numeric,
          ${body.notes?.trim() || null}, ${userId}::uuid
        )
      `);

      // Update factory production batch issued_qty if matching batch exists
      await tx.execute(sql`
        UPDATE factory_production_batches
        SET issued_qty = issued_qty + ${loadedQty.toFixed(4)}::numeric,
            updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND batch_no = ${batchNo} AND deleted_at IS NULL
      `);

      await tx.execute(sql`
        INSERT INTO van_stock_movements (
          id, tenant_id, movement_type, batch_no, load_order_id, salesman_id, item_id,
          qty, unit_price, amount, reason, actor_user_id
        ) VALUES (
          ${newId()}::uuid, ${tenantId}::uuid, 'van_load', ${batchNo}, ${loadOrderId}::uuid,
          ${salesmanId}::uuid, ${body.itemId || null}::uuid,
          ${loadedQty.toFixed(4)}::numeric, 6.50, ${estimatedValue.toFixed(4)}::numeric,
          ${`صرف وتحميل عهدة للمندوب بموجب أمر التحميل ${number}`}, ${userId}::uuid
        )
      `);
    });

    return this.dashboard(tenantId);
  }

  /**
   * Pillar 3, 4, 5, 7, 8: Issue Van Sales Document (ZATCA Tax Invoice or Internal Delivery)
   * with price lock, discount control, bonus reason & ceiling, batch deduction, and profit calculation.
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
    },
  ) {
    await this.ensureSchema();
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
      const currentDamaged = dec(loadOrder.damaged_qty);
      const remaining = loaded
        .minus(currentSold)
        .minus(currentBonus)
        .minus(currentReturned)
        .minus(currentDamaged);
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

      // 2) Customer price tier & price lock enforcement (Pillar 4)
      const partyId = body.partyId ? str(body.partyId).trim() || null : null;
      let customerRule: Record<string, unknown> | undefined;
      if (partyId) {
        customerRule = first(await tx.execute(sql`
          SELECT * FROM van_sales_customer_prices
          WHERE tenant_id = ${tenantId}::uuid AND party_id = ${partyId}::uuid AND deleted_at IS NULL
          ORDER BY updated_at DESC LIMIT 1
        `));
      }

      const tierUnitPrice = customerRule ? dec(customerRule.unit_price) : null;
      const requestedUnitPrice = dec(body.unitPrice ?? (tierUnitPrice ? tierUnitPrice.toString() : '6.50'));
      if (tierUnitPrice && customerRule?.lock_price !== false && requestedUnitPrice.lt(tierUnitPrice) && !body.allowPriceDiscountOverride) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          `منع تغيير السعر غير المصرح به: سعر هذا العميل مثبّت في النظام عند (${tierUnitPrice.toFixed(2)} ريال/كجم). لا يُسمح للمندوب بالبيع بسعر أقل (${requestedUnitPrice.toFixed(2)} ريال/كجم) إلا بموافقة الإدارة.`,
          422,
          { field: 'unitPrice' },
        );
      }
      const resolvedUnitPrice = tierUnitPrice && customerRule?.lock_price !== false && !body.allowPriceDiscountOverride
        ? tierUnitPrice
        : requestedUnitPrice;
      if (resolvedUnitPrice.lte(0)) {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'حدد سعر البيع للكيلو', 422, {
          field: 'unitPrice',
        });
      }

      // Exceptional discount control
      const discountAmount = Decimal.max(0, dec(body.discountAmount ?? '0'));
      const grossBeforeDiscount = soldQty.mul(resolvedUnitPrice);
      const maxDiscountPct = customerRule ? dec(customerRule.max_discount_pct) : new Decimal(0);
      const discountPct = grossBeforeDiscount.gt(0)
        ? discountAmount.div(grossBeforeDiscount).mul(100)
        : new Decimal(0);
      if (discountAmount.gt(0) && discountPct.gt(maxDiscountPct) && !body.allowPriceDiscountOverride) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          `منع الخصم غير المصرح به: قيمة الخصم (${discountAmount.toFixed(2)} ريال — ${discountPct.toFixed(1)}%) تتجاوز السقف المسموح للعميل (${maxDiscountPct.toFixed(1)}%). يتطلب اعتماد صاحب المصنع أو المحاسب.`,
          422,
          { field: 'discountAmount' },
        );
      }

      // 3) Bonus / Free quantity & samples anti-fraud check (Pillar 3)
      const loadMaxBonusRemaining = dec(loadOrder.max_bonus_qty).minus(currentBonus);
      const customerMaxBonusKg = customerRule ? dec(customerRule.max_bonus_kg_per_invoice) : new Decimal('20');
      const customerMaxBonusPct = customerRule ? dec(customerRule.max_bonus_pct) : dec(loadOrder.max_bonus_pct);
      const bonusPctOfSale = soldQty.gt(0) ? bonusQty.div(soldQty).mul('100') : new Decimal('100');

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

      // 4) Dual Invoice Mode & Profit Calculation (Pillar 7 & 8)
      const invoiceMode =
        body.invoiceMode ??
        (customerRule ? (str(customerRule.preferred_invoice_mode) as 'zatca_tax' | 'internal_delivery') : 'zatca_tax');
      const subtotal = Decimal.max(0, grossBeforeDiscount.minus(discountAmount));
      const taxRate = invoiceMode === 'zatca_tax' ? new Decimal('15') : new Decimal('0');
      const taxTotal = invoiceMode === 'zatca_tax' ? subtotal.mul('0.15') : new Decimal('0');
      const grandTotal = subtotal.plus(taxTotal);
      const paymentMethod = body.paymentMethod ?? 'cash';
      const paidAmount = paymentMethod === 'credit' ? new Decimal('0') : grandTotal;

      // Credit limit check for credit sales (Pillar 5)
      if (paymentMethod === 'credit' && partyId && customerRule) {
        const creditLimit = dec(customerRule.credit_limit);
        const unpaidRow = first(await tx.execute(sql`
          SELECT COALESCE(SUM(total - paid_amount), 0)::text AS unpaid
          FROM van_sales_documents
          WHERE tenant_id = ${tenantId}::uuid AND party_id = ${partyId}::uuid AND deleted_at IS NULL
        `));
        const currentDebt = dec(unpaidRow?.unpaid);
        if (currentDebt.plus(grandTotal).gt(creditLimit) && !body.allowPriceDiscountOverride) {
          throw new DomainError(
            errorCodes.VALIDATION_FAILED,
            `تجاوز الحد الائتماني للعميل: مديونية العميل بعد هذه الفاتورة (${currentDebt.plus(grandTotal).toFixed(2)} ريال) تتجاوز سقف الائتمان المسموح (${creditLimit.toFixed(2)} ريال).`,
            422,
            { field: 'paymentMethod' },
          );
        }
      }

      // Cost & Net Profit calculation (including cost of free bonus kg!)
      const batchRow = first(await tx.execute(sql`
        SELECT unit_cost::text FROM factory_production_batches
        WHERE tenant_id = ${tenantId}::uuid AND batch_no = ${str(loadOrder.production_batch_no)} AND deleted_at IS NULL
        LIMIT 1
      `));
      const unitCost = batchRow ? dec(batchRow.unit_cost) : new Decimal('3.80');
      const totalCogs = soldQty.plus(bonusQty).mul(unitCost);
      const netProfit = subtotal.minus(totalCogs);

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
          sold_qty, bonus_qty, bonus_reason, unit_price, discount_amount, discount_reason,
          discount_approved_by, subtotal, tax_rate, tax_total, total, paid_amount,
          unit_cost, net_profit,
          customer_bonus_confirmed, customer_confirmation_code, bonus_anomaly, anomaly_reason,
          notes, created_by
        ) VALUES (
          ${newId()}::uuid, ${tenantId}::uuid, ${number}, ${loadOrderId}::uuid,
          ${str(loadOrder.salesman_id)}::uuid, ${partyId}::uuid,
          ${body.customerName?.trim() || null},
          ${body.itemId || (loadOrder.item_id ? str(loadOrder.item_id) : null)}::uuid,
          ${invoiceMode}, ${paymentMethod}, CURRENT_DATE, ${str(loadOrder.production_batch_no)},
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
          ${Boolean(body.customerBonusConfirmed)},
          ${body.customerConfirmationCode?.trim() || null},
          ${bonusAnomaly},
          ${anomalyReasons.length > 0 ? anomalyReasons.join(' · ') : null},
          ${body.notes?.trim() || null},
          ${userId}::uuid
        )
      `);

      // Update load order running quantities and expected cash
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

      // Log stock movements for sold and bonus quantities (Pillar 6)
      if (soldQty.gt(0)) {
        await tx.execute(sql`
          INSERT INTO van_stock_movements (
            id, tenant_id, movement_type, batch_no, load_order_id, salesman_id, party_id,
            qty, unit_price, amount, reason, actor_user_id
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, 'van_sale', ${str(loadOrder.production_batch_no)},
            ${loadOrderId}::uuid, ${str(loadOrder.salesman_id)}::uuid, ${partyId}::uuid,
            ${soldQty.toFixed(4)}::numeric, ${resolvedUnitPrice.toFixed(4)}::numeric,
            ${grandTotal.toFixed(4)}::numeric,
            ${`بيع للعميل بموجب فاتورة ${number}`}, ${userId}::uuid
          )
        `);
      }
      if (bonusQty.gt(0)) {
        await tx.execute(sql`
          INSERT INTO van_stock_movements (
            id, tenant_id, movement_type, batch_no, load_order_id, salesman_id, party_id,
            qty, unit_price, amount, reason, actor_user_id
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, 'van_bonus', ${str(loadOrder.production_batch_no)},
            ${loadOrderId}::uuid, ${str(loadOrder.salesman_id)}::uuid, ${partyId}::uuid,
            ${bonusQty.toFixed(4)}::numeric, 0, 0,
            ${`كمية مجانية / بونص (${body.bonusReason?.trim() || 'ترويجي'}) في فاتورة ${number}`}, ${userId}::uuid
          )
        `);
      }
    });

    return this.dashboard(tenantId);
  }

  /**
   * Pillar 2 (Stage 1): Sales Rep submits End-of-Day Shift Closing (`تقديم إغلاق الوردية للمحاسب`).
   * Example: 150 kg loaded -> 100 kg sold + 20 kg bonus + 25 kg damaged (requires physical inspection)
   * -> automatically computes 5 kg shortage charged to the rep!
   * Status becomes `'pending_closing'` until the Accountant inspects damaged goods and approves.
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
    await this.ensureSchema();
    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const loadOrder = first(await tx.execute(sql`
        SELECT l.*, COALESCE(s.name, 'مندوب') AS salesman_name
        FROM van_load_orders l
        LEFT JOIN salesmen s ON s.id = l.salesman_id
        WHERE l.id = ${loadOrderId}::uuid AND l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
        FOR UPDATE
      `));
      if (!loadOrder) {
        throw new DomainError(errorCodes.NOT_FOUND, 'أمر التحميل غير موجود', 404);
      }
      if (str(loadOrder.status) === 'settled') {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'تم اعتماد وتصفية هذه الوردية مسبقاً', 422);
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

      // Automatic shortage calculation: Loaded - (Sold + Bonus + Returned + Damaged)
      const shortageQty = Decimal.max(0, loaded.minus(accountedQty));
      const unitChargePrice = new Decimal('6.50');
      const shortageValue = shortageQty.mul(unitChargePrice);

      await tx.execute(sql`
        UPDATE van_load_orders
        SET status = 'pending_closing',
            returned_qty = ${returnedQty.toFixed(4)}::numeric,
            damaged_qty = ${damagedQty.toFixed(4)}::numeric,
            shortage_qty = ${shortageQty.toFixed(4)}::numeric,
            shortage_value = ${shortageValue.toFixed(4)}::numeric,
            collected_cash = ${collectedCash.toFixed(4)}::numeric,
            damage_reason = ${body.damageReason?.trim() || null},
            closing_notes = ${body.closingNotes?.trim() || null},
            closing_submitted_at = now(),
            closing_submitted_by = ${userId}::uuid,
            updated_at = now()
        WHERE id = ${loadOrderId}::uuid AND tenant_id = ${tenantId}::uuid
      `);

      // Notify Accountant / Owner in notifications bell
      const recipients = rows(await tx.execute(sql`
        SELECT id::text AS membership_id
        FROM memberships
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status = 'active'
        LIMIT 10
      `));
      const title = `🚚 طلب اعتماد إغلاق وردية المندوب (${str(loadOrder.salesman_name)}) — ${str(loadOrder.number)}`;
      const msgBody = `المستلم: ${loaded.toFixed(1)} كجم | المباع: ${sold.toFixed(1)} كجم | البونص: ${bonus.toFixed(1)} كجم | تالف للفحص: ${damagedQty.toFixed(1)} كجم | عجز على المندوب: ${shortageQty.toFixed(1)} كجم (${shortageValue.toFixed(2)} ريال). بانتظار اعتماد المحاسب.`;
      for (const r of recipients) {
        await tx.execute(sql`
          INSERT INTO notifications (id, tenant_id, membership_id, type, payload)
          VALUES (
            ${newId()}::uuid,
            ${tenantId}::uuid,
            ${str(r.membership_id)}::uuid,
            'van_sales_closing_request',
            ${JSON.stringify({ title, body: msgBody, href: '/van-sales?tab=loads' })}::jsonb
          )
        `).catch(() => undefined);
      }
    });

    return this.dashboard(tenantId);
  }

  /**
   * Pillar 2 (Stage 2) & Pillar 7: Accountant inspects damaged goods, approves charging
   * any shortage (`5 kg`) to the rep's salary deduction, and zeroes out rep custody (`0.00 kg`).
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
      notes?: string;
    },
  ) {
    await this.ensureSchema();
    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const loadOrder = first(await tx.execute(sql`
        SELECT l.*, COALESCE(s.name, 'مندوب') AS salesman_name
        FROM van_load_orders l
        LEFT JOIN salesmen s ON s.id = l.salesman_id
        WHERE l.id = ${loadOrderId}::uuid AND l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
        FOR UPDATE
      `));
      if (!loadOrder) {
        throw new DomainError(errorCodes.NOT_FOUND, 'أمر التحميل غير موجود', 404);
      }

      const loaded = dec(loadOrder.loaded_qty);
      const sold = dec(loadOrder.sold_qty);
      const bonus = dec(loadOrder.bonus_qty);
      const returnedQty =
        body.returnedQty !== undefined ? Decimal.max(0, dec(body.returnedQty)) : dec(loadOrder.returned_qty);
      const damagedQty =
        body.damagedQty !== undefined ? Decimal.max(0, dec(body.damagedQty)) : dec(loadOrder.damaged_qty);
      const collectedCash =
        body.collectedCash !== undefined ? Decimal.max(0, dec(body.collectedCash)) : dec(loadOrder.collected_cash);

      if (damagedQty.gt(0) && body.damageInspected === false) {
        throw new DomainError(
          errorCodes.VALIDATION_FAILED,
          'لا يمكن اعتماد إغلاق الوردية بوجود كميات تالفة دون تأكيد الفحص الفعلي للتالف من المحاسب أو أمين المستودع',
          422,
        );
      }

      const shortageQty = Decimal.max(0, loaded.minus(sold).minus(bonus).minus(returnedQty).minus(damagedQty));
      const shortageValue = shortageQty.mul('6.50');
      const damageInspected = damagedQty.gt(0) ? body.damageInspected !== false : true;
      const salaryDeductionApproved = shortageQty.gt(0) ? body.salaryDeductionApproved !== false : false;

      await tx.execute(sql`
        UPDATE van_load_orders
        SET status = 'settled',
            returned_qty = ${returnedQty.toFixed(4)}::numeric,
            damaged_qty = ${damagedQty.toFixed(4)}::numeric,
            shortage_qty = ${shortageQty.toFixed(4)}::numeric,
            shortage_value = ${shortageValue.toFixed(4)}::numeric,
            collected_cash = ${collectedCash.toFixed(4)}::numeric,
            damage_inspected = ${damageInspected},
            damage_inspected_by = ${userId}::uuid,
            salary_deduction_approved = ${salaryDeductionApproved},
            approved_at = now(),
            approved_by = ${userId}::uuid,
            settled_at = now(),
            notes = COALESCE(${body.notes?.trim() || null}, notes),
            updated_at = now()
        WHERE id = ${loadOrderId}::uuid AND tenant_id = ${tenantId}::uuid
      `);

      // Update factory production batch returned & damaged quantities
      await tx.execute(sql`
        UPDATE factory_production_batches
        SET returned_good_qty = returned_good_qty + ${returnedQty.toFixed(4)}::numeric,
            damaged_qty = damaged_qty + ${damagedQty.toFixed(4)}::numeric,
            updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid
          AND batch_no = ${str(loadOrder.production_batch_no)}
          AND deleted_at IS NULL
      `);

      // Record stock movements for return, inspected damage, and rep shortage (Pillar 6 & 7)
      if (returnedQty.gt(0)) {
        await tx.execute(sql`
          INSERT INTO van_stock_movements (
            id, tenant_id, movement_type, batch_no, load_order_id, salesman_id,
            qty, unit_price, amount, reason, actor_user_id, approved_by_user_id
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, 'van_return', ${str(loadOrder.production_batch_no)},
            ${loadOrderId}::uuid, ${str(loadOrder.salesman_id)}::uuid,
            ${returnedQty.toFixed(4)}::numeric, 0, 0,
            ${`إرجاع بضاعة سليمة للمستودع الرئيسي عند إغلاق الوردية ${str(loadOrder.number)}`},
            ${userId}::uuid, ${userId}::uuid
          )
        `);
      }
      if (damagedQty.gt(0)) {
        await tx.execute(sql`
          INSERT INTO van_stock_movements (
            id, tenant_id, movement_type, batch_no, load_order_id, salesman_id,
            qty, unit_price, amount, reason, actor_user_id, approved_by_user_id
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, 'van_damage', ${str(loadOrder.production_batch_no)},
            ${loadOrderId}::uuid, ${str(loadOrder.salesman_id)}::uuid,
            ${damagedQty.toFixed(4)}::numeric, 3.80, ${damagedQty.mul('3.80').toFixed(4)}::numeric,
            ${`بضاعة تالفة تم فحصها فعلياً واعتمادها (${str(loadOrder.damage_reason) || 'تلف نقل'}) — ${str(loadOrder.number)}`},
            ${userId}::uuid, ${userId}::uuid
          )
        `);
      }
      if (shortageQty.gt(0)) {
        await tx.execute(sql`
          INSERT INTO van_stock_movements (
            id, tenant_id, movement_type, batch_no, load_order_id, salesman_id,
            qty, unit_price, amount, reason, actor_user_id, approved_by_user_id
          ) VALUES (
            ${newId()}::uuid, ${tenantId}::uuid, 'van_shortage', ${str(loadOrder.production_batch_no)},
            ${loadOrderId}::uuid, ${str(loadOrder.salesman_id)}::uuid,
            ${shortageQty.toFixed(4)}::numeric, 6.50, ${shortageValue.toFixed(4)}::numeric,
            ${`عجز عهدة محسوب على المندوب ومعتمد للخصم من الراتب (${shortageQty.toFixed(2)} كجم = ${shortageValue.toFixed(2)} ريال) — ${str(loadOrder.number)}`},
            ${userId}::uuid, ${userId}::uuid
          )
        `);
      }

      // Send notification confirming closing approval and zeroed custody
      const recipients = rows(await tx.execute(sql`
        SELECT id::text AS membership_id
        FROM memberships
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status = 'active'
        LIMIT 10
      `));
      const title = `✅ تم اعتماد إغلاق وردية المندوب (${str(loadOrder.salesman_name)}) وتصفير العهدة`;
      const msgBody = `أمر التحميل ${str(loadOrder.number)}: رصيد العهدة الآن 0.00 كجم.${shortageQty.gt(0) ? ` تم قيد عجز ${shortageQty.toFixed(1)} كجم (${shortageValue.toFixed(2)} ريال) خصماً على راتب المندوب.` : ''}`;
      for (const r of recipients) {
        await tx.execute(sql`
          INSERT INTO notifications (id, tenant_id, membership_id, type, payload)
          VALUES (
            ${newId()}::uuid,
            ${tenantId}::uuid,
            ${str(r.membership_id)}::uuid,
            'van_sales_closing_approved',
            ${JSON.stringify({ title, body: msgBody, href: '/van-sales?tab=loads' })}::jsonb
          )
        `).catch(() => undefined);
      }
    });

    return this.dashboard(tenantId);
  }

  /**
   * Direct settlement endpoint (kept for backward compatibility — delegates to `approveClosing`).
   */
  async settleLoadOrder(
    tenantId: string,
    id: string,
    body: {
      returnedQty?: string;
      damagedQty?: string;
      collectedCash?: string;
      notes?: string;
    },
    userId?: string,
  ) {
    return this.approveClosing(tenantId, userId ?? newId(), id, {
      returnedQty: body.returnedQty,
      damagedQty: body.damagedQty,
      collectedCash: body.collectedCash,
      damageInspected: true,
      salaryDeductionApproved: true,
      notes: body.notes,
    });
  }

  /**
   * Pillar 5: Record Customer Collection Receipt (`سند تحصيل مديونية من عميل`).
   */
  async collectCustomerDebt(
    tenantId: string,
    userId: string,
    body: {
      documentId?: string;
      collectedAmount?: string;
      notes?: string;
    },
  ) {
    await this.ensureSchema();
    const documentId = str(body.documentId).trim();
    const collectedAmount = dec(body.collectedAmount);
    if (!documentId || collectedAmount.lte(0)) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'حدد الفاتورة الآجلة ومبلغ التحصيل', 422);
    }

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const doc = first(await tx.execute(sql`
        SELECT * FROM van_sales_documents
        WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `));
      if (!doc) throw new DomainError(errorCodes.NOT_FOUND, 'الفاتورة غير موجودة', 404);
      const docTotal = dec(doc.total);
      const currentPaid = dec(doc.paid_amount);
      const nextPaid = Decimal.min(docTotal, currentPaid.plus(collectedAmount));

      await tx.execute(sql`
        UPDATE van_sales_documents
        SET paid_amount = ${nextPaid.toFixed(4)}::numeric
        WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid
      `);

      await tx.execute(sql`
        INSERT INTO van_stock_movements (
          id, tenant_id, movement_type, batch_no, load_order_id, salesman_id, party_id,
          qty, unit_price, amount, reason, actor_user_id
        ) VALUES (
          ${newId()}::uuid, ${tenantId}::uuid, 'collection_receipt', ${str(doc.production_batch_no)},
          ${doc.load_order_id ? str(doc.load_order_id) : null}::uuid,
          ${doc.salesman_id ? str(doc.salesman_id) : null}::uuid,
          ${doc.party_id ? str(doc.party_id) : null}::uuid,
          0, 0, ${collectedAmount.toFixed(4)}::numeric,
          ${`سند قبض وتحصيل مديونية للفاتورة ${str(doc.number)} ${body.notes ? `— ${body.notes.trim()}` : ''}`},
          ${userId}::uuid
        )
      `);
    });

    return this.dashboard(tenantId);
  }
}
