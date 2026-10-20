# مرجعُ واجهة تطبيق إدارة المخابز (Android Bakery) — عقودٌ حرفيّةٌ من الخادم

<div dir="rtl">

هذا المرجعُ يوقّعُ كلَّ مسارٍ يستدعيه تطبيقُ `apps/android-bakery` على
المصدر: `apps/api/src/modules/van-sales/van-sales.controller.ts` وما حوله
(المصادقةُ `platform/auth`، الإشعاراتُ `platform-services/notifications`،
البحثُ `organization` + `inventory`). **ما ليس هنا لا يستدعيه التطبيق، وما هنا
موقّعٌ بموقعه في الكود.**

قاعدةٌ عامّة: الردودُ الناجحةُ بغلاف `ApiEnvelope` — `{ "data": … }` —
والاستثناءانِ الحرفيّان: `/parties` و`/organization/catalog/items` مصفوفاتٌ
خام، و`/notifications` بغلافها الخاصّ. وكلُّ الأرقامِ (كميّاتٌ وأموال) **نصوص**
(‏`numeric` من PostgreSQL) — يتعاملُ معها التطبيقُ بـBigDecimal (`Dec`).

---

## ٠. البنية العامة

| العنصر | القيمة |
|---|---|
| البادئة | `/api/v1` (نسبيّة — المضيفُ من شاشة الدخول ويُطبَّق في `HostSelectionInterceptor`) |
| المصادقة | `Authorization: Bearer <accessToken>` — لا تُلحق بمسارَي الدخول والتجديد |
| التجديد | `POST /auth/refresh` عند 401 (مرةً واحدةً لكلّ طلب — single-flight) |
| أخطاء 4xx/5xx | RFC-9457 Problem: `{type, title, status, code, detail, traceId, errors[{field, message}]}` — `detail` عربيٌّ يُعرض حرفيًّا |
| المتصل | تطبيقٌ متصلٌ دائمًا: IOException = «لم تصل» (ليست رفضًا)؛ إجراءاتُ الدفعة/التحميل/التحصيل تحملُ `idempotencyKey` |

## ١. المصادقة — `platform/auth`

| المسار | ملاحظات |
|---|---|
| `POST /auth/login` | جسم: `{email, password, tenantCode, mfaCode?}` → `{data: {accessToken, refreshToken, tokenType, expiresIn, user{…, mustChangePassword}, memberships[]}}` |
| `POST /auth/refresh` | `{refreshToken}` → كال login |
| `POST /auth/logout` | 204 — تُحذفُ الجلسةُ محليًّا في كلّ حال |
| `GET /me` | `{data: {user, membership, permissions[], platformPermissions[], impersonation?, branchScope?, enabledApps[]}}` — منها تبني الشاشاتُ صلاحياتِها |
| `POST /auth/change-password` | `{current(1..200), new(12..200)}` → **204 ويُبطل كلَّ الجلسات**؛ سياسةٌ: ≥12 حرفًا، ≥3 فئات، لا DENY_LIST، لا local-part البريد/الاسم الكامل (token ≥4)؛ 400 VALIDATION_FAILED، 429 RATE_LIMITED |

## ٢. لوحة القيادة — `GET /van-sales/dashboard` (إذن `van_sales.view`)

**مصدرُ كلّ شاشة.** `{data: DashboardDto}` والحقلُ الغائب `null`:

