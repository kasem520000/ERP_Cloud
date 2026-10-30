# 16 — Database, Migration, Backup and Recovery Audit

**Audit date:** 2026-10-30  
**Scope:** Migrations, schema, backup/restore, recovery

## Migrations

| Aspect | Status | Details |
|--------|--------|---------|
| Location | `packages/database/migrations/` | 157 migration SQL files |
| Migration tool | Drizzle Kit + custom CLI | `packages/database/src/cli/migrate.ts` |
| Migration locking | NOT VERIFIED | Migration lock mechanism not inspected |
| Rollback safety | Down migrations exist | `packages/database/migrations/down/` (135 files) |
| Migration idempotency | RLS policies use `DROP POLICY IF EXISTS` | VERIFIED |
| Concurrent migration | NOT VERIFIED | Not tested |
| Fresh install | NOT TESTED | Not executed |

## Schema Objects Verified

| Object | Status | Notes |
|--------|--------|-------|
| Primary keys (UUID v7) | VERIFIED | Application-side generation |
| Foreign keys | VERIFIED | Drizzle `.references()` with `onDelete` |
| Unique constraints | VERIFIED | `uniqueIndex` with `deleted_at IS NULL` for soft deletes |
| Check constraints | NOT VERIFIED | Schema comments mention CHECK but not verified in SQL |
| Indexes | VERIFIED | Performance indexes on tenant_id, dates, etc. |
| Decimal types | VERIFIED | `numeric(20,4)` string mode |
| Nullability | VERIFIED | `notNull()` where required |
| Cascading behavior | VERIFIED | `onDelete: 'cascade'` / `'restrict'` |

## RLS on Migrations

Migration SQL creates RLS policies:
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
- Policy creation with `DROP POLICY IF EXISTS` + `CREATE POLICY`

VERIFIED in `packages/database/src/rls.ts` helper functions.

## Backup and Recovery

| Component | File | Status |
|-----------|------|--------|
| Backup script | `scripts/db-backup.mjs` | EXISTS — not executed |
| Restore script | `scripts/db-backup.mjs` | EXISTS — not executed |
| Verify script | `scripts/db-backup.mjs verify` | EXISTS — not executed |
| Drill script | `scripts/db-backup.mjs drill` | EXISTS — not executed |
| Local DB setup | `scripts/local-db.mjs` | EXISTS — not executed |

### Backup Capabilities

The `db-backup.mjs` script supports:
- `backup` — Create database backup
- `restore` — Restore from backup
- `verify` — Verify backup integrity
- `drill` — Disaster recovery drill

None were executed in this session (requires running database).

## Migration CLI

| Command | Package | Status |
|---------|---------|--------|
| `db:generate` | `@erp/database` | Generates Drizzle migrations |
| `db:migrate` | `@erp/database` | Runs migrations |
| `db:migrate:down` | `@erp/database` | Rolls back migrations |
| `db:roles` | `@erp/database` | Sets up database roles |
| `db:seed` | `@erp/api` | Seeds demo data |
| `db:seed:coa` | `@erp/database` | Seeds chart of accounts |

## Known Issues

None found in migration/schema code.

## Remaining Work

- Execute fresh database installation
- Run complete migration sequence
- Test migration rollback
- Execute backup and restore
- Verify data consistency after restore
- Test concurrent migration execution
- Verify migration locking
