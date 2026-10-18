# مرجعُ واجهةِ البرمجة (API) لتطبيقِ المندوب — أندرويد

> **الغرض:** هذا المستند هو قائمةُ المسارات الرسمية وأشكالُ الطلبات والاستجابات **كما هي في الخادم فعلًا**، لاستعمالها في إصلاح تطبيق المندوب على أندرويد. كلّ شكلٍ هنا مقروءٌ من الكود المصدري للخادم (`apps/api/src/modules/van-sales/van-sales.service.ts` و`van-sales.controller.ts` و`packages/contracts/src/platform/auth.ts`) لا من وثيقةٍ قديمة.
>
> **تاريخ المطابقة:** 2026-10-18 · **السطح:** `apps/bakery/app/rep` (تطبيق المندوب)

---

## ١. قواعدُ عامةٌ قبل أيّ شيء

| القاعدة | التفصيل |
|---|---|
| **العنوان الأساسي** | `https://<الخادم>/api/v1` — في التطوير عادةً `http://<ip>:3000/api/v1`. كلّ المسارات أدناه **بلا** البادئة `/api/v1` (أضفها أنت). |
| **المصادقة** | ترويسة `Authorization: Bearer <accessToken>` في كلّ طلب ما عدا `login` و`refresh`. لا يوجد ترويسة «tenant»: المستأجر يُشتقّ **من الرمز** نفسه. |
| **نوع المحتوى** | `Content-Type: application/json` لكلّ POST/PUT. |
| **انتهاء الرمز** | الرمزُ المُتاح قصير العمر (٩٠٠ ثانية). عند استلام **401**: نداءٌ واحد لـ `POST /auth/refresh` ثمّ إعادة الطلب الأصلي. إن فشل التجديد → خروجٌ لشاشة الدخول. |
| **الأرقام نصوص!** | كلّ الكميات والقيم المالية ترجع **سلاسل نصّية** (`"12.5000"`, `"456.00"`) لأنها `numeric` من PostgreSQL. استعمل `BigDecimal`/عشريًّا دقيقًا ولا تحوّلها إلى `double`. |
| **الغلاف** | أغلبُ المسارات تلفّ النتيجة في `{ "data": … }`. **الاستثناء المهم:** `GET /parties` ترجع **مصفوفةً خامًا بلا غلاف** (انظر §٦). |
| **نجاح POST** | كلّ مسارات `van-sales` الـPOST ترجع **201 Created** (لا 200). اعتبر أيّ 2xx نجاحًا. |

### شكلُ الخطأ (كلّ الأخطاء — RFC 9457 `application/problem+json`)

```json
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "detail": "أدخل الكمية المباعة بالكيلو",
  "traceId": "بصمة-تتبع",
  "errors": [ { "field": "soldQty", "message": "…" } ]
}
```

- **`detail`** هو النصُّ العربيّ الذي يجب أن يُعرض للمندوب **كما هو** (هكذا بُني الخادم).
- **`code`** رمزٌ ثابتٌ تُبنى عليه معالجةُ الحالات برمجيًّا (انظر §٩).
- `errors` اختياريّ، و`errors[].field` يحدّد الحقل المسؤول.

---

## ٢. خريطةُ المسارات — ملخّصٌ سريع

| # | الطريقة والمسار | الصلاحية المطلوبة | نجاح | الغرض |
|---|---|---|---|---|
| 1 | `POST /auth/login` | عامّة | 200 | الدخول |
| 2 | `POST /auth/refresh` | عامّة | 200 | تجديد الرمز |
| 3 | `POST /auth/logout` | Bearer | 204 | الخروج |
| 4 | `GET /me` | Bearer | 200 | هوية الجلسة والصلاحيات |
| 5 | `GET /van-sales/me` | `van_sales.view` | 200 | مساحةُ عمل المندوب كاملة |
| 6 | `GET /parties?kind=customer` | `parties.view` | 200 | قائمةُ العملاء |
| 7 | `POST /van-sales/documents` | `van_sales.invoice.create` | 201 | مستندُ بيع |
| 8 | `POST /van-sales/documents/:id/returns` | `van_sales.invoice.create` | 201 | مرتجعُ عميل |
| 9 | `POST /van-sales/collections` | `van_sales.collection.create` | 201 | تحصيلُ دين |
| 10 | `POST /van-sales/load-orders/:id/confirm-receipt` | `van_sales.view` | 201 | تأكيدُ استلام توريد |
| 11 | `POST /van-sales/load-orders/:id/submit-closing` | `van_sales.closing.submit` | 201 | إغلاقُ الوردية |
| 12 | `GET /van-sales/documents/:id/print-view?copies=2` | `van_sales.view` | 200 | نسختا الطباعة |

> **تنبيه مهمّ:** لا يوجد مسار «إعادة مزامنة جماعية» للتوزيع. لا تُنادِ `POST /van-sales/offline-sync` (غير موجود — 404). كلُّ نيّةٍ محفوظة دون اتصالٍ تُعاد إلى **مسارها الرسميّ نفسه** في الجدول أعلاه.

> **خطأ 403 الدلالي:** إن استلمت 403 برسالة `permission <code> required` فهذا نقصُ صلاحيةٍ في الدور، وإن استلمت 403 برمز `VAN_SALES_COMPANY_SCOPE_REQUIRED` فأنت تنادي مسارًا مكتبيًّا لا مسارًا للمندوب.

---

## ٣. المصادقةُ والجلسة

### ٣.١ `POST /auth/login` — الدخول

**الطلب:**

```json
{
  "email": "rep@example.com",
  "password": "••••••••••••",
  "tenantCode": "BAKERY1",
  "mfaCode": "123456"
}
```

