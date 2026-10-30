# 15 — Mobile and Offline Audit

**Audit date:** 2026-10-30  
**Scope:** Android apps (bakery, rep), offline functionality, synchronization

## Mobile Applications

| App | Path | Type | Status |
|-----|------|------|--------|
| Android Bakery | `apps/android-bakery` | Kotlin, Gradle | NOT BUILT |
| Android Rep | `apps/android-rep` | Kotlin, Gradle | NOT BUILT |

### Build Verification

Mobile apps were NOT built in this session. Gradle build requires Android SDK which is not available in the sandbox.

| Check | Status |
|-------|--------|
| `gradlew assembleDebug` | NOT RUN |
| `gradlew assembleRelease` | NOT RUN |
| APK signing | NOT TESTED |
| Keystore configuration | `keystore.properties.example` exists |

## Mobile App Code Review (Sampled)

| Area | Observation | Status |
|------|-------------|--------|
| Authentication | Token-based auth with API | NOT VERIFIED |
| Token storage | Not inspected | NOT_TESTED |
| API URL configuration | Not inspected | NOT_TESTED |
| Local database | Not inspected | NOT_TESTED |
| Offline transaction creation | Not inspected | NOT_TESTED |
| Sync/conflict resolution | Not inspected | NOT_TESTED |
| Logout cleanup | Not inspected | NOT_TESTED |

## Offline Functionality

| Feature | Status |
|---------|--------|
| Offline POS | `offline-pos.spec.ts` exists — offline POS tested |
| Offline queue | `offline_queue` table in `rlsProtectedTables` (future enhancement) |
| Sync mechanism | Not inspected |
| Conflict resolution | Not inspected |
| Duplicate prevention | Not inspected |

## Known Limitations

- Mobile apps not built or tested
- Offline sync not verified
- Local database security not verified
- Token storage on device not verified

## Remaining Work

- Install Android SDK and build mobile apps
- Test offline POS workflow
- Verify sync and conflict resolution
- Verify local database encryption
- Verify logout cleanup (token removal)
