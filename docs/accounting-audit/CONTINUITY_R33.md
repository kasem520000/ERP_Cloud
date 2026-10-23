# CONTINUITY R33 — حالة الإصلاح الكودي الشامل ونقطة الاستئناف

**الفرع:** `arena/0e400dd3-erp-cloud`. **آخر دفعة موثَّقة:** انظر `git log -1` (التقرير: `REMEDIATION_R33.md`).
**القاعدة:** كل تعديل كود يُثبَت بإعادة تنفيذ (فاحص حي على بذرة معزولة + vitest) ثم يُلتزم ويُدفع فوراً. لا إصلاح ببيانات أو قيود تسوية.

## 1. ما أُنجز في R33 (ملخص؛ التفصيل في `REMEDIATION_R33.md`)
- 19 من الـ20 عيباً المفتوحة بعد R32 مُصلَحة ومُثبَتة حياً؛ ACC-141 توثيق فقط (MF-46).
- 10 عيوب جديدة ACC-172…181 مُصلَحة؛ 177/178/180 أُثبتت حياً بفاحص **Block U** (`round33-probe4.cjs` RUN 21/22 — 22/22)؛ ACC-181 (خصوصية سجل التدقيق) باختبار تكامل فقط.
- فاحصات حيّة على **بذرة 12 بالبناء الختامي `b307d21`:** probe1 68/68، probe2 42/42، probe3 48/48 (كلها RUN 23)، probe4 22/22. (بذرة 11 سابقاً: 68/46/48.)
- 12 قرار سياسة بالتفويض مع موضع العكس (`REMEDIATION_R33.md` §4).
- **vitest الكامل على `02ea39f`:** 534 ملفاً / 2038 اختباراً — **2012 ✓ / 1 ✗ / 25 معلّق** (الأساس `0a9dc57`: 46 ✗)؛ الفشل الوحيد (`ai-help` لقطة التنقل) أُصلح في `b307d21` → المتوقَّع الآن **0 فشل**. فرز الـ38 فشلاً القديم مكتمل (§6).

## 2. البيئة (التهيئة 12 — بذرة 12) — إعادة البناء عند الحاجة
1. العلامة أن البيئة أُعيدت تهيئتها: `git log -1` = `54171c6` و`git status` يُظهر `?? docs/accounting-audit/` ولا يوجد `/home/user/.bin` ولا `.env`.
2. الوصفة: `git fetch origin +refs/heads/arena/0e400dd3-erp-cloud:refs/remotes/origin/arena/0e400dd3-erp-cloud && rm -rf docs/accounting-audit && git reset --hard origin/arena/0e400dd3-erp-cloud` → `mkdir -p /home/user/.bin /home/user/.corepack; COREPACK_HOME=/home/user/.corepack corepack enable --install-directory /home/user/.bin; corepack prepare pnpm@9.15.0 --activate` → `export PATH=/home/user/.bin:$PATH COREPACK_HOME=/home/user/.corepack` → `pnpm install --frozen-lockfile` → `pnpm -r --filter "./packages/*" build` → `node scripts/setup-env.mjs` → `sed -i 's/^DEMO_TENANT_NAME=.*/DEMO_TENANT_NAME=AUDIT-TEST-2026-R24/' .env` (قبل البذرة فيأخذه الـseed) → start_process `DB_LOCAL_PERSIST=true DB_LOCAL_DATA_DIR=/home/user/.pgdata-r33 node scripts/local-db.mjs` → `pnpm db:migrate` (142) → `pnpm db:seed` → `cd apps/api && pnpm build` → start_process `node dist/main.js` → `R33_RUN=NN … round33-bootstrap.cjs`.
3. **لا تُصدِّر `.env` بـ`set -a`** (يكسر `JWT_PRIVATE_KEY`). API من `dist`: تعديل `src` بلا `pnpm build` + إعادة تشغيل لا أثر له.
4. `/tmp/q.cjs "<sql>"` أداة استعلام (تُمحى مع التهيئة؛ تُعاد كتابتها: pg من `node_modules/.pnpm/node_modules/pg` عبر `DATABASE_MIGRATOR_URL` من `.env`).
5. الفاحصات: `R33_RUN=NN R32_OUT=$PWD/docs/accounting-audit/evidence/round-33 node docs/accounting-audit/scripts/round33-probe{1,2,3,4}.cjs | grep -v ^Snapshot` — السطر الختامي «R33 probe N: X/Y PASS». آخر RUN مستعمل **23** (probe1/2/3 على بذرة 12؛ probe4 استعمل 21 و22) → التالي 24. probe2 يختار أول شهر حر من (2026-11, 2026-12): على بذرة 12 بعد RUN 23 نوفمبر مشغول (مسيّر معكوس + مسودة متبقية — MF-45) وديسمبر حر؛ إن لم يبقَ شهر حر فإما بذرة جديدة أو توسيع قائمة الأشهر في probe2. probe4 (Block U) يُشغَّل بنفس الصيغة؛ `R33_SKIP_U1`/`R33_SKIP_U3` لتخطي كتلتي ACC-178/ACC-177.

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
1. ~~فرز الـ38 فشلاً القديم~~ ✅ (§6). ~~فاحص حي لـACC-177/178/180~~ ✅ (`round33-probe4.cjs`).
2. تشغيل vitest كامل مرة أخيرة على `b307d21` للتأكد من 0 فشل (آخر تشغيل كامل على `02ea39f` = فشل واحد أُصلح بعده).
3. جولة تحقق للـ153 معرّفاً NOT-RETESTED (7 صارت FIXED-VERIFIED-R33 في `ROUND_32_VERDICTS.md`) (أولوية: التصنيع/الأصول/التقارير التفصيلية؛ الخياطة والمقاولات غطّتها اختبارات R33).
4. جولة UI (staff + bakery) بلقطات حقيقية للمسارات التي تغيّر سلوك API فيها (الرواتب، المناقلات النقدية، الخياطة، الأرقام التسلسلية).
5. تنفيذ MF-45 (إلغاء مسودة مسيّر) وMF-46 (مسودة القيد اليدوي — بعد قرار المالك)؛ اقتراح MF جديد: ضريبة التفصيل كإعداد للمستأجر بدل `TAX_RATE` ثابت.