- `mfaCode` اختياريّ (٦ أرقام TOTP أو كود استرجاع `XXXX-XXXX`) — يُرسل فقط إن كان مفعّلًا.
- حدُّ المعدّل: إن تجاوزت المحاولات يرجع **429 `RATE_LIMITED`**. المنشأةُ الموقوفة ترجع **423 `TENANT_SUSPENDED`**. بياناتٌ خاطئة → **401 `UNAUTHENTICATED`**.

**الاستجابة 200:**

```json
{
  "data": {
    "accessToken": "eyJhbGciOi…",
    "refreshToken": "d8f1c…",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "user": {
      "id": "0f9c…",
      "email": "rep@example.com",
      "fullName": "أحمد المندوب",
      "phone": null,
      "status": "active",
      "isPlatformAdmin": false,
      "platformRoles": [],
      "mustChangePassword": false,
      "lastLoginAt": "2026-10-17T08:14:03.120Z"
    },
    "memberships": [
      {
        "id": "3a1b…",
        "tenantId": "9d2e…",
        "tenantCode": "BAKERY1",
        "tenantName": "مخبز النور",
        "displayName": "أحمد المندوب",
        "status": "active",
        "isOwner": false,
        "branchScope": null,
        "roles": [
          { "id": "r-01", "name": "مندوب توزيع", "description": null, "isSystem": true }
        ],
        "kind": "staff",
        "scopes": [],
        "maxDiscountPct": null,
        "maxDiscountAmount": null
      }
    ]
  }
}
```

احفظ `accessToken` و`refreshToken` و`tenantCode` محليًّا. المستخدم قد يملك أكثر من عضوية — إن كان كذلك اعرض اختيارًا؛ رمزُ الدخول مرتبطٌ بالعضوية المختارة.

### ٣.٢ `POST /auth/refresh` — التجديد الصامت

**الطلب:** `{ "refreshToken": "…" }` → **الاستجابة 200:** نفسُ شكل استجابة الدخول بالضبط (`data.accessToken`, `data.refreshToken`, `data.expiresIn`, …). استبدل الرمزين القديمين بالجديدين (التجديد يُستهلك — الرمزُ القديم يُلغى). فشلُه → 401 والجلسة منتهية.

### ٣.٣ `POST /auth/logout` — الخروج

**الطلب:** `{}` مع ترويسة Bearer → **204 بلا جسم**. احذف الرمزين محليًّا حتى لو فشل النداء.

### ٣.٤ `GET /me` — هوية الجلسة

**الاستجابة 200:**

```json
{
  "data": {
    "user": { "id": "…", "email": "…", "fullName": "…", "phone": null, "status": "active", "isPlatformAdmin": false, "platformRoles": [], "mustChangePassword": false, "lastLoginAt": "…" },
    "membership": {
      "id": "…", "tenantId": "…", "tenantCode": "BAKERY1", "tenantName": "…",
      "displayName": "…", "status": "active", "isOwner": false,
      "branchScope": null,
      "roles": [ { "id": "…", "name": "مندوب توزيع", "description": null, "isSystem": true } ],
      "kind": "staff", "scopes": [],
      "maxDiscountPct": null, "maxDiscountAmount": null
    },
    "permissions": ["van_sales.view", "van_sales.invoice.create", "van_sales.collection.create", "van_sales.closing.submit", "parties.view"],
    "platformPermissions": [],
    "impersonation": null,
    "branchScope": null,
    "enabledApps": ["van_sales", "bakery_distribution"]
  }
}
```

- **`permissions` هي أساسُ إظهار/إخفاء الأزرار** في التطبيق (دور «مندوب توزيع» يحمل عادةً الأربعة `van_sales.*` + `parties.view`). الخادمُ يبقى الحارسَ النهائيّ مهما أخفيت.
- `impersonation` غير null إذا كانت الجلسة جلسةَ دعمٍ مؤقتة.

---

## ٤. `GET /van-sales/me` — مساحةُ عمل المندوب (الحمولةُ الرئيسية)

هذا المسارُ الوحيدُ الذي يبني منه التطبيقُ شاشته. الخادم يشتقّ المندوبَ **من عضوية المتصل** (لا يوجد معامل `salesmanId` في الطلب — ولا يجوز أن يكون).

### ٤.١ الحالة أ: الحساب **مرتبط** ببطاقة مندوب (`isRep: true`)

