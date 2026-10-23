# CONTINUITY — الجولة 30 (R30): بوابة العميل، روابط الدفع الإلكتروني، بوابات بطاقات نقطة البيع، بوابة المورّد

> مستأجر الاختبار المحلي `AUDIT-TEST-2026-R24` (code `demo`) فقط — البذرة السابعة. نقطة الانطلاق = الحالة الختامية لR29
> (`evidence/round-29/R29-DB-044-G-final.json`) وأُعيد التقاطها كخط أساس `evidence/round-30/R30-DB-000-baseline.json` (82 مفتاحاً).
> لا كتابة على أي بيانات حقيقية؛ كل المستندات أدناه معزولة وموسومة `R30`.

## 0. لماذا هذه الجولة — وتصحيح تصنيف سابق

- في R28/R29 صُنّفت «بوابات الدفع» ضمن **خارج النطاق** بحجّة أنها تتطلّب مزوّداً خارجياً. الاستكشاف في بداية R30 أثبت أن التصنيف **خاطئ**:
  - روابط الدفع (`payments/links`) لها وضع محاكاة افتراضي (`payment_provider_configs.simulation = true`) ونقطة `POST payments/links/:id/simulate`
    تُطبّق نفس مسار الويبهوك الحقيقي (`applyEvent`) محلياً، وتُنشئ **سند قبض مرحّلاً** عبر `treasury.createVoucher/postVoucher` ثم `sales.addPayment`.
  - بوابات بطاقات نقطة البيع (`payment-gateways` جيديا/NeoLeap) لها `simulation = true` افتراضياً، ونقطة `/:provider/sale` تُسوّي الفاتورة عبر `sales.addPayment` فقط.
  - ويبهوك عام `POST payments/webhooks/:provider` يُمكن استدعاؤه محلياً بسرّ مشترك.
- كذلك لم يُفحص قطّ تطبيق **`apps/customer-portal`** (11 صفحة؛ Next 15؛ يُشغَّل على المنفذ 3004 عبر `scripts/next-run.mjs`) ولا **بوابة المورّد** (`supplier-portal/*`
  + شاشة الموظفين `/purchases/supplier-portal` ولوحة المورّد `/supplier-portal`). كلاهما داخل النطاق لأنهما يُنفَّذان محلياً بالكامل.
- `apps/platform-admin` (41 صفحة: فوترة اشتراكات/dunning/revenue) = فوترة **المشغّل** لا دفاتر المستأجر؛ يُستكشف ويُوثَّق قرار النطاق في §8 دون تنفيذ مالي.

## 1. ما اكتُشف (قراءة كود + DB، قبل أي تنفيذ)

### 1.1 بوابة العميل (`modules/portal`, `apps/customer-portal`)
| البند | الحقيقة المتحقَّق منها |
| --- | --- |
| منح الوصول | staff `/sales/portal-access` → `POST /parties/:id/portal-access {email, fullName?, password?, notify}` → يُنشئ مستخدماً بدور «Customer portal» بلا أي صلاحية + صف `portal_accounts`؛ تُعاد `temporaryPassword` مرة واحدة فقط وتُعرض في الشاشة |
| الدخول | نفس `POST /auth/login {tenantCode,email,password}`؛ `mustChangePassword=true` → `/auth/change-password` (`POST /auth/change-password {current,new}`) |
| الرصيد في `/portal` | `GET /portal/me` → `balance = Σ(debit−credit)` من `journal_entry_lines` حيث `party_id = حساب البوابة` و`status='posted'` — **من الأستاذ** |
| الفواتير | `GET /portal/invoices` → `sales_invoices` المرحّلة للطرف (`kind,payment_status,total,paid_total,zatca_status`) |
| الكشف | `GET /portal/statement` → **مستندي**: فواتير مرحّلة (مدين) + سندات مرحّلة للطرف (قبض دائن/صرف مدين)؛ يُصنّف المردود بشرط `si.kind = 'return'` بينما قيم `kind` الفعلية في النظام هي `sale / sale_return / credit_note / debit_note / quotation` ⇒ **توقّع عيب: مردود مرحّل للعميل سيظهر «فاتورة مبيعات» مديناً** |
| المدفوعات | `GET /portal/payments` → `vouchers` المرحّلة للطرف فقط (لا تشمل `invoice_payments` بلا سند) |
| رابط الدفع | `GET /portal/invoices/:id/payment-link` → أحدث رابط `pending` أو آخر رابط؛ العميل لا يُنشئ الرابط |
| الحراسة | فاتورة طرف آخر → 404؛ حساب موقوف → 403 `PORTAL_ACCESS_SUSPENDED`؛ مستخدم بلا حساب بوابة → 403 `PORTAL_ACCESS_REQUIRED`؛ أي مسار staff → 403 لانعدام الصلاحيات |

