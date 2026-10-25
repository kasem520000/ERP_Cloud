-- 0154_tax_groups_and_tenant_provisioning_backfill.sql
--
-- 1) توحيد المجموعات الضريبية الافتراضية («ضريبة القيمة المضافة» = 15%، «ضريبة صفرية» = 0%).
-- 2) استكمال تهيئة المنشآت القائمة (غير منشأة المنصة الداخلية `platform`) التي أُنشئت
--    سابقاً بلا سنة/فترات مالية مفتوحة أو بلا تصنيف «مجموعة عامة» أو وحدات قياس أساسية
--    أو طرق دفع أساسية، حتى تعمل فواتيرها وسنداتها دون خطأ FISCAL_PERIOD_NOT_FOUND.
-- 3) تفعيل التسجيل الذاتي `platform.self_signup = true` افتراضياً عند وجود منشأة `platform`
--    ما لم يكن المشغّل قد ضبطه صراحةً من لوحة المنصة.

DO $$
DECLARE
  rec RECORD;
  v_year int := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_today date := CURRENT_DATE;
  v_fy_id uuid;
  v_month int;
  v_label text;
  v_pstart date;
  v_pend date;
  v_vat_acc uuid;
  v_cash_loc uuid;
  v_has_active boolean;
BEGIN
  -- تفعيل التسجيل الذاتي في بيئات التشغيل المهيّأة إن لم يُضبط بعد
  IF EXISTS (SELECT 1 FROM tenants WHERE code = 'platform') THEN
    INSERT INTO platform_settings (id, tenant_id, key, value)
    SELECT gen_random_uuid(), NULL, 'platform.self_signup', 'true'::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM platform_settings WHERE tenant_id IS NULL AND key = 'platform.self_signup'
    );
  END IF;

  -- معالجة المنشآت المهيّأة فعلياً (التي تملك دليل حسابات وليست منشأة `platform`)
  FOR rec IN
    SELECT t.id AS tenant_id, t.code
      FROM tenants t
     WHERE t.code <> 'platform'
       AND EXISTS (SELECT 1 FROM accounts a WHERE a.tenant_id = t.id AND a.deleted_at IS NULL)
  LOOP
    PERFORM set_config('app.tenant_id', rec.tenant_id::text, true);

    SELECT a.id INTO v_vat_acc
      FROM accounts a
     WHERE a.tenant_id = rec.tenant_id AND a.code = '2222001' AND a.deleted_at IS NULL
     LIMIT 1;

    -- توحيد تسمية المجموعة الافتراضية 15% و 0% إن وجدت بالتسميات القديمة في demo
    UPDATE tax_groups
       SET name_ar = 'ضريبة القيمة المضافة',
           name_en = COALESCE(NULLIF(name_en, ''), 'VAT 15%'),
           vat_account_id = COALESCE(vat_account_id, v_vat_acc),
           updated_at = now()
     WHERE tenant_id = rec.tenant_id
       AND deleted_at IS NULL
       AND name_ar = 'ضريبة القيمة المضافة 15%'
       AND NOT EXISTS (
         SELECT 1 FROM tax_groups tg2
          WHERE tg2.tenant_id = rec.tenant_id
            AND tg2.deleted_at IS NULL
            AND tg2.name_ar = 'ضريبة القيمة المضافة'
       );

    UPDATE tax_groups
       SET name_ar = 'ضريبة صفرية',
           name_en = 'Zero VAT 0%',
           updated_at = now()
     WHERE tenant_id = rec.tenant_id
       AND deleted_at IS NULL
       AND name_ar = 'معفاة من الضريبة'
       AND rate = 0
       AND NOT EXISTS (
         SELECT 1 FROM tax_groups tg2
          WHERE tg2.tenant_id = rec.tenant_id
            AND tg2.deleted_at IS NULL
            AND tg2.name_ar = 'ضريبة صفرية'
       );

    -- ضمان وجود ضريبة القيمة المضافة 15% وضريبة صفرية 0%
    IF NOT EXISTS (
      SELECT 1 FROM tax_groups
       WHERE tenant_id = rec.tenant_id AND deleted_at IS NULL AND rate = 15
    ) THEN
      INSERT INTO tax_groups (id, tenant_id, name_ar, name_en, rate, vat_account_id, is_inclusive_default)
      VALUES (gen_random_uuid(), rec.tenant_id, 'ضريبة القيمة المضافة', 'VAT 15%', 15.0000, v_vat_acc, false);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM tax_groups
       WHERE tenant_id = rec.tenant_id AND deleted_at IS NULL AND rate = 0
    ) THEN
      INSERT INTO tax_groups (id, tenant_id, name_ar, name_en, rate, vat_account_id, is_inclusive_default)
      VALUES (gen_random_uuid(), rec.tenant_id, 'ضريبة صفرية', 'Zero VAT 0%', 0.0000, NULL, false);
    END IF;

    -- ضمان وجود مجموعة عامة إن لم توجد أي مجموعة أصناف
    IF NOT EXISTS (
      SELECT 1 FROM item_categories WHERE tenant_id = rec.tenant_id AND deleted_at IS NULL
    ) THEN
      INSERT INTO item_categories (id, tenant_id, code, name_ar, name_en, sort_order, show_in_pos, show_in_sale, show_in_purch)
      VALUES (gen_random_uuid(), rec.tenant_id, 'GEN', 'مجموعة عامة', 'General Group', 1, true, true, true);
    END IF;

    -- ضمان الوحدات الأساسية إن لم توجد وحدات بعد
    IF NOT EXISTS (
      SELECT 1 FROM units_of_measure WHERE tenant_id = rec.tenant_id AND deleted_at IS NULL
    ) THEN
      INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en) VALUES
        (gen_random_uuid(), rec.tenant_id, 'PCS', 'حبة', 'Piece'),
        (gen_random_uuid(), rec.tenant_id, 'CTN', 'كرتون', 'Carton'),
        (gen_random_uuid(), rec.tenant_id, 'BOX', 'علبة', 'Box'),
        (gen_random_uuid(), rec.tenant_id, 'KG', 'كيلوجرام', 'Kilogram'),
        (gen_random_uuid(), rec.tenant_id, 'LTR', 'لتر', 'Litre'),
        (gen_random_uuid(), rec.tenant_id, 'MTR', 'متر', 'Meter');
    END IF;

    -- ضمان سنة مالية و12 فترة مفتوحة تغطي تاريخ اليوم إن غابت
    SELECT fy.id INTO v_fy_id
      FROM fiscal_years fy
     WHERE fy.tenant_id = rec.tenant_id
       AND fy.start_date <= v_today
       AND fy.end_date >= v_today
     LIMIT 1;

    IF v_fy_id IS NULL THEN
      v_fy_id := gen_random_uuid();
      INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date, status)
      VALUES (v_fy_id, rec.tenant_id, v_year::text, make_date(v_year, 1, 1), make_date(v_year, 12, 31), 'open');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM fiscal_periods fp WHERE fp.tenant_id = rec.tenant_id AND fp.is_active = true
    ) INTO v_has_active;

    FOR v_month IN 1..12 LOOP
      v_label := v_year::text || '-' || lpad(v_month::text, 2, '0');
      v_pstart := make_date(v_year, v_month, 1);
      v_pend := (v_pstart + interval '1 month - 1 day')::date;
      IF NOT EXISTS (
        SELECT 1 FROM fiscal_periods fp
         WHERE fp.tenant_id = rec.tenant_id AND fp.fiscal_year_id = v_fy_id AND fp.name = v_label
      ) THEN
        INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, start_date, end_date, status, is_active)
        VALUES (
          gen_random_uuid(),
          rec.tenant_id,
          v_fy_id,
          v_label,
          v_pstart,
          v_pend,
          'open',
          (NOT v_has_active AND v_month = EXTRACT(MONTH FROM v_today)::int)
        );
        IF NOT v_has_active AND v_month = EXTRACT(MONTH FROM v_today)::int THEN
          v_has_active := true;
        END IF;
      END IF;
    END LOOP;

    -- ضمان طرق الدفع الأساسية إن لم توجد بعد
    IF NOT EXISTS (
      SELECT 1 FROM payment_methods pm WHERE pm.tenant_id = rec.tenant_id AND pm.deleted_at IS NULL
    ) THEN
      SELECT cl.id INTO v_cash_loc
        FROM cash_locations cl
       WHERE cl.tenant_id = rec.tenant_id AND cl.kind = 'safe' AND cl.is_default = true AND cl.deleted_at IS NULL
       LIMIT 1;

      INSERT INTO payment_methods (id, tenant_id, code, name_ar, name_en, kind, due_days, cash_location_id, is_active, is_default)
      VALUES
        (gen_random_uuid(), rec.tenant_id, 'CASH', 'نقدي', 'Cash', 'cash', 0, v_cash_loc, true, true),
        (gen_random_uuid(), rec.tenant_id, 'CARD', 'بطاقة / شبكة', 'Card / Network', 'card', 0, NULL, true, false),
        (gen_random_uuid(), rec.tenant_id, 'TRANSFER', 'تحويل بنكي', 'Bank transfer', 'transfer', 0, NULL, true, false),
        (gen_random_uuid(), rec.tenant_id, 'CREDIT', 'آجل', 'Credit', 'credit', 30, NULL, true, false);
    END IF;
  END LOOP;
END $$;
