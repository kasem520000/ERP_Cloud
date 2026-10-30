# 12 — Application Security Audit

**Audit date:** 2026-10-30  
**Scope:** OWASP Top 10 and API Security Top 10

## Authentication

| Area | Implementation | Status |
|------|---------------|--------|
| Password hashing | Argon2id (`@node-rs/argon2`) | VERIFIED |
| Password hash storage | PHC string in `users.password_hash` | VERIFIED |
| JWT tokens | RS256, key pair generated per test run; production uses configured keys | VERIFIED |
| Refresh token rotation | SHA-256 hash, family-based reuse detection | VERIFIED |
| Refresh token race | `UPDATE ... WHERE revoked_at IS NULL` needed (AUD-07 finding from prior audit) | PRIOR FINDING |
| Session management | Stateless JWT + refresh tokens | VERIFIED |
| Token expiration | `expiresAt` on refresh tokens | VERIFIED |
| Logout/revocation | Refresh token revocation | VERIFIED |
| MFA | TOTP with encrypted secret (`bytea`), recovery codes | VERIFIED |
| Account lockout | `failed_login_attempts`, `lockedUntil` | VERIFIED |
| Password reset | Hashed tokens, expiry, single-use | VERIFIED |
| Session fixation | Not applicable (stateless JWT) | N/A |

## Authorization

| Area | Implementation | Status |
|------|---------------|--------|
| IDOR/BOLA | RLS on all tenant tables + `PermissionsGuard` | VERIFIED (architecture) |
| Broken function-level authorization | `@RequiresPermission()` on all routes | VERIFIED (sample) |
| Privilege escalation | `*` wildcard = tenant only, console perms excluded | VERIFIED |
| Cross-tenant access | RLS + `app.tenant_id` GUC | VERIFIED (architecture) |
| Portal denial | `tenant.kind === 'portal'` → 403 on staff routes | VERIFIED |

## Input and Output Security

| Area | Implementation | Status |
|------|---------------|--------|
| SQL injection | Parameterized Drizzle `sql` tags everywhere | VERIFIED |
| XSS | Next.js auto-escaping, no `dangerouslySetInnerHTML` found in sample | NOT FULLY CHECKED |
| CSRF | Stateless JWT (Bearer tokens) — CSRF not applicable | N/A |
| SSRF | Not inspected | NOT_TESTED |
| Command injection | No `child_process`/`exec` found in sample | NOT FULLY CHECKED |
| Path traversal | Not inspected | NOT_TESTED |
| Unsafe file uploads | Not inspected | NOT_TESTED |
| Deserialization | No unsafe deserialization found | NOT FULLY CHECKED |
| Template injection | Not inspected | NOT_TESTED |
| Open redirects | Not inspected | NOT_TESTED |

## Infrastructure Security

| Area | Implementation | Status |
|------|---------------|--------|
| CORS | Not inspected | NOT_TESTED |
| Security headers | Helmet v8 (`@erp/api` dependency) | VERIFIED (dependency present) |
| TLS | Not inspected (deployment config) | NOT_TESTED |
| Secrets management | Environment variables, no hardcoded keys | VERIFIED |
| Encryption at rest | `bytea` for MFA secrets, AES-256-GCM | VERIFIED |
| Encryption in transit | Not inspected (TLS termination at reverse proxy) | NOT_TESTED |
| Debug endpoints | `/health` only, no debug endpoints found | VERIFIED |
| Swagger exposure | `@nestjs/swagger` — needs production review | NOT_TESTED |
| Error messages | Structured `DomainError`, no stack traces to clients | VERIFIED |
| Sensitive logging | `logging-redaction.spec.ts` exists | VERIFIED |
| Dependency vulnerabilities | Not scanned | NOT_TESTED |

## Business Logic Attacks

| Attack | Protection | Status |
|--------|-----------|--------|
| Manipulated invoice totals | Server-side calculation, not client-trusted | VERIFIED |
| Negative quantities | `money(quantity).gt(0)` checks | VERIFIED |
| Unauthorized discounts | `maxDiscountPct/Amount` per membership | VERIFIED |
| Unauthorized price changes | Posting profile account validation | VERIFIED |
| Duplicate payments | Idempotency keys | VERIFIED |
| Unauthorized cancellations | ZATCA-sealed protection, payment checks | VERIFIED |
| Unauthorized refunds | Void requires reason, no payments | VERIFIED |
| Unauthorized journal entries | Balance validation, postable accounts | VERIFIED |
| Stock manipulation | RLS, warehouse gating, serial tracking | VERIFIED |
| Approval bypass | `approvals` module, explicit grants | VERIFIED |

## Prior Audit Findings (from docs/PROJECT_AUDIT_FINDINGS_REVIEWED.md)

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| AUD-01 | P1 | `login()` doesn't check `users.status` | PRIOR — not re-verified |
| AUD-02 | P1 | Owner role assignment via membership management | PRIOR — not re-verified |
| AUD-03 | P1 | Scope restrictions not enforced on business services | PRIOR — not re-verified |
| AUD-04 | P1 | Webhooks missing `@Public()` (Stripe, Salla) | PRIOR — not re-verified |
| AUD-05 | P1 | Billing service doesn't set RLS context | PRIOR — not re-verified |
| AUD-06 | P1 | Stripe webhook idempotency | PRIOR — not re-verified |
| AUD-07 | P1 | Refresh token rotation race condition | PRIOR — not re-verified |
| AUD-08 | P1 | Tokens in query string, localStorage session | PRIOR — not re-verified |
| AUD-09 | P1 | Compat sessions in Map, rate limit always true | PRIOR — not re-verified |
| AUD-10 | P1 | Payroll transaction separation | PRIOR — not re-verified |
| AUD-11 | P2 | Sales update draft transaction split | PRIOR — not re-verified |
| AUD-12 | P2 | Alias mismatch in UI | PRIOR — not re-verified |
| AUD-13 | P2 | Route prefix matching (`/m` matches `/marina`) | PRIOR — not re-verified |
| AUD-14 | P2 | Webhook audit tenant context | FIXED — `setAuditTenantId` implemented |
| AUD-15 | P2 | HRM soft delete not enforced | PRIOR — not re-verified |
| AUD-16 | P1 | Dev encryption key fallback | PRIOR — not re-verified |

## Known Issues (Current Session)

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| F-001 | MEDIUM | Test isolation pollution in full suite | INVESTIGATING |
| F-002 | LOW | Weekly report test timezone dependency | FIXED |

## Remaining Work

- Run dependency vulnerability scan (`npm audit` / `snyk`)
- Test CORS configuration
- Review Swagger/OpenAPI exposure in production
- Test file upload security
- Test for XSS in user-generated content
- Verify CSRF protection if cookies are used for sessions