### 1.2 روابط الدفع الإلكتروني (`payment-links.service.ts`)
- `createLink`: الفاتورة يجب أن تكون `posted`؛ المبلغ الافتراضي = `total − paid_total`؛ `amount > due` → 422 `PAYMENT_EXCEEDS_DUE`؛ `amount ≤ 0` → 422؛ البوابة غير مفعّلة → 409.
- `applyEvent` عند `paid`: `cashLocation()` = `config.cashLocationId` وإلا افتراضي الفرع وإلا أول صندوق؛ `idempotencyKey = online-pay:<provider>:<paymentId>`؛
  `receipt()` ← `treasury.createVoucher(kind receipt, subtype customer, method card)` ثم `postVoucher` مع تخصيص للفاتورة؛ ثم `sales.addPayment(method card, idempotencyKey)` (يكتب `invoice_payments` + `paid_total`)؛ ثم الرابط `paid` مع `voucher_id`.
- `simulatePayment` مرفوض إذا `simulation=false`. `receiveWebhook` يتطلّب سرّاً مشتركاً (`secret_token` في الجسم أو `x-webhook-secret`) أو HMAC؛ سرّ فارغ لا يُطابق أبداً (`verifySharedSecret` تُعيد false) ⇒ ويبهوك بلا سرّ → 401.
- `settlementDecision`: رابط `paid` → تجاهل (`already-paid`)؛ مبلغ مختلف → رفض `amount-mismatch` (422 ويُسجَّل `lastError`)؛ `failed/expired` → تحديث حالة الرابط فقط.

### 1.3 بوابات بطاقات نقطة البيع (`payments.service.ts`)
- `PUT payment-gateways/:provider` (`pos.config.manage`)؛ `simulation=true` افتراضياً؛ `POST /:provider/test` يخصم 0.01 (جيديا) تجريبياً؛ `POST /:provider/sale {amount, invoiceId?, ecrRef?}` (`sales.invoice.pay`).
- `ecrRef` ببادئة `DECLINE-`/`CANCEL-`/`ERROR-` يُنتج رفضاً/إلغاءً/خطأً في المحاكاة؛ نفس `ecrRef` مرتين → 409 `PAYMENT_REFERENCE_DUPLICATED`.
- **المسوّي الوحيد** لبيع معتمد مرتبط بفاتورة هو `sales.addPayment({method:'card'})` الذي — كما ثبت في ACC-018 — يكتب `invoice_payments` + `paid_total` **بلا سند وبلا قيد** ⇒ توقّع عيب جديد: تحصيل بالبطاقة عبر البوابة يُغلق الفاتورة ولا يصل إلى الأستاذ/البنك.

### 1.4 بوابة المورّد (`supplier-portal`)
- staff (`supplier_portal.access`): `POST supplier-portal/users {partyId,email}` → `temporaryPassword`؛ `POST supplier-portal/rfqs {partyId,title,note}`؛ `GET supplier-portal/uploads`.
- المورّد: `POST supplier-portal/auth/login {tenantCode,email,password}` → `token` (جلسة مجزّأة في `supplier_portal_sessions`)؛ `GET invoices/payments/quotations`؛ `POST quotations/:id/respond {price,note}` (ردّ واحد)؛ `POST invoices {referenceNo,declaredTotal,note}` → `supplier_invoice_uploads` **ليست فاتورة شراء مرحّلة** (تصريح فقط).

### 1.5 حالة البيانات عند الانطلاق (DB-000)
- العميل الآجل `000001 — بقالة R29 (آجل)` (party `01a16672-aafe-77ce-bba9-27910738ad87`): SI-000002 86.25 (paid_total 86.25؛ منها 20 بسند RV-000001 و66.25 تحصيل مندوب بلا سند — ACC-151)، SI-000004 11.04 غير مسدّدة.
  **رصيد الطرف في الأستاذ = 86.25 + 11.04 − 20 = 77.29** (حساب 12310001 كله 71.54 لأن مردود R29 SR-000001 5.75 دائن بلا طرف — ACC-156).
