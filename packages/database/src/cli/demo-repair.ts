import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

/**
 * `pnpm db:demo-repair` — **إصلاحُ الصفوفِ القائمة** التي كتبتها القيمُ الافتراضيةُ
 * المفبركة قبل الهجرة `0131_van_sales_honest_defaults.sql`.
 *
 * لماذا أداةٌ ولا هجرة: فالهجرةُ تُنفَّذ تلقائيًّا على كلّ تثبيتٍ ولا تسأل، وهذه كتابةٌ في
 * أرقامٍ محاسبيةٍ قائمة — فتُخطّط أوّلًا (بلا كتابة)، وتطبع كلّ صفٍّ بما فيه ومن أيّ منشأة
 * وماذا سيصير، وتأخذ نسخةً احتياطيةً على القرص، ولا تكتب إلا بـ`--apply` صريحةٍ في
 * معاملةٍ واحدة. ومَن أراد الكشفَ بلا إصلاح فـ`pnpm db:demo-audit` (قراءةٌ فقط).
 *
 * **وما يُصلَح وكيف عُرف أنّه مفبرك** (قِيس في `information_schema` وفي نصّ `0131` نفسه،
 * لا من الذاكرة):
 *
 *   ١. `van_sales_documents.unit_cost = 3.80` في صفٍّ **مرتجع** (`document_kind = 'return'`)
 *      أُنشئ قبل تطبيق `0131`: فـ`createReturnDocument` كان لا يُسمّي العمودَ فيأخذ
 *      الافتراضيّ. والحقيقةُ تُعاد بالطريقة نفسها التي يكتبها المسارُ الرسميّ اليوم
 *      (‏`van-sales.service.ts:8076-8089`): ‏`SUM(sales_invoice_lines.cost_total) /
 *      SUM(quantity)` على إشعاره الدائن (`sales_invoice_id`) — وهي رجلُ Dr مخزون /
 *      Cr «تكلفة المبيعات» نفسها. وإن لم يُرحَّل الإشعارُ فالتكلفةُ **مجهولة** ⇒ صفرٌ
 *      صادق (وهو ما يكتبه المسارُ الرسميّ في هذه الحال) ويُعدّ في «لا يُكتشف».
 *      و`net_profit` لا يُلمس: فصفُّ المرتجع يحمل صفرًا بالتصميم (`0167` في تعليق
 *      الخدمة)، ومجاميعُ الربح تقرأ التكلفةَ من الإشعار لا من هذا العمود.
 *
 *   ٢. `batch_code = 'BATCH-DEFAULT'` في `van_load_orders` و`van_sales_documents` ⇒ ‏`NULL`.
 *      والعمودان nullable (قِيس) فالتفريغُ صادق: «لم يُسمِّ أحدٌ دفعة». وأمّا
 *      `production_batch_no` فـ`NOT NULL` وتركته `0131` عمدًا (يكتبه المسارُ الرسميّ)،
 *      فلا يُفرَّغ هنا ويُعدّ في «لا يُصلَح».
 *
 *   ٣. `factory_production_batches.item_name = 'رقائق سمبوسة وفطائر طازجة'` ⇒ اسمُ الصنف
 *      الحقيقيّ `items.name_ar` إن كان `item_id` مربوطًا — وهذا ليس اختراعًا بل قراءةُ ما
 *      هو مكتوبٌ في صفّ الصنف. وبلا `item_id` لا يُكتشف، والعمودُ `NOT NULL` (قِيس) فلا
 *      يُفرَّغ ⇒ يُعدّ ويُترك.
 *
 *   ٤. **وبـ`--fix-batch-cost` وحدها**: `factory_production_batches.unit_cost` حيث
 *      `round(total_cost / produced_qty, 4) <> round(unit_cost, 4)` — أي صفٌّ يناقض نفسه.
 *      والإصلاحُ من أرقامِ الصفّ نفسه (`total_cost` هو ما رُحِّل إلى الأستاذ فيبقى كما هو،
 *      وتُشتقّ تكلفةُ الوحدة منه). وهي مقفلةٌ افتراضيًّا لأنّها ليست معلَّمةً بقيمةٍ
 *      مفبركة، فالتناقضُ قد يكون سببُه `total_cost` لا `unit_cost`.
 *
 * **وما لا يُلمس عمدًا**: صفُّ **بيعٍ** يحمل ٣٫٨٠ — فمسارُ البيع يكتب العمودَ صراحةً
 * (`van-sales.service.ts:4921,4940`) وقد تكون ٣٫٨٠ تكلفةَ الصنف الحقيقية (وهذا بالضبط ما
 * أخفى العيبَ في تثبيت القبول)، فلا دليلَ على الفبركة ⇒ يُعدّ ولا يُصلَح. وهويةُ المنشأة
 * الوهمية ليست من شأن هذه الأداة: فصارت تُقرأ من `DEMO_COMPANY_*` عند البذر، والقائمُ
 * منها يُعدَّل في staff → الإعدادات (ولا تمحوه بذرة).
 *
 * والأداةُ **عادّة**: فبعد الإصلاح لا تعود الصفوفُ مطابقةً للعلامات، وتشغيلٌ ثانٍ يجد صفرًا.
 */

