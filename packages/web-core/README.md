# @erp/web-core

القشرة المشتركة لواجهات الويب المستأجرة (`apps/staff` اليوم، و`apps/bakery` ومن يليها).

## ماذا يحمل

| الوحدة | المحتوى |
|---|---|
| `api.ts` | تخزين الجلسة (وصول/تحديث/مستأجر/جلسة نظر)، والتجديد التلقائي بلا تكرار، و`apiOpen`/`apiFetch`/`apiData`/`apiList`/`apiPost`/`apiPatch`/`apiPut`/`apiDelete`، وقراءة `application/problem+json` إلى `ApiError`، و`apiErrorText` (تعرض سبب الرفض الحقيقي لا العنوان العام)، و`login`/`logout`/`fetchMe`، واعتماد رمز الدعم (P-C8). |
| `session.tsx` | `SessionProvider` و`useSession` — الحالة (`loading`/`anonymous`/`authenticated`) والصلاحيات بعد توحيد رموزها (`canonicalizePermissionCode`). |
| `i18n.tsx` | `LanguageProvider` و`useLang` و`translate` و`dirFor` وقاموس `STRINGS`. |
| `use-query.ts` | خطّاف استعلام صغير (حالة/خطأ/إعادة تحميل) بلا اعتماد خارجي. |
| `offline-db.ts` | محوّل IndexedDB للعمل بلا اتصال: الكتالوج، وطابور الفواتير، ومعرّف الجهاز، والتسلسل. |
| `sync-engine.ts` | تحديث الكتالوج، ومزامنة الطابور، وإعادة محاولة التعارض، وحلقة كل عشر ثوانٍ. |
| `sync.ts` | مساعدات مستوى المزامنة القديم/أندرويد (`/compat/sync/*`). |
| `token-bridge.tsx` | جسر الدخول (AUD-08): يستبدل `?handoff=` بـPOST وينظّف العنوان قبل الطلب. |

## ماذا لا يحمل (ولماذا)

- **كتالوج الشاشات** (`apps/staff/lib/navigation.ts`) و**سياسة الأسطح** (`surface-routing.ts`):
  بيانات كل تطبيق وهويته، وليست آلية مشتركة.
- **القشرة البصرية** (`AppShell`, `AuthGate`, `LoginScreen`, `EmployeeShell`): تحتاج حدوداً
  معلَنة (manifest للتطبيق: الاسم والشعار والأسطح والشاشات المفعّلة) قبل أن تُنقل، ونقلها بلا
  ذلك يعني قشرةً واحدة بسلوكين.

## الاستعمال

```jsonc
// apps/<app>/package.json
"dependencies": { "@erp/web-core": "workspace:*" }
```

```js
// apps/<app>/next.config.mjs — تُشحن مصدراً فتُصرَّف بأداة التطبيق نفسه (ADR-030)
transpilePackages: ['@erp/ui', '@erp/web-core']
```

```ts
import { apiData, apiErrorText } from '@erp/web-core/api';
import { SessionProvider, useSession } from '@erp/web-core/session';
import { TokenBridge } from '@erp/web-core/token-bridge';
```

## الاختبارات

`pnpm --filter @erp/web-core run test` — أحكام العميل والجسر ومخزن العمل بلا اتصال
(`tests/api-error-text.spec.ts`, `tests/session-handoff.spec.ts`, `tests/offline-store.spec.ts`).
لا متصفح في هذه البيئة (Playwright محجوب)، فأحكام الـJSX تُثبَّت نصّياً كما كان الاصطلاح.