```json
{
  "data": {
    "isRep": true,
    "salesmanId": "5c6f…",
    "salesmanName": "أحمد المندوب",
    "employeeId": "1d2e…",
    "warehouseId": "w-77",
    "vehiclePlate": "أ ب ج 123",
    "active": true,
    "custodyKg": "120.0000",
    "custodyValue": "456.0000",

    "balances": [
      {
        "itemId": "it-01", "itemName": "خبز صامولي", "sku": "BREAD-01",
        "warehouseId": "w-77", "warehouseName": "سيارة أ ب ج 123",
        "warehouseCode": "VAN-01", "branchId": "br-01",
        "quantity": "120.0000", "value": "456.0000", "averageCost": "3.8000"
      }
    ],

    "pendingReceipts": [
      {
        "id": "lo-09", "number": "VLO-000009", "loadDate": "2026-10-18",
        "status": "pending_receipt",
        "loadedQty": "80.0000", "receivedQty": "0.0000",
        "productionBatchNo": "BAT-000120", "stockTransferId": "st-31",
        "itemName": "خبز صامولي", "fromWarehouseName": "المستودع الرئيسي"
      }
    ],

    "loadOrders": [
      {
        "id": "lo-05", "number": "VLO-000005", "loadDate": "2026-10-17",
        "status": "loaded",
        "itemName": "خبز صامولي", "productionBatchNo": "BAT-000118",
        "loadedQty": "100.0000", "receivedQty": "100.0000",
        "soldQty": "60.0000", "bonusQty": "5.0000",
        "returnedQty": "2.0000", "damagedQty": "1.0000",
        "shortageQty": "0.0000", "shortageValue": "0.0000",
        "expectedCash": "300.0000", "collectedCash": "280.0000", "outstandingCash": "20.0000",
        "expectedRemainingQty": "32.0000",
        "actualRemainingQty": "0.0000",
        "discrepancyQty": "0.0000", "discrepancyNotes": "",
        "stockSettlementStatus": "not_required", "stockSettlementNote": "",
        "remainingAction": null,
        "closingSubmittedAt": null, "approvedAt": null
      }
    ],

    "documents": [
      {
        "id": "vd-21", "number": "VSD-000021", "docDate": "2026-10-17",
        "documentKind": "sale",
        "invoiceMode": "zatca_tax",
        "paymentMethod": "cash",
        "customerName": "بقالة النور",
        "itemName": "خبز صامولي",
        "soldQty": "20.0000", "bonusQty": "2.0000", "unitPrice": "4.0000",
        "subtotal": "80.00", "taxTotal": "12.00", "total": "92.00",
        "paidAmount": "92.00", "outstanding": "0.00",
        "salesInvoiceId": "si-88", "invoiceNumber": "INV-000101", "invoiceStatus": "posted"
      }
    ],

    "collections": [
      {
        "id": "mv-40", "collectedAt": "2026-10-17T12:30:05.000Z",
        "amount": "50.00", "reason": "تحصيل دفعة من فاتورة آجلة",
        "voucherId": "vv-12", "voucherNumber": "RV-000007", "voucherStatus": "posted"
      }
    ],

    "totals": {
      "revenue": "1500.00",
      "salesGross": "1700.00",
      "cashSales": "1200.00",
      "creditSales": "500.00",
      "collected": "400.00",
      "outstanding": "100.00",
      "returns": "180.00",
      "returnsVat": "20.00",
      "returnCount": 2,
      "returnsWithoutCostCount": 0
    },

    "custody": {
      "expectedKg": "120.0000",
      "officialKg": "120.0000",
      "pendingClosings": 1
    },

    "windows": {
      "loadOrders":     { "returned": 50, "total": 63,  "limit": 50 },
      "documents":      { "returned": 100, "total": 214, "limit": 100 },
      "collections":    { "returned": 50, "total": 50,  "limit": 50 },
      "notifications":  { "returned": 20, "total": 34,  "limit": 20 }
    },

    "notifications": [
      {
        "id": "n-01", "type": "van_sales_closing_request",
        "read": false, "createdAt": "2026-10-17T14:02:11.000Z",
        "payload": { "title": "…", "body": "…", "href": "/van-sales?tab=loads" }
      }
    ]
  }
}
```

#### دلالاتُ الحقول الحرجة

| الحقل | الدلالة |
|---|---|
| `custodyKg` / `custodyValue` | الرصيدُ الرسميّ **في السيارة الآن** من دفتر المخزون (`balances` مجمّعة). كاملٌ بلا نافذة. |
| `balances` | أرصدةُ كلّ صنفٍ في سيارة المندوب — **كاملة** (لا حدّ لها). |
| `pendingReceipts` | توريدٌ في الطريق بانتظار أن يؤكّد المندوبُ استلامَه (زرّ «تأكيد الاستلام»). **كاملة** (لا حدّ). |
| `loadOrders` | نافذةُ **أحدث ٥٠** أمر تحميل. أوامرُ البيع منها: `status === 'loaded'` و`expectedRemainingQty > 0`. |
| `documents` | نافذةُ **أحدث ١٠٠** مستند. المرتجعُ منها `documentKind === 'return'`؛ البيعُ منها `'sale'`. |
| `collections` | نافذةُ **أحدث ٥٠** حركة تحصيل. |
| `notifications` | نافذةُ **أحدث ٢٠** إشعارًا (لا خدمةَ دفعٍ في هذا الإصدار — اقترب بالتحديث). |
| `totals` | مجاميعُ **جدول المندوب كلّه** (ليست مجموع النوافذ!). المعادلتان: `revenue = salesGross − returns − returnsVat` و`cashSales + creditSales − returns − returnsVat = revenue`. |
| `custody.expectedKg` | ما يجب أن يبقى في السيارة حسب المستندات (على أساس **المستلَم** فعلًا). |
| `custody.officialKg` | نفسُ `custodyKg` (الرصيدُ الرسميّ من دفتر المخزون). |
| `custody.pendingClosings` | عددُ الإغلاقات بانتظار اعتماد المحاسب. |
| `windows` | يُعلن لكلّ قائمة `{returned, total, limit}` — اعرض «أحدث ٥٠ من ٦٣» ولا تفترض القائمةَ كلَّ شيء. |
| `loadOrders[].discrepancyQty` | **نقصُ الاستلام** `max(0, loaded − received)` — ليس فرقَ الجرد. |
| `loadOrders[].shortageQty` / `shortageValue` | **العجزُ المُعلن عند الإقفال** (يملؤه الخادم بعد `submit-closing`). |
| `loadOrders[].expectedRemainingQty` | ما تقول المستنداتُ إنه يجب أن يبقى — منه يُحسب سقفُ البيع المتبقي. |
| `loadOrders[].status` | القيم: `draft` → `pending_receipt` → `loaded` → `in_route` → `pending_closing` → `pending_stock_settlement` → `settled`، و`canceled` و`rejected`. |

### ٤.٢ الحالة ب: الحساب **غير مرتبط** ببطاقة مندوب (`isRep: false`)

```json
{
  "data": {
    "isRep": false,
    "salesmanId": null,
    "salesmanName": null,
    "warehouseId": null,
    "vehiclePlate": null,
    "balances": [],
    "pendingReceipts": [],
    "loadOrders": [],
    "documents": [],
    "collections": [],
    "custody": null,
    "notifications": [],
    "message": "حسابك غير مرتبط ببطاقة مندوب توزيع — اطلب من المحاسب ربطك من شاشة المندوبين"
  }
}
```