/** القيمُ التي كانت تُكتب من المخطط لا من العمل — نصًّا كما في `0120`/`0121`. */
export const FABRICATED = {
  /** `0121:151` — ‏`ADD COLUMN unit_cost numeric(18,4) NOT NULL DEFAULT 3.80`. */
  unitCost: '3.80',
  /** `0120:62,68` — ‏`batch_code text DEFAULT 'BATCH-DEFAULT'`. */
  batchCode: 'BATCH-DEFAULT',
  /** `0120:51` — ‏`item_name text NOT NULL DEFAULT '…'`. */
  itemName: 'رقائق سمبوسة وفطائر طازجة',
  /** الهجرةُ التي أسقطت الافتراضيّات — وحدُّ «قبلها» هو دليلُ الفبركة. */
  migration: '0131_van_sales_honest_defaults.sql',
} as const;

/** أدنى ما تحتاجه الأداةُ من مُشغّلٍ — فيقبل `pg.Client` ويقبل اتصالَ اختبار. */
export type RepairClient = {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

export type RepairCategory =
  | 'return-unit-cost'
  | 'load-batch-code'
  | 'document-batch-code'
  | 'batch-item-name'
  | 'batch-unit-cost-inconsistent';

export type Repair = {
  category: RepairCategory;
  table: string;
  column: string;
  id: string;
  tenantCode: string;
  reference: string;
  createdAt: string;
  before: string | null;
  after: string | null;
  reasonAr: string;
  /** الأعمدةُ كما هي الآن — تُحفظ في النسخة الاحتياطية قبل أيّ كتابة. */
  backup: Record<string, unknown>;
};

export type ReportOnly = {
  key: string;
  labelAr: string;
  count: number;
  whyAr: string;
};

export type RepairPlan = {
  /** ‏`applied_at` للهجرة `0131` — حدُّ «مفبركٌ مُثبت». ‏`null` ⇒ لم تُطبَّق ⇒ تُرفض. */
  cutoff: string | null;
  repairs: Repair[];
  reportOnly: ReportOnly[];
};

export type PlanOptions = {
  /** يضيّق على منشأةٍ برمزها؛ بلا رمزٍ تُقاس المنشآت كلّها ويُطبع التفصيلُ لكلٍّ منها. */
  tenantCode?: string;
  /** الفئةُ ٤ — مغلقةٌ افتراضيًّا (انظر رأس الملف). */
  fixBatchCost?: boolean;
};

const one = async <T>(client: RepairClient, text: string, params: readonly unknown[] = []): Promise<T | undefined> =>
  (await client.query<T>(text, params)).rows[0];

/** عدّادٌ من عمودٍ مُسمّى — فـ`count(*)` يرجع صفًّا واحدًا و`rowCount` لا يعدّ الصفوف. */
const countOf = async (client: RepairClient, text: string, params: readonly unknown[] = []): Promise<number> => {
  const row = await one<{ n: number }>(client, text, params);
  return Number(row?.n ?? 0);
};

/**
 * يقيس الصفوفَ المُثبتَ فبركتُها ويبني خطةَ الإصلاح — **بلا كتابةٍ واحدة**.
 */
export async function planRepairs(client: RepairClient, options: PlanOptions = {}): Promise<RepairPlan> {
  const migration = await one<{ applied_at: string }>(
    client,
    `SELECT applied_at::text FROM erp_migrations WHERE name LIKE $1 ORDER BY applied_at LIMIT 1`,
    [`${FABRICATED.migration.slice(0, 4)}%`],
  );
  const cutoff = migration?.applied_at ?? null;
  if (!cutoff) {
    throw new Error(
      `migration ${FABRICATED.migration} is not applied on this database — the fabricated defaults ` +
        'are still live, so repairing rows now would be re-fabricated by the next insert. Run pnpm db:migrate first.',
    );
  }

  /**
   * شرطُ المنشأة — **بترقيمٍ يُحسب لكلّ استعلام**: فكتابتُه `$3` يدويًّا (كما كانت) تكذب
   * حين يقلّ عددُ الوسائط قبله، ويرفض postgres الاستعلامَ بـ«could not determine data type
   * of parameter $2» — وهو ما كشفه الاختبار لا المراجعة.
   */
  const tenantClause = (nextIndex: number): { sql: string; params: string[] } =>
    options.tenantCode ? { sql: `AND t.code = $${nextIndex}`, params: [options.tenantCode] } : { sql: '', params: [] };
  const repairs: Repair[] = [];
  const reportOnly: ReportOnly[] = [];

  // ١. تكلفةُ المرتجع — الحقيقةُ من إشعاره الدائن بالطريقة نفسها التي يكتبها المسارُ الرسميّ.
  const scope = tenantClause(3);
  const returns = (
    await client.query<Record<string, unknown>>(
      `SELECT d.id::text AS id, t.code AS tenant_code, d.number, d.unit_cost::text AS unit_cost,
              d.net_profit::text AS net_profit, d.sold_qty::text AS sold_qty, d.subtotal::text AS subtotal,
              d.sales_invoice_id::text AS sales_invoice_id, d.reference_document_id::text AS reference_document_id,
              d.created_at::text AS created_at
       FROM van_sales_documents d
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.document_kind = 'return' AND d.deleted_at IS NULL
         AND d.unit_cost = $1::numeric AND d.created_at < $2::timestamptz ${scope.sql}
       ORDER BY d.created_at`,
      [FABRICATED.unitCost, cutoff, ...scope.params],
    )
  ).rows;

  let undiscoverableReturns = 0;
  for (const row of returns) {
    const invoiceId = row.sales_invoice_id ? String(row.sales_invoice_id) : null;
    // ‏`NULLIF` يجعل الكميةَ الصفرية `NULL` فيرجع `NULL` لا قسمةً على صفر — والصفرُ الصادق يُكتب بعده.
    // والمصدرُ `sales_invoice_lines` على الإشعار الدائن وحده (`invoice_id` مفتاحُه)، وهي
    // القراءةُ نفسها التي في `van-sales.service.ts:8078-8084`.
    const measured = invoiceId
      ? await one<{ valuation: string | null; qty: string }>(
          client,
          `SELECT round(SUM(li.cost_total) / NULLIF(SUM(li.quantity), 0), 4)::text AS valuation,
                  COALESCE(SUM(li.quantity), 0)::text AS qty
           FROM sales_invoice_lines li
           WHERE li.invoice_id = $1::uuid`,
          [invoiceId],
        )
      : undefined;
    const discovered = measured?.valuation ?? null;
    if (!discovered) undiscoverableReturns += 1;
    repairs.push({
      category: 'return-unit-cost',
      table: 'van_sales_documents',
      column: 'unit_cost',
      id: String(row.id),
      tenantCode: String(row.tenant_code),
      reference: String(row.number ?? '—'),
      createdAt: String(row.created_at),
      before: String(row.unit_cost),
      after: discovered ?? '0.0000',
      reasonAr: discovered
        ? 'تكلفةُ المرتجع من إشعاره الدائن (‏cost_total ÷ quantity) — وهي الطريقةُ التي يكتبها مسارُ المرتجع اليوم'
        : 'لا إشعارَ دائنًا مُرحَّلًا له ⇒ التكلفةُ مجهولةٌ فصفرٌ صادق (لا رقمَ مخترع)',
      backup: {
        id: row.id,
        tenant_code: row.tenant_code,
        number: row.number,
        unit_cost: row.unit_cost,
        net_profit: row.net_profit,
        sold_qty: row.sold_qty,
        subtotal: row.subtotal,
        sales_invoice_id: row.sales_invoice_id,
        reference_document_id: row.reference_document_id,
        created_at: row.created_at,
      },
    });
  }
  if (undiscoverableReturns > 0) {
    reportOnly.push({
      key: 'return-cost-undiscoverable',
      labelAr: `مرتجعاتٌ لا تُكتشف تكلفتُها (بلا إشعارٍ دائنٍ مُرحَّل) — كُتب لها صفرٌ صادق`,
      count: undiscoverableReturns,
      whyAr: 'لا مصدرَ للرقم: فـ`sales_invoice_lines` على الإشعار الدائن هي الحقيقةُ الوحيدة، وبلاها لا يُخترع رقم',
    });
  }

  // ٢. ‏`batch_code` المفبرك في أمرَي التحميل ومستندات الخطّ — والعمودان nullable فالتفريغُ صادق.
  const loads = (
    await client.query<Record<string, unknown>>(
      `SELECT l.id::text AS id, t.code AS tenant_code, l.number, l.batch_code, l.status,
              l.production_batch_no, l.created_at::text AS created_at
       FROM van_load_orders l
       JOIN tenants t ON t.id = l.tenant_id
       WHERE l.deleted_at IS NULL AND l.batch_code = $1 AND l.created_at < $2::timestamptz ${scope.sql}
       ORDER BY l.created_at`,
      [FABRICATED.batchCode, cutoff, ...scope.params],
    )
  ).rows;
  for (const row of loads) {
    repairs.push({
      category: 'load-batch-code',
      table: 'van_load_orders',
      column: 'batch_code',
      id: String(row.id),
      tenantCode: String(row.tenant_code),
      reference: String(row.number ?? '—'),
      createdAt: String(row.created_at),
      before: String(row.batch_code),
      after: null,
      reasonAr: 'لم يُسمِّ المسارُ دفعةً فأخذ العمودُ افتراضيَّ المخطط — والعمودُ nullable فـ`NULL` هي الصادقة',
      backup: row,
    });
  }

  const docs = (
    await client.query<Record<string, unknown>>(
      `SELECT d.id::text AS id, t.code AS tenant_code, d.number, d.batch_code, d.document_kind,
              d.production_batch_no, d.created_at::text AS created_at
       FROM van_sales_documents d
       JOIN tenants t ON t.id = d.tenant_id
       WHERE d.deleted_at IS NULL AND d.batch_code = $1 AND d.created_at < $2::timestamptz ${scope.sql}
       ORDER BY d.created_at`,
      [FABRICATED.batchCode, cutoff, ...scope.params],
    )
  ).rows;
  for (const row of docs) {
    repairs.push({
      category: 'document-batch-code',
      table: 'van_sales_documents',
      column: 'batch_code',
      id: String(row.id),
      tenantCode: String(row.tenant_code),
      reference: `${String(row.number ?? '—')} (${String(row.document_kind ?? 'sale')})`,
      createdAt: String(row.created_at),
      before: String(row.batch_code),
      after: null,
      reasonAr: 'علامةُ المخطط المفبركة في عمودٍ nullable — و`production_batch_no` المجاور يُترك (‏NOT NULL وقرارُ ٠١٣١)',
      backup: row,
    });
  }

  // ٣. اسمُ الصنف المفبرك في دفعة الإنتاج — يُستبدل باسم الصنف المربوط الحقيقيّ.
  const batches = (
    await client.query<Record<string, unknown>>(
      `SELECT b.id::text AS id, t.code AS tenant_code, b.batch_no, b.item_name, b.item_id::text AS item_id,
              i.name_ar AS item_name_ar, b.produced_qty::text AS produced_qty, b.unit_cost::text AS unit_cost,
              b.total_cost::text AS total_cost, b.status, b.created_at::text AS created_at
       FROM factory_production_batches b
       JOIN tenants t ON t.id = b.tenant_id
       LEFT JOIN items i ON i.id = b.item_id
       WHERE b.deleted_at IS NULL AND b.item_name = $1 AND b.created_at < $2::timestamptz ${scope.sql}
       ORDER BY b.created_at`,
      [FABRICATED.itemName, cutoff, ...scope.params],
    )
  ).rows;
  let nameUndiscoverable = 0;
  for (const row of batches) {
    const real = row.item_name_ar ? String(row.item_name_ar) : null;
    if (!real) {
      nameUndiscoverable += 1;
      continue; // ‏`item_name` NOT NULL (قِيس) فلا يُفرَّغ، وبلا `item_id` لا مصدرَ للاسم ⇒ يُعدّ ويُترك.
    }
    repairs.push({
      category: 'batch-item-name',
      table: 'factory_production_batches',
      column: 'item_name',
      id: String(row.id),
      tenantCode: String(row.tenant_code),
      reference: String(row.batch_no ?? '—'),
      createdAt: String(row.created_at),
      before: String(row.item_name),
      after: real,
      reasonAr: 'اسمُ الصنف الحقيقيّ `items.name_ar` من الربط القائم — لا اسمَ مُخترعًا ولا تفريغ (العمودُ NOT NULL)',
      backup: row,
    });
  }
  if (nameUndiscoverable > 0) {
    reportOnly.push({
      key: 'batch-item-name-undiscoverable',
      labelAr: 'دفعاتُ إنتاجٍ تحمل الاسمَ المفبرك ولا `item_id` لها — تُركت كما هي',
      count: nameUndiscoverable,
      whyAr: 'العمودُ `NOT NULL` فلا يُفرَّغ بصدق، وبلا صنفٍ مربوطٍ لا مصدرَ لاسمٍ حقيقيّ — واستبدالُه باسمٍ آخر اختراع',
    });
  }

  // ٤. (بـ`--fix-batch-cost`) صفٌّ يناقض نفسه: ‏`total_cost / produced_qty <> unit_cost`.
  if (options.fixBatchCost) {
    const costScope = tenantClause(1);
    const inconsistent = (
      await client.query<Record<string, unknown>>(
        `SELECT b.id::text AS id, t.code AS tenant_code, b.batch_no, b.unit_cost::text AS unit_cost,
                b.total_cost::text AS total_cost, b.produced_qty::text AS produced_qty,
                round(b.total_cost / b.produced_qty, 4)::text AS derived, b.created_at::text AS created_at
         FROM factory_production_batches b
         JOIN tenants t ON t.id = b.tenant_id
         WHERE b.deleted_at IS NULL AND b.produced_qty > 0 AND b.total_cost > 0
           AND round(b.total_cost / b.produced_qty, 4) <> round(b.unit_cost, 4) ${costScope.sql}
         ORDER BY b.created_at`,
        [...costScope.params],
      )
    ).rows;
    for (const row of inconsistent) {
      repairs.push({
        category: 'batch-unit-cost-inconsistent',
        table: 'factory_production_batches',
        column: 'unit_cost',
        id: String(row.id),
        tenantCode: String(row.tenant_code),
        reference: String(row.batch_no ?? '—'),
        createdAt: String(row.created_at),
        before: String(row.unit_cost),
        after: String(row.derived),
        reasonAr: 'الصفُّ يناقض نفسه: ‏`total_cost ÷ produced_qty` غيرُ `unit_cost` — وتُشتقّ الوحدةُ من الإجماليّ المُرحَّل',
        backup: row,
      });
    }
  }

  // —— ما يُقاس ويُعلن ولا يُلمس (فلا دليلَ على الفبركة، أو العمودُ لا يقبل الصدق).
  const saleCosts = await countOf(
    client,
    `SELECT count(*)::int AS n FROM van_sales_documents d JOIN tenants t ON t.id = d.tenant_id
     WHERE d.deleted_at IS NULL AND d.document_kind <> 'return'
       AND d.unit_cost = $1::numeric AND d.created_at < $2::timestamptz ${scope.sql}`,
    [FABRICATED.unitCost, cutoff, ...scope.params],
  );
  if (saleCosts > 0) {
    reportOnly.push({
      key: 'sale-unit-cost-3.80',
      labelAr: 'صفوفُ **بيعٍ** (لا مرتجع) تحمل تكلفةً ٣٫٨٠ قبل ٠١٣١ — تُركت',
      count: saleCosts,
      whyAr:
        'مسارُ البيع يكتب `unit_cost` صراحةً من تكلفة الصنف/الدفعة، فقد تكون ٣٫٨٠ حقيقيةً — وهذا الاحتمالُ هو ما أخفى العيبَ في تثبيت القبول. واليقينُ يحتاج مطابقةً صنفًا صنفًا، وهي قرارُ محاسبٍ لا أداة',
    });
  }

  const batchCosts = await countOf(
    client,
    `SELECT count(*)::int AS n FROM factory_production_batches b JOIN tenants t ON t.id = b.tenant_id
     WHERE b.deleted_at IS NULL AND b.unit_cost = $1::numeric AND b.created_at < $2::timestamptz ${scope.sql}`,
    [FABRICATED.unitCost, cutoff, ...scope.params],
  );
  if (batchCosts > 0) {
    reportOnly.push({
      key: 'batch-unit-cost-3.80',
      labelAr: 'دفعاتُ إنتاجٍ تحمل تكلفةَ وحدةٍ ٣٫٨٠ قبل ٠١٣١ — تُركت',
      count: batchCosts,
      whyAr:
        'المسارُ الرسميّ للإنتاج يكتب `unit_cost` و`total_cost` و`cost_basis` صراحةً، فـ٣٫٨٠ هنا إمّا حقيقيةٌ وإمّا من مسارٍ آخر — ولا تُفرَّق إلا بمطابقة. ‏`--fix-batch-cost` تُصلح منها ما يناقض نفسه فقط',
    });
  }

  // ‏`production_batch_no` وحدها وسيطتها العلامةُ فقط (بلا حدٍّ زمنيّ: فالعمودُ ما زال
  // ‏NOT NULL بافتراضيّ «BATCH-DEFAULT» بعد ٠١٣١، فالعدّ هنا كشفٌ لا دليلَ فبركة) ⇒ الترقيم ٢.
  const batchNoScope = tenantClause(2);
  for (const [key, table, labelAr] of [
    ['load-production-batch-no', 'van_load_orders', 'أوامرُ تحميلٍ تحمل `production_batch_no = BATCH-DEFAULT` — تُركت'],
    ['document-production-batch-no', 'van_sales_documents', 'مستنداتُ خطٍّ تحمل `production_batch_no = BATCH-DEFAULT` — تُركت'],
  ] as const) {
    const n = await countOf(
      client,
      `SELECT count(*)::int AS n FROM ${table} x JOIN tenants t ON t.id = x.tenant_id
       WHERE x.deleted_at IS NULL AND x.production_batch_no = $1 ${batchNoScope.sql}`,
      [FABRICATED.batchCode, ...batchNoScope.params],
    );
    if (n > 0) {
      reportOnly.push({
        key,
        labelAr,
        count: n,
        whyAr:
          'العمودُ `NOT NULL` (قِيس) فتفريغُه يكسر الإدراج، و`0131` تركته عمدًا لأنّ المسارَ الرسميّ يكتبه صراحةً — وتفريغُه يحتاج قيمةً بديلةً صادقةً لا يملكها أحد',
      });
    }
  }

  return { cutoff, repairs, reportOnly };
}

/**
 * يكتب الخطةَ في معاملةٍ واحدة، ويتحقّق لكلّ صفٍّ من أنّه **ما زال يحمل القيمةَ التي
 * قِيست** — فإن تغيّر صفٌّ بين التخطيط والكتابة (خادمٌ قائمٌ يكتب) تُلفّ المعاملةُ كلّها
 * ولا يُصلَح نصفُ حالة.
 */
export async function applyRepairs(client: RepairClient, plan: RepairPlan): Promise<{ applied: number; failed: Repair | null }> {
  let applied = 0;
  await client.query('BEGIN');
  try {
    for (const repair of plan.repairs) {
      const result = await writeRepair(client, repair);
      if (result !== 1) {
        await client.query('ROLLBACK');
        return { applied: 0, failed: repair };
      }
      applied += 1;
    }
    await client.query('COMMIT');
    return { applied, failed: null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/** ‏SQL الكتابة لكلّ فئة — بأعمدةٍ قِيست: ‏`van_sales_documents` بلا `updated_at` مثلًا. */
async function writeRepair(client: RepairClient, repair: Repair): Promise<number> {
  switch (repair.category) {
    case 'return-unit-cost': {
      const result = await client.query(
        `UPDATE van_sales_documents SET unit_cost = $1::numeric
         WHERE id = $2::uuid AND document_kind = 'return' AND unit_cost = $3::numeric`,
        [repair.after, repair.id, repair.before],
      );
      return result.rowCount ?? 0;
    }
    case 'load-batch-code': {
      const result = await client.query(
        `UPDATE van_load_orders SET batch_code = NULL, updated_at = now()
         WHERE id = $1::uuid AND batch_code = $2`,
        [repair.id, repair.before],
      );
      return result.rowCount ?? 0;
    }
    case 'document-batch-code': {
      const result = await client.query(
        `UPDATE van_sales_documents SET batch_code = NULL
         WHERE id = $1::uuid AND batch_code = $2`,
        [repair.id, repair.before],
      );
      return result.rowCount ?? 0;
    }
    case 'batch-item-name': {
      const result = await client.query(
        `UPDATE factory_production_batches SET item_name = $1, updated_at = now()
         WHERE id = $2::uuid AND item_name = $3`,
        [repair.after, repair.id, repair.before],
      );
      return result.rowCount ?? 0;
    }
    case 'batch-unit-cost-inconsistent': {
      // الاشتقاقُ في SQL من صفّ الدفعة نفسه — فلا حسابَ عائمةً في JS على رقمٍ محاسبيّ.
      const result = await client.query(
        `UPDATE factory_production_batches
         SET unit_cost = round(total_cost / produced_qty, 4), updated_at = now()
         WHERE id = $1::uuid AND produced_qty > 0 AND unit_cost = $2::numeric
           AND round(total_cost / produced_qty, 4) <> round(unit_cost, 4)`,
        [repair.id, repair.before],
      );
      return result.rowCount ?? 0;
    }
    default:
      return 0;
  }
}

/** يكتب النسخةَ الاحتياطية قبل أيّ كتابةٍ في القاعدة، ويرجع مسارَها. */
export function writeBackup(plan: RepairPlan, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = resolve(dir, `demo-repair-${stamp}.json`);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tool: 'pnpm db:demo-repair',
        migrationCutoff: plan.cutoff,
        note: 'قيمُ الصفوف كما كانت قبل الإصلاح — تُستعمل للإرجاع يدويًّا إن لزم',
        repairs: plan.repairs,
        reportOnly: plan.reportOnly,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return path;
}

type CliOptions = PlanOptions & { apply: boolean; backupDir: string };

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { apply: false, backupDir: '.demo-repair', fixBatchCost: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--fix-batch-cost') options.fixBatchCost = true;
    else if (arg === '--tenant') options.tenantCode = argv[++index];
    else if (arg === '--backup-dir') options.backupDir = argv[++index] ?? options.backupDir;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'pnpm db:demo-repair [--tenant <code>] [--apply] [--fix-batch-cost] [--backup-dir <dir>]',
          '',
          '  (بلا خيارات)  يقيس ويطبع خطةَ الإصلاح — ولا يكتب شيئًا',
          '  --tenant      يضيّق على منشأةٍ برمزها (الافتراضي: المنشآت كلّها)',
          '  --apply       يكتب، في معاملةٍ واحدة، بعد نسخةٍ احتياطية JSON',
          '  --fix-batch-cost  يُصلح أيضًا دفعاتِ الإنتاج التي تناقض نفسها (‏total_cost ÷ produced_qty)',
          '  --backup-dir  مكانُ النسخة (الافتراضي .demo-repair/ — خارج Git)',
        ].join('\n'),
      );
      process.exitCode = 0;
      throw new Error('__help__');
    }
  }
  return options;
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch {
    return; // ‏`--help`
  }

  // ‏`@erp/config` يُستورد **هنا** لا في رأس الملف: فدوالُ التخطيط والكتابة مُصدَّرة من
  // فهرس الحزمة، واستيرادُ البيئة عند التحميل كان يربط كلّ مستوردٍ لـ`@erp/database`
  // (ومنها مثبّتاتٌ لا بيئةَ لها) بملفّ بيئة. والأداةُ وحدها تحتاج اتصالًا.
  const { env } = await import('@erp/config');
  const connectionString = env.DATABASE_MIGRATOR_URL ?? env.DATABASE_URL;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const plan = await planRepairs(client, options);
    console.log(`حدُّ الفبركة: الهجرة ${FABRICATED.migration} طُبّقت في ${plan.cutoff}`);
    console.log(
      options.tenantCode
        ? `منشأة: ${options.tenantCode}`
        : 'منشآت: كلّها (ولكلّ صفٍّ رمزُ منشأته في السجلّ أدناه)',
    );
    console.log('');

    if (plan.repairs.length === 0) {
      console.log('✓ لا صفوفَ مُثبتةَ الفبركة — فلا شيءَ يُصلَح.');
    } else {
      console.log(`خطةُ الإصلاح — ${plan.repairs.length} صفًّا:`);
      for (const repair of plan.repairs) {
        console.log(
          `  [${repair.category}] ${repair.table}.${repair.column} — ${repair.tenantCode} / ${repair.reference}` +
            ` (${repair.id.slice(0, 8)}…, أُنشئ ${repair.createdAt.slice(0, 10)})`,
        );
        console.log(`      ${JSON.stringify(repair.before)} → ${JSON.stringify(repair.after)} — ${repair.reasonAr}`);
      }
    }

    if (plan.reportOnly.length > 0) {
      console.log('');
      console.log('يُعدّ ولا يُصلَح:');
      for (const item of plan.reportOnly) {
        console.log(`  ⚠ [${item.key}] ${item.labelAr}: ${item.count}`);
        console.log(`      لماذا: ${item.whyAr}`);
      }
    }

    if (plan.repairs.length === 0) return;
    console.log('');
    if (!options.apply) {
      console.log(
        'هذا قياسٌ لم يكتب شيئًا. للكتابة: ‏pnpm db:demo-repair --apply' +
          (options.tenantCode ? ` --tenant ${options.tenantCode}` : '') +
          (options.fixBatchCost ? ' --fix-batch-cost' : ''),
      );
      return;
    }

    const backupPath = writeBackup(plan, options.backupDir);
    console.log(`نسخةٌ احتياطية: ${backupPath}`);
    const result = await applyRepairs(client, plan);
    if (result.failed) {
      console.error(
        `✗ تغيّر الصفُّ ${result.failed.table} ${result.failed.id} (${result.failed.column}) بين القياس والكتابة ` +
          '— فلُفّت المعاملةُ كلّها ولم يُكتب شيء. أعِد القياس.',
      );
      process.exitCode = 1;
      return;
    }
    console.log(`✓ أُصلح ${result.applied} صفًّا في معاملةٍ واحدة. والنسخةُ الاحتياطية في ${backupPath}`);
  } finally {
    await client.end();
  }
}

/** يُشغَّل عند التنفيذ المباشر فقط — فتستورد الاختباراتُ الدوالَ بلا تشغيلِ الأداة. */
const entryScript = process.argv[1] ?? '';
const isDirectRun = entryScript !== '' && fileURLToPath(import.meta.url) === resolve(entryScript);
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
