import { loadEnvFiles } from '../../scripts/dotenv.mjs';

loadEnvFiles(process.cwd());

const apiTarget = (process.env.API_PROXY_TARGET ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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
            value:
              "default-src 'self'; connect-src 'self' http: https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; frame-ancestors *",
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
