import { loadEnvFiles } from '../../scripts/dotenv.mjs';

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

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.NEXT_OUTPUT_STANDALONE === '1' ? { output: 'standalone' } : {}),
  // ‏`@erp/web-core` تُشحن مصدراً TypeScript (ADR-030) فيُصرّفها التطبيق نفسه؛ والبوابة
  // تستهلك منها قرارَ عنوان التسليم (`handoffAction`) بدل نسخةٍ محلية ثانية من القاعدة.
  transpilePackages: ['@erp/web-core'],
  poweredByHeader: false,
  env: {
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
            // SH-01: restrict frame-ancestors to self + Arena/e2b preview hosts (or CSP_FRAME_ANCESTORS)
            // instead of `*`, and drop 'unsafe-eval' in production builds while keeping dev HMR working.
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
