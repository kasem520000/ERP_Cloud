# CONTINUITY R32 — جولة التحقق بعد دمج فرع الإصلاح (الحالة بعد الدفعة الأولى، 2026-10-23)

**الحالة:** فرع الإصلاح `arena/163dfc4b-erp-cloud` (`2d92324`) مدموج في فرعنا `arena/0e400dd3-erp-cloud` عند `83b9c4b`. نُفِّذت خمس كتل تحقق (Block A، إعادة R29، إعادة R30 + مسابير، Block H، Block I) وسُلِّمت `ROUND_32_RESULTS.md` + `ROUND_32_VERDICTS.md` + قسم «الجولة 32» في `DEFECTS.md` (ACC-164…171). **50/204 معرّفاً أُعيد تنفيذها؛ 154 لم يُنفَّذ مسارها بعد.**

## 1. ما يُعاد فوراً عند الاستئناف
```bash
cd /home/user/ERP_Cloud && git log --oneline -1           # يجب أن يكون ≥ commit «R32: ROUND_32_RESULTS.md …»؛ وإلا: git fetch origin +refs/heads/arena/0e400dd3-erp-cloud:refs/remotes/origin/arena/0e400dd3-erp-cloud && git reset --hard origin/arena/0e400dd3-erp-cloud
python3 docs/accounting-audit/scripts/round32-verdicts.py  # يعيد توليد ROUND_32_VERDICTS.md من DEFECTS.md + خريطة الأحكام
python3 docs/accounting-audit/scripts/round32-r29-check.py | tail -1 ; python3 docs/accounting-audit/scripts/round32-r30-check.py | tail -1
```
- إن اختفت `/tmp` أو العمليات (إعادة تهيئة — حدثت 9 مرات): البيئة تُبنى من جديد بوصفة `CONTINUITY_R24.md` §3 (+ غلاف pnpm، `DB_LOCAL_PERSIST=true DB_LOCAL_DATA_DIR=/home/user/.pgdata-r32 node scripts/local-db.mjs`، متصفح `.scratch/audit-browser` + `/tmp/al2023` + `/tmp/fonts`، `sed` على `.env` لـ`DEMO_TENANT_NAME=AUDIT-TEST-2026-R24`، rename المستأجر). بذرة 9 تُفقد بإعادة التهيئة؛ أي استكمال يكون على **بذرة 10** جديدة.
- عند الاستئناف على بذرة جديدة: لقطة خط أساس أولاً (`round30-snapshot.cjs R32-DB-000-...`) ثم الكتلة المطلوبة.

## 2. ما بقي (بالترتيب المقترح)
1. **كتل API لجولات R19–R28** بنمط `round32-blockH.cjs` (استخرج أشكال الطلبات من `evidence/round-NN/RNN-http-events.jsonl` كما فُعل لـH): R20 (الدفعات/الأقساط/حدّ الائتمان staff)، R21 (المقاولات ACC-056…059/065، الأصول)، R22 (POS/offline ACC-052، العملات)، R23–R26 (الفترات/الإقفال السنوي/التكلفة/التصنيع)، R27 (ACC-128…134)، R28 (ACC-135…150). كل كتلة: توقعات صريحة + لقطات DB + `R32-<X>-results.json`، ثم تحديث خريطة الأحكام في `round32-verdicts.py`.
2. **UI بلقطات قبل الحفظ** للمسارات ذات الشاشات فقط (شرط المالك)، بعد نجاح كتلة الـAPI المقابلة.
3. **إعادة إنتاج مستهدَفة:** ACC-065، ACC-105، ACC-154، UI-051/052، وما تبقّى من CRITICAL القديمة (ACC-002/011).
4. بعد إصلاح الانحدارات الثمانية: إعادة R29 كاملة + مسبار G + D19 + H04b، وتحديث الأحكام.

## 3. حقائق تقنية تختصر الوقت
- `round32-lib.cjs`: `api(id, method, path, body, {role})` يكتب `<R32_OUT>/<id>-response.json` (`{request, response}`)؛ `race(id, calls)`؛ `snapshot(name)` (يفوّض `round30-snapshot.cjs`؛ يرفض EEXIST). الدليل الهدف بـ`R32_OUT=`؛ ضع `R30-seed-ids.json` في الدليل إذا احتجت المعرّفات (`branch, whMain, safe, bank, cust, custGen, supp, bread, pi1, si*`).
- بذرة 9 (إن بقيت): فترة 2026-10 `01a16790-5954-74f8-870d-909d680f1c60`؛ VAT 15 % `01a16790-5940-715b-ae91-43d89d867eed`؛ حسابات 3122001 `…d8f471c6a03d`، 224 `…23cd44ed1905`. المستأجر `01a16790-56f2-7106-81ae-fc3fdc1f6a88`.
- أشكال API المؤكَّدة: `/hrm/employees {employeeNo,name,status,hireDate,gender,salaryComponents:{basic},bank:{},branchIds:[]}`؛ `/hrm/payroll/preview {yearMonth}`؛ `/hrm/payroll/runs {yearMonth, periodId}`؛ `/runs/:id/post {}` (اشتقاق خادمي) أو `{branchId,fiscalPeriodId,journalLines}` (يُطابَق الصافي)؛ `/hrm/salary-payments {employeeId,branchId,yearMonth,paymentDate,method:'cash',cashLocationId,runId}`؛ `/runs/:id/pay {branchId,cashLocationId,method,fiscalPeriodId}`؛ `/runs/:id/reverse {reason}`؛ `/purchase-invoices/:id/payments {amount,idempotencyKey,cashLocationId,method}`؛ `/shift-closes/open {branchId}` → `/current?branch_id=` (`live.expectedCash`) → `/:id/close {counts:[{denomination,count}]}` → `/:id/post {}`؛ `/treasury/bank-accounts {bankName,accountNo,iban,openingBalance,cashLocationId}`؛ `/treasury/bank-statements/import {bankAccountId,csv,openingBalance}` → `{data:{statement:{id},lines}}`؛ `/bank-statements/:id/auto-match`، `/match {lineId,voucherId}`، `DELETE /lines/:lineId/match`؛ `/vouchers` يتطلب `date` و`method ∈ cash|cheque|bank_transfer|card` وإلا 500 (ACC-171)؛ `/reports/party-statement?partyId=` (لا `party_id`).
- فاحصات R29/R30 القديمة تُشفِّر سلوك ما قبل الإصلاح وأرقام بذرة 7 → استعمل الأغلفة `round32-r29-check.py`/`round32-r30-check.py` واقرأ FAIL بوصفه «اختلافاً يُفرز» لا عيباً.
- عدّ العيوب: `grep -c "^#\{2,3\} [A-Z]\+-[0-9]\+" DEFECTS.md` = 212 عنواناً + 8 محجوزة = 220.

## 4. ما يُطلب من فريق الإصلاح الآن (من R32)
ACC-164 (ازدواج التسوية الجزئية — `settleIfApproved` يجب ألا يستدعي `addPayment` بعد السند)، ACC-167 (إلغاء `netSold` أو فصل مرتجع العميل عن مرتجع المستودع)، ACC-168 (قيد مقابل لكل شطب عجز أو تأجيل الإخراج)، ACC-169 (`recordInTx` لعجز المناقلة)، ACC-170 (حسابات ورقية `is_postable` + فرض `is_postable` في `postJournalInTx`)، ACC-166 (`path` عند إنشاء حساب الموظف التلقائي أو 422)، ACC-165 وACC-032 (قرارا سياسة §7 في النتائج)، ACC-171، وما بقي مفتوحاً: ACC-035/044/045/064/156/120/141/162.