- `policy{allowInternalDeliveryWithoutTax, preventSelfApproval, shortageValuationBasis, zatcaSeller{ready, missingFields[], refusalDetail}}`
- `postingReadiness{branchId?, salesInvoice, stockTransfer, receiptVoucher, message?}` — `message` عربيٌّ يُعرض حرفيًّا عند نقصِ ملفّ الترحيل.
- `officialStock[{itemId?, itemName?, warehouseId?, warehouseName?, quantity?, averageCost?}]`
- `mainWarehouseId?`
- `windows{productionBatches, loadOrders, documents, movements, customerPriceHistory}` — كلٌّ `{returned, total, limit}`: القائمةُ نافذةٌ لا الجدولُ كلَّه.
- `summary{…}`: ‏`totalProducedKg, totalScrapKg, mainWarehouseBalanceKg, vanWarehousesBalanceKg, derivedMainWarehouseBalanceKg, stockLedgerAgrees, inTransitKg, inTransitValueSar, inTransitTransfersCount, totalProductionCostSar, totalLoadedKg, totalSoldKg, totalBonusKg, totalReturnedKg, totalDamagedKg, totalShortageKg, totalShortageSar, remainingInVansKg, totalZatcaSalesSar, totalInternalSalesSar, totalRevenueSar, totalSalesGrossSar, totalReturnsSar, totalReturnsVatSar, returnDocumentCount, returnsWithoutCostCount, totalCollectedCashSar, totalCreditReceivablesSar, totalNetProfitSar, anomalyCount, pendingClosingsCount, pendingReceiptsCount, pendingStockSettlementsCount, pendingTransitDecisionsCount`.
- `productionBatches[{id, batchNo, productionDate, itemId?, warehouseId?, itemName, producedQty, scrapQty, issuedQty, returnedGoodQty, damagedQty, availableWarehouseQty, unitCost, totalCost, costBasis(manufacturing_order|manual_input_or_item_cost), scrapValue, scrapCostLoaded, status(active|exhausted|closed), supervisorName, notes, …}]`
- `loadOrders[{id, number, loadDate, productionBatchNo, vehiclePlate, status, salesmanId, salesmanName, warehouseId?, vanWarehouseId?, itemId?, itemName, loadedQty, receivedQty, discrepancyQty, discrepancyNotes, receivedAt?, awaitingReceipt, soldQty, bonusQty, returnedQty, damagedQty, shortageQty, shortageValue, remainingQty, actualRemainingQty, vehicleCountQty?, otherCustodyQty?, expectedRemainingQty, countVarianceQty(موجب=عجز، سالب=فائض), stockAdjustmentId?, remainingAction?, stockSettlementStatus, stockSettlementNote, awaitingStockSettlement, awaitingTransitDecision, maxBonusQty, maxBonusPct, expectedCash, collectedCash, cashVariance, damageReason, damageInspected, salaryDeductionApproved, closingNotes, closingSubmittedAt?, approvedAt?, approvedByLabel, notes, …}]`
  - قيمُ `status`: `pending_receipt` · `loaded` · `in_route` · `pending_closing` · `pending_stock_settlement` · `settled` · `cancelled` (+أيُّ قيمةٍ غير معروفة تُعرض خامًا).
- `customerPrices[{id, partyId, partyName, partyCode, partyTaxNo, itemId?, itemName, priceTierLabel, unitPrice, maxBonusPct, maxBonusKgPerInvoice, preferredInvoiceMode, creditLimit, paymentTermsDays, lockPrice, maxDiscountPct, effectiveFrom, effectiveTo?, changeReason, notes}]`
- `customerPriceHistory[{…, previousUnitPrice?, newUnitPrice, changedByLabel, createdAt}]`
- `documents[{id, number, docDate, invoiceMode, taxPolicyStatus, paymentMethod, documentKind(sale|sale_return), invoiceNumber?, invoiceStatus?, productionBatchNo, loadOrderId?, salesmanName, partyId?, customerName, customerTaxNo, itemId?, itemName, soldQty, bonusQty, bonusReason, unitPrice, discountAmount, discountReason, subtotal, taxRate, taxTotal, total, paidAmount, unitCost, netProfit, customerBonusConfirmed, bonusAnomaly, anomalyReason, qrPayload, notes, createdAt}]`
- `movements[{id, movementType, batchNo, qty, unitPrice, amount, reason, salesmanName, customerName, actorLabel, approvedByLabel, createdAt}]`
- `repPerformance[{salesmanId, salesmanName, loadedKg, soldKg, bonusKg, returnedKg, damagedKg, shortageKg, shortageSar, custodyRemainingKg, revenueSar, collectedSar, creditDebtSar, netProfitSar, pendingClosings}]`

## ٣. الإنتاج — `POST /van-sales/production-batches` (إذن `van_sales.production.manage`)

