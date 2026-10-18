import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const pages = [
  'auth/login', 'auth/forgot', 'auth/change-password',
  'portal', 'portal/invoices', 'portal/invoices/[id]', 'portal/invoices/[id]/pay',
  'portal/payments', 'portal/profile', 'portal/statement',
];
const appDir = fileURLToPath(new URL('../app/', import.meta.url));

describe('portal page structure (not a substitute for browser review)', () => {
  it.each(pages)('%s uses the shared structural engine, not just a colour import', (route) => {
    const source = readFileSync(`${appDir}${route}/page.tsx`, 'utf8');
    expect(source).toContain("from '@erp/ui/page'");
    expect(source).toContain('<PageFrame');
    expect(source).toContain('<PageHeader');
    if (route.startsWith('portal')) expect(source).toContain('<PortalShell>');
    expect(source).not.toContain('className="card"');
  });
});
