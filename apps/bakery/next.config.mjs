import { loadEnvFiles } from '../../scripts/dotenv.mjs';

// ‏Next يقرأ `apps/bakery/.env*` وحدها، والمستودع يحفظ `.env` واحدة في الجذر — فتُحمَّل هنا
// قبل تقييم كائن الإعداد (الآلية نفسها في staff وplatform-admin وcustomer-portal).
loadEnvFiles(process.cwd());

/**
 * عنوان الـAPI الذي تُمرَّر إليه `/api/v1/*` من هذه الواجهة (same-origin من المتصفّح).
 *
 * كان الافتراضي `http://127.0.0.1:${PORT}` — ومنفذ الواجهة نفسها يأتي في `PORT` عند PM2 أو
 * `next start`، فتوكّل الواجهة إلى **نفسها** بدل الـAPI: كل نداء يفشل بـ404 محلي، ويبدو
 * العطل كأنه خطأ في الـAPI. الافتراضي الآن منفذ الـAPI الصريح، والقيمة تُثبَّت وقت البناء
 * لأن `rewrites()` تُخزَّن في `.next/routes-manifest.json`.
 */
const apiTarget = (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');

/**
 * أيّ مضيفٍ يجوز له مخاطبة خادم التطوير.
 *
 * الواجهة تُفتح عبر مضيف النفق (`https://3005-<sandbox>.e2b.app`) وفي الإنتاج عبر
 * `bakery.erp.example`، وNext 15 يعامل أيّ طلب `/_next/*` بمضيفٍ غير محليّ طلبَ تطويرٍ
 * عبريّ الأصل. والقائمة هنا للتطوير وحده: `next start` يتجاهلها فلا يتّسع سطحُ
 * الإنتاج.
 */
const allowedDevOrigins = [
  'localhost',
  '127.0.0.1',
  '*.e2b.app',
  '*.e2b.dev',
  '*.arena.ai',
  'bakery.erp.example',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // ‏ADR-030: الحزمة المشتركة تُشحن مصدراً TypeScript فيُصرّفها التطبيق نفسه،
  // فلا خطوة بناءٍ تُزامَن بين الواجهات.
  transpilePackages: ['@erp/ui', '@erp/web-core', '@erp/web-van'],
  poweredByHeader: false,
  allowedDevOrigins,
  env: {
    // ‏فارغ = «المضيف نفسه»: الطلبات تذهب إلى `/api/v1/*` على هذا الخادم وإعادة الكتابة
    // أدناه تحوّلها إلى API. هكذا تعمل الواجهة من أيّ مضيف (شبكة محلية، نفق، حاوية)
    // بلا لمس CORS — ولا يعرف المتصفّح عنوان API الداخليّ أبداً.
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? '',
  },
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${apiTarget}/api/v1/:path*` },
      { source: '/api/health/:path*', destination: `${apiTarget}/health/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "form-action 'self'",
              "connect-src 'self' http: https:",
              "img-src 'self' data: blob:",
              "style-src 'self' 'unsafe-inline'",
              process.env.NODE_ENV === 'production'
                ? "script-src 'self' 'unsafe-inline'"
                : "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              `frame-ancestors ${process.env.CSP_FRAME_ANCESTORS ?? "'self' https://*.e2b.app https://*.e2b.dev https://*.arena.ai"}`,
            ].join('; '),
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
