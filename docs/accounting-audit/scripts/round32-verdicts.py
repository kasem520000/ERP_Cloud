#!/usr/bin/env python3
"""R32 verdict table generator — one row per defect id in DEFECTS.md (ACC-001…171, UI-005…053 + the 8 reserved ids).
Verdicts come ONLY from executed evidence in evidence/round-32/** (checkers, snapshots, API responses); every id that
no R32 block re-executed is marked NOT-RETESTED (the fixer's own vitest specs — 121 ✓, R32-FIXER-SPECS-vitest.log — and
the code review in REMEDIATION_BRANCH_REVIEW.md are NOT counted as verification).
Writes ROUND_32_VERDICTS.md and prints the tally. Run: python3 docs/accounting-audit/scripts/round32-verdicts.py"""
import re, os
from collections import Counter, OrderedDict
ROOT = os.path.join(os.path.dirname(__file__), '..')
# ---- verdict map: id -> (verdict, evidence/notes) ----------------------------------------------------------
V = OrderedDict()
def put(ids, verdict, note):
    for i in ids.split():
        V[i] = (verdict, note)
# Block A (seed 8, evidence/round-32/R32-A*)
put('ACC-006 ACC-031', 'FIXED-VERIFIED', 'A06 addPayment cash 10 → سند قبض + قيد + صندوق فرعي؛ replay idempotent (`R32-A06-*`, `R32-DB-005`)')
put('ACC-009 ACC-029', 'FIXED-VERIFIED', 'A07 دفعة زائدة 0.01/0.02 → 422 `PAYMENT_EXCEEDS_DUE` (`R32-A07-pay-over-*`)')
put('ACC-023', 'FIXED-VERIFIED', 'A08 ترحيل السند ×3 متزامن → قيد واحد (`R32-A08-voucher-post-x3`, `R32-DB-007`)')
put('ACC-024', 'FIXED-VERIFIED', 'A09 إبطال السند → قيد عكسي ورصيد فرعي (`R32-A09-voucher-void`, `R32-DB-008`)')
put('ACC-025', 'FIXED-VERIFIED', 'A10 قيد في فترة مقفلة/فترة لا تطابق التاريخ → 409/422 (`R32-A10-*`, `R32-DB-009`)')
put('ACC-049 ACC-090', 'FIXED-VERIFIED', 'A13 تخصيص من سند غير موجود/فوق الفاتورة → 422 (`R32-A13-rv-alloc-*`)')
put('ACC-053 ACC-097', 'FIXED-VERIFIED', 'A11 قفل وحدة المبيعات/الخزينة يمنع الترحيل 409 (`R32-A11-*`, `R32-DB-010`)')
put('ACC-070', 'FIXED-VERIFIED', 'A14 قيد يدوي على حساب خزينة رقابي → 422 (`R32-A14-manual-je-nontreasury`)')
put('ACC-100', 'FIXED-VERIFIED', 'A12 فرع BR32 جديد: ترقيم SI/PI متسلسل بلا 500 (`R32-A12-*`, `R32-DB-011`)')
put('ACC-123', 'FIXED-VERIFIED', 'A13 `GET /payment-methods` يعود بطرق فعلية (`R32-A13-payment-methods`)')
put('ACC-141', 'STILL-OPEN', 'Block A: بلا تغيير (راجع `R32-DB-012/013`)')
# R29 replay (seed 9, evidence/round-32/r29/*)
put('ACC-151', 'FIXED-VERIFIED', 'D14 تحصيل الخط بلا موقع → RV-000001/JE-000015 Dr 1211001 50؛ D16 RV-000003/JE-000017 (الرنر اختار البنك صراحةً)')
put('ACC-152', 'PARTIAL', 'JE-000020 قيد العجز المعتمد Cr 1270001 ✓؛ غير المعتمد يُشطب بلا قيد (ACC-168) والكمية مشوَّهة (ACC-167)')
put('ACC-153', 'PARTIAL', 'مرتجع العميل لا يُنقص `expected_cash` بالصفر ✓ لكن لوحة bakery `receivables 4.54` ≠ أستاذ 5.29 (G-final)؛ وإصلاحه أنتج ACC-167')
put('ACC-154', 'NOT-RETESTED', 'مستند VRT: لم يُعد فحص `subtotal/tax_total` في R32 (المصفوفة خلطت المعرّف — REMEDIATION_BRANCH_REVIEW §7)')
put('ACC-155', 'FIXED-VERIFIED', 'خصم المندوب المفوَّض → JE-000012 Dr 4100003 5.00 (`R29-DB-023`)')
put('ACC-156', 'STILL-OPEN', 'SR-000001/JE-000022 مرتجع فاتورة نقدية Cr 12310001 5.75 بلا ردّ نقدي؛ يبقى −5.75 على الرقابي حتى نهاية R30')
put('ACC-157', 'PARTIAL', 'VLO-0003 المرفوض خرج من «في السيارات الآن» ✓؛ `stockLedgerAgrees=false` في G07 (صحيح الآن بسبب ACC-168/169)')
put('UI-050', 'FIXED-VERIFIED', 'زر «تقديمُ الإغلاق» يظهر لأوامر `in_route` (`R29-CLOSE-01-REP-NOBUTTON.txt` س143/149)')
put('UI-051', 'NOT-RETESTED', 'عدّ المركبة كلها من `/custody`: الرنر أقفل VLO-0002 عبر API (المرحلة 43) فلم يُنفَّذ مسار الواجهة')
put('UI-052', 'NOT-RETESTED', 'نصوص `/collection`/`/rep` لم تُقارن حرفياً؛ السلوك المحاسبي خلفها مُصلَح (ACC-151)')
put('ACC-085', 'FIXED-VERIFIED', 'مسار HRM: السلفة تُنشئ حساب الموظف (JE-000018)؛ مسار الاعتماد المباشر انحدر 500 = ACC-166')
put('ACC-018', 'FIXED-VERIFIED', 'الصندوق الفرعي = الأستاذ طوال R29/R30/H: الصندوق 170.75، البنك 50.29 → 185.29 (`cash_location_balances` في اللقطات)')
put('ACC-120', 'STILL-OPEN', 'شاشة الأرباح 289.80 (R29 G-rpt) كما قبل الإصلاح')
put('ACC-062', 'FIXED-VERIFIED', 'R29 D3 `SALE-D3-CREDIT-LIMIT` → 422 على مسار مبيعات الخط (مسار فاتورة المبيعات staff لم يُعد)')
# R30 replay (seed 9, evidence/round-32/r30/*)
put('ACC-158', 'FIXED-VERIFIED', 'لوحة البوابة 22.54 مدين (B07) = الأستاذ؛ −5.75 بعد D (D18/F05b)')
put('ACC-159', 'FIXED-VERIFIED', 'NeoLeap → RV-000006/JE-000029، جيديا → RV-000007/JE-000031 بطاقة إلى البنك (D05/D14)؛ انظر ACC-164 للجزئي')
put('ACC-160', 'FIXED-VERIFIED', 'SR-000002 «إشعار دائن»، «غير المسدد» 22.54 يطرحه، الكشف دائن 5.75 (B08/D11)؛ متبقٍّ تجميلي: API `payment_status unpaid`')
put('ACC-161', 'FIXED-VERIFIED', 'E09 upload-dup-ref → 409 `SUPPLIER_INVOICE_REFERENCE_DUPLICATE`')
put('ACC-162', 'PARTIAL', 'F07 login أثناء الإيقاف 200 ويبقى المستخدم `active` بعد الإلغاء؛ التخفيف `/portal/*` 403 + الدخول بعد الإلغاء 401')
put('ACC-163', 'FIXED-VERIFIED', 'C09: no/wrong secret 401، amount-mismatch 422، replay `already-paid`؛ `lastError` لم يُعد فحصه')
put('UI-053', 'FIXED-VERIFIED', 'الكشف بترتيب زمني (فاحص D11 ✓)')
put('ACC-004', 'FIXED-VERIFIED', '«أرصدة حساب العملاء» 5.75 دائن = الأستاذ (F05b)؛ «كشف حساب عميل» بـ`partyId` 120.29/126.04 (`R30-F01b`)')
# Block H (seed 9, evidence/round-32/h/*)
put('ACC-032', 'PARTIAL', 'H09 سداد فاتورة الشراء → JE-000040 Dr 22111001 بالطرف / Cr 1211001 ✓ لكن بلا سند صرف')
put('ACC-033', 'FIXED-VERIFIED', 'H10 سباق 100+100 على 192 → 201 + 422 `PAYMENT_EXCEEDS_DUE`؛ `paid_total` 138')
put('ACC-034', 'FIXED-VERIFIED', 'H14–H16 النقد المتوقع 5.75 = حركة الأستاذ؛ CS-000001/JE-000044')
put('ACC-035', 'STILL-OPEN', 'H19 إيداع 11.04 طُوبق بالفاتورة المسددة SI-000004 (0.95) بدل RV-000004')
put('ACC-037', 'FIXED-VERIFIED', 'H03b مسيّر ثانٍ → 409 `PAYROLL_RUN_EXISTS`')
put('ACC-038', 'FIXED-VERIFIED', 'H02 تناسب 16/31 × 120 = 61.9355')
put('ACC-039', 'FIXED-VERIFIED', 'H04 سطور 999 → 422 `PAYROLL_JOURNAL_AMOUNT_MISMATCH`؛ الاشتقاق الخادمي يقيّد على تجميعيات = ACC-170')
put('ACC-040', 'FIXED-VERIFIED', 'H06 PV-000002 Dr 22410003 (حساب الموظف) / Cr 1211001')
put('ACC-043', 'FIXED-VERIFIED', 'H18b استيراد الكشف نفسه → 409 `BANK_STATEMENT_DUPLICATE`')
put('ACC-044', 'STILL-OPEN', 'H21b مطابقة −2.50 مع RV-000001 50.00 → 201')
put('ACC-045', 'STILL-OPEN', 'H25c مطابقة سند مسودة → 201')
put('ACC-046', 'FIXED-VERIFIED', 'H07 صرف المسيّر بعد صرف فردي → 409 `SALARY_ALREADY_PAID`')
put('ACC-047', 'FIXED-VERIFIED', 'H08 عكس مسيّر مدفوع → JE-000038 + إلغاء PV-000002 (JE-000039)')
put('ACC-048', 'FIXED-VERIFIED', 'H05 `payroll_run_lines.status = posted`')
put('ACC-064', 'STILL-OPEN', 'H22 إلغاء مطابقة لسطر pending → 200')
# code-review-only items (not executed in R32)
put('ACC-065', 'NOT-RETESTED', 'إغلاق زائف في المصفوفة (مراجعة كود §3)؛ لم يُنفَّذ مسار المقاولات في R32')
put('ACC-105', 'NOT-RETESTED', 'جزئي بقراءة الكود (REMEDIATION_BRANCH_REVIEW §3)؛ لم يُنفَّذ في R32')
# new in R32
put('ACC-164', 'NEW-REGRESSION', 'ازدواج قيد التسوية الجزئية للبطاقة (Block A + مسبار G)')
put('ACC-165', 'NEW', 'بيع بوابة بلا فاتورة → RV «أخرى» بلا طرف على 12310001 (A05 + D19)')
put('ACC-166', 'NEW-REGRESSION', 'approve-closing بخصم راتب لمندوب بلا حساب → 500')
put('ACC-167', 'NEW-REGRESSION', '`netSold` يعطّل حارس الإقفال ويولّد عجزاً وتسويات وهمية')
put('ACC-168', 'NEW', 'شطب عجز غير معتمد بلا قيد (GL − Σbal = 6.00)')
put('ACC-169', 'NEW-REGRESSION', 'عجز المناقلة خارج `recordInTx` (Σbal − Σtx = 1.20)')
put('ACC-170', 'NEW-REGRESSION', 'قيد المسيّر المشتق على حسابات تجميعية غير قابلة للترحيل')
put('ACC-171', 'NEW', '`POST /vouchers` بلا date/method → 500')

