-- 0131_van_sales_honest_defaults.down.sql
--
-- ⚠️ ما يُفقد عند التراجع: **لا بيانات**. الأوامرُ الخمسة تُعيد القيمَ الافتراضية إلى ما
--    كانت عليه، ولا تلمس صفًّا قائمًا: فالصفوفُ التي كُتبت بين التطبيق والتراجع تحمل ما
--    كُتب فيها فعلًا (‏`unit_cost = 0` لمرتجعٍ لم يعرف تكلفته، و`batch_code = NULL` لأمر
--    تحميل)، وتبقى كما هي بعد التراجع — فلا يُفقد مالٌ ولا مخزونٌ ولا تدقيق.
--
-- وما يُفقد هو **الحماية**: بعد التراجع يعود كلّ إدراجٍ لا يُسمّي `unit_cost` في مستندات
--    التوزيع إلى كتابة تكلفةٍ مفبركة ٣.٨٠ (ومسارُ المرتجع كان كذلك قبل ٠١٣١)، ويعود
--    `factory_production_batches.item_name` إلى اختراع «رقائق سمبوسة وفطائر طازجة» لمنشأةٍ
--    لا تبيعها، ويعود `batch_code` إلى 'BATCH-DEFAULT' في كلّ أمر تحميل. أي أنّ التراجع
--    قرارُ بياناتٍ لا قرارُ تشغيل: فلا شاشةَ تنكسر ولا عقدَ يُكسر — لأنّ مسارَي الإدراج
--    الرسميَّين في `van-sales.service.ts` (وبعد إصلاح ٠١٣١ في الكود: `createReturnDocument`
--    يكتب التكلفةَ الرسمية) لا يعتمدان على هذه الافتراضيات في صحّتهما.
--
--    والتراجعُ يعيد الأرقامَ **بالحرف** كما قِيست في `information_schema.columns` قبل
--    الهجرة (‏3.80 / 3.80 / 'رقائق سمبوسة وفطائر طازجة' / 'BATCH-DEFAULT' / 'BATCH-DEFAULT')،
--    فلا يُترك عمودٌ بلا افتراضيّ كان له واحد.

ALTER TABLE van_sales_documents ALTER COLUMN unit_cost SET DEFAULT 3.80;
ALTER TABLE factory_production_batches ALTER COLUMN unit_cost SET DEFAULT 3.80;
ALTER TABLE factory_production_batches ALTER COLUMN item_name SET DEFAULT 'رقائق سمبوسة وفطائر طازجة';
ALTER TABLE van_load_orders ALTER COLUMN batch_code SET DEFAULT 'BATCH-DEFAULT';
ALTER TABLE van_sales_documents ALTER COLUMN batch_code SET DEFAULT 'BATCH-DEFAULT';