- SI-000001/003/005 وSR-000001 بلا `party_id` (مبيعات نقدية من السيارة). PI-000001 230 للمورّد `SUPP-GEN` غير مسدّدة (22111001 = −230).
- الصناديق: `الصندوق الرئيسي` (safe, 1211001 = 50,120.75) و`الحساب البنكي الرئيسي` (bank, 1221001 = 180,000)؛ كلاهما `is_default=true`.
- المخزون: BR-R29 7 في MAIN و2 في VAN-1 (متوسط 1.20)؛ FL-R29 70 (2.00). 19 قيداً مرحّلاً (آخرها JE-000019).

## 2. خطة التنفيذ والتوقعات المحسوبة مسبقاً

| الكتلة | المسار | المتوقع (محسوب قبل التنفيذ) |
| --- | --- | --- |
| **A** وصول البوابة | staff `/sales/portal-access` منح `customer@r30.test` للطرف 000001 → دخول العميل على :3004 → تغيير كلمة المرور → `/portal` | `portal_accounts` 1 صف، مستخدم بدور «Customer portal» بلا صلاحيات؛ الرصيد **77.29**؛ الفواتير: SI-000002 (مسدّدة) وSI-000004 (11.04 غير مسدّدة) فقط؛ المدفوعات: RV-000001 20؛ الكشف: 86.25 − 20 + 11.04 → إقفال 77.29؛ صفحة الدفع لـSI-000004 بلا رابط؛ `GET /parties` بالرمز → 403؛ فاتورة SI-000001 (بلا طرف) → 404 |
| **B** مستندات جديدة للعميل | staff: SI-000006 (1 × BR-R29 @5 +15% = 5.75 آجل)، SI-000007 (2 × BR-R29 = 11.50 آجل)، مردود SR-000002 على SI-000002 كمية 1 (5.75) | قيود: مبيعات Dr AR / Cr 4100001 + 2222001، COGS 1.20 و2.40؛ المردود يعكس 5.75 مع طرف؛ الرصيد في البوابة **77.29 + 5.75 + 11.50 − 5.75 = 88.79**؛ كشف البوابة: المردود يجب أن يظهر دائناً — **التوقّع أنه سيظهر مديناً «فاتورة مبيعات» (إقفال خاطئ 100.29)** |
| **C** روابط الدفع | `/settings/payments` تهيئة ميسر (صندوق السند = الحساب البنكي؛ سرّ ويبهوك `r30-webhook-secret`؛ محاكاة ✓؛ مفعّل ✓) → `/sales/invoices/[SI-000004]` «إنشاء رابط دفع» → البوابة تعرض الرابط → «محاكاة دفع» | رابط `pending` 11.04؛ المحاكاة → RV-000002 مرحّل **Dr 1221001 11.04 / Cr 12310001 11.04 (مع الطرف)** + تخصيص + `invoice_payments` card 11.04 + SI-000004 `paid` + الرابط `paid` مع `voucher_id`؛ إعادة المحاكاة → `already-paid` بلا سند ثانٍ؛ رابط بمبلغ 20 → 422؛ رابط لفاتورة مسدّدة → 422 |
| **C'** ويبهوك حقيقي | رابط لـSI-000006 (5.75) ثم `POST /payments/webhooks/moyasar?tenant_id=…` بلا سرّ، بسرّ خاطئ، بسرّ صحيح ومبلغ 500 هللة، ثم 575 هللة، ثم إعادة الإرسال | 401، 401، 422 `amount-mismatch` (+`lastError` على الرابط)، تسوية → RV-000003 5.75 Dr بنك / Cr AR، إعادة الإرسال → تجاهل؛ رصيد البوابة **88.79 − 11.04 − 5.75 = 72.00** |
| **D** بطاقات POS | `/settings/payment-gateways` تفعيل جيديا (محاكاة) → TEST → «دفع» 125 بلا فاتورة → API `sale` على SI-000007: `DECLINE-R30-1` ثم `R30-ECR-0001` 11.50 ثم تكرار المرجع ثم مبلغ 20 | TEST صف 0.01 غير مسوّى؛ دفع 125 معتمد بلا فاتورة (لا أثر مالي — يُوثَّق)؛ الرفض لا يسوّي؛ المعتمد → `invoice_payments` card 11.50 وSI-000007 `paid` و`settled=true` **بلا سند وبلا قيد** (عيب متوقَّع: AR يبقى 72.00 في الأستاذ بينما كل الفواتير مسدّدة)؛ التكرار → 409؛ مبلغ > المتبقي → 422 |
| **E** بوابة المورّد | `/purchases/supplier-portal` دعوة `supplier@r30.test` للمورّد SUPP-GEN + طلب عرض سعر → لوحة `/supplier-portal` دخول → الفواتير/المدفوعات/الردّ بسعر 190 → رفع فاتورة `SUP-R30-001` بإجمالي 115 | المورّد يرى PI-000001 230 غير مسدّدة ولا مدفوعات؛ الردّ يُغلق الطلب؛ الرفع يُنشئ صفاً في `supplier_invoice_uploads` **ولا** فاتورة شراء ولا قيداً (AP يبقى −230)؛ الرمز لا يفتح `/purchases/invoices` (401) ولا فاتورة طرف آخر (404) |
| **F** تقارير/حراسة/ختام | كشف حساب الطرف في staff مقابل البوابة؛ ميزان المراجعة؛ سجل السندات؛ إيقاف حساب البوابة → `/portal` 403 → إعادة تفعيل → إلغاء → دخول مرفوض؛ لقطة ختامية | AR أستاذ 72.00 = 77.29 + 5.75 + 11.50 − 5.75 − 11.04 − 5.75؛ بنك 180,016.79؛ المستندي: كل فواتير العميل مسدّدة ⇒ فجوة 72.00 = 66.25 (ACC-151) + 11.50 (بطاقة بلا قيد) − 5.75 (مردود R29 بلا طرف محسوب على الحساب لا الطرف — يُحسب على مستوى الحساب فقط) |

