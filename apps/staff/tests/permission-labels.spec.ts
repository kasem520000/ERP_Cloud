import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { permissionRegistry } from '@erp/contracts';

import { permissionLabelAr, systemRoleNameAr } from '../lib/permission-labels';

const rolePage = readFileSync(
  fileURLToPath(new URL('../app/settings/roles/page.tsx', import.meta.url)),
  'utf8',
);
const explicit = rolePage.slice(
  rolePage.indexOf('const PERMISSION_LABELS_AR'),
  rolePage.indexOf('function describePermissionAr'),
);

describe('Arabic tenant permissions', () => {
  it('names every canonical permission from the contract without English or generic fallback', () => {
    for (const permission of permissionRegistry.filter((item) => !item.deprecated)) {
      if (explicit.includes(`'${permission.code}': {`)) continue;
      const title = permissionLabelAr(permission.code);
      expect(title, permission.code).toMatch(/[\u0600-\u06ff]/);
      expect(title, permission.code).not.toContain('غير مصنّفة');
      expect(title, permission.code).not.toMatch(/[a-zA-Z]/);
    }
  });

  it('keeps unknown grants visibly unclassified instead of inventing an authorization meaning', () => {
    expect(permissionLabelAr('new_module.unknown')).toContain('غير مصنّفة');
    expect(systemRoleNameAr('Owner')).toBe('مالك المنشأة');
    expect(systemRoleNameAr('محاسب خاص')).toBe('محاسب خاص');
  });
});