⚠️ **لاحظ:** في هذه الحالة **لا توجد** حقول `totals` ولا `windows` ولا `custodyKg` ولا `active` أصلًا — غيابُها معنويّ لا نقصٌ يُعوَّض بصفر. اعرض `message` كما هي.

---

## ٥. مسارُ قراءةٍ واحدٌ لكلّ تحديث

التطبيقُ لا يجمع الأرقامَ محليًّا أبدًا: بعد كلّ إجراءٍ ناجحٍ (٢xx) **أعد نداء `GET /van-sales/me`** وأعد رسم الشاشة منه. الأرقامُ المعروضة دون اتصالٍ هي «آخر قراءةٍ ناجحة» — قل ذلك ولا تخترع تحديثًا.

---

## ٦. `GET /parties?kind=customer` — قائمةُ العملاء

⚠️ **مصيدة شائعة:** هذا المسار يرجع **مصفوفةً خامًا بلا غلاف `data`**:

```json
[
  {
    "id": "p-01", "tenantId": "9d2e…", "code": "CUST-GEN",
    "kind": "customer", "name": "عميل عام", "legalName": "عميل عام",
    "taxNo": "3001234567", "nationalId": null,
    "address": { "city": "المكلا", "street": "…" },
    "phone": "777123456", "email": null,
    "receivableAccountId": "acc-01", "payableAccountId": null,
    "creditLimit": "0", "isOwner": false, "isContractor": false,
    "branchId": null, "paymentMethodId": null,
    "createdAt": "2026-09-01T10:00:00.000Z", "createdBy": null,
    "updatedAt": null, "updatedBy": null, "version": 1, "deletedAt": null,
    "customFields": {}
  }
]
```

- الحقول **camelCase** (`legalName`, `taxNo`, `creditLimit`). الاسمُ المعروض من `name` (وليس `nameAr`).
- المرشِّح `kind=customer` إلزاميّ لتقييد القائمة بالعملاء. الحدّ الأقصى ١٠٠ صفٍّ (أحدثُها أولًا).
- الاستجابة قد تكون مصفوفةً فارغة `[]` — تُعامل كقائمةٍ صحيحةٍ لا كخطأ.

---

## ٧. الإجراءاتُ (كلّها POST إلا الطباعة)

### ٧.١ `POST /van-sales/documents` — مستندُ بيع (فاتورة)

**الطلب:**

```json
{
  "loadOrderId": "lo-05",
  "partyId": "p-01",
  "customerName": "محل تجزئة نقدي",
  "invoiceMode": "zatca_tax",
  "paymentMethod": "cash",
  "cashLocationId": "cl-01",
  "soldQty": "20.00",
  "bonusQty": "2.00",
  "bonusReason": "اتفاق ترويجي",
  "unitPrice": "4.00",
  "discountAmount": "0.00",
  "discountReason": "خصم كمية",
  "customerBonusConfirmed": true,
  "customerConfirmationCode": "4321",
  "notes": "ملاحظة",
  "idempotencyKey": "rep-document:a1b2c3d4:9f8e7d6c5b4a3210"
}
```

| الحقل | القاعدة |
|---|---|
| `loadOrderId` | **إلزاميّ** — البيع من أمر التحميل الخاص بالمندوب فقط (422 بدونه). |
| `partyId` أو `customerName` | عميلٌ ببطاقة (`partyId`) **أو** اسمُ عميلٍ نقديّ حرّ (`customerName`). أرسل أحدهما؛ مع `partyId` يُهمل `customerName`. |
| `soldQty` | إلزاميّ > 0 (أو `bonusQty` > 0). |
| `bonusQty`/`discountAmount` | أرسلها دومًا (`"0"` إن لا شيء). |
| `unitPrice` | إن لم يُرسل، يُسعَّر من التدرّج: سعرُ العميل+الصنف ← سعرُ العميل العامّ ← قائمةُ الأسعار الافتراضيّة ← بطاقةُ الصنف. |
| `invoiceMode` | `'zatca_tax'` (فاتورة ضريبية) أو `'internal_delivery'` (تسليم داخلي). |
| `paymentMethod` | `'cash'` / `'card'` / `'credit'`. |
| `allowPriceDiscountOverride` / `allowBonusOverride` | **لا ترسلهما** من حساب المندوب — يحتاجان `van_sales.override.approve` وإلا **403**. |
| `idempotencyKey` | اختياريّ لغويًّا، **إلزاميٌّ عمليًّا** للطابور (انظر §٨). إعادةُ المفتاح نفسه ترجع **201 بلا مستندٍ ثانٍ**. |

**الاستجابة 201:** `{ "data": { …لوحة الخطّ… } }` — انظر §٨ (ليست بطاقةَ مستند!). **الاستعمال الصحيح:** اعتبر 201 نجاحًا وأعد قراءة `GET /van-sales/me`.

**أهمُّ الرفضات:** 409 `VAN_LOAD_ORDER_NOT_RECEIVED` (لم يؤكَّد استلامُ التوريد بعد) · 422 تجاوزُ المتبقي في السيارة · 422 الرصيدُ الرسميّ لا يكفي · 403 `VAN_SALES_NOT_YOUR_LOAD` · 422 `VAN_ZATCA_SELLER_IDENTITY_REQUIRED` (بياناتُ البائع الضريبية ناقصة عند المنشأة) · 422 `VAN_SALES_INTERNAL_DELIVERY_POLICY_REQUIRED` · 422 `PARTY_CREDIT_LIMIT_EXCEEDED` (تجاوزُ سقف الائتمان على آجل).

### ٧.٢ `POST /van-sales/documents/:id/returns` — مرتجعُ عميل