ملاحظة الفجوة على مستوى **الحساب 12310001**: 71.54 + 5.75 + 11.50 − 5.75 − 11.04 − 5.75 = **66.25**؛ وعلى مستوى **الطرف** 72.00 (الفرق 5.75 = SR-000001 بلا طرف).

## 3. آلية التنفيذ

- `scripts/round30-main.cjs` (نسخة من بنية R29): كل كتابة من شاشة تتوقف قبل الزر (`READY <id>` → لقطة `<id>-before.png` + `-before.json` تُراجَع ثم `.scratch/r30/<id>.approve`)، ثم `-response.json`، `-after.png/.txt`، ولقطة DB `R30-DB-NNN-<id>.json` عبر `scripts/round30-snapshot.cjs`.
- بوابة العميل تعمل على `http://127.0.0.1:3004` (`next build` ثم `next start -H 0.0.0.0 -p 3004`؛ تُوكّل `/api/v1` إلى :3000). المسارات الموسومة `P:` في الرنر تُفتح عليها.
- الويبهوك العام يُستدعى بلا ترويسة تفويض (fetch من سياق المتصفح دون bearer) لإثبات أنه مسار عام فعلاً.
- الأدلة: `evidence/round-30/`؛ النتائج: `ROUND_30_RESULTS.md`؛ فحص آلي: `scripts/round30-check.py`.

## 4. المتبقي بعد R30
- R31: التقرير الموحَّد الختامي (دمج R10–R30، سجل العيوب الكامل، قرارات السياسة، خريطة التغطية النهائية، تقدير ما لم يُنفَّذ).
- تقدير `apps/platform-admin` (فوترة المشغّل) و`apps/marketing`/`apps/migrator` يُوثَّق في `ROUND_30_RESULTS.md` §8.

## الحالة الختامية لـR30 (2026-10-23) — مُنجَزة
- الرنر 56 مرحلة اكتملت (A–F) + مسباران من API (E09b، D19)؛ آخر لقطة `R30-DB-039`؛ الفاحص `round30-check.py` 76/15 من 91 (`R30-CHECK-OUTPUT.txt`).
- التقرير `ROUND_30_RESULTS.md`؛ العيوب ACC-158…163 + UI-053 في DEFECTS.md؛ السجلات (SCREEN_REGISTER/TEST_DATA/EVIDENCE_INDEX/FINANCIAL_RECONCILIATION/TEST_RESULTS/README) مُلحَقة.
- انحراف موثَّق: D05 بحقل `ecrRef` الخاطئ (الحقل الصحيح `reference`) — أُبقي دليلاً على ACC-159 وأُعيدت المسابر على SI-000008 (D12–D18).
- التالي (R31): التقرير الموحَّد بلا تنفيذ + تقدير `apps/platform-admin` (فوترة المشغّل). إن أُعيدت التهيئة: وصفة CONTINUITY_R24 §3 ثم `next build` لبوابة العميل (:3004) ولا حاجة لإعادة R30 (الأدلة كاملة في Git).