## 6. الفشل القديم في vitest — **فُرِز بالكامل** (17 ملفاً؛ كلها خضراء منفردة بعد `02ea39f`)
القاعدة التي طُبّقت: اختبار قديم يخالف سياسة/حارساً مدمجاً ومُوثَّقاً → يُحدَّث الاختبار مع تعليق يذكر المعرّف؛ عيب حقيقي → إصلاح كود + معرّف جديد. لا حارس خُفِّف.

| الملف | كان | الحكم | ما تغيّر (commit) |
|---|---|---|---|
| `test/remediation-phase1.spec.ts` | 1 | ارتعاش تزامن (ACC-025) | يقبل 201/409 أو 201/201 مع قيد واحد (`b185926`) |
| `test/audit-payroll.spec.ts` | 5 | اختبار قديم | سطور الترحيل = `summary.preview.netPayable` (حارس `PAYROLL_JOURNAL_AMOUNT_MISMATCH`)؛ سند لكل موظف `payroll:<run>:<emp>` → `LIKE` (ACC-170) (`a3c5bd7`) |
| `test/employee-statement.spec.ts` | 3 | اختبار قديم | الاستحقاق = صافي المسيّر لا 20000 ثابتة؛ الرصيد يُقارَن صافياً أياً كان جانبه (`a3c5bd7`) |
| `test/journal-entry-card.spec.ts` | 8 | اختبار قديم | كان يختار أول فترة مفتوحة (ديسمبر) → `FISCAL_PERIOD_DATE_MISMATCH` (حارس ACC-024)؛ الآن الفترة التي تحوي اليوم (`a583114`) |
| `test/trial-balance.spec.ts` | 2 | اختبار قديم | ACC-139: رصيد افتتاحي أحادي الجانب ⇒ `balanced:false` و«الرصيد 500 مدين» (`a583114`) |
| `test/journal-reversal-consistency.spec.ts` | 1 | اختبار قديم | كان يقارن أول سطر في المرآة بسطر الإيراد؛ الآن سطراً بسطره بالحساب (`a583114`) |
| `test/report-party-statements.spec.ts` | 1 | اختبار قديم | `customer-balances` يفترض `partyKind=customer`؛ الموردون بـ`partyKind=all` (`1b6d22a`) |
| `test/treasury-transfers.spec.ts` | 1 | اختبار قديم (ليس عيباً) | ACC-127: إلغاء مناقلة **مُرسَلة** = إعادتها للمصدر بعكس قيد الإرسال؛ الاختبار يتحقق من الرصيد والمرآة (`1b6d22a`) |
| `test/sequences.spec.ts` | 1 | اختبار قديم | ACC-100: نطاق جديد يُبذَر من أعلى قيمة للمستأجر؛ أنواع المستندات ذات التفرد العام عدّاد واحد (`5ad3786`) |
| `test/contractor-contracts.spec.ts` | 1 | اختبار قديم | ACC-058: «صرف» المستخلص = سند مرحَّل بقيد (Dr 2110/Cr 1211)؛ الـfixture احتاج سنة مالية وحسابات (`5ad3786`) |
| `test/tailoring-invoices.spec.ts` | 5 | اختبار قديم | ACC-149 ضريبة 15 % (`TAX_RATE` ثابت 0.15 — **جزئي**: ليس من إعداد المستأجر)؛ ACC-150 الدفعة سند قبض مرحَّل و`TAILORING_CASH_LOCATION_REQUIRED` (`50b25ba`) |
| `test/audit-sales-replace.spec.ts` | 3 | اختبار قديم | ACC-153: `total` إجمالي بالضريبة؛ حساب السطور في `subtotal` (`acbd258`) |
| `test/inventory-serials.spec.ts` | 3 | اختبار قديم | ACC-132 حارس `SERIAL_COUNT_EXCEEDS_STOCK` → الـfixture يُدخل 10 وحدات؛ UI-044 حشو 4 خانات (`acbd258`) |
| `src/modules/sales/sales.service.spec.ts` | 1 | اختبار قديم | ACC-121 حارس سعر المرتجع يقرأ `unitPrice` من السطر المصدر؛ الـstub احتاجه (`02ea39f`) |
| `test/audit-salla-webhook.spec.ts` | 1 | اختبار قديم | المسار المدقَّق `integrations/salla/webhooks/<storeId>/orders` → `LIKE`؛ نسب AUD-14 سليم (`02ea39f`) |
| `src/modules/ai/ai-help.spec.ts` | 1 | ارتعاش/ترتيب | يمرّ منفرداً دون تعديل (يُراقَب في التشغيل الكامل) |
| `test/public-help.spec.ts` | 1 | **عيب حقيقي → ACC-181** | صوت الزائر المجهول كان يُدقَّق مع IP (طيّ المسار في `describeRoute`)؛ إصلاح `isAnonymousPost()` (`02ea39f`) |

**نتيجة التشغيل الكامل بعد الفرز (`02ea39f`):** 2012 ✓ / 1 ✗ (`ai-help` — أُصلح في `b307d21`) / 25 معلّق — `evidence/round-33/R33-vitest-full-02ea39f.json`.
