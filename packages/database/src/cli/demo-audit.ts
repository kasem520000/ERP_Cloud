import { Client } from 'pg';
import { env } from '@erp/config';

/**
 * `pnpm db:demo-audit` — **قراءةٌ فقط**: ما في القاعدة من بياناتٍ لا تصلح أن تُرى في
 * إنتاج، بأرقامٍ لا بانطباعات.
 *
 * لماذا أداةٌ ولا اجتهاد: فشكوى «هناك بياناتٌ تظهر في الشاشات لا تصلح للإنتاج» تُجاب
 * بقياسٍ على القاعدة نفسها، لا بقائمةٍ من الذاكرة. والأداةُ لا تكتب ولا تحذف ولا تُصلح
 * — فتنظيفُ صفوفٍ تحمل أرقامًا قرارُ صاحبِ العمل (وقد يكون الرقمُ ٣٫٨٠ تكلفةً حقيقيةً
 * لصنفٍ اسمه كذلك)، وما هنا كشفٌ يُقرأ ثم يُقرَّر.
 *
 * والفئاتُ الستّ مقاسةٌ على مصادرَ معلومة لا مُخمَّنة:
 *   ١. هويةُ المنشأة الوهمية في `company_profiles` — الرقمُ الضريبيّ والسجلّ والهاتف
 *      والبريد تُطبع في الفاتورة وفي مستند ZATCA، وهي من `seed-demo.ts:449-462`.
 *   ٢. الأطرافُ العامة («عميل عام»/«مورد عام») من `seed-demo.ts:550,562`.
 *   ٣. قيدُ الافتتاح (٢٥٠٠٠٠ رأسُ مالٍ في الصندوق والبنك والأصول) من `seedOpeningEntry`.
 *   ٤. اشتراكٌ مُفعَّل يدويًّا (`provider = 'manual'`) — باقةٌ بلا شراء.
 *   ٥. صفوفٌ تحمل القيمَ الافتراضية المفبركة التي أسقطتها الهجرة ٠١٣١: ‏`unit_cost = 3.80`
 *      في مستندات الخطّ (وكانت تُكتب في **كلّ مرتجع** لأنّ `createReturnDocument` لا
 *      يُسمّي العمود)، و`batch_code = 'BATCH-DEFAULT'` في أوامر التحميل والمستندات، و
 *      `item_name = 'رقائق سمبوسة وفطائر طازجة'` في دفعات الإنتاج. والهجراتُ لا تُعيد
 *      كتابة الصفوف، فمَن هاجَر قبل ٠١٣١ يحملها.
 *   ٦. دفعاتُ إنتاجٍ أو مستنداتُ خطٍّ بتكلفةٍ صفر بعد ٠١٣١ — وهي صادقةٌ («لا أعرف»)
 *      لكنها تُقرأ في تقرير الربح صفرًا، فتُعرض هنا لتُقرَّر لا لتُخفى.
 */
type Finding = {
  key: string;
  labelAr: string;
  count: number;
  whereAr: string;
  sample: string;
};