المعامل `:id` = معرّف **مستند البيع الأصلي** (لا رقمُه — استخدم `documents[].id`).

**الطلب:**

```json
{
  "returnedQty": "3.00",
  "reason": "خبز متيبس",
  "notes": "أُرجع غدًا صباحًا",
  "idempotencyKey": "rep-return:b2c3d4e5:1a2b3c4d5e6f7080"
}
```

**الاستجابة 201:** `{ "data": { …لوحة الخطّ… } }` (نفس القاعدة).

**الرفضات:** 422 بلا مستند/كمية ≤ 0 · 422 «لا يمكن إرجاع مرتجع» (المستند المصدر `documentKind === 'return'`) · 422 إجماليُّ المرتجع يتجاوز `(soldQty + bonusQty)` للمستند الأصلي (الخادم يجمع **كلّ** مرتجعاته السابقة) · 403 `VAN_SALES_NOT_YOUR_DOCUMENT` · 404.

### ٧.٣ `POST /van-sales/collections` — تحصيلُ دين

**الطلب:**

```json
{
  "documentId": "vd-22",
  "collectedAmount": "50.0000",
  "cashLocationId": "cl-01",
  "offsetAccountId": "acc-02",
  "notes": "دفعة أولى",
  "idempotencyKey": "rep-collection:c3d4e5f6:2b3c4d5e6f708190"
}
```

- `documentId` = مستندُ بيعٍ **آجلٍ غير مسدَّد** (من `documents` حيث `outstanding > 0` و`documentKind === 'sale'`).
- `cashLocationId` اختياريّ (الصندوق الذي يستقرّ فيه النقد).
- **الاستجابة 201:** `{ "data": { …لوحة الخطّ… } }`.
- **الرفضات:** 422 بلا مستند/مبلغ ≤ 0 · 409 `INVOICE_ALREADY_PAID` · 422 المبلغُ يتجاوز المتبقي على الفاتورة · 403 `VAN_SALES_NOT_YOUR_DOCUMENT` · 404.

### ٧.٤ `POST /van-sales/load-orders/:id/confirm-receipt` — تأكيدُ استلام التوريد

`:id` = معرّف أمر التحميل من `pendingReceipts[].id`.

**الطلب:**

```json
{ "receivedQty": "78.00", "notes": "نقص كرتونين عند التحميل" }
```

- `receivedQty` اختياريّ: إن أُهمل أو أُرسل فارغًا يعتمد الخادمُ الكميةَ المحمَّلة كاملةً.
- **لا يوجد `idempotencyKey` في هذا المسار** — انظر §٨.
- **الاستجابة 201:** `{ "data": { …لوحة الخطّ… } }`.
- **الرفضات:** 409 `VAN_LOAD_ORDER_NOT_AWAITING_RECEIPT` («تم تأكيد استلام أمر التحميل هذا مسبقًا ولا يمكن تكرار الاستلام») · 422 الكميةُ المستلمة سالبة أو تتجاوز المحمَّل · 403 (تأكيدُ عهدة مندوبٍ آخر) · 404 · 409 `VAN_WAREHOUSE_UNDER_SETTLEMENT`.

### ٧.٥ `POST /van-sales/load-orders/:id/submit-closing` — إغلاقُ الوردية

`:id` = معرّف أمر التحميل المُقفَل.

**الطلب:**

```json
{
  "returnedQty": "2.00",
  "damagedQty": "1.00",
  "damageReason": "تالف أثناء النقل",
  "collectedCash": "280.0000",
  "actualRemainingQty": "31.50",
  "vehicleCountQty": "45.00",
  "closingNotes": "وردية عادية"
}
```

| الحقل | القاعدة |
|---|---|
| `returnedQty`, `damagedQty`, `collectedCash`, `closingNotes` | اختيارية (تُعامل صفرًا/فارغًا). |
| `damageReason` | **إلزاميّ إذا `damagedQty > 0`** (422 بدونه). |
| `actualRemainingQty` | المتبقي **بهذا الأمر** بالجرد. إن لم يُرسل يُعامل **صفرًا** (كلُّ غيرِ المحسوب عجزٌ على المندوب). |
| `vehicleCountQty` | عددُ المركبة **كلها** — **بديلٌ عن** `actualRemainingQty` لا رفيقٌ له: الخادم يشتقّ نصيبَ هذا الأمر بعد طرح عهدة الأوامر الأخرى. لا ترسلهما معًا. |
| `idempotencyKey` | **غير موجود في هذا المسار** — انظر §٨. |

- **الاستجابة 201:** `{ "data": { …لوحة الخطّ… } }`. بعدها يصبح `status = 'pending_closing'` بانتظار اعتماد المحاسب.
- **الرفضات:** 409 `VAN_LOAD_ORDER_ALREADY_SETTLED` (فقط إذا صار `settled`) · 422 مجموعُ الكميات يتجاوز العهدة المستلمة · 422 بلا سبب تلف · 422 `VAN_VEHICLE_COUNT_BELOW_OTHER_CUSTODY` و`VAN_VEHICLE_COUNT_CONFLICTS_WITH_ORDER_COUNT` و`VAN_VEHICLE_COUNT_INVALID` · 403 `VAN_SALES_NOT_YOUR_LOAD` · 404.

### ٧.٦ `GET /van-sales/documents/:id/print-view?copies=2` — نسختا الطباعة

**الاستجابة 200** — مستندٌ واحدٌ معروضٌ بعدد نسخ:

