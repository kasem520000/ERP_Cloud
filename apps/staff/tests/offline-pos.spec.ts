import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const source = (name: string) => new URL(`../${name}`, import.meta.url);

describe('offline POS PWA surface', () => {
  it('has an installable manifest and a worker fallback for both offline screens', async () => {
    const manifest = JSON.parse(await readFile(source('public/manifest.webmanifest'), 'utf8')) as {
      start_url: string;
      display: string;
      icons: unknown[];
    };
    const worker = await readFile(source('public/sw.js'), 'utf8');
    expect(manifest.start_url).toBe('/pos/offline');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(worker).toContain("request.mode === 'navigate'");
    expect(worker).toContain("'/pos/offline'");
    expect(worker).toContain("'/pos/offline-queue'");
  });

  /**
   * أحكام المكتبة (طابور IndexedDB وحلقة إعادة المحاولة كل عشر ثوانٍ) انتقلت مع كودها إلى
   * `packages/web-core/tests/offline-store.spec.ts` — وبقيت هنا أحكام شاشة المخبز نفسها.
   */
  it('keeps the barcode fallback and the retry action in the offline screens', async () => {
    const pos = await readFile(source('app/pos/offline/page.tsx'), 'utf8');
    const queue = await readFile(source('app/pos/offline-queue/page.tsx'), 'utf8');
    expect(pos).toContain('BarcodeDetector');
    expect(pos).toContain('إيصال 80mm');
    expect(queue).toContain('retryOfflineConflict');
  });
});
