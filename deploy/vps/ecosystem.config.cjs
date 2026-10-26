/**
 * PM2 — نشر Sahab Accounting على VPS واحد.
 *
 *   pm2 start deploy/vps/ecosystem.config.cjs --env production
 *   pm2 save && pm2 startup
 *
 * ── ما يُصلحه هذا الملف مقابل النسخة اليدوية ─────────────────────────────────
 *
 * 1. **`erp-worker` كان غائباً.** الـAPI يخدم HTTP فقط؛ المستهلكون (بريد، إشعارات،
 *    إعادة محاولات ZATCA، الحملات، التقارير الأسبوعية) يعيشون في عملية `WORKER=1`.
 *    بلا هذه العملية تبقى الصفوف في الطابور إلى الأبد: تظهر «تم الإرسال» ولا يخرج بريد.
 * 2. **`PORT` كان يُفسد وكيل الـAPI.** كل واجهة تُمرّر `/api/v1/*` إلى الـAPI؛ وكان
 *    `next.config.mjs` يبني الهدف من `PORT` (منفذ الواجهة نفسها). الآن الهدف صريح عبر
 *    `API_PROXY_TARGET`، والمنافذ عبر `*_PORT` التي يقرأها `scripts/next-run.mjs`.
 * 3. **المنافذ على loopback.** `WEB_HOST=127.0.0.1` و`API_HOST=127.0.0.1`: لا وصول
 *    مباشر إلى 3000–3005 من الإنترنت، فكل الطلبات تمرّ بـNginx (وترويسات الأمان
 *    والعنوان الحقيقي للعميل تصبح ذات معنى).
 * 4. **`env_production` مُعرَّف صراحةً.** `deploy.sh` يمرّر `--env production`، فيجد
 *    PM2 البيئة المعلنة بلا تحذير `Environment [production] is not defined`.
 * 5. **إغلاق `/api/docs` وتخطّي الهجرة التلقائية المكررة وقت الإقلاع.** `deploy.sh`
 *    يشغّل `pnpm run db:migrate` بدور المهاجر قبل إعادة التشغيل، فلا تُعيد عملية
 *    `erp-api` محاولة الهجرة ولا تفتح Swagger في الإنتاج افتراضياً.
 *
 * القيم الحسّاسة في `.env` (‏`chmod 600`) لا هنا: هذا الملف يُحفظ في المستودع.
 *
 * ملاحظة: الواجهات تُبنى مسبقاً بـ`pnpm -r run build` — و`next start` يقرأ
 * `.next/routes-manifest.json`، فقيمة `API_PROXY_TARGET` تُثبَّت **وقت البناء** أيضاً.
 */
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const app = (dir) => path.join(root, 'apps', dir);

const baseEnv = {
  NODE_ENV: 'production',
  TZ: 'Asia/Riyadh',
  // تقارير أخطاء سيرفرات Next تذهب مباشرة عبر loopback بدلاً من الالتفاف عبر شهادة Cloudflare الخارجية.
  PROBLEM_INGEST_URL: 'http://127.0.0.1:3000/api/v1',
  // لا أسرار هنا: `@erp/config` يقرأ `.env` من جذر المستودع بالبحث الصاعد من `cwd`،
  // فيكفي أن تكون العمليات داخل شجرة المستودع.
};

const withProductionEnv = (vars) => {
  const merged = { ...baseEnv, ...vars };
  return {
    env: merged,
    env_production: { ...merged },
  };
};

const common = {
  autorestart: true,
  // سقفٌ أعلى من استهلاك الذروة المقاس؛ عند تجاوزه إعادة تشغيل أفضل من swap.
  max_memory_restart: '700M',
  // إقلاعٌ متكرر خلال دقيقة يعني عطلاً حقيقياً: توقّف بدل أن تخفي السبب.
  max_restarts: 10,
  min_uptime: '30s',
  restart_delay: 2000,
  kill_timeout: 15000,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  error_file: path.join(root, 'logs', 'error.log'),
  out_file: path.join(root, 'logs', 'out.log'),
  merge_logs: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'erp-api',
      cwd: app('api'),
      script: 'dist/main.js',
      interpreter: 'node',
      // عملية واحدة في الأساس؛ عند التوسّع: `pm2 scale erp-api 2` مع Redis (مضبوط) و
      // `TRUST_PROXY=loopback` — الدلو المشترك يجعل السقف سقفاً واحداً لا سقفاً لكل نسخة.
      instances: 1,
      exec_mode: 'fork',
      ...withProductionEnv({
        PORT: '3000',
        API_HOST: '127.0.0.1',
        API_PROXY_TARGET: 'http://127.0.0.1:3000',
        // على VPS تعمل عملية `erp-worker` مستقلة؛ تعطيل العامل المدمج يمنع ازدواج السحب.
        EMBEDDED_WORKER: '0',
        // `deploy.sh` يشغّل `pnpm run db:migrate` قبل الإقلاع بدور المهاجر؛ تخطّي المحاولة هنا يسرّع الإقلاع ويمنع تعليق الاتصالات.
        AUTO_MIGRATE: 'false',
        // توثيق Swagger مغلق في الإنتاج افتراضياً (دفاع بالعمق إلى جانب حجب Nginx).
        OPENAPI_ENABLED: 'false',
        // خلف Nginx على loopback فقط: الوكيل الوحيد الموثوق.
        TRUST_PROXY: 'loopback',
      }),
    },
    {
      ...common,
      name: 'erp-worker',
      cwd: app('api'),
      script: 'dist/main.js',
      interpreter: 'node',
      // نسخة واحدة: توقيع ZATCA وترقيم المستندات يحتاجان تسلسلاً، والتوازي هنا
      // يضاعف العمل لا يسرّعه (القفل في القاعدة هو ما يمنع التكرار).
      instances: 1,
      exec_mode: 'fork',
      ...withProductionEnv({
        WORKER: '1',
        // بلا PORT: عمليةٌ بلا مستمع HTTP أصلاً، و`PORT` هنا تُربك القراءة فقط.
      }),
    },
    ...['staff', 'marketing', 'platform-admin', 'customer-portal', 'bakery'].map((name, index) => ({
      ...common,
      name: `erp-${name}`,
      cwd: app(name),
      // `pnpm start` يشغّل `scripts/next-run.mjs` الذي يقرأ المنفذ من `*_PORT`.
      script: 'pnpm',
      args: 'start',
      interpreter: 'none',
      ...withProductionEnv({
        WEB_HOST: '127.0.0.1',
        API_PROXY_TARGET: 'http://127.0.0.1:3000',
        // المنافذ كما في `apps/*/next.config.mjs` و`deploy/vps/nginx-erpcloud.conf`.
        [`${['STAFF', 'MARKETING', 'PLATFORM_ADMIN', 'CUSTOMER_PORTAL', 'BAKERY'][index]}_PORT`]: String(
          3001 + index,
        ),
      }),
    })),
  ],
};
