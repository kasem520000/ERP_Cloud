import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { extractEffectiveSettings } from '../app/settings/general/page';
import { allScreens } from '../lib/navigation';
import { describePermissionAr } from '../lib/permissions-ar';
import { permissionRegistry } from '@erp/contracts';

describe('general settings payload unwrapping (Item 3)', () => {
  it('unwraps { settings, registry } from GET /api/v1/settings without leaking nested settings/registry keys', () => {
    const apiPayload = {
      settings: {
        allow_negative_stock: false,
        default_currency_code: 'SAR',
        'invoice.number_prefix': 'SI-',
        'invoice.padding': 6,
        'invoice.start_at': 1,
        'pos.barcodeAuto': true,
      },
      registry: [
        { key: 'allow_negative_stock', module: 'inventory', description: '...', defaultValue: false },
      ],
    };

    const effective = extractEffectiveSettings(apiPayload);
    expect(effective).toEqual({
      allow_negative_stock: false,
      default_currency_code: 'SAR',
      'invoice.number_prefix': 'SI-',
      'invoice.padding': 6,
      'invoice.start_at': 1,
      'pos.barcodeAuto': true,
    });
    expect('settings' in effective).toBe(false);
    expect('registry' in effective).toBe(false);
  });

  it('also supports flat settings dictionaries and strips accidental nested settings/registry keys', () => {
    const flatPayload = {
      allow_negative_stock: true,
      'vat.default_rate_percent': 15,
      settings: { stale: true },
      registry: [],
    };
    expect(extractEffectiveSettings(flatPayload)).toEqual({
      allow_negative_stock: true,
      'vat.default_rate_percent': 15,
    });
  });
});

describe('no desktop / frm* UI references & Arabic permission localization (Item 4)', () => {
  function walkTsFiles(dir: string, acc: string[] = []): string[] {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.next', 'dist', 'tests'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkTsFiles(full, acc);
      else if (/\.(tsx?|mjs)$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name)) acc.push(full);
    }
    return acc;
  }

  it('contains zero non-comment references to الديسكتوب / frm* / .xaml in staff UI files', () => {
    const staffRoot = path.resolve(__dirname, '..');
    const files = [
      ...walkTsFiles(path.join(staffRoot, 'app')),
      ...walkTsFiles(path.join(staffRoot, 'components')),
    ];
    const forbidden = /دسكتوب|ديسكتوب|النسخة المكتبية|النافذة المكتبية|\b[fF]rm[A-Z][A-Za-z0-9_]*|\b[A-Za-z0-9_]+\.xaml\b/;

    const violations: string[] = [];
    for (const file of files) {
      const stripped = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      stripped.split('\n').forEach((line, idx) => {
        if (forbidden.test(line)) {
          violations.push(`${path.relative(staffRoot, file)}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('contains zero frm* / الديسكتوب strings in navigation screen descriptions and includes بطاقة مجموعة ضريبية', () => {
    const taxGroupsScreen = allScreens.find((item) => item.href === '/inventory/tax-groups');
    expect(taxGroupsScreen?.labelAr).toBe('بطاقة مجموعة ضريبية');

    const badDescriptions = allScreens.filter(
      (item) =>
        item.description &&
        (/دسكتوب|ديسكتوب|\b[fF]rm[A-Za-z0-9_]+|\.xaml/.test(item.description)),
    );
    expect(badDescriptions).toEqual([]);
  });

  it('translates 100% of canonical tenant permissions into Arabic titles', () => {
    for (const perm of permissionRegistry) {
      if (perm.deprecated) continue;
      const desc = describePermissionAr(perm.code, perm.module);
      expect(desc.title).not.toBe(perm.code);
      expect(/[\u0600-\u06FF]/.test(desc.title)).toBe(true);
    }
  });
});
