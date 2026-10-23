# CONTINUITY R33 — حالة الإصلاح الكودي الشامل ونقطة الاستئناف

**الفرع:** `arena/0e400dd3-erp-cloud`. **آخر دفعة موثَّقة:** انظر `git log -1` (التقرير: `REMEDIATION_R33.md`).
**القاعدة:** كل تعديل كود يُثبَت بإعادة تنفيذ (فاحص حي على بذرة معزولة + vitest) ثم يُلتزم ويُدفع فوراً. لا إصلاح ببيانات أو قيود تسوية.

## 1. ما أُنجز في R33 (ملخص؛ التفصيل في `REMEDIATION_R33.md`)
- 19 من الـ20 عيباً المفتوحة بعد R32 مُصلَحة ومُثبَتة حياً؛ ACC-141 توثيق فقط (MF-46).
- 9 عيوب جديدة ACC-172…180 مُصلَحة (177/178/180 بالاختبارات فقط — تحتاج فاحصاً حياً).
- فاحصات حيّة على بذرة 11: probe1 68/68 (RUN 18)، probe2 46/46 (RUN 19)، probe3 48/48 (RUN 18).
- 12 قرار سياسة بالتفويض مع موضع العكس (`REMEDIATION_R33.md` §4).
- **vitest الكامل على `c761688`:** 534 ملفاً / 2038 اختباراً — **1974 ✓ / 39 ✗ / 25 معلّق** (الأساس `0a9dc57`: 46 ✗). الـ39: 38 فشلاً قديماً من الأساس في 16 ملفاً لا تخص عيوب الجولات (القائمة في §6) + `remediation-phase1` (رعشة توقيت في اختبار التزامن ACC-025 — عُدِّل ليقبل 201/201 idempotent مع قيد واحد).

## 2. البيئة (التهيئة 12 — بذرة 12) — إعادة البناء عند الحاجة
1. العلامة أن البيئة أُعيدت تهيئتها: `git log -1` = `54171c6` و`git status` يُظهر `?? docs/accounting-audit/` ولا يوجد `/home/user/.bin` ولا `.env`.
2. الوصفة: `git fetch origin +refs/heads/arena/0e400dd3-erp-cloud:refs/remotes/origin/arena/0e400dd3-erp-cloud && rm -rf docs/accounting-audit && git reset --hard origin/arena/0e400dd3-erp-cloud` → `mkdir -p /home/user/.bin /home/user/.corepack; COREPACK_HOME=/home/user/.corepack corepack enable --install-directory /home/user/.bin; corepack prepare pnpm@9.15.0 --activate` → `export PATH=/home/user/.bin:$PATH COREPACK_HOME=/home/user/.corepack` → `pnpm install --frozen-lockfile` → `pnpm -r --filter "./packages/*" build` → `node scripts/setup-env.mjs` → `sed -i 's/^DEMO_TENANT_NAME=.*/DEMO_TENANT_NAME=AUDIT-TEST-2026-R24/' .env` (قبل البذرة فيأخذه الـseed) → start_process `DB_LOCAL_PERSIST=true DB_LOCAL_DATA_DIR=/home/user/.pgdata-r33 node scripts/local-db.mjs` → `pnpm db:migrate` (142) → `pnpm db:seed` → `cd apps/api && pnpm build` → start_process `node dist/main.js` → `R33_RUN=NN … round33-bootstrap.cjs`.
3. **لا تُصدِّر `.env` بـ`set -a`** (يكسر `JWT_PRIVATE_KEY`). API من `dist`: تعديل `src` بلا `pnpm build` + إعادة تشغيل لا أثر له.
4. `/tmp/q.cjs "<sql>"` أداة استعلام (تُمحى مع التهيئة؛ تُعاد كتابتها: pg من `node_modules/.pnpm/node_modules/pg` عبر `DATABASE_MIGRATOR_URL` من `.env`).
5. الفاحصات: `R33_RUN=NN R32_OUT=$PWD/docs/accounting-audit/evidence/round-33 node docs/accounting-audit/scripts/round33-probe{1,2,3}.cjs | grep -v ^Snapshot` — السطر الختامي «R33 probe N: X/Y PASS». آخر RUN مستعمل **20** (bootstrap بذرة 12) → التالي 21. probe2 يختار أول شهر حر من (2026-11, 2026-12).