```json
{
  "data": {
    "documentId": "vd-21",
    "documentNumber": "VSD-000021",
    "invoiceNumber": "INV-000101",
    "invoiceStatus": "posted",
    "saleDate": "2026-10-17",
    "companyName": "مخبز النور",
    "companyNameEn": "Al-Noor Bakery",
    "companyTaxNo": "3001234567",
    "companyCrNo": "10-123",
    "companyEmail": "info@…",
    "companyPhones": ["777000111"],
    "companyAddress": { "city": "المكلا" },
    "customerName": "بقالة النور",
    "customerTaxNo": "3009876543",
    "customerPhone": "", "customerMobile": "",
    "salesmanName": "أحمد المندوب",
    "salesmanMobile": "",
    "vanWarehouseName": "سيارة أ ب ج 123",
    "loadOrderNumber": "VLO-000005",
    "productionBatchNo": "BAT-000118",
    "invoiceMode": "zatca_tax",
    "taxPolicyStatus": "standard_vat",
    "paymentMethod": "cash",
    "lines": [
      { "kind": "sale", "itemName": "خبز صامولي", "sku": "BREAD-01", "quantity": "20.000", "unitPrice": "4.00", "discount": "0.00", "lineTotal": "80.00" },
      { "kind": "bonus", "itemName": "خبز صامولي — كمية مجانية (بونص)", "sku": "BREAD-01", "quantity": "2.000", "unitPrice": "0.00", "discount": "0.00", "lineTotal": "0.00", "reason": "ترويجي" }
    ],
    "subtotal": "80.00",
    "discountTotal": "0.00",
    "vatRate": "15.00",
    "vatTotal": "12.00",
    "grandTotal": "92.00",
    "paidAmount": "92.00",
    "outstandingAmount": "0.00",
    "bonusQtyTotal": "2.000",
    "qrPayload": "TLV…رمز ZATCA من الخادم…",
    "notes": "",
    "printedAt": "2026-10-18T09:00:00.000Z",
    "copies": [
      { "copyIndex": 1, "kind": "customer", "copyLabel": "نسخة العميل", "requiresCustomerSignature": false, "signatureBlock": null, "…": "بقيةُ حقول المستند نفسها" },
      { "copyIndex": 2, "kind": "rep", "copyLabel": "نسخة المندوب (تُعاد موقّعة من العميل إلى المحاسب)", "requiresCustomerSignature": true,
        "signatureBlock": { "customerSignatureLabel": "توقيع العميل / المستلم", "repSignatureLabel": "توقيع المندوب", "accountantNote": "تُعاد هذه النسخة موقّعة من العميل إلى المحاسب مع إغلاق الوردية" },
        "…": "بقيةُ حقول المستند نفسها" }
    ],
    "copiesCount": 2
  }
}
```

- `copies=1` تعطي نسخةَ العميل فقط؛ الافتراضي `2`.
- `qrPayload` يُبنى على الخادم — لا تُولّد QR بنفسك.

---

## ٨. شكلُ استجابةِ الإجراءات = لوحةُ الخطّ (مهمٌّ جدًّا)

**كلُّ مسارات §٧ (POST) الناجحة ترجع 201 بجسمٍ واحدٍ هو لوحةُ الخطّ الكاملة** (المسار نفسه الذي يرجعه `GET /van-sales/dashboard` للمكتب)، وليس بطاقةَ العمل المنفَّذ:

