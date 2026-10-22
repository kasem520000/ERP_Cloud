import { describe, expect, it } from 'vitest';

import { actionForMethod, describeRoute } from './audit.interceptor.js';

/**
 * Route → audit entity/action mapping (SECURITY_ARCHITECTURE §10: "every mutating
 * endpoint writes an audit row"). The interceptor must derive a stable entity name from
 * the URL alone, because it runs for controllers that have no audit-specific code.
 */
describe('audit route mapping', () => {
  it('strips the version prefix and splits resource / id / sub-resource', () => {
    expect(describeRoute('/api/v1/roles')).toEqual({ resource: 'roles', entityId: null, subResource: null });
    expect(describeRoute('/api/v1/roles/abc-123')).toEqual({
      resource: 'roles',
      entityId: 'abc-123',
      subResource: null,
    });
    expect(describeRoute('/api/v2/memberships/abc/roles')).toEqual({
      resource: 'memberships',
      entityId: 'abc',
      subResource: 'roles',
    });
  });

  it('ignores the query string and a trailing slash', () => {
    expect(describeRoute('/api/v1/files?limit=10')).toEqual({
      resource: 'files',
      entityId: null,
      subResource: null,
    });
    expect(describeRoute('/api/v1/files/')).toEqual({
      resource: 'files',
      entityId: null,
      subResource: null,
    });
  });

  it('maps the HTTP verb to a CRUD action, qualified by the sub-resource', () => {
    const collection = describeRoute('/api/v1/roles');
    const item = describeRoute('/api/v1/roles/abc');
    const sub = describeRoute('/api/v1/notifications/abc/read');

    expect(actionForMethod('POST', collection)).toBe('create');
    expect(actionForMethod('PUT', item)).toBe('update');
    expect(actionForMethod('PATCH', item)).toBe('update');
    expect(actionForMethod('DELETE', item)).toBe('delete');
    // A POST *on an existing entity* is a state change of that entity, not a creation:
    // `POST /notifications/{id}/read` is audited as `update.read`.
    expect(actionForMethod('POST', sub)).toBe('update.read');
  });

  it('maps multi-segment collections correctly with sub-resources', () => {
    const postVoucher = describeRoute(
      '/api/v1/inventory/vouchers/01a16577-19c4-7536-bdc6-c063139f10a3/post',
    );
    expect(postVoucher).toEqual({
      resource: 'inventory/vouchers',
      entityId: '01a16577-19c4-7536-bdc6-c063139f10a3',
      subResource: 'post',
    });
    expect(actionForMethod('POST', postVoucher)).toBe('update.post');

    const postInvoice = describeRoute(
      '/api/v1/sales/invoices/01a16575-b3a1-79ba-b485-61266b8801d0/post',
    );
    expect(postInvoice).toEqual({
      resource: 'sales/invoices',
      entityId: '01a16575-b3a1-79ba-b485-61266b8801d0',
      subResource: 'post',
    });
    expect(actionForMethod('POST', postInvoice)).toBe('update.post');
  });
});