جسم: `{batchNo?, itemId?, warehouseId?, branchId?, productionDate?, bomId?, components?[{itemId, qty, unitId?}], itemName?, producedQty?, scrapQty?, scrapReason?, unitCost?, supervisorName?, notes?, idempotencyKey?}`

قواعدُ الخادم (تُطابقُها فحوصُ النموذج في التطبيق):
- `producedQty` رقمٌ **موجبٌ محدود**.
- `scrapQty` ≥ 0، ومع أيّ فاقدٍ ( >0 ) **`scrapReason` إلزاميّ**.
- `itemId` مطلوب.
- `unitCost` موجبةٌ إن أُدخلت؛ الأولويّةُ لأمرِ التصنيعِ ثمّ البطاقة.
- **مصدرُ الموادّ إلزاميّ**: `bomId` **أو** `components[{itemId, qty, unitId?}]` —
  بلا أحدهما يرفضُ الخادمُ الدفعةَ بـ 422 `VAN_PRODUCTION_INPUT_REQUIRED`
  (لا مخزونَ من العدم: الواردُ من خارج المنشأة موضعهُ إذنُ إدخالٍ مخزنيٌّ رسميّ
  أو تسويةُ جردٍ معتمدة).
- تكرارُ `idempotencyKey` يعيدُ نتيجةَ النيّةِ نفسِها فلا دفعةً مكرّرةً.

## ٤. التحميل والتوزيع

| المسار | الإذن | الجسم | ملاحظات |
|---|---|---|---|
| `POST /van-sales/load-orders` | `van_sales.load.manage` | `{salesmanId, warehouseId?, vanWarehouseId?, itemId?, vehiclePlate?, productionBatchNo?, loadedQty?, maxBonusQty?, maxBonusPct?, notes?, idempotencyKey?}` | `loadedQty` موجب؛ الأصنافُ المتتبَّعةُ بالدفعات (`track_lot`) تُرفضُ بلا `productionBatchNo`؛ مستودعُ المصدر ≠ مستودعُ السيارة؛ مع `idempotencyKey` يُعاد تحميلُ اللوحة (لا أمرًا مكرّرًا) |
| `POST /van-sales/load-orders/{id}/confirm-receipt` | `van_sales.view` | `{receivedQty?, notes?}` | المندوبُ صاحبُ العهدة أو إدارةُ التحميل؛ بلا `receivedQty` = اعتمادٌ كامل |
| `POST /van-sales/load-orders/{id}/reject-receipt` | `van_sales.view` | `{reason?}` | الكميّةُ رسميًّا في الطريق ⇒ مناقلةُ إرجاعٍ للمصدر |
| `POST /van-sales/load-orders/{id}/cancel` | `van_sales.load.manage` | `{reason?}` | قبلَ الاستلام فقط — إلغاءُ المناقلةِ الرسميّة |
| `POST /van-sales/load-orders/{id}/close-transit-difference` | `van_sales.load.manage` | `{mode: return|shortage, reason?}` | قرارٌ ماليٌّ ينفّذه محرّكُ المخزون |

## ٥. العهدة والإقفال

| المسار | الإذن | ملاحظات |
|---|---|---|
| `POST /van-sales/load-orders/{id}/submit-closing` | `van_sales.closing.submit` | جسم: `{returnedQty?, damagedQty?, damageReason?, collectedCash?, actualRemainingQty?, vehicleCountQty?, closingNotes?}` — **`actualRemainingQty` و`vehicleCountQty` بديلانِ لا رفيقان**: الثاني عددُ المركبةِ كلَّها ويُشتقُّ منه نصيبُ الأمر بعد طرحِ عهدةِ الأوامرِ الأخرى (ترحيل 0129) |
| `POST /van-sales/load-orders/{id}/approve-closing` | `van_sales.closing.approve` | جسم: `{returnedQty?, damagedQty?, collectedCash?, damageInspected?, salaryDeductionApproved?, selfApprovalOverride?, notes?, actualRemainingQty?, vehicleCountQty?, remainingAction?(return_to_main|carry_over — إلزاميٌّ مع متبقٍّ فعليّ), settleStockAdjustment?(تفويضُ ترحيلِ مستندِ الجرد — بدونه مسودةٌ والعهدةُ معلّقة), surplusAcknowledged?(إقرارٌ إلزاميٌّ عند فائضِ الجرد)}` |
| `POST /van-sales/load-orders/{id}/settle-stock` | `van_sales.closing.approve` | `{settleStockAdjustment?, remainingAction?}` — استكمالٌ آمنٌ لتسويةٍ معلّقة: التكرارُ لا يحرّكُ كيلوغرامًا مرّتين |

