# 14 — API, Worker, and Integration Audit

**Audit date:** 2026-10-30  
**Scope:** API endpoints, background jobs, integrations, real-time functionality

## API Endpoints (Sampled)

All inspected API routes follow the same pattern:

| Pattern | Implementation | Status |
|---------|---------------|--------|
| Authentication | JWT Bearer token via `AuthGuard` | VERIFIED |
| Authorization | `PermissionsGuard` + `@RequiresPermission()` | VERIFIED |
| Tenant context | `TenantGuard` publishes `app.tenant_id` GUC | VERIFIED |
| Input validation | Zod schemas via `zod-validation.pipe.ts` | VERIFIED |
| Error handling | `AllExceptionsFilter` → structured `DomainError` | VERIFIED |
| Audit logging | `AuditInterceptor` on mutating endpoints | VERIFIED |
| Request ID | `request-id.middleware.ts` → traceId | VERIFIED |
| Rate limiting | `rate-limit.guard.ts`, `tenant-rate-limit.guard.ts` | VERIFIED |

### Public Endpoints (Intentional)

| Endpoint | Auth Method | Purpose |
|----------|-------------|---------|
| `POST crm/webhooks/whatsapp` | Token in query | WhatsApp inbound webhook |
| `POST billing/webhook` | Stripe signature | Stripe billing webhook |
| `POST salla/webhook` | Salla signature | Salla e-commerce webhook |
| `GET public/verify` | Public | Invoice verification |
| `GET/POST public/*` | Public | Marketing site content |

## Background Jobs (BullMQ)

| Component | File | Purpose |
|-----------|------|---------|
| Job module | `apps/api/src/modules/platform-services/jobs/` | BullMQ job registration |
| Job handlers | `apps/api/src/modules/platform-services/jobs/job-handlers.ts` | Job processor implementations |
| Outbox jobs | `outbox_jobs` table | Reliable event publishing |
| Idempotency | `idempotency_keys` table | Duplicate prevention |

### Job Reliability (Not Verified)

- Job persistence: BullMQ stores in PostgreSQL — NOT VERIFIED
- Retry behavior: NOT VERIFIED
- Dead-letter handling: NOT VERIFIED
- Duplicate execution: Idempotency keys — VERIFIED (architecture)
- Tenant context: Jobs run via `runAsSystem()` — VERIFIED (architecture)
- Failure recovery: NOT VERIFIED
- Graceful shutdown: NOT VERIFIED

## Integrations

| Integration | File | Type | Status |
|-------------|------|------|--------|
| ZATCA | `apps/api/src/modules/einvoicing/zatca/` | E-invoicing | Architecture verified, not certified |
| Stripe | `apps/api/src/modules/platform/billing/` | Payment | Prior finding AUD-04/@AUD-06 |
| Salla | `apps/api/src/modules/integrations/salla/` | E-commerce | Prior finding AUD-04 |
| WhatsApp | `apps/api/src/modules/integrations/whatsapp/` | Messaging | Not inspected |
| Mudad | `apps/api/src/modules/integrations/` | Payroll | Not inspected |
| Moyasar | `apps/api/src/modules/integrations/` | Payment | Not inspected |

## WebSockets / Real-Time

No WebSocket implementation found in inspected code. Real-time functionality may exist in frontend apps but not in the API backend.

## Simulated/Mocked Integrations

No mocked integrations found in production code paths. All integrations appear to be real.

## Known Issues

- Prior findings AUD-04 through AUD-10 (from `docs/PROJECT_AUDIT_FINDINGS_REVIEWED.md`) not re-verified
- Webhook idempotency (AUD-06) — Stripe event ID not stored for dedup

## Remaining Work

- Verify BullMQ job persistence, retry, dead-letter
- Test webhook idempotency (duplicate Stripe events)
- Verify background job tenant context
- Inspect all integrations for mock/simulation code in production
