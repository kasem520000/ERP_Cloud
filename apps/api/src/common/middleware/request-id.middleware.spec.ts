import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { getTraceId, requestContextStorage } from '../../request-context/request-context.js';

import { RequestIdMiddleware } from './request-id.middleware.js';

function runMiddleware(headers: Record<string, string>): {
  headerValue: string;
  traceId: string;
  responseHeader?: string;
} {
  const request = { headers: { ...headers } } as unknown as Request;
  const recorded: { value?: string } = {};
  const response = {
    setHeader: (name: string, value: string) => {
      recorded.value = value;
    },
  } as unknown as Response;

  let traceId = '';
  RequestIdMiddleware(request, response, () => {
    traceId = getTraceId();
  });

  return {
    headerValue: String(request.headers['x-request-id']),
    traceId,
    responseHeader: recorded.value,
  };
}

describe('RequestIdMiddleware', () => {
  it('generates a trace id, echoes it and opens the AsyncLocalStorage scope', () => {
    const result = runMiddleware({});
    expect(result.headerValue).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(result.traceId).toBe(result.headerValue);
    expect(result.responseHeader).toBe(result.headerValue);
    // Outside the callback the store must be gone again.
    expect(requestContextStorage.getStore()).toBeUndefined();
  });

  it('replaces a hostile X-Request-Id instead of echoing it into logs', () => {
    const result = runMiddleware({ 'x-request-id': 'bad id\\nX-Injected: 1' });
    expect(result.headerValue).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(result.headerValue).not.toContain('X-Injected');
    expect(result.responseHeader).toBe(result.headerValue);
  });

  it('preserves an incoming X-Request-Id so traces survive the gateway', () => {
    const result = runMiddleware({ 'x-request-id': 'trace-from-gateway' });
    expect(result.headerValue).toBe('trace-from-gateway');
    expect(result.traceId).toBe('trace-from-gateway');
    expect(result.responseHeader).toBe('trace-from-gateway');
  });
});