## ٦. التحصيل والتسعير

| المسار | الإذن | الجسم |
|---|---|---|
| `POST /van-sales/collections` | `van_sales.collection.create` | `{documentId, collectedAmount, cashLocationId?, offsetAccountId?, notes?, idempotencyKey?}` — التجاوزُ عن المتبقّي يُرفضُ: «مبلغ التحصيل (X ريال) يتجاوز الرصيد المتبقي على الفاتورة (Y ريال)» |
| `POST /van-sales/customer-prices` | `van_sales.pricing.manage` | `{partyId, itemId?, priceTierLabel?, unitPrice, maxBonusPct?, maxBonusKgPerInvoice?, preferredInvoiceMode?(zatca_tax|internal_delivery), creditLimit?, paymentTermsDays?, lockPrice?, maxDiscountPct?, effectiveFrom?, effectiveTo?, changeReason?, notes?}` — upsertٌ بالعميل/الصنف بلا مفتاحِ نيّة |

## ٧. السياسة والتقارير

- `GET /van-sales/policy?salesmanId?` (إذن `van_sales.view`) → `{data: {shortageValuationBasis, shortageUnitPrice?, preventSelfApproval, allowInternalDeliveryWithoutTax, zatcaSeller{…}, valuationSource, configured, writableKeys[], chargeCreditAccount{id,name,code}?, salesmanReadiness{…}?}}`
  — **`valuationSource` هو الحقيقة**: سعرٌ صريحٌ (`explicit_policy_price`) يتقدّمُ على الأساس.
- `PUT /van-sales/policy` (إذن `van_sales.override.approve`) — دمجٌ لا استبدال: `{shortageValuationBasis?, shortageUnitPrice?, preventSelfApproval?}`؛ و`allowInternalDeliveryWithoutTax` **مرفوضٌ هنا** (قرارٌ ضريبيّ في موضعٍ آخر) — التطبيقُ لا يرسلُه أصلًا.
- `GET /van-sales/reports?salesmanId&fromDate&toDate` (إذن `van_sales.view`) → `{data: {generatedAt?, filters?, rowCap?, truncated?, policy?, summary?, periodTotals?, repCustodyReport[{salesmanId?, salesmanName?, loadedKg?, soldKg?, bonusKg?, returnedKg?, damagedKg?, shortageKg?, shortageSar?, custodyRemainingKg?, revenueSar?, collectedSar?, creditDebtSar?, netProfitSar?, pendingClosings?}], transfersReport?, collectionsReport?, productionReport?, customerPriceAuditReport?}}`
  — `periodTotals` **مجموعُ الفترة** و`summary` أرقامُ المنشأةِ الكاملة: لا يُخلطان.

## ٨. المناديب

| المسار | الإذن | ملاحظات |
|---|---|---|
| `GET /van-sales/salesmen` | `van_sales.view` | `{data: SalesmanCard[]}` — البطاقةُ الرسميّةُ بعهدتِها الحيّة: `custody{openLoadOrders, pendingReceipts, pendingClosings, custodyQty, outstandingCash, items[{itemId, itemName, warehouseName, quantity, value}]}` و`readiness{hasEmployee, hasLoginAccount, loginActive, hasVanWarehouse, hasVanSalesPermissions}` (يحسبها الخادمُ ولا يُعادُ حسابُها في العميل) |
| `POST /van-sales/salesmen/{id}/account` | `sales.salesman.manage` | `{email?, fullName?, branchScope?, restrictToVanWarehouse?}` → إيصالُ `{salesmanId, salesmanName, membershipId, email(الفعليّ), requestedEmail, reusedExistingAccount, status, roleId, roleName, employeeLinked, scopedToVanWarehouse, activationRequired}` — الحسابُ الجديدُ بلا كلمةِ مرور: `invited` + `must_change_password` ورابطُ تفعيلٍ رسميّ |