```json
{
  "data": {
    "policy": { "allowInternalDeliveryWithoutTax": false, "preventSelfApproval": false, "shortageValuationBasis": "unit_cost", "zatcaSeller": { "ready": true, "missingFields": [], "refusalDetail": null } },
    "officialStock": [ { "itemId": "…", "itemName": "…", "sku": "…", "warehouseId": "…", "warehouseName": "…", "warehouseCode": "…", "branchId": "…", "quantity": "…", "value": "…", "averageCost": "…" } ],
    "mainWarehouseId": "w-01",
    "postingReadiness": { "branchId": "br-01", "salesInvoice": true, "stockTransfer": true, "receiptVoucher": true, "message": null },
    "windows": { "productionBatches": { "returned": 50, "total": 61, "limit": 50 }, "loadOrders": { "returned": 60, "total": 63, "limit": 60 }, "documents": { "returned": 120, "total": 214, "limit": 120 }, "movements": { "returned": 80, "total": 95, "limit": 80 }, "customerPriceHistory": { "returned": 50, "total": 50, "limit": 50 } },
    "summary": { "totalProducedKg": "…", "totalScrapKg": "…", "mainWarehouseBalanceKg": "…", "vanWarehousesBalanceKg": "…", "derivedMainWarehouseBalanceKg": "…", "stockLedgerAgrees": true, "inTransitKg": "…", "inTransitValueSar": "…", "inTransitTransfersCount": 0, "totalProductionCostSar": "…", "totalLoadedKg": "…", "totalSoldKg": "…", "totalBonusKg": "…", "totalReturnedKg": "…", "totalDamagedKg": "…", "totalShortageKg": "…", "totalShortageSar": "…", "remainingInVansKg": "…", "totalZatcaSalesSar": "…", "totalInternalSalesSar": "…", "totalRevenueSar": "…", "totalSalesGrossSar": "…", "totalReturnsSar": "…", "totalReturnsVatSar": "…", "returnDocumentCount": 0, "returnsWithoutCostCount": 0, "totalCollectedCashSar": "…", "totalCreditReceivablesSar": "…", "totalNetProfitSar": "…", "anomalyCount": 0, "pendingClosingsCount": 0, "pendingReceiptsCount": 0, "pendingStockSettlementsCount": 0, "pendingTransitDecisionsCount": 0 },
    "productionBatches": [ … ],
    "repPerformance": [ { "salesmanId": "…", "salesmanName": "…", "soldKg": "…", "returnsSar": "…", "returnsVatSar": "…", "collectedSar": "…", "creditDebtSar": "…", "netProfitSar": "…", "…": "…" } ],
    "loadOrders": [ { "id": "…", "number": "…", "loadDate": "…", "productionBatchNo": "…", "vehiclePlate": "…", "status": "…", "salesmanId": "…", "salesmanName": "…", "warehouseId": "…", "vanWarehouseId": "…", "stockTransferId": "…", "returnTransferId": "…", "damageVoucherId": "…", "approvalRequestId": "…", "shortagePolicyStatus": "…", "itemId": "…", "itemName": "…", "loadedQty": "…", "receivedQty": "…", "discrepancyQty": "…", "discrepancyNotes": "…", "receivedAt": null, "awaitingReceipt": false, "soldQty": "…", "bonusQty": "…", "returnedQty": "…", "damagedQty": "…", "shortageQty": "…", "shortageValue": "…", "remainingQty": "…", "actualRemainingQty": "…", "vehicleCountQty": null, "otherCustodyQty": null, "expectedRemainingQty": "…", "countVarianceQty": "…", "stockAdjustmentId": null, "remainingAction": null, "remainingInventoryTxId": null, "countVarianceCostValue": "…", "countDocumentVarianceValue": null, "countDocumentVarianceQty": null, "vanOfficialQty": "…", "otherCustodyInVanQty": "…", "vanStockShortOfCustodyQty": "…", "countDocumentExpectedQty": null, "stockSettlementStatus": "…", "stockSettlementNote": "…", "damageJournalEntryId": null, "shortageJournalEntryId": null, "shortageChargeBasis": null, "shortageChargeAmount": null, "awaitingStockSettlement": false, "awaitingTransitDecision": false, "maxBonusQty": "…", "maxBonusPct": "…", "expectedCash": "…", "collectedCash": "…", "cashVariance": "…", "damageReason": "", "damageInspected": false, "salaryDeductionApproved": false, "closingNotes": "", "closingSubmittedAt": null, "approvedAt": null, "approvedByLabel": "", "notes": "" } ],
    "customerPrices": [ … ],
    "customerPriceHistory": [ … ],
    "documents": [ { "id": "…", "number": "…", "docDate": "…", "invoiceMode": "…", "taxPolicyStatus": "…", "paymentMethod": "…", "documentKind": "…", "referenceDocumentId": null, "invoiceNumber": "…", "invoiceStatus": "…", "productionBatchNo": "…", "loadOrderId": "…", "salesInvoiceId": "…", "receiptVoucherId": "…", "stockDeliveryId": "…", "salesmanId": "…", "salesmanName": "…", "partyId": "…", "customerName": "…", "customerTaxNo": "…", "itemId": "…", "itemName": "…", "soldQty": "…", "bonusQty": "…", "bonusReason": "…", "unitPrice": "…", "discountAmount": "…", "discountReason": "…", "subtotal": "…", "taxRate": "…", "taxTotal": "…", "total": "…", "paidAmount": "…", "unitCost": "…", "netProfit": "…", "customerBonusConfirmed": false, "customerConfirmationCode": "", "bonusAnomaly": false, "anomalyReason": "", "qrPayload": "…", "notes": "", "createdAt": "…" } ],
    "movements": [ … ]
  }
}
```

**القاعدة للتطبيق:** لا تحاول قراءة «المستند الذي أُنشئ» من هذا الرد. اعتبر **أيّ 2xx نجاحًا**، اعرض رسالةَ نجاح، ثمّ **أعد نداء `GET /van-sales/me`** وحدّث الشاشة منه. (المستندُ الجديد سيظهر في نافذة `documents` عندها.)

---

## ٩. جدولُ رموزِ الأخطاء التي يعالجها التطبيق

| الرمز (`code`) | HTTP | متى |
|---|---|---|
| `UNAUTHENTICATED` | 401 | رمزٌ مفقود/منتهٍ → جرّب `refresh` مرةً ثمّ خروج. |
| `FORBIDDEN` | 403 | نقصُ صلاحية (رسالةُ الخادم: `permission <code> required`). |
| `VAN_SALES_COMPANY_SCOPE_REQUIRED` | 403 | نداءُ مسارٍ مكتبيٍّ من حساب مندوب (مثل `/van-sales/dashboard`). |
| `VAN_SALES_NOT_YOUR_LOAD` | 403 | أمرُ التحميل مسندٌ إلى مندوبٍ آخر. |
| `VAN_SALES_NOT_YOUR_DOCUMENT` | 403 | المستندُ لمندوبٍ آخر. |
| `VAN_LOAD_ORDER_NOT_RECEIVED` | 409 | بيعٌ من توريدٍ لم يُؤكَّد استلامُه بعد. |
| `VAN_LOAD_ORDER_NOT_AWAITING_RECEIPT` | 409 | الاستلامُ مؤكَّدٌ مسبقًا (أو الأمرُ ما زال مسودة). |
| `VAN_LOAD_ORDER_ALREADY_SETTLED` | 409 | الورديةُ مُصفّاةٌ مسبقًا. |
| `INVOICE_ALREADY_PAID` | 409 | تحصيلٌ على فاتورةٍ مسدَّدة. |
| `IDEMPOTENCY_REPLAY` | 409 | المفتاحُ نفسه استُعمل بحمولةٍ مختلفة — نيّةٌ عُدِّلت بعد حفظها: تحتاج قرارًا بشريًّا لا إعادةً عمياء. |
| `VALIDATION_FAILED` | 422 | كلُّ أخطاء الحقول (اقرأ `errors[].field` و`detail`). |
| `PARTY_CREDIT_LIMIT_EXCEEDED` | 422 | بيعٌ آجلٌ فوق سقف ائتمان العميل. |
| `STOCK_INSUFFICIENT` | 422 | رصيدُ السيارة الرسميّ لا يكفي. |
| `VAN_ZATCA_SELLER_IDENTITY_REQUIRED` | 422 | بياناتُ البائع الضريبية ناقصة (إعدادٌ عند المنشأة). |
| `VAN_SALES_INTERNAL_DELIVERY_POLICY_REQUIRED` | 422 | وضعُ «تسليم داخلي» غير مسموحٍ بسياسة المنشأة. |
| `VAN_WAREHOUSE_UNDER_SETTLEMENT` | 409 | السيارةُ قيدُ تسويةِ جردٍ — ممنوعٌ البيع/الاستلامُ حتى ينتهي. |
| `VAN_VEHICLE_COUNT_INVALID` / `_BELOW_OTHER_CUSTODY` / `_CONFLICTS_WITH_ORDER_COUNT` | 422 | أخطاءُ عدد المركبة عند الإقفال. |
| `NOT_FOUND` | 404 | معرّفٌ غير موجود (أمر/مستند/مسار). |
| `RATE_LIMITED` | 429 | تجاوزُ حدِّ المعدّل (الدخول خصوصًا). |
| `TENANT_SUSPENDED` | 423 | المنشأةُ موقوفة. |

