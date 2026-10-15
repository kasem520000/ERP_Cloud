-- 0130_sector_licence_usage_index.sql
--
-- 🏪 قياسُ الاستعمال غير المرخّص يُقرأ الآن **من مستوى المنصّة**، لا من داخل منشأةٍ واحدة.
--
-- ما كان قائماً: `SectorLicenceGuard` في وضع `observe` يكتب سطراً `sector_licence.unlicensed_use`
-- في `audit_log` لكلّ **كتابةٍ** من منشأةٍ بلا باقة (لا للقراءات، فلا شاشةٌ تُستطلع كل ثلاثين
-- ثانية تُغرق السجل)، و`apps/api/test/sector-licence-enforcement.spec.ts` يقيس ذلك. لكنّ كلّ
-- فهارس `audit_log` القائمة تبدأ بـ`tenant_id` (‏`0001_platform_services.sql`)
-- (‏`audit_log_tenant_entity_idx` و`audit_log_tenant_created_at_idx` و`audit_log_tenant_actor_idx`)
-- لأنها تخدم سؤال منشأةٍ عن سجلّها هي — وسؤالُ المنصّة معكوس: «أيّ المنشآت تستعمل سطحاً بلا
-- ترخيص؟» وهو تجميعٌ **عبر المنشآت** على `action` وحده. وبلا فهرسٍ يقود به كان ذلك التجميع
-- مسحاً متسلسلاً لأكبر جدولٍ إلحاقيّ في النظام (‏`audit_log` ممنوعٌ عنه UPDATE وDELETE وTRUNCATE
-- لدور `erp_api`، فهو ينمو ولا يتقلّص).
--
-- فجاء الفهرس **جزئياً**: لا يحمل إلا صفوف القياس نفسه، فيبقى متناسباً مع عدد الكتابات غير
-- المرخّصة لا مع حجم السجلّ كله — وهو صغيرٌ بحكم بنائه: يتوقّف عن النمو لحظةَ تقلب المنصةُ
-- السطحَ إلى `enforce`، لأنّ الحارس عندها يرفض 403 قبل أن يكتب قياساً.
--
-- ⚠️ ملاحظة تطبيقٍ على إنتاج: الهجرات تُنفَّذ داخل معاملة واحدة (`runMigrations` في
-- ‏`packages/database/src/migrate.ts` تُغلّف كل ملفٍّ بـBEGIN/COMMIT)، فـ`CREATE INDEX CONCURRENTLY` غير متاحٍ هنا، وهذا الأمر يأخذ
-- قفل SHARE على `audit_log` مدّةَ بنائه — أي أنّ كتابات التدقيق تتوقّف حتى ينتهي. على قاعدةٍ
-- فيها سجلٌّ كبير يُبنى الفهرس نفسه يدوياً بـ`CONCURRENTLY` في نافذة صيانةٍ **قبل** تشغيل
-- الهجرة، و`IF NOT EXISTS` يجعلها عندها بلا أثر. ولا يُبنى بـ`CONCURRENTLY` داخل هذه الهجرة
-- لأنها ستفشل حتماً (‏25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block).

CREATE INDEX IF NOT EXISTS audit_log_sector_licence_use_idx
  ON audit_log (created_at, tenant_id)
  WHERE action = 'sector_licence.unlicensed_use';