## ٩. البحث المشترك

| المسار | الشكل |
|---|---|
| `GET /warehouses` (إذن `organization.warehouse.view`) | صفحةٌ `{data: [{id, code?, name?, nameAr?, isDefault?, …}], meta}` |
| `GET /organization/catalog/items` (إذن `catalog.item.view`) | مصفوفةٌ خام (drizzle ⇒ camelCase): `[{id, sku?, nameAr?, name?, nameEn?, trackLot?, …}]` — يُقترحُ منها الصنفُ ومن `trackLot` يُطلبُ رقمُ الدفعة |
| `GET /parties?kind=customer` | مصفوفةٌ خام: `[{id, code, kind, name, legalName?, taxNo?, phone?, creditLimit?, address?, …}]` |

## ١٠. الإشعارات — `platform-services/notifications` (إذن `tenant.notification.view`)

- `GET /notifications?limit=1..200&offset&filter[read]&filter[type]` — **بلا ApiEnvelope**:
  `{data: [{id, membershipId, type, payload{title, body, href}, readAt, createdAt}], meta: {total, limit, offset, unread}}`
- `POST /notifications/{id}/read` → 201 تكرارًا آمنًا.

## ١١. الطباعة

مستنداتُ التطبيق الثلاثة تُبنى **محليًّا** من بيانات اللوحة (لا مسارَ خادمًا لها):

| المستند | المصدر | المحتوى |
|---|---|---|
| إشعارُ تحميلٍ وتسلّمِ عهدة | `LoadOrderDto` | الرقمُ/الحالة/المندوب/الصنف/الكميّة/المركبة/الدفعة/سقفُ المجاني + توقيعان |
| ملخّصُ إقفال وردية | `LoadOrderDto` | أساسُ العهدة · مبيع/مجاني/مرتجع/تالف/عجز · المتوقّعُ مقابل المُعلن · فرقُ الاعتماد · النقدُ المتوقّع/المُحصَّل/الفرق + توقيعان |
| بطاقةُ دفعةِ إنتاج | `ProductionBatchDto` | رقمُ الدفعة/الصنف/التاريخ/المنتج/الفاقد/المتاح/التكلفة |
| إيصالُ بيعةِ نقطة البيع | `PosCheckoutReceiptDto` | رقمُ الفاتورة/الإجماليُّ قبل الضريبة/الضريبة/الصافي/المدفوع/الباقي/حالةُ السداد |

وفاتورةُ المستندِ الرسميّة إن لزمت: `GET /van-sales/documents/{id}/print-view?copies=1..6`
(إذن `van_sales.view`) — كما في تطبيقِ المندوب.

</div>

## ١٢. وحداتُ «الطاقم» المنقولة من `apps/staff` (الكتالوج/المشتريات/السندات/نقطة البيع/HRM/الأدوار/التقارير)

كلُّ هذه المسارات تُستدعى بأذونها الرسميّة نفسِها، والأرقامُ نصوصٌ (numeric من PostgreSQL):

### الكتالوج — `organization/catalog`
- `GET /organization/catalog/categories` (إذن `catalog.item.view`) — مصفوفةٌ خام:
  `{id, code, nameAr, nameEn?, parentId?, sortOrder?}`.
- `GET /organization/catalog/units` — `{id, code, nameAr, nameEn?}`.
- `GET /organization/catalog/items?q=` — `{id, sku, barcode?, nameAr, categoryId?, baseUnitId?, kind, salePrice?, purchasePrice?, minQty?, trackLot, showInPos, active?…}`.
- `POST /organization/catalog/categories` (إذن `catalog.category.manage`) — `{code, nameAr, parentId?}`.
- `POST /organization/catalog/units` (إذن `catalog.unit.manage`) — `{code, nameAr}`.
- `POST /organization/catalog/items` (إذن `catalog.item.manage`) — `{sku, nameAr, categoryId, baseUnitId, barcode?, salePrice?, purchasePrice?, minQty?, trackLot?…}`.