## 3. اختبارات `apps/api`
- أمر ملف: `cd apps/api && timeout 900 npx vitest run test/<file>.spec.ts 2>&1 | grep -E "✓|×|Tests |spec.ts:[0-9]+:"`.
- الكامل: `npx vitest run --reporter=json --outputFile=/tmp/vitest-r33.json` (~20 دقيقة؛ يطبع لوج Postgres؛ شغّله بـstart_process).
- اختبارات التزامن (ACC-025 وأمثالها) قد ترتعش تحت حمل التشغيل الكامل — أعد الملف منفرداً قبل الحكم.

## 4. أفخاخ معروفة (لا تُكرَّر)
- حارس `ACCOUNT_NOT_POSTABLE` يرفض أي اختيار «أول حساب بالاسم» على رأس تجميعي (`1`, `4`, `122`, `123`, `224`) — رشّح بـ`isPostable`.
- `payment_allocations.party_id NOT NULL` — فاتورة عميل نقدي: حدّث `paid_total` فقط.
- `POST /van-sales/*` يعيد لوحة كاملة لا المستند → المعرّفات من DB. approve بـ`settleStockAdjustment:false` يحجب السيارة 409 حتى `settle-stock`.
- قياس الأساس بـ`git checkout 0a9dc57 -- apps/api/src` مع test/الحزم الحالية غير موثوق.
- `snapshot()` يرفض اسماً موجوداً → RUN جديد لكل تشغيلة. `stop_process` يعيد لوجاً ضخماً؛ `/tmp/q.cjs` يقصّ عند 6000 حرف.

## 5. الخطوات التالية المقترحة (بالترتيب)
1. فرز الـ38 فشلاً القديم (§6): لكل ملف — اختبار قديم يخالف سياسة مدمجة (يُحدَّث مع التوثيق) أم عيب حقيقي (يُصلَح الكود + معرّف جديد).
2. فاحص حي لـACC-177 (مقاولات)، ACC-178 (دفعة بلا `batchNo` ثم تحميل وبيع)، ACC-180 (بيع بطاقة على فاتورة عميل نقدي) — Block U في probe3.
3. جولة تحقق للـ152 معرّفاً NOT-RETESTED (أولوية: التصنيع/الخياطة/الأصول/التقارير التفصيلية).
4. جولة UI (staff + bakery) بلقطات حقيقية للمسارات التي تغيّر سلوك API فيها.
5. تنفيذ MF-45 (إلغاء مسودة مسيّر) وMF-46 (مسودة القيد اليدوي — بعد قرار المالك).

## 6. الفشل القديم المتبقّي في vitest (من الأساس `0a9dc57`؛ لم يُلمس في R33 حتى `e50e404`)
| الملف | عدد | العرض (رسالة الفشل) |
|---|---|---|
| `test/audit-payroll.spec.ts` | 5 | ترحيل المسيّر → 422 (الاختبار يتوقع 200/201؛ حُرّاس الرواتب الجديدة) |
| `test/employee-statement.spec.ts` | 3 | ترحيل المسيّر → 422 ثم صفوف الكشف 2 بدل 3 |
| `test/journal-entry-card.spec.ts` | 8 | إنشاء قيد → 409 (الحقول الجديدة للبطاقة: الوقت/ضريبي/مندوب) |
| `test/trial-balance.spec.ts` | 2 | `expected false to be true` (إنشاء القيد التمهيدي يفشل) |
| `test/journal-reversal-consistency.spec.ts` | 1 | إبطال فاتورة بيع: `journal_entry_id` لا يصير null |
| `test/report-party-statements.spec.ts` | 1 | صف عميل واحد بدل اثنين |
| `test/treasury-transfers.spec.ts` | 1 | حذف مناقلة خزينة مُرسَلة → 201 (المتوقع 422) |
| `test/sequences.spec.ts` | 1 | عدّاد لكل فرع/سنة: 3 بدل 1 |
| `test/tailoring-invoices.spec.ts` | 5 | الإجمالي 1150 بدل 1050 (ضريبة مضافة)؛ دفعة 422/400 |
| `test/contractor-contracts.spec.ts` | 1 | 400 بدل `paid` |
| `test/audit-sales-replace.spec.ts` | 3 | إجمالي 230 بدل 200 (ضريبة)؛ 575 بدل 500 |
| `test/inventory-serials.spec.ts` | 3 | توليد أرقام تسلسلية → 422 |
| `src/modules/sales/sales.service.spec.ts` | 1 | `DecimalError` في اختبار وحدة المرتجع |
| `test/audit-salla-webhook.spec.ts` | 1 | سجل تدقيق الويب هوك فارغ |
| `src/modules/ai/ai-help.spec.ts` | 1 | لقطة شاشات التنقل قديمة |
| `test/public-help.spec.ts` | 1 | صفوف تدقيق 4 بدل 3 |