# ---- read DEFECTS.md headings --------------------------------------------------------------------------------
heads = OrderedDict()
for line in open(os.path.join(ROOT, 'DEFECTS.md'), encoding='utf-8'):
    m = re.match(r'^#{2,3} ([A-Z]+-\d+) — ([A-Z]+)(?: \(([^)]*)\))? — (.*)$', line.rstrip())
    if m and m.group(1) not in heads:
        heads[m.group(1)] = (m.group(2), (m.group(4) or '').strip())
reserved = ['ACC-003', 'ACC-005', 'ACC-007', 'ACC-008', 'ACC-012', 'ACC-013', 'ACC-014', 'ACC-015']
rows = []
def key(i):
    p, n = i.split('-'); return (0 if p == 'ACC' else 1, int(n))
all_ids = sorted(set(heads) | set(reserved), key=key)
for i in all_ids:
    sev, title = heads.get(i, ('—', 'معرّف محجوز بلا عنوان مستقل في DEFECTS.md (R10)'))
    verdict, note = V.get(i, ('NOT-RETESTED', 'لم يُعد تنفيذه في R32 — تغطيته الوحيدة اختبارات المُصلِح (vitest 121 ✓) وقراءة الكود'))
    rows.append((i, sev, verdict, note, title))
tally = Counter(r[2] for r in rows)
out = ['# R32 — جدول الأحكام لكل معرّف (مولَّد بـ`scripts/round32-verdicts.py` من `DEFECTS.md` وخريطة الأحكام المستندة إلى أدلة `evidence/round-32/**` فقط)', '',
       f'**{len(rows)} معرّفاً** — ' + '، '.join(f'{k}: {v}' for k, v in sorted(tally.items(), key=lambda x: -x[1])), '',
       'المعاني: FIXED-VERIFIED = أعيد تنفيذ المسار في R32 وثبت الإصلاح بفاحص/لقطة/استجابة؛ PARTIAL = جزء مُصلَح وجزء مفتوح بالدليل؛ STILL-OPEN = أعيد الإنتاج بلا تغيير؛ NEW/NEW-REGRESSION = اكتُشف في R32 (الانحدار = سبّبه كود الإصلاح)؛ NOT-RETESTED = لم يُنفَّذ مساره في R32 (ادّعاء المصفوفة غير مُتحقَّق منه — اختبارات المُصلِح وقراءة الكود لا تُعدّ تحققاً).', '',
       '| المعرّف | الشدة | حكم R32 | الدليل/الملاحظة | العنوان (مختصر) |', '|---|---|---|---|---|']
for i, sev, verdict, note, title in rows:
    out.append(f'| {i} | {sev} | {verdict} | {note} | {title[:90].replace("|", "/")} |')
open(os.path.join(ROOT, 'ROUND_32_VERDICTS.md'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print(len(rows), dict(tally))