### الفروع والخزائن
- `GET /branches` (إذن `organization.view`) — صفحةٌ `{data: [{id, nameAr, code?, isActive, isDefault}]}`.
- `GET /cash-locations` — صفحةٌ `{data: [{id, name, kind, branchId?, isDefault, changeInPos, isActive}]}`.

### المشتريات
- `GET /purchase-invoices` (إذن `purchase.view`) — مصفوفةٌ خام (آخر 100): `{id, number, invoiceDate?, partyId?, partyName?, branchId?, warehouseId?, kind, status, supplierReferenceNo?, subtotal?, taxTotal?, total?, paidTotal?, paymentStatus?, createdAt?}`.
- `POST /purchase-invoices` (إذن `purchase.invoice.create`) — `{branchId, partyId, warehouseId?, supplierReferenceNo?, lines[{itemId, quantity, unitPrice, discountRate?, taxRate?, batchNo?, expiryDate?}]}`.
- `POST /purchase-invoices/{id}/post` (إذن `purchase.invoice.post`) — `{fiscalPeriodId?, journalLines?, settlement?: credit|cash|bank, settlementAccountId?, settlementCashLocationId?}`.
- `POST /parties` (إذن `parties.manage`) — `{kind: supplier, name, taxNo?, phone?}`.

### السندات المخزنيّة — `inventory/vouchers`
- `GET /inventory/vouchers?kind=&status=&warehouse_id=` (إذن `inventory.view`) — مصفوفةٌ خام (آخر 200) مع السطور: `{id, number, kind: opening|stock_in|stock_out, status, voucherDate?, branchId?, warehouseId?, warehouseName?, reason?, notes?, lines[{itemId, qty, unitId?, unitCost?, batchNo?}]}`.
- `POST /inventory/vouchers` (إذن `inventory.adjust`) — `{branchId, warehouseId, kind, voucherDate?, reason?, notes?, lines[{itemId, qty, unitId?, unitCost?, batchNo?, expiryDate?}]}` — **بضاعةُ أوّل المدة تحتاج unitCost موجبةً لكلّ صنف**.
- `POST /inventory/vouchers/{id}/post` (إذن `inventory.adjust`) — `{fiscalPeriodId?, allowNegative?}`.

### قوائمُ الموادّ — `manufacturing`
- `GET /manufacturing/boms` (إذن `manufacturing.view`) — `{data: [{id, name, version?, productItemId?, lines[{id, componentItemId, qty, unitId?}]}]}` (آخر 200).

### نقطة البيع — `pos`
- `GET /pos/offline-data` (إذن `pos.view`) — `{data: {schemaVersion, generatedAt, items[], categories[], units[], itemUnits[], barcodes[], taxes[], customers[], branches[], warehouses[], cashLocations[], priceLists[], prices[], stock[], defaults{branchId, warehouseId, cashLocationId}}}` — الأصنافُ `showInPos` فقط.
- `POST /pos/checkout` (إذنان `pos.operate` + `sales.invoice.post`) —
  `{branchId, warehouseId?, partyId? (إلزاميٌّ للآجل), cashCustomerName?, lines[{itemId, quantity, unitPrice, taxRate?, discountAmount?}], payment{method: cash|card|bank|credit, cashLocationId?, tendered?}, payments?[]}`
  ← يُعيد `{data: {invoiceId, number, subtotal, taxTotal, total, paidTotal, paymentStatus, method, change, shiftId}}` — **رقمُ الفاتورة من الخادم**.