async function main(): Promise<void> {
  const tenantCode = process.env.AUDIT_TENANT_CODE ?? process.env.DEMO_TENANT_CODE ?? 'demo';
  const connectionString = env.DATABASE_MIGRATOR_URL ?? env.DATABASE_URL;
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const tenant = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM tenants WHERE code = $1`,
      [tenantCode],
    );
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) {
      console.error(`Tenant "${tenantCode}" does not exist.`);
      process.exitCode = 1;
      return;
    }
    await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    console.log(`منشأة: ${tenant.rows[0]?.name ?? tenantCode} (‏${tenantCode})`);
    console.log('');

    const findings: Finding[] = [];
    const add = async (
      key: string,
      labelAr: string,
      whereAr: string,
      sqlText: string,
      params: unknown[] = [],
      sampleOf: (row: Record<string, unknown>) => string = () => '',
    ): Promise<void> => {
      const result = await client.query<Record<string, unknown>>(sqlText, [tenantId, ...params]);
      /**
       * العددُ من العمود `n` لا من `rowCount`: فاستعلامُ `SELECT count(*)` يُعيد **صفًّا
       * واحدًا**، و`rowCount` إذن يساوي ١ دائمًا — وهذا خطأُ قياسٍ كان سيقول «صفٌّ واحد»
       * عن فئةٍ فيها مئةُ صفّ (وعن قاعدةٍ فارغةٍ تمامًا، كما قِيس هنا قبل التصحيح:
       * الفئاتُ الأربع الأخيرة قالت ١ ولا مستندَ خطٍّ واحد في البذرة).
       */
      const row = result.rows[0] as Record<string, unknown> | undefined;
      const counted = Number(row?.n ?? 0);
      findings.push({
        key,
        labelAr,
        whereAr,
        count: Number.isFinite(counted) ? counted : (result.rowCount ?? 0),
        sample: row ? sampleOf(row) : '',
      });
    };

    // ١. هويةُ المنشأة
    await add(
      'identity',
      'هويةُ منشأةٍ من بذرة العرض (رقمٌ ضريبيّ/سجلّ/هاتف/بريد)',
      'تُطبع في الفاتورة وفي مستند ZATCA وفي إعدادات اللوحة',
      `SELECT count(*)::int AS n,
              min(tax_no) AS tax_no, min(cr_no) AS cr_no,
              min(phones::text) AS phones, min(email) AS email, min(name_en) AS name_en
       FROM company_profiles
       WHERE tenant_id = $1::uuid
         AND (tax_no IN ('300000000000003', '') OR tax_no IS NULL
              OR cr_no IN ('1010000000', '') OR cr_no IS NULL
              OR email LIKE '%@demo.test' OR name_en = 'Demo Trading Co.')`,
      [],
      (row) =>
        `tax_no=${String(row.tax_no ?? '—')} cr_no=${String(row.cr_no ?? '—')} email=${String(row.email ?? '—')} name_en=${String(row.name_en ?? '—')}`,
    );

    // ٢. الأطراف العامة
    await add(
      'parties',
      'أطرافٌ عامة من البذرة («عميل عام»/«مورد عام»)',
      'قوائمُ العملاء والموردين في البيع والتحصيل والمشتريات',
      `SELECT count(*)::int AS n, string_agg(DISTINCT name, '، ') AS names
       FROM parties WHERE tenant_id = $1::uuid AND deleted_at IS NULL
         AND (code IN ('CUST-GEN','SUPP-GEN') OR name IN ('عميل عام','مورد عام'))`,
      [],
      (row) => String(row.names ?? ''),
    );

    // ٣. قيد الافتتاح
    await add(
      'opening',
      'قيودُ افتتاحٍ من البذرة (٢٥٠٠٠٠ رأسُ مالٍ موزّعة)',
      'ميزانُ المراجعة وقائمةُ المركز الماليّ وأرصدةُ الحسابات',
      // العلامةُ `idempotency_key` لا الوصف: فالبذرةُ تكتب `seed:opening:<date>`
      // (‏`seed-demo.ts` — `seedOpeningEntry`)، والوصفُ نصٌّ قابلٌ للتغيير. والأطرافُ
      // `debit + credit` فالجدولُ لا عمودَ `amount` فيه (قِيس على `information_schema`).
      `SELECT count(*)::int AS n, min(e.number) AS number,
              min((SELECT sum(l.debit + l.credit) FROM journal_entry_lines l
                    WHERE l.entry_id = e.id)::text) AS amount
       FROM journal_entries e
       WHERE e.tenant_id = $1::uuid AND e.idempotency_key LIKE 'seed:opening:%'`,
      [],
      (row) => `${String(row.number ?? '—')} · مجموعُ الأطراف ${String(row.amount ?? '—')}`,
    );

    // ٤. الاشتراك
    await add(
      'subscription',
      'اشتراكٌ مُفعَّل يدويًّا (بلا عملية شراء)',
      'شاشةُ الفوترة في منصة الإدارة، وحسابُ الاستحقاق',
      `SELECT count(*)::int AS n, min(p.code) AS plan, min(s.current_period_end::date::text) AS until
       FROM tenant_subscriptions s LEFT JOIN billing_plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1::uuid AND s.provider = 'manual' AND s.status = 'active'`,
      [],
      (row) => `${String(row.plan ?? '—')} حتى ${String(row.until ?? '—')}`,
    );

    // ٥. القيمُ الافتراضية المفبركة (قبل الهجرة ٠١٣١)
    await add(
      'fabricated-cost',
      'مستنداتُ خطٍّ بتكلفةِ الافتراضيّ المفبرك ٣٫٨٠',
      'تكلفةُ المرتجع وربحُه في تقارير الخطّ (وكان كلّ مرتجعٍ يحملها)',
      `SELECT count(*)::int AS n, min(document_kind) AS kind, min(number) AS number
       FROM van_sales_documents
       WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND unit_cost = 3.80`,
      [],
      (row) => `${String(row.kind ?? '—')} · ${String(row.number ?? '—')}`,
    );
    await add(
      'fabricated-batch',
      'صفوفٌ برقمِ تجربةٍ `BATCH-DEFAULT`',
      'أوامرُ التحميل ومستنداتُ الخطّ (العمودُ لا تقرأه شاشةٌ اليوم، لكنه حقيقةٌ مكتوبة)',
      `SELECT (SELECT count(*) FROM van_load_orders
                WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND batch_code = 'BATCH-DEFAULT')
             + (SELECT count(*) FROM van_sales_documents
                WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND batch_code = 'BATCH-DEFAULT') AS n`,
      [],
      () => '',
    );
    await add(
      'fabricated-item',
      'دفعاتُ إنتاجٍ باسم الصنف المفبرك «رقائق سمبوسة وفطائر طازجة» أو بتكلفة ٣٫٨٠',
      'تقريرُ الإنتاج وتكلفةُ الدفعة — لمنشأةٍ قد لا تبيع السمبوسة أصلًا',
      `SELECT count(*)::int AS n, min(batch_no) AS batch_no
       FROM factory_production_batches
       WHERE tenant_id = $1::uuid AND deleted_at IS NULL
         AND (item_name = 'رقائق سمبوسة وفطائر طازجة' OR unit_cost = 3.80)`,
      [],
      (row) => String(row.batch_no ?? ''),
    );

    // ٦. تكلفةٌ صفرية (صادقة لكنها تُقرأ صفرًا في الربح)
    await add(
      'zero-cost',
      'مستنداتُ خطٍّ بتكلفةٍ صفر (بعد إسقاط الافتراضيّ المفبرك)',
      'هامشُ الربح في تقارير الخطّ — صفرٌ صادقٌ أم ناقص؟',
      `SELECT count(*)::int AS n, min(document_kind) AS kind
       FROM van_sales_documents
       WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND unit_cost = 0`,
      [],
      (row) => String(row.kind ?? '—'),
    );

    let unfit = 0;
    for (const finding of findings) {
      unfit += finding.count;
      const mark = finding.count > 0 ? '⚠' : '✓';
      console.log(`${mark} [${finding.key}] ${finding.labelAr}: ${finding.count}`);
      if (finding.count > 0) {
        console.log(`    أين تظهر: ${finding.whereAr}`);
        if (finding.sample) console.log(`    عيّنة: ${finding.sample}`);
      }
    }
    console.log('');
    console.log(
      unfit === 0
        ? 'لا صفوفَ من الفئات الستّ — فلا شيءَ هنا يحتاج قرارًا.'
        : `المجموع: ${unfit} صفًّا/سجلًّا من الفئات الستّ. ولا شيءَ يُحذف هنا: فتنظيفُها قرارٌ (وبعضُها أرقامٌ محاسبية) — والكشفُ للقراءة فقط.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
