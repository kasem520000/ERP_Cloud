# خطة التحسينات والتطوير — مشروع ERP Cloud

> **الغرض من هذا الملف**: قائمة موثَّقة بفرص التحسين والتطوير في المشروع، تكمِّل ملف `ISSUES.md`. هنا لا نُصلح أخطاءً، بل نُضيف قيمة: observability، testing، performance، DX، CI/CD، توثيق، ميزات ناقصة، تقوية أمنية، قابلية توسُّع، تحسين تكلفة، امتثال، ودعم لغات.

> **القاعدة**: كل بند يُحدِّد: المنطقة، الفرصة، الإجراء المُقترَح، الأثر المتوقَّع، والجهد التقديري (S/M/L/XL).

---

## الفهرس

- [1. المراقبة (Observability)](#1-المراقبة-observability)
- [2. الاختبارات (Testing)](#2-الاختبارات-testing)
- [3. الأداء (Performance)](#3-الأداء-performance)
- [4. تجربة المطوِّر (DX)](#4-تجربة-المطور-dx)
- [5. CI/CD والـdeploy](#5-cicd-والdeploy)
- [6. التوثيق (Documentation)](#6-التوثيق-documentation)
- [7. اكتمال الميزات (Feature Completeness)](#7-اكتمال-الميزات-feature-completeness)
- [8. تقوية الأمن (Security Hardening)](#8-تقوية-الأمن-security-hardening)
- [9. قابلية التوسُّع (Scalability)](#9-قابلية-التوسع-scalability)
- [10. تحسين التكلفة (Cost Optimization)](#10-تحسين-التكلفة-cost-optimization)
- [11. الامتثال (Compliance)](#11-الامتثال-compliance)
- [12. تدويل اللغة (i18n)](#12-تدويل-اللغة-i18n)
- [ملخص الأولويات والجدولة](#ملخص-الأولويات-والجدولة)

---

## 1. المراقبة (Observability)

### O-01 — إضافة OpenTelemetry للـdistributed tracing
- **المنطقة**: `apps/api/src/` كاملاً + الـworker
- **الفرصة**: لا توجد request spans عبر الـmodules. يستحيل تحديد مكان البطء في تدفقات cross-module (مثل sale→inventory→journal→e-invoice).
- **الإجراء**:
  1. ثبِّت `@opentelemetry/api` + `@opentelemetry/sdk-node` + instrumentations لـNestJS, pg, redis, bullmq, undici/fetch.
  2. صدِّر إلى OTLP collector (Jaeger/Tempo).
  3. حقن `trace_id` و`span_id` في Pino context.
- **الأثر المتوقَّع**: تشخيص البطء من ساعات إلى دقائق. القدرة على ربط طلب API بكل استعلام DB ومكالمة خارجية.
- **الجهد**: L

---

### O-02 — إضافة Prometheus `/metrics` endpoint
- **المنطقة**: `apps/api/src/ops/metrics.service.ts`
- **الفرصة**: الـ`MetricsService` الحالي JSON-only وin-process، غير قابل للـscrape. لا يمكن لـPrometheus جمع المقاييس.
- **الإجراء**:
  1. ثبِّت `prom-client`.
  2. أضِف endpoint `/metrics` يُصدِّر: `erp_http_requests_total{route,status}`, `erp_outbox_dead_total`, `erp_einvoice_failures_total`, `erp_llm_fallback_total`, `erp_db_pool_active`, `erp_db_pool_waiting`.
  3. حمِّل endpoint بـ`@Public()` + basic auth.
- **الأثر المتوقَّع**: لوحات Grafana، تنبيهات PromQL.
- **الجهد**: M

---

### O-03 — تعريف SLOs وقواعد تنبيه
- **المنطقة**: جديد في `infrastructure/alerts/`
- **الفرصة**: لا توجد قواعد تنبيه. السكتات الإنتاجية تكتشف فقط عبر شكاوى العملاء.
- **الإجراء**: عرِّف تنبيهات PromQL/Sloth:
  - 5xx rate > 1% خلال 5 دقائق
  - p95 > 1s على `POST /sales/invoices/*/post`
  - outbox dead-letter growth > 10 خلال ساعة
  - idempotency replay rate > 5%
  - DB pool utilization > 70%
  - DB CPU > 80% لـ10 دقائق
  - ZATCA gateway failures > 5 خلال 10 دقائق
- **الأثر المتوقَّع**: كشف الاستثناءات قبل أن تصبح حوادث.
- **الجهد**: M

---

### O-04 — حقن W3C Trace Context في السجلات
- **المنطقة**: `apps/api/src/common/middleware/request-id.middleware.ts` + Pino config
- **الفرصة**: لا يوجد `trace_id`/`span_id` في السجلات. يستحيل ربط سجل بطلب مُحدَّد عبر services.
- **الإجراء**:
  1. أضِف middleware يقرأ `traceparent` header ويولِّده إن لم يوجد.
  2. ضعه في Pino context.
  3. صدِّره في كل سجل.
- **الأثر المتوقَّع**: تتبُّع طلب واحد عبر كل سجلاته.
- **الجهد**: S

---

### O-05 — توثيق سياسة احتفاظ سجل التدقيق
- **المنطقة**: `apps/api/src/modules/platform-services/audit/` + `docs/runbooks/`
- **الفرصة**: لا سياسة موثَّقة. ينمو بلا حدود (انظر D-01 في ISSUES.md).
- **الإجراء**:
  1. عرِّف سياسة: hot 90 يوم، cold 7 سنوات (امتثال ZATCA)، ثم archive.
  2. أضِف runbook `docs/runbooks/audit-archival.md`.
- **الأثر المتوقَّع**: امتثال + قابلية إدارة البيانات.
- **الجهد**: S

---

## 2. الاختبارات (Testing)

### T-01 — إضافة اختبارات e2e بـPlaywright
- **المنطقة**: جديد في `apps/staff/tests/e2e/` + `apps/customer-portal/tests/e2e/`
- **الفرصة**: `docs/TESTING_STRATEGY.md` يُلزِم Playwright e2e لـP17/P18 لكن `find . -name "e2e"` يُرجِع فارغاً.
- **الإجراء**:
  1. ثبِّت Playwright.
  2. أَنشِئ tenant اختبار مُزروع.
  3. غطِّ أهم 10 تدفقات: login → إنشاء فاتورة → ترحيل → دفع → ZATCA file → تسوية بنكية. + الموافقة على طلب → صرف راتب → تصدير WPS. + إنشاء PO → استلام → دفع مورد. + تسجيل دخول مورد → توقيع esign. + تسجيل دخول عميل → دفع فاتورة. + إضافة موظف → صرف حضور. + إعداد ZATCA → فاتورة clearing. + تسجيل دخول platform admin → إنشاء tenant. + impersonation → إنهاء. + إنشاء dashboard → ترتيب widgets.
- **الأثر المتوقَّع**: ثقة في الترقيات. كشف انكسارات UI/تكامل قبل الإنتاج.
- **الجهد**: XL

---

### T-02 — اختبارات contract لـOpenAPI
- **المنطقة**: `packages/contracts/openapi.json` + CI
- **الفرصة**: وثيقة OpenAPI موجودة لكن لا اختبار يُؤكِّد أن الـAPI يطابقها.
- **الإجراء**:
  1. ثبِّت `@stoplight/spectral-cli`.
  2. أضِف قاعدة lint: قارن `/openapi.json` الحي بـ`packages/contracts/openapi.json`.
  3. أضِف خطوة CI تفشل عند الاختلاف.
- **الأثر المتوقَّع**: لا drift بين الكود والعقد.
- **الجهد**: S

---

### T-03 — بوابة تغطية (coverage gate)
- **المنطقة**: `vitest.config.ts` + CI
- **الفرصة**: 199 spec file لكن لا حد تغطية.
- **الإجراء**:
  1. فعِّل `vitest --coverage`.
  2. اضبط حدود: 60% lines / 50% branches.
  3. أضِف خطوة CI تفشل تحت الحدود.
- **الأثر المتوقَّع**: منع تراجع التغطية تدريجياً.
- **الجهد**: S

---

### T-04 — اختبارات حمل بـk6
- **المنطقة**: جديد في `tests/load/`
- **الفرصة**: لا اختبارات حمل. السلوك تحت الحمل غير معروف.
- **الإجراء**:
  1. ثبِّت k6.
  2. اكتب سيناريوهات للمسارات الحارة:
     - `POST /sales/invoices/:id/post` (50 RPS sustained, 200 RPS burst)
     - `POST /einvoicing/.../submit` (20 RPS)
     - `POST /treasury/vouchers/:id/post` (30 RPS)
  3. قِس p95، error rate، DB pool، CPU.
- **الأثر المتوقَّع**: تحديد الـbottlenecks قبل الإنتاج.
- **الجهد**: M

---

### T-05 — اختبارات up-down للـmigrations
- **المنطقة**: CI جديد
- **الفرصة**: 67 migration لكن لا اختبار أن down-migrations تُلغي بنجاح.
- **الإجراء**: أضِف وظيفة CI: `migrate:up && migrate:down && migrate:up` على container Postgres طازج. تفشل عند أي خطأ.
- **الأثر المتوقَّع**: ضمان قابلية التراجع.
- **الجهد**: S

---

### T-06 — اختبارات mutation testing
- **المنطقة**: جديد
- **الفرصة**: قياس فعالية الاختبارات لا تغطيتها فقط.
- **الإجراء**: ثبِّت Stryker Mutation Testing. شغِّل على الـmodules الحرجة (`sales`, `accounting`, `treasury`, `hrm`). حدد mutation score ≥ 70%.
- **الأثر المتوقَّع**: كشف الثغرات في الاختبارات.
- **الجهد**: L

---

### T-07 — اختبارات العقود الخارجية (consumer-driven)
- **المنطقة**: تكاملات ZATCA, Salla, Moyasar, WhatsApp
- **الفرصة**: لا اختبارات تُؤكِّد أن استجابات الـproviders الخارجية تُعالَج بشكل صحيح. الـspecs الحالية تُحاكي الـresponses بـstubs.
- **الإجراء**: سجِّل استجابات حقيقية من sandboxes الـproviders، أعد تشغيلها في اختبارات contract. أضِف `pact` tests.
- **الأثر المتوقَّع**: كشف تغييرات API الـproviders قبل أن تكسر الإنتاج.
- **الجهد**: L

---

## 3. الأداء (Performance)

### P-01 — إضافة طبقة caching بـRedis
- **المنطقة**: جديد `packages/cache/` + الـmodules الحرجة
- **الفرصة**: `dashboards.service.ts` يستهدف Redis لكن لا module آخر يستخدمه. كل قراءة تذهب للـDB.
- **الإجراء**:
  1. أَنشِئ port `CachePort` مع implementatation Redis.
  2. cache: إعدادات الـtenant (5 min)، شجرة الـchart of accounts (10 min)، قائمة الكتالوج (2 min)، حل قوائم الأسعار (5 min)، فروع/مستودعات/صناديق (10 min).
  3. invalidate على الكتابة عبر events.
- **الأثر المتوقَّع**: تقليل حمل DB 30-50%.
- **الجهد**: M

---

### P-02 — معالجة N+1 بـDataLoader
- **المنطقة**: `apps/api/src/modules/parties/parties.service.ts` + `custom-fields.service.ts`
- **الفرصة**: `parties.service.ts:33-37` يستدعي `this.get` ثم `this.customFields.decorate` — استعلامات منفصلة لكل party. عند سرد 50 party = 50+50 استعلام.
- **الإجراء**: ثبِّت `dataloader`، استخدمه في `decorate`، `get`، `attachFileUrl`. اربطه بـrequest context.
- **الأثر المتوقَّع**: تقليل استعلامات القوائم بنسبة 80%+.
- **الجهد**: M

---

### P-03 — materialized views للتقارير الثقيلة
- **المنطقة**: `apps/api/src/modules/accounting/accounting.service.ts` + `reporting/`
- **الفرصة**: استعلامات trial balance وgeneral ledger (1100+ سطر تجميع) تُعاد كل مرة.
- **الإجراء**:
  1. أَنشِئ `CREATE MATERIALIZED VIEW trial_balance_mv REFRESH ... CONCURRENTLY`.
  2. حدِّثها عبر trigger بعد `journal.post`.
  3. استخدمها في التقارير.
- **الأثر المتوقَّع**: تقارير اللحظة من ثوانٍ إلى ميلي ثوانٍ.
- **الجهد**: L

---

### P-04 — توثيق وتحسين pool الـDB
- **المنطقة**: `packages/database/src/client.ts` + `packages/config/src/env.ts`
- **الفرصة**: لا `pool_max`/`pool_min` موثَّق. مع HPA min=2 max=6 وpool افتراضي 10 = 60 اتصال.
- **الإجراء**:
  1. أضِف `DATABASE_POOL_MAX` (default 10), `DATABASE_POOL_MIN` (default 2), `DATABASE_POOL_IDLE_TIMEOUT_MS`.
  2. أضِف تنبيه عند `pg_stat_activity` > 70% من pool.
  3. وثِّق العلاقة بين replicas × pool × DB max_connections.
- **الأثر المتوقَّع**: منع connection exhaustion تحت الحمل.
- **الجهد**: S

---

### P-05 — فحص `pg_stat_statements` الدوري
- **المنطقة**: جديد `scripts/verify-slow-queries.mjs`
- **الفرصة**: لا أحد يقرأ `pg_stat_statements`. الاستعلامات البطيئة تتراكم.
- **الإجراء**: سكربت يعمل أسبوعياً، يُبلِّغ عن الاستعلامات بـ`mean_exec_time > 100ms`، يُصدِّر تقريراً.
- **الأثر المتوقَّع**: كشف الـbottlenecks قبل أن تُصبح حرجة.
- **الجهد**: S

---

### P-06 — read replicas للتقارير
- **المنطقة**: `packages/database/src/client.ts` + `apps/api/src/modules/reporting/`
- **الفرصة**: كل القراءات تذهب للـprimary. التقارير الثقيلة تُثقِل الـprimary وقت ذروة العمل.
- **الإجراء**:
  1. أضِف `DATABASE_READ_REPLICA_URL`.
  2. أَنشِئ `DrizzleRead` instance.
  3. وجِّه `/reports/*` و`/dashboards/*` للاستخدام الـreplica.
  4. تأكَّد من read-after-write consistency عبر الـprimary لعمليات الـuser الحديثة.
- **الأثر المتوقَّع**: تقرير ثقيل لا يُبطئ الـcheckout.
- **الجهد**: L

---

### P-07 — async job للتقارير الطويلة
- **المنطقة**: `apps/api/src/modules/reporting/`
- **الفرصة**: تقارير الـgeneral ledger عبر سنوات تُنفَّذ بشكل متزامن في الـAPI. timeout 30 ثانية.
- **الإجراء**:
  1. حوِّل التقارير الطويلة إلى async job (queue موجود).
  2. أرجِع `202 Accepted` + `report_run_id`.
  3. أرسل تنبيه عند الانتهاء + رابط تنزيل presigned S3.
- **الأثر المتوقَّع**: لا timeout. تحميل أقل على الـAPI.
- **الجهد**: M

---

### P-08 — تحسين outbox publisher (fan-out متوازي)
- **المنطقة**: `apps/api/src/modules/platform-services/jobs/outbox.publisher.ts`
- **الفرصة**: يتكرر على tenants بالتسلسل. مع 100+ tenant و1s poll = bottleneck.
- **الإجراء**: استخدم `Promise.all` بـconcurrency cap (مثل 10 tenants متوازية).
- **الأثر المتوقَّع**: إنتاجية outbox × 10.
- **الجهد**: S

---

## 4. تجربة المطوِّر (DX)

### D-01 — إضافة Turborepo لتخزين المهام
- **المنطقة**: root `package.json` + جديد `turbo.json`
- **الفرصة**: pnpm workspaces مُكوَّن لكن لا caching. كل build/test يعاد من الصفر.
- **الإجراء**: ثبِّت Turborepo. عرِّف tasks `build`, `test`, `lint` مع caching + remote cache (اختياري).
- **الأثر المتوقَّع**: تقليل زمن CI 50%+.
- **الجهد**: S

---

### D-02 — workflow typegen واضح
- **المنطقة**: `scripts/typegen.mjs` + `docs/`
- **الفرصة**: السكربت موجود لكن لا توثيق متى يُشغَّل.
- **الإجراء**:
  1. وثِّق workflow في `docs/CONTRIBUTING.md`.
  2. أضِف `pnpm typegen:check` في CI يفشل إذا الأنواع المولَّدة قديمة.
- **الأثر المتوقَّع**: لا drift بين العقد والأنواع.
- **الجهد**: S

---

### D-03 — سكربت `db:reset:demo` واحد
- **المنطقة**: `scripts/`
- **الفرصة**: إعداد demo يتطلب عدة أوامر يدوية.
- **الإجراء**: أَنشِئ `pnpm db:reset:demo` يُسقِط، يُهاجِر، يَزرع tenant demo كامل في < 60 ثانية.
- **الأثر المتوقَّع**: onboarding مطوِّر جديد في دقائق.
- **الجهد**: S

---

### D-04 — تحقق `.env` شامل بـZod
- **المنطقة**: `packages/config/src/env.ts` + `scripts/check-env.mjs`
- **الفرصة**: التحقق يُبلِّغ عن مفتاح واحد في كل مرة.
- **الإجراء**: استخدم Zod schema تتحقق من كل المفاتيح dفياً، تُصدِر رسالة واحدة بكل الناقص.
- **الأثر المتوقَّع**: إقلاع فاشل واضح بدل سلسلة أخطاء.
- **الجهد**: S

---

### D-05 — تبسيط `local-start.sh`
- **المنطقة**: `scripts/local-start.sh` (700+ سطر bash)
- **الفرصة**: معقَّد للصيانة.
- **الإجراء**: استخدم `concurrently` + ملف YAML للتعريف. وثِّق `pnpm dev` في `docs/RUN_LOCALLY.md`.
- **الأثر المتوقَّع**: سهولة الصيانة + onboarding.
- **الجهد**: M

---

### D-06 — PR template وreview checklist
- **المنطقة**: جديد `.github/PULL_REQUEST_TEMPLATE.md` + `docs/CONTRIBUTING.md`
- **الفرصة**: لا template موحَّد.
- **الإجراء**: أَنشِئ template يتضمن: ملخص، نوع التغيير، اختبارات مضافة، screenshots (للواجهة)، breaking changes، checklist مراجعة.
- **الأثر المتوقَّع**: جودة مراجعة أعلى.
- **الجهد**: S

---

### D-07 — Storybook لمكوّنات UI
- **المنطقة**: `packages/ui/` + `apps/staff/components/ui/`
- **الفرصة**: لا بيئة تطوير معزولة لمكوّنات UI.
- **الإجراء**: ثبِّت Storybook. أَنشِئ stories للمكوّنات المشتركة (Button, Input, Modal, DataTable, Toast, Tabs).
- **الأثر المتوقَّع**: تطوير UI أسرع + توثيق بصري.
- **الجهد**: M

---

### D-08 — generate SDK client من OpenAPI
- **المنطقة**: `packages/contracts/` + frontends
- **الفرصة**: كل frontend يستدعي الـAPI بـfetch خام + أنواع مكتوبة يدوياً.
- **الإجراء**: استخدم `openapi-typescript` أو `orval` لتوليد typed client من `openapi.json`. استبدل `apiData<T>` اليدوي.
- **الأثر المتوقَّع**: أمان أنواع، كشف التغييرات وقت compile.
- **الجهد**: M

---

## 5. CI/CD والـdeploy

### CI-01 — إنشاء pipeline CI (حرج)
- **المنطقة**: جديد `.github/workflows/ci.yml`
- **الفرصة**: `.github/workflows/`, `.gitlab-ci.yml`, `.circleci/` **جميعها مفقودة**. `docs/STATUS.md` PHASE_01 يدَّعي إنشاء `ci.yml` لكنه غير موجود في المستودع. هذا أكبر خطر تسليم.
- **الإجراء**: أَنشِئ `ci.yml` يتضمن:
  1. `pnpm install --frozen-lockfile`
  2. `pnpm verify` (موجود: typegen + tsc + lint + build + smoke + test + openapi:export)
  3. `pnpm test:coverage` مع حدود
  4. Spectral OpenAPI lint
  5. `trivy fs .` لثغرات الـdependencies
  6. gitleaks على كل push
  7. docker build لـ`deploy/Dockerfile.api`
  8. اختبار up-down migrations
- **الأثر المتوقَّع**: منع الانكسارات قبل الدمج.
- **الجهد**: M

---

### CI-02 — تثبيت husky pre-commit hooks
- **المنطقة**: `package.json` (يذكر husky 9 + lint-staged) لكن `.husky/` **غير موجود**
- **الفرصة**: `pnpm install` لا يُشغِّل `husky install`. pre-commit hooks لا تعمل.
- **الإجراء**:
  1. أضِف `"prepare": "husky"` إلى `package.json`.
  2. أَنشِئ `.husky/pre-commit` يُشغِّل `lint-staged`.
  3. أَنشِئ `.husky/commit-msg` يُشغِّل `commitlint`.
- **الأثر المتوقَّع**: منع commits بأسلوب سيء.
- **الجهد**: S

---

### CI-03 — تبني GitOps (Flux/ArgoCD)
- **المنطقة**: `deploy/k8s/`
- **الفرصة**: k8s manifests صلبة لكن deploy يدوي `kubectl apply`. لا تتبُّع للحالة في Git.
- **الإجراء**: ثبِّت Flux أو ArgoCD. عرِّف `Kustomization` لكل environment. كل تغيير deploy عبر PR.
- **الأثر المتوقَّع**: deploy قابل للتدقيق، rollback سهل.
- **الجهد**: M

---

### CI-04 — توثيق تسلسل deploy
- **المنطقة**: `docs/runbooks/deploy.md`
- **الفرصة**: `deploy/k8s/migrate-job.yaml` موجود (جيد) لكن التسلسل غير موثَّق.
- **الإجراء**: وثِّق: migrate-job → api rollout → web rollout → smoke test → announce.
- **الأثر المتوقَّع**: deploy موحَّد عبر الفريق.
- **الجهد**: S

---

### CI-05 — يمكن-canary deployments
- **المنطقة**: `deploy/k8s/`
- **الفرصة**: deploy حالياً rolling update. لا canary.
- **الإجراء**: استخدم Argo Rollouts أو Flagger لـcanary 5% → 25% → 100% بناءً على معدل خطأ.
- **الأثر المتوقَّع**: كشف الانكسارات لـ5% فقط من المستخدمين.
- **الجهد**: L

---

### CI-06 — db migration safety checks
- **المنطقة**: CI + `packages/database/`
- **الفرصة**: لا فحص أن الـmigrations الجديدة آمنة (مثل: ALTER TABLE يحمل ACCESS EXCLUSIVE lock).
- **الالإجراء**: أضِف `squawk` (linter لـSQL migrations) في CI. افشل عند migrations خطرة بدون `CONCURRENTLY` أو مع `NOT NULL` على column مُعَمَّر.
- **الأثر المتوقَّع**: migrations لا تُوقِف الإنتاج.
- **الجهد**: S

---

## 6. التوثيق (Documentation)

### DOC-01 — إضافة ADRs للقرارات الحديثة
- **المنطقة**: `docs/ARCHITECTURE_DECISION_RECORDS.md`
- **الفرصة**: ADR-000..021+ موجودة لكن لا ADR لـ: rate-limiter Redis migration، observability stack choice، multi-region strategy، ZATCA Phase 2 integration decisions.
- **الإجراء**: أضِف ADRs عند اتخاذ كل قرار معماري حرج. استخدم template: Context، Decision، Consequences، Alternatives.
- **الأثر المتوقَّع**: قرارات مدفونة موثَّقة.
- **الجهد**: S (متكرر)

---

### DOC-02 — مخطط C4 معماري
- **المنطقة**: جديد `docs/architecture/`
- **الفرصة**: `docs/TARGET_ARCHITECTURE.md` نصي فقط. لا مخطط.
- **الإجراء**: أَنشِئ مخطط C4 (Structurizr/Lucid/Excalidraw) يُظهِر: modules، data flow، تكاملات خارجية (Salla, ZATCA, Moyasar, Geidea, WhatsApp, OCR, LLM).
- **الأثر المتوقَّع**: onboarding أسرع للجدد.
- **الجهد**: M

---

### DOC-03 — API sandbox لـ"Try it out"
- **المنطقة**: `apps/api` Swagger UI
- **الفرصة**: `/docs` موجود لكن لا sandbox للاختبار.
- **الإجراء**: أضِف tenant اختبار مُزروع. فعِّل "Try it out" في Swagger UI مع auth token جاهز.
- **الأثر المتوقَّع**: تجربة API أسرع للعملاء.
- **الجهد**: M

---

### DOC-04 — runbooks للعمليات
- **المنطقة**: جديد `docs/runbooks/`
- **الفرصة**: تقارير phases موجودة لكن لا runbooks تشغيلية.
- **الإجراء**: أَنشِئ runbooks لـ:
  - outbox dead-letter growth
  - ZATCA gateway down
  - DB CPU > 80%
  - tenant suspended يدوياً
  - backup restore
  - impersonation session طارئة
  - rate limit exceeded جماعي
- **الأثر المتوقَّع**: استجابة حوادث أسرع.
- **الجهد**: M

---

### DOC-05 — CONTRIBUTING.md
- **المنطقة**: جديد `docs/CONTRIBUTING.md`
- **الفرصة**: commitlint مُكوَّن لكن لا توثيق.
- **الإجراء**: وثِّق: branch naming (`feat/`, `fix/`, `chore/`)، commit conventions (Conventional Commits)، PR template، review checklist، how-to-run-locally.
- **الأثر المتوقَّع**: انضمام مطوِّرين جدد أسلس.
- **الجهد**: S

---

### DOC-06 — توثيق قرارات الـRLS
- **المنطقة**: `packages/database/src/rls.ts` + `docs/`
- **الفرصة**: الـRLS معقَّد لكن لا توثيق للـpolicies لكل جدول.
- **الإجراء**: أَنشِئ `docs/rls-policies.md` يُدرِج كل جدول مع policy السبب.
- **الأثر المتوقَّع**: مراجعة أمنية أسهل.
- **الجهد**: M

---

## 7. اكتمال الميزات (Feature Completeness)

### F-01 — متابعة الـfuture-enhancements الـ18
- **المنطقة**: `docs/future-enhancements/`
- **الفرصة**: 18 تحسين موثَّق، أغلبها بـverify scripts لكن لا بوابة قبول. تتبُّع غائب.
- **الإجراء**: حوِّل كل تحسين إلى GitHub Issue مع: status، owner، acceptance criteria، deadline. اعرض الـdashboard في `docs/STATUS.md`.
- **الأثر المتوقَّع**: رؤية واضحة لما يُنفَّذ وما يتعثَّر.
- **الجهد**: S

---

### F-02 — مُبدِّل العملات في بوابة العملاء
- **المنطقة**: `apps/customer-portal/`
- **الفرصة**: `currencies` و`fx_rates` موجودة (`resolveFx` يُجرِّب التحويل المثلَّث). لا UI للمستخدم النهائي لعرض الفاتورة بعملته المُفضَّلة.
- **الإجراء**: أضِف مُبدِّل عملات في صفحة الفاتورة يُتاح للعميل اختيار عملة العرض.
- **الأثر المتوقَّع**: تجربة عميل أفضل، خاصة للعملاء متعددي العملات.
- **الجهد**: M

---

### F-03 — محرك workflow approvals حقيقي متعدد الخطوات
- **المنطقة**: `apps/api/src/modules/approvals/` + `sales.service.ts:400`
- **الفرصة**: الـmodule موجود لكن notify-only ("A notify-only workflow or a request that was already approved may continue"). سلاسل الموافقين متعددة الخطوات غير مُنفَّذة.
- **الإجراء**: نفِّذ سلاسل موافقين متعددة (sequential, parallel, threshold). أضِف UI لإعداد الـworkflow. اربط بنماذج sales/purchases/treasury.
- **الأثر المتوقَّع**: امتثال مؤسسي، تقليل الاحتيال.
- **الجهد**: XL

---

### F-04 — منشئ التقارير المخصصة البصري
- **المنطقة**: `apps/api/src/modules/custom-fields/` + `apps/staff/app/reports/builder/`
- **الفرصة**: `custom-reports.controller.ts` يقبل `unknown` bodies. لا UI منشئ فعلي.
- **الإجراء**: أَنشِئ UI drag-and-drop: اختيار مصدر، حقول، فلاتر، تجميع، ترتيب. حفظ + جدولة. تصدير Excel/PDF.
- **الأثر المتوقَّع**: تمكين العملاء من تقاريرهم دون مطوِّر.
- **الجهد**: XL

---

### F-05 — تطبيق موظفين mobile حقيقي
- **المنطقة**: `apps/staff/app/m/` + جديد
- **الفرصة**: `employee-mobile.ts` موجود. `apps/staff/app/m/` responsive لكن ليس تطبيق mobile حقيقي.
- **الإجراء**: اختر React Native (Expo) أو PWA مثبَّت. أضِف push notifications حقيقية، touch ID، offline-first للجدول والحضور.
- **الأثر المتوقَّع**: تبنٍّ أعلى من قِبَل الموظفين الميدانيين.
- **الجهد**: XL

---

### F-06 — API pubic SDK (npm package)
- **المنطقة**: جديد `packages/sdk/`
- **الفرصة**: العملاء يريدون تكامل برمجي. لا SDK رسمي.
- **الإجراء**: أَنشِئ `@erp/sdk` package يُولَّد من OpenAPI. اعرض: TypeScript types، methods لكل endpoint، retry/auth/idempotency built-in. انشر على npm.
- **الأثر المتوقَّع**: تقليل احتكاك التكامل.
- **الجهد**: L

---

### F-07 — وحدة إدارة المخزون المتقدمة (WMS)
- **المنطقة**: `apps/api/src/modules/inventory/wms-*.ts`
- **الفرصة**: WMS-BOM موجود لكن استلام البضائع، picking، packing، shipping غير مكتملة.
- **الإجراء**: أكمل: pick waves، packing slips، shipping integration، cycle counting، ABC analysis.
- **الأثر المتوقَّع**: قيمة للمستودعات الكبيرة.
- **الجهد**: XL

---

### F-08 — وحدة إدارة المشروع المتقدمة (Projects)
- **المنطقة**: `apps/api/src/modules/projects/`
- **الفرصة**: projects، kanban، gantt موجودة لكن resource leveling، critical path، earned value management غير مكتملة.
- **الإجراء**: أضِف resource leveling، CPM، EVM dashboards.
- **الأثر المتوقَّع**: قيمة لشركات المقاولات.
- **الجهد**: L

---

### F-09 — وحدة CRM متقدمة
- **المنطقة**: `apps/api/src/modules/crm/`
- **الفرصة**: pipelines، deals، activities موجودة لكن: email tracking، meeting scheduler، lead scoring غير مكتملة.
- **الإجراء**: أضِف: email tracking pixel، calendar integration، lead scoring rules، campaign attribution.
- **الأثر المتوقَّع**: قيمة لفرق المبيعات.
- **الجهد**: L

---

### F-10 — marketplace apps الفعلية
- **المنطقة**: `apps/api/src/modules/marketplace/` + `apps/platform-admin/app/marketplace/`
- **الفرصة**: marketplace موجود لكن لا apps فعلية باستثناء تكاملات الـbuilt-in (Salla، WhatsApp).
- **الإجراء**: طوِّر 3-5 apps أولية: توقيع إلكتروني متقدم، OCR متقدم، POS restaurant pack، loyalty program، marketing automation. أنشِئ SDK للتطوير الخارجي.
- **الأثر المتوقَّع**: توسعة المنصة عبر الشركاء.
- **الجهد**: XL

---

## 8. تقوية الأمن (Security Hardening)

### SH-01 — CSP صارم بـnonces
- **المنطقة**: كل التطبيقات الـ4
- **الفرصة**: CSP حالي `unsafe-eval 'unsafe-inline'`. (انظر F-14 في ISSUES.md)
- **الإجراء**: استخدم nonces لكل صفحة. اضبط `script-src 'self' 'nonce-...'`. اضبط `object-src 'none'`، `base-uri 'self'`.
- **الأثر المتوقَّع**: منع XSS حتى لو وجدت ثغرة.
- **الجهد**: M

---

### SH-02 — SRI للموارد الخارجية
- **المنطقة**: كل التطبيقات
- **الفرصة**: لا Subresource Integrity.
- **الإجراء**: أضِف `integrity="sha384-..."` لأي script/style من CDN.
- **الأثر المتوقَّع**: منع تزوير CDN.
- **الجهد**: S

---

### SH-03 — توليد SBOM
- **المنطقة**: CI
- **الفرصة**: لا SBOM.
- **الإجراء**: استخدم `cyclonedx-webpack` أو `npm sbom --omit=dev`. ارفع إلى Dependency-Track.
- **الأثر المتوقَّع**: تتبُّع ثغرات الـdependencies.
- **الجهد**: S

---

### SH-04 — Dependabot/فحص dependencies
- **المنطقة**: `.github/dependabot.yml`
- **الفرصة**: `.gitleaksignore` موجود (جيد للأسرار) لكن لا فحص ثغرات dependencies.
- **الإجراء**: فعِّل Dependabot لـ`pnpm-lock.yaml`. راجِع تنبيهات أسبوعياً.
- **الأثر المتوقَّع**: كشف ثغرات dependencies تلقائياً.
- **الجهد**: S

---

### SH-05 — تشفير حقل IBAN/رقم الحساب
- **المنطقة**: `packages/database/src/schema/parties.ts`, `banking.ts`
- **الفرصة**: `mfa_secret_enc`, أسرار Salla/Stripe مُشفَّرة AES-GCM. لكن `parties.iban` و`bank_accounts.account_number` مخزَّنة plaintext (مُقَنَّعة عند القراءة فقط).
- **الإجراء**: أضِف `iban_enc` و`account_number_enc` أعمدة مُشفَّرة. استخدم نفس `secret-box`. أبقِ الأعمدة القديمة masked للتوافق.
- **الأثر المتوقَّع**: حماية البيانات المالية الحساسة حتى لو تسرَّب الـDB.
- **الجهد**: M

---

### SH-06 — rate limit على كل مسارات auth
- **المنطقة**: `apps/api/src/modules/platform/auth/`
- **الفرصة**: `RateLimiterService` موصَّل بـlogin. تحقَّق من `POST /auth/refresh`, `/auth/change-password`, `POST /auth/mfa/*`.
- **الإجراء**: راجِع وأضِف `@RateLimit` لكل مسار auth. اختبر المحاولة المتكررة.
- **الأثر المتوقَّع**: حماية شاملة من brute force.
- **الجهد**: S

---

### SH-07 — audit للقراءات الحساسة في platform admin
- **المنطقة**: `apps/api/src/modules/platform/guards/platform-admin.guard.ts:68` (TODO)
- **الفرصة**: GET reads في `/platform/*` (omnibox، audit trail، tenant details) غير مُدقَّقة. token مُخترَق يُعدِّد tenants/users بلا أثر.
- **الإجراء**: أضِف audit للـGET reads الحساسة. حلَّ TODO في `platform-admin.guard.ts:68`.
- **الأثر المتوقَّع**: تتبُّع كل وصول لبيانات tenants.
- **الجهد**: M

---

### SH-08 — mTLS بين services
- **المنطقة**: `deploy/k8s/`
- **الفرصة**: الـAPI والـworker وRedis وDB يتواصلون بـplaintext داخل الشبكة.
- **الإجراء**: استخدم Istio/Linkerd لـmTLS تلقائي بين pods. أو شهادات يدوية.
- **الأثر المتوقَّع**: حماية traffic lateral.
- **الجهد**: L

---

### SH-09 — فحص secrets في CI
- **المنطقة**: CI
- **الفرصة**: `.gitleaksignore` موجود لكن gitleaks لا يعمل في CI (لأن CI غير موجود).
- **الإجراء**: بعد CI-01، أضِف خطوة gitleaks على كل push وPR.
- **الأثر المتوقَّع**: منع commit أسرار.
- **الجهد**: S

---

### SH-10 — bug bounty / security review خارجي
- **المنطقة**: خارجي
- **الفرصة**: لا مراجعة أمنية خارجية.
- **الإجراء**: تعاقد مع شركة أمن سيبراني لمراجعة penetration test شاملة. أصلح ما يكتشف.
- **الأثر المتوقَّع**: كشف ثغرات لا يراها المراجعة الداخلية.
- **الجهد**: M (تكلفة مالية)

---

## 9. قابلية التوسُّع (Scalability)

### SC-01 — pgbouncer كـsidecar
- **المنطقة**: `deploy/k8s/`
- **الفرصة**: كل pod يفتح pool اتصالات مباشر. 6 replicas × 10 = 60 اتصال على الـDB.
- **الإجراء**: أضِف pgbouncer كـsidecar أو service خارجي. pool صغير لكل pod (2-3)، pgbouncer يُدير multiplexing.
- **الأثر المتوقَّع**: DB يرى 12 اتصال بدل 60. يدعم المزيد من الـreplicas.
- **الجهد**: M

---

### SC-02 — verify لا sticky sessions
- **المنطقة**: ingress config
- **الفرصة**: HPA min=2 max=6. لو sticky sessions مفعَّلة، يُلغِي مفعول الـscaling.
- **الإجراء**: تحقَّق أن ingress لا يستخدم sticky sessions. استخدم cookie-less auth (HttpOnly cookie موزَّع).
- **الأثر المتوقَّع**: توزيع حمل فعلي.
- **الجهد**: S

---

### SC-03 — sharding للـtenants الكبار
- **المنطقة**: `packages/database/`
- **الفرصة**: عند >1000 tenant، RLS وحده يُصبح hot path. الـindexes تنتفخ.
- **الإجراء**: خطط الآن لـ:
  - schema-per-tenant للـtenants الكبار (>1000 مستخدم).
  - database-per-tenant للـenterprises.
  - أبقِ `app.tenant_id` switching للـlong tail.
- **الأثر المتوقَّع**: قابلية توسُّع لـ100k+ tenant.
- **الجهد**: XL

---

### SC-04 — partitioning للجداول الكبيرة
- **المنطقة**: `audit_log` (D-01 في ISSUES.md) + `journal_entry_lines`, `sales_invoice_lines`, `inventory_transactions`
- **الفرصة**: جداول تُحدِّثها كل عملية تنمو بلا حدود.
- **الإجراء**: جزِّئها بـ`RANGE (created_at)` شهرياً. أضِف partition pruning في الاستعلامات.
- **الأثر المتوقَّع**: استعلامات تبقى سريعة مع نمو البيانات.
- **الجهد**: L

---

### SC-05 — CDN للملفات الثابتة
- **المنطقة**: `apps/marketing/`, `apps/staff/public/`
- **الفرصة**: Next.js يخدم الـstatic بنفسه. لا CDN.
- **الإجراء**: استخدم CloudFront/Cloudflare. وجِّه `/_next/static/*` للـCDN.
- **الأثر المتوقَّع**: تحميل أسرع عالمياً، تكلفة إخراج أقل.
- **الجهد**: M

---

### SC-06 — async webhook delivery
- **المنطقة**: `apps/api/src/modules/developer/webhook-publisher.service.ts`
- **الفرصة**: إرسال webhooks bursty. الـworker يحجز resources دائماً.
- **الإجراء**: انقل إرسال webhook إلى Lambda/CloudRun (pay-per-invocation). أو استخدم SQS + consumer مستقل.
- **الأثر المتوقَّع**: تكلفة أقل، توسُّع أفضل للـbursts.
- **الجهد**: L

---

## 10. تحسين التكلفة (Cost Optimization)

### CO-01 — سياسة S3 lifecycle للـbackups
- **المنطقة**: `apps/api/src/modules/backups/artifact-store.ts` + S3 config
- **الفرصة**: لا lifecycle policy موثَّقة. كل backups على Standard storage.
- **الإجراء**: اضبط: Standard 30 يوم → GLACIER_IR 60 يوم → DEEP_ARCHIVE 7 سنوات → EXPIRE.
- **الأثر المتوقَّع**: تقليل تكلفة S3 للـbackups 80%+.
- **الجهد**: S

---

### CO-02 — حماية تكلفة LLM بحدود شهرية لكل tenant
- **المنطقة**: `apps/api/src/modules/ai/ai-llm.ts:103` + `usage/`
- **الفرصة**: `estimateCost` موجود لكن لا حد شهري لكل tenant. tenant يستطيع استنزاف ميزانية LLM.
- **الإجراء**: استخدم `usage.record('ai_tokens_per_month')` (النمط موجود لـ`email_sends_per_month`). ارفض بعد تجاوز الحد.
- **الأثر المتوقَّع**: تكلفة LLM متحكم بها.
- **الجهد**: S

---

### CO-03 — reserved instances للـDB
- **المنطقة**: `infrastructure/`
- **الفرصة**: DB على on-demand. تكلفة أعلى 40%.
- **الإجراء**: اشترِ reserved instances للـDB (1-3 سنوات). اعمل تحليل workload أولاً.
- **الأثر المتوقَّع**: توفير 30-50% على تكلفة DB.
- **الجهد**: S (متطلب رأسمالي)

---

### CO-04 — autoscaling للـworker
- **المنطقة**: `deploy/k8s/`
- **الفرصة**: worker يعمل دائماً بـreplica واحد.
- **الإجراء**: استخدم KEDA للـautoscaling بناءً على طول طابور outbox. scale to 0 في الليل (low traffic).
- **الأثر المتوقَّع**: توفير موارد worker في أوقات الهدوء.
- **الجهد**: M

---

### CO-05 — image optimization مع sharp
- **المنطقة**: `apps/staff/`, `apps/customer-portal/`
- **الفرصة**: لا `next/image` بـ`sharp` للصور المنتجة. تُحمَّل بحجمها الأصلي.
- **الإجراء**: فعِّل `sharp` في `next.config.mjs`. استخدم `next/image` لكل صور الـproducts. أضِف تنسيقات WebP/AVIF.
- **الأثر المتوقَّع**: تقليل حجم الصور 60%+، تحميل أسرع.
- **الجهد**: S

---

### CO-06 — تحليل تكلفة دوري
- **المنطقة**: `infrastructure/`
- **الفرصة**: لا تقرير شهري للتكلفة.
- **الإجراء**: أَنشِئ dashboard يعرض: تكلفة DB, S3, egress, LLM, SMS, payment gateway fees. تنبيه عند تجاوز ميزانية شهرية.
- **الأثر المتوقَّع**: كشف التضخُّم التكلفي مبكراً.
- **الجهد**: M

---

## 11. الامتثال (Compliance)

### CMP-01 — اختبار ZATCA Phase 2 ضد sandbox حقيقي
- **المنطقة**: `apps/api/src/modules/einvoicing/`
- **الفرصة**: الـmodule شامل (hash chain، ICV تحت FOR UPDATE، UBL، QR، clearance/reporting). لكن verify scripts تستخدم stubs بأسلوب `OCR_PROVIDER=mock`. لم يُختبر بـCSID إنتاجي ضد Fatoora sandbox.
- **الإجراء**:
  1. احصل على CSID من sandbox الفاتورة.
  2. شغِّل اختبار شامل: clearance invoice، reporting invoice، debit/credit notes.
  3. وثِّق أي تناقضات مع spec ZATCA.
- **الأثر المتوقَّع**: جاهزية إنتاجية حقيقية لـZATCA.
- **الجهد**: M

---

### CMP-02 — دعم data residency متعدد المناطق
- **المنطقة**: `infrastructure/` + `packages/database/`
- **الفرصة**: لا قصة data residency. لو خدمة عملاء EU، يجب تثبيت المنطقة لكل tenant.
- **الإجراء**:
  1. أضِف `region` field لـ`tenants` table.
  2. أَنشِئ deployments منفصلة لـEU (Postgres + S3).
  3. وجِّه الـtraffic بناءً على region الـtenant.
- **الأثر المتوقَّع**: الامتثال لـGDPR لعملاء EU.
- **الجهد**: XL

---

### CMP-03 — سياسة احتفاظ بيانات موثَّقة
- **المنطقة**: جديد `docs/retention-policy.md` + `packages/database/src/schema/`
- **الفرصة**: القانون السعودي يلزم 6+ سنوات احتفاظ سجلات محاسبية. لا سياسة موثَّقة. (D-01 يُصلح الـaudit_log؛ هنا التعميم.)
- **الإجراء**: عرِّف سياسة لكل نوع بيانات: سجلات محاسبية (7 سنوات)، سجلات HR (تختلف)، PII العملاء (حسب طلب)، backups (90 يوم hot، 7 سنوات cold).
- **الأثر المتوقَّع**: امتثال قانوني + ضمان حذف في الوقت.
- **الجهد**: M

---

### CMP-04 — endpoint لتصدير بيانات العميل (GDPR)
- **المنطقة**: `apps/api/src/modules/parties/` + جديد
- **الفرصة**: لا `GET /parties/:id/export` يُنتِج dump بيانات GDPR-compliant.
- **الإجراء**: أَنشِئ endpoint يُصدِّر: بيانات العميل، كل فواتيره، مدفوعاته، تعليقاته، ملفاته. JSON + PDF.
- **الأثر المتوقَّع**: امتثال right to access.
- **الجهد**: M

---

### CMP-05 — endpoint لمحق بيانات العميل
- **المنطقة**: نفس CMP-04
- **الفرصة**: لا right to erasure.
- **الإجراء**: أَنشِئ endpoint يحذف: PII العميل (الاسم، البريد، الجوال)، يُفرِّغ الـiban، يُ保留 الفواتير للأغراض الضريبية (مُ anonimized).
- **الأثر المتوقَّع**: امتثال right to be forgotten مع احترام التزامات ضريبية.
- **الجهد**: L

---

### CMP-06 — سكربت تدقيق backup/restore
- **المنطقة**: جديد `scripts/backup-restore-drill.mjs`
- **الفرصة**: `docs/PHASE_23_IMPLEMENTATION_REPORT.md` يذكر "backup/PITR drill" كـenvironment-owner gate لكن لا سكربت ملتزم.
- **الإجراء**: سكربت يسترجع آخر backup إلى scratch schema، يُجري checksum query، يُصدِّر تقرير. شغِّل شهرياً.
- **الأثر المتوقَّع**: ضمان قابلية الاسترجاع قبل الحاجة.
- **الجهد**: S

---

### CMP-07 — توقيع PDFs للفواتير المعتمدة
- **المنطقة**: `apps/api/src/modules/reporting/print-templates.service.ts`
- **الفرصة**: فواتير ZATCA مُوقَّعة XML لكن PDF المُولَّد غير مُوقَّع رقمياً.
- **الإجراء**: أضِف توقيع PDF بـPAdES مع شهادة الـtenant. اعرض الـsignature visible في الزاوية.
- **الأثر المتوقَّع**: قابلية التحقق من PDF بلا الرجوع للـAPI.
- **الجهد**: L

---

## 12. تدويل اللغة (i18n)

### I18N-01 — إدخال `next-intl` للدعم الكامل
- **المنطقة**: كل التطبيقات الـ4
- **الفرصة**: لا مكتبة i18n. كل النصوص مضمَّنة. لا بنية تحتية لأي لغة غير العربية. (F-22 في ISSUES.md يُحدِّد المشكلة للـstaff.)
- **الإجراء**:
  1. ثبِّت `next-intl`.
  2. استخرج كل النصوص العربية إلى `messages/ar.json`.
  3. أنشِئ `messages/en.json`.
  4. أضِف locale switcher فعلي.
  5. اضبط `dir="rtl"`/`dir="ltr"` ديناميكياً.
- **الأثر المتوقَّع**: دعم EN كامل، جاهز للغات إضافية.
- **الجهد**: XL (مشروع متعدد أسابيع)

---

### I18N-02 — ترجمة رسائل `DomainError` حسب لغة العميل
- **المنطقة**: `packages/contracts/src/errors.ts` + `apps/api/src/common/filters/all-exceptions.filter.ts`
- **الفرصة**: رسائل `DomainError` مزدوجة اللغة في بعض الأماكن (`hrm.service.ts:131` `'يجب إدخال اسم الإضافة ⚠️'`) لكن إنجليزية فقط في أخرى (`parties.service.ts:35`). لا تفاوض على لغة، لغة المتصفح تُتجاهل.
- **الإجراء**:
  1. عرِّف `messages.ts` بـerror codes كـkeys.
  2. اقبل `Accept-Language` header.
  3. ترجِم رسالة الخطأ بناءً على لغة العميل.
- **الأثر المتوقَّع**: تجربة عميل غير عربي أفضل.
- **الجهد**: M

---

### I18N-03 — `Intl.NumberFormat` لعرض العملات
- **المنطقة**: frontends + `packages/ui/`
- **الفرصة**: كل أموال مُخزَّنة strings بـ4 خانات عشرية (halalas). لا `Intl.NumberFormat`. الـfrontend يُصلِّب `ر.س`.
- **الإجراء**: أَنشِئ `formatCurrency(amount, currency, locale)` helper. استخدمه في كل عرض مالي. اضبط currency من `tenant.baseCurrency`.
- **الأثر المتوقَّع**: عرض صحيح للعملات المتعددة (SAR, AED, USD, EGP).
- **الجهد**: M

---

### I18N-04 — `Intl.DateTimeFormat` لعرض التواريخ
- **المنطقة**: frontends
- **الفرصة**: `Intl.DateTimeFormat` مستخدم في `payroll-compliance.ts:343` و`ai-engine.ts:128` فقط. الـfrontend يُصلِّب `YYYY-MM-DD`.
- **الإجراء**: أَنشِئ `formatDate(date, locale, options)` helper. استخدمه في كل عرض تاريخ. اضبط timezone من `tenant.timezone`.
- **الأثر المتوقَّع**: تواريخ معروضة بتوقيت الـtenant ولغته.
- **الجهد**: M

---

### I18N-05 — دعم locale ثالث (مثلاً فرنسي)
- **المنطقة**: `apps/marketing/` (أولوية) ثم باقي التطبيقات
- **الفرصة**: لو استهداف شمال أفريقيا (الجزائر، تونس، المغرب) الفرنسية ضرورية.
- **الإجراء**: بعد I18N-01، أضِف `messages/fr.json`. اختبر RTL/LTR switching. وظِّف مترجم.
- **الأثر المتوقَّع**: توسيع سوق.
- **الجهد**: L

---

### I18N-06 — توثيق مصطلحات الأعمال
- **المنطقة**: جديد `docs/glossary.md`
- **الفرصة**: مصطلحات مثل "قيد"، "سند"، "مرتجع"، "خصم" لا توجد مرادفات إنجليزية موحَّدة.
- **الإجراء**: أَنشِئ glossary ثلاثي اللغة (AR/EN/FR) مع تعريفات. اربط بالكود.
- **الأثر المتوقَّع**: ترجمة متسقة عبر الفريق.
- **الجهد**: M

---

## ملخص الأولويات والجدولة

### حرج ( Critical) — ابدأ الآن
| ID | الوصف | الجهد |
|---|---|---|
| CI-01 | إنشاء pipeline CI كامل | M |
| CI-02 | تثبيت husky pre-commit hooks | S |
| CMP-01 | اختبار ZATCA Phase 2 ضد sandbox حقيقي | M |

### عالي (High) — Q1 القادم
| ID | الوصف | الجهد |
|---|---|---|
| O-01 | OpenTelemetry distributed tracing | L |
| O-02 | Prometheus `/metrics` | M |
| O-03 | SLOs + alerting | M |
| T-01 | Playwright e2e tests | XL |
| T-02 | OpenAPI contract tests | S |
| T-03 | coverage gate | S |
| P-01 | Redis caching layer | M |
| P-02 | DataLoader لـN+1 | M |
| SH-01 | CSP صارم بـnonces | M |
| SH-03 | SBOM generation | S |
| SH-04 | Dependabot | S |
| SH-05 | تشفير IBAN/رقم الحساب | M |
| DOC-02 | مخطط C4 | M |
| DOC-04 | runbooks | M |
| I18N-01 | إدخال `next-intl` | XL |
| SC-01 | pgbouncer sidecar | M |
| SC-04 | partitioning للجداول الكبيرة | L |

### متوسط (Medium) — Q2-Q3
| ID | الوصف | الجهد |
|---|---|---|
| O-04, O-05 | trace context في السجلات، سياسة احتفاظ | S+S |
| T-04, T-05, T-06, T-07 | k6 load، up-down migrations، mutation testing، contract testing خارجي | M+S+L+L |
| P-03, P-04, P-05, P-06, P-07, P-08 | materialized views، pool tuning، slow queries، read replicas، async reports، outbox fan-out | L+S+S+L+M+S |
| D-01..D-08 | Turborepo، typegen workflow، db reset، env validation، simplify local-start، PR template، Storybook، generate SDK | S+S+S+S+M+S+M+M |
| CI-03..CI-06 | GitOps، deploy docs، canary، squawk | M+S+L+S |
| DOC-01, DOC-03, DOC-05, DOC-06 | ADRs، API sandbox، CONTRIBUTING، RLS docs | S+M+S+M |
| F-02, F-03 | currency switcher، approvals engine | M+XL |
| SH-06..SH-10 | rate limit auth، audit reads، mTLS، secrets في CI، bug bounty | S+M+L+S+M |
| SC-02, SC-03, SC-05, SC-06 | لا sticky، sharding، CDN، async webhooks | S+XL+M+L |
| CO-01..CO-06 | S3 lifecycle، LLM cap، reserved DB، worker autoscale، sharp، cost dashboard | S+S+S+M+S+M |
| CMP-02..CMP-07 | data residency، retention policy، GDPR export/erasure، backup drill، PDF signing | XL+M+M+L+S+L |
| I18N-02..I18N-06 | DomainError i18n، NumberFormat، DateTimeFormat، فرنسي، glossary | M+M+M+L+M |

### منخفض (Low) — backlog
| ID | الوصف |
|---|---|
| F-01 | تتبُّع future-enhancements |
| DOC-01 (متكرر) | ADRs مستمرة |
| F-04..F-10 | custom report builder، mobile app، SDK، WMS، Projects advanced، CRM advanced، marketplace apps |

---

## مبادئ توجيهية للتنفيذ

1. **افعل شيئاً واحداً بشكل صحيح**: كل تحسين يجب أن يُكمَل بنسبة 100% مع اختبارات وتوثيق قبل الانتقال للتالي. التحسين الجزئي أسوأ من لا شيء.

2. **قِس قبل وبعد**: كل تحسين أداء/تكلفة يتطلب metric baseline ومقارنة. لا تدَّعي تحسُّناً بلا أرقام.

3. **توثيق القرارات**: كل قرار كبير يتطلب ADR. القرار غير الموثَّق ليس قراراً.

4. **الاختبار قبل الإنتاج**: كل ميزة/تحسين يُمرَّ عبر staging وsmoke test قبل الإنتاج.

5. **التراجع المخطَّط**: كل deploy يجب أن يكون قابل للتراجع في < 5 دقائق. وثِّق rollback procedure.

6. **مراجعة دورية**: جدول مراجعة ربع سنوية لهذا الملف. أَزِل ما تم، أَضِف الجديد.

7. **الديون التقنية**: كل sprint يخصص 20% للديون التقنية. لا تتجاوزها.

8. **الأمن أولاً**: أي تعارض بين الأمن والميزات يُحل لصالح الأمن. لا استثناءات.

---

## ختام

هذا الملف يُغطّي **86 فرصة تحسين** موزَّعة على 12 قسم. ليست جميعها ذات أولوية متساوية. ابدأ بالحرجة (Critical) ثم العالية (High). استخدم جدول الأولويات للتخطيط الربع سنوي.

> **ملاحظة**: هذا الملف مكمِّل لـ`ISSUES.md`. اقرأهما معاً للحصول على صورة كاملة. الـ`ISSUES.md` يُصلح ما هو مكسور؛ هذا الملف يُضيف قيمة لما يعمل.

> **التاريخ**: 2026-10-06
> **المراجعة التالية**: 2027-01-06