### المواردُ البشريّة — `hrm`
- `GET /hrm/employees?q=&status=&branch_id=&department_id=&job_id=` (إذن `hrm.view`) — مصفوفةٌ خام من بطاقات الموظفين: `{id, employeeNo, name, status, branchId?, departmentId?, departmentName?, managementName?, jobId?, jobName?, hireDate?, phone?, mobile?, email?, nationalId?, accountCode?, totalSalary, salaryComponents{code→قيمة نصّيّة}}`.
- `POST /hrm/employees` (إذن `hrm.manage`) — `{employeeNo, name, branchId?, departmentId?, jobId?, hireDate?, gender?, phone?, mobile?, email?, salaryComponents?}`.
- `GET /hrm/departments` / `GET /hrm/jobs` — مصفوفتان خامتان.
- `GET /hrm/adjustments?employee_id=&status=` (إذن `hrm.view`) — `{data: [{id, employeeId, employeeName?, employeeNo?, typeId?, typeCode?, typeName?, kind: addition|deduction, valueText, startsOn, endsOn?, recurring, paymentMethod?, cashLocationName?, reason?, number?, status: draft|approved, createdAt?}]}`.
- `POST /hrm/adjustments` (إذن `hrm.manage`) — `{employeeId, typeId?|typeCode?, kind?, componentCode?, valueText, startsOn, endsOn?, recurring?, subFromSalary?, paymentMethod?: cash|bank, cashLocationId?, reason?, postEntry?}`.
- `POST /hrm/adjustments/{id}/approve` (إذن `hrm.adjust.approve`) — يحوّل draft → approved.
- `GET /hrm/payroll/runs` (إذن `hrm.view`) — `{data: [{id, yearMonth, periodId?, currency?, status: draft|posted|paid, summary{preview{yearMonth, employeeCount, netPayable, lines[{employeeId, employeeName, gross, additions, deductions, net}]}}, createdAt?}]}`.
- `POST /hrm/payroll/runs` (إذن `hrm.manage`) — `{yearMonth, periodId?, currency?, unpaidDaysByEmployee?}`.
- `POST /hrm/payroll/runs/{id}/post` (إذن `hrm.payroll.post`) — `{journalEntryId?, branchId?, fiscalPeriodId?, journalLines?}`.
- `POST /hrm/payroll/runs/{id}/pay` (إذن `hrm.payroll.post`) — **`{branchId, cashLocationId}` إلزاميّان** + `method?: cash|cheque|bank_transfer|card`.
- `GET /hrm/employee-statement?employee_id=&from=&to=&branch_id=&full_period=` (إذن `hrm.view`) — `{data: {employee{id, employeeNo, name, accountCode, accountName}, branchId?, from?, to?, fullPeriod, summary{totalDebit, totalCredit, balanceDebit, balanceCredit}, rows[{seq, date, entryId?, entryNumber?, description?, debit, credit, runningBalance?, balanceStatus?, branchName?, entryType?}]}}`.
- `GET /hrm/salary-payments?employee_id=` (إذن `hrm.view`) — `{data: [{id, number, employeeId, employeeName?, branchName?, yearMonth, paymentDate, method, cashLocationName?, net, voucherNumber?, voucherStatus?, notes?, createdAt?}]}`.

### الخزينة والمصروفات
- `GET /vouchers?from=&to=&q=` (إذن `treasury.view`) — مصفوفةٌ خام (آخر 500): `{id, branchId, kind: receipt|payment, subtype: customer|supplier|expense|account|salary|vat|other, number, date, partyId?, counterAccountId?, cashLocationId?, method: cash|cheque|bank_transfer|card, amount, vatAmount?, netAmount?, currency?, chequeNo?, chequeState?, referenceNo?, recipient?, description?, voucherTime?, status: draft|posted|void, postedAt?, createdByName?}`.
- `POST /vouchers` (إذن `treasury.voucher.create`) — `{branchId, kind, subtype, date, partyId?, counterAccountId?, cashLocationId, method, amount, description?, voucherTime?, idempotencyKey?}` — الحسابُ المقابل يُحسم من الطرف أو ملفّ الترحيل، وإلا 422 `COUNTER_ACCOUNT_REQUIRED`.
- `POST /vouchers/{id}/post` (إذن `treasury.voucher.post`) — `{fiscalPeriodId?, journalLines?, allocations?}`.
- `GET /accounts` (إذن `accounting.account.view`) — `{data: [{id, code, nameAr?, type?, isPostable?…}]}` (للحساب المقابل اختياريًّا).

