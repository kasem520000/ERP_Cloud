-- ACC-105 / MF-08 (خطة MISSING_FEATURES — المرحلة 0 «تثبيت الدفاتر»):
-- 1) تاريخ استحقاق حقيقي على فواتير البيع والشراء (كان العمر يُحسب من تاريخ القيد دائماً).
-- 2) مدة سدادٍ وحظرٌ ائتماني في بطاقة الطرف (كان الحقل مبعثرًا في «طريقة الدفع» فقط).
-- التعبئة الرجعية للفواتير القائمة: «تاريخ الوثيقة + أيام طريقة دفع الطرف» كما في بطاقة
-- MF-08؛ من بلا طريقة مُعرَّفة يبقى NULL فيُحسب عمره من تاريخ القيد — سلوك الأعمار لا يتغير.

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS payment_terms_days integer;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS credit_hold boolean NOT NULL DEFAULT false;

UPDATE sales_invoices d
   SET due_date = coalesce(d.posted_at, d.created_at)::date + pm.due_days
  FROM parties p
  JOIN payment_methods pm ON pm.id = p.payment_method_id AND pm.tenant_id = p.tenant_id
 WHERE d.due_date IS NULL
   AND d.tenant_id = p.tenant_id
   AND d.party_id = p.id
   AND pm.due_days > 0;

UPDATE purchase_invoices d
   SET due_date = coalesce(d.posted_at, d.created_at)::date + pm.due_days
  FROM parties p
  JOIN payment_methods pm ON pm.id = p.payment_method_id AND pm.tenant_id = p.tenant_id
 WHERE d.due_date IS NULL
   AND d.tenant_id = p.tenant_id
   AND d.party_id = p.id
   AND pm.due_days > 0;