**قاعدةُ إعادة المحاولة:** 5xx أو انقطاعُ شبكة ⇒ «لم تصل» (أعد لاحقًا). 4xx ⇒ «رُفضت» (اعرض `detail` ولا تُعِد تلقائيًّا).

---

## ١٠. الطابورُ دون اتصال — قواعدُ صارمة

| العمليّة | تُحفظ دون اتصال؟ | `idempotencyKey` في الجسم؟ |
|---|---|---|
| مستند بيع `POST /van-sales/documents` | ✅ نعم | ✅ نعم — **إلزاميّ** عند الحفظ |
| مرتجع `POST /van-sales/documents/:id/returns` | ✅ نعم | ✅ نعم |
| تحصيل `POST /van-sales/collections` | ✅ نعم | ✅ نعم |
| تأكيد الاستلام `confirm-receipt` | ❌ لا يُحفظ | ❌ لا يوجد |
| إغلاق الوردية `submit-closing` | ❌ لا يُحفظ | ❌ لا يوجد |

- **صيغةُ المفتاح:** `<prefix>:<بصمة الحمولة>:<nonce>` (مثال `rep-document:9c8b7a6f:1f2e3d4c5b6a7890`) بطولٍ أقصى **١٢٠** حرفًا. البادئات المستعملة في الويب: `rep-document` / `rep-return` / `rep-collection`.
- **المفتاحُ يُبنى مرةً واحدةً عند الحفظ** ويُخزَّن **مع** الجسم فتستعمله كلُّ إعادة — مفتاحٌ جديدٌ لكلّ محاولة يعني مستنداتٍ مكرَّرة.
- سببُ منع حفظ الإقفال والاستلام: مساراهما لا يفحصان مفتاحًا؛ إعادةُ الإقفال العمياء **تعيد كتابةَ إعلان الجرد** ما دام `pending_closing`، وإعادةُ الاستلام ترجع 409 فتظهر للمندوب خطأً رغم نجاحها أولًا. أرسلهما **لحظة عودة الشبكة فقط**.
- عند إعادة الإرسال: 2xx ⇒ وصلت (ومنها إعادةُ المفتاح نفسه — 201 بلا أثرٍ ثانٍ) · 409 `IDEMPOTENCY_REPLAY` ⇒ مرفوضةٌ وتُعرض على المندوب · بقية 4xx ⇒ مرفوضةٌ برسالة الخادم · 5xx/بلا اتصال ⇒ تبقى في الطابور.

---

## ١١. مساراتٌ **لا** يستعملها تطبيقُ المندوب (مكتبٌ خلفيّ — سيُرفض معظمُها لحساب المندوب)

`GET /van-sales/dashboard` · `GET /van-sales/reports` · `GET /van-sales/salesmen` · `POST /van-sales/salesmen/:id/account` · `POST /van-sales/load-orders` (إنشاءُ تحميل) · `POST /van-sales/production-batches` · `POST /van-sales/customer-prices` · `GET|PUT /van-sales/policy` · `POST /van-sales/load-orders/:id/approve-closing` · `POST /van-sales/load-orders/:id/settle` · `POST /van-sales/load-orders/:id/settle-stock` · `POST /van-sales/load-orders/:id/close-transit-difference` · `POST /van-sales/load-orders/:id/cancel` · `POST /van-sales/load-orders/:id/reject-receipt` · `POST /van-sales/legacy-reconciliation`

(بعضُها يحتاج صلاحياتٍ إداريّةً سيرفضها الخادم 403 لحساب المندوب؛ وبعضُها — مثل لوحة الخطّ — مرفوضٌ للحسابات المرتبطة ببطاقة مندوب تحديدًا برمز `VAN_SALES_COMPANY_SCOPE_REQUIRED`.)

---

## ١٢. مصادرُ الحقيقة في المستودع (للمراجعة عند أيّ خلاف)

| ماذا | أين |
|---|---|
| المسارات والصلاحيات وأجسام الطلبات | `apps/api/src/modules/van-sales/van-sales.controller.ts` |
| الاستجابات والحرّاس ورسائل الرفض العربية | `apps/api/src/modules/van-sales/van-sales.service.ts` (`repWorkspace`, `createDocument`, `createReturnDocument`, `collectCustomerDebt`, `confirmReceipt`, `submitClosing`, `documentPrintView`) |
| عقدُ `GET /van-sales/me` (نوع TypeScript مطابق) | `packages/web-van/src/rep-workspace.ts` |
| عقدُ الدخول والجلسة و`/me` | `packages/contracts/src/platform/auth.ts` |
| عميلُ الويب الذي يُقاس عليه السلوك (الغلاف، 401→refresh، الطابور) | `packages/web-core/src/api.ts`, `apps/bakery/lib/rep-queue.ts`, `apps/bakery/app/rep/page.tsx` |
| غلافُ الأخطاء RFC-9457 | `packages/contracts/src/problem.ts` |