### المخزون والأرصدة
- `GET /inventory/levels?warehouse_id=&item_id=` (إذن `inventory.view`) — مصفوفةُ `stock_balances` خامًا: `{itemId, warehouseId, quantity, value, averageCost, updatedAt}` (بلا أسماء — تُجلبُ محليًّا من الكتالوج).
- `GET /inventory/movements?item_id=&warehouse_id=&from=&to=&limit=` — مصفوفةٌ خام: `{id, itemId, sku, itemNameAr, warehouseId?, warehouseNameAr?, direction: in|out, qty, baseQty, unitNameAr?, unitCost?, totalCost?, docType, occurredAt}`.
- `GET /inventory/item-card?item_id=&warehouse_id=&from=&to=` — كائنٌ خام: `{itemId, sku, nameAr, opening{quantity,value}, totals{inQty,inValue,outQty,outValue}, closing{quantity,value}, rows[…movement + balanceQty, balanceValue, averageCost]}` — الرصيدُ الجاري كميّةً وقيمةً.
- `GET /inventory/adjustments?status=` — مصفوفةٌ خام مع السطور: `{id, number, branchId, warehouseId, reason, status: draft|posted, createdAt?, lines[{itemId, expectedQty, countedQty, unitCost?, varianceQty?, varianceValue}]}`.
- `POST /inventory/adjustments` (إذن `inventory.adjust`) — `{branchId, warehouseId, reason, lines[{itemId, countedQty, unitId?, unitCost?, batchNo?, note?}]}` — **countedQty الكميّةُ المعدودةُ المطلقة** والخادمُ يحسبُ التباين من الدفتر.
- `POST /inventory/adjustments/{id}/post` (إذن `inventory.adjust`) — `{approved?, fiscalPeriodId?, counterAccountId?, allowNegative?}` — فرقُ العجز/الفائض يُقيَّد على حساب الفرق.

### الأطراف وكشوفها
- `GET /parties?kind=customer|supplier` (إذن `parties.view`) — مصفوفةٌ خام: `{id, code, kind, name, legalName?, taxNo?, phone?, creditLimit?, address?}`.
- `POST /parties` (إذن `parties.manage`) — `{kind, name, taxNo?, phone?, creditLimit?}`.
- `GET /parties/{id}/balance?asOf=` (إذن `parties.view`) — كائنٌ خام: `{receivable, payable, open[{entryId, accountId, date, debit, credit, allocated}]}` — من القيود **المرحّلة** فقط.

### المنظّمة والأدوار
- `GET /sales/salesmen` (إذن `sales.view`) — مصفوفةٌ خام: `{id, name, active, employeeId?, commissionRate, collectionCommissionRate, profitCommissionRate, tel?, mobile?, notes?}`.
- `POST /sales/salesmen` (إذن `sales.salesman.manage`) — `{name, employeeId?, active?, commissionRate?, collectionCommissionRate?, profitCommissionRate?, tel?, mobile?, notes?}`.
- `GET /memberships` (إذن `tenant.membership.manage`) — صفحةٌ `{data: [{id, displayName, status, isOwner, kind, branchScope: uuid[]|null, roles[{id, name, isSystem}]}]}`.
- `GET /memberships/assignable-roles` — `{data: [{id, name, isSystem}]}`.
- `POST /memberships` — `{email, fullName?, displayName?, branchScope?, roleIds (واحدٌ على الأقلّ)}`.
- `GET /roles` (إذن `tenant.role.manage`) — صفحةٌ `{data: [{id, name, description?, isSystem, permissionCodes[]}]}`.
- `POST /roles` — `{name, description?, permissionCodes[]}` (أذوناتٌ من الفهرس لا تُخترع).
- `GET /permissions` — عامٌّ للهويّة: `{data: [{code, module, description}]}`.

### حزمةُ التقارير — `reports`
- `GET /reports` (إذن `reporting.view`) — فهرسٌ خام: `{key, titleAr, group, hintAr?, params[], columns[], totals[], grandTotal[], chart?}`.
- `GET /reports/{key}?branch_id=&from=&to=&month=` — كائنٌ خام: `{key, titleAr, group, hintAr?, params, columns[{key, labelAr, type: text|money|qty|int|date|percent, hidden?}], rows[{key→قيمة نصّيّة}], totals{key→قيمة}, grandTotal[{key, labelAr, amount}], rowCount, generatedAt}` — **كلُّ الحساب عند الخادم**.

</div>
