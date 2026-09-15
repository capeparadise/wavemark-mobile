# Security review — 13 September 2026

The initial production and GitHub review was read-only. Later, owner-approved database hardening migrations and authentication URL corrections were applied and verified as recorded below. No live exploitation, account reset, commit or push was performed. Existing app changes were preserved. Findings describe authorization rules, not evidence of a breach.

## Priority findings

1. **High — legacy connection approval bypass.** Production `friend_requests_update_parties` allows either requester or recipient to set status to accepted. The insert policy allows a requester to create a pending request. Constraints validate IDs/status only; the only before-update trigger updates the timestamp. The after-status trigger `sync_accepted_connection_to_follows` is security-definer and upserts accepted follows in both directions. Listening RPCs trust those accepted relationships. Together these rules permit requester self-approval and potential private-history access. Legacy direct updates remain in `lib/profileSocial.ts`. Reproduce with synthetic users in isolation; enforce recipient-only approval and immutable participants, checking all legacy and modern entry points before production migration. Also test `get_social_activity`, which reads legacy accepted requests and can return saved, unlistened entries.
2. **High — ratings insert ownership.** `Owner insert ratings (dev)` permits authenticated inserts with CHECK true. There is no ratings ownership trigger. Other operations are owner-scoped, but insert permits a supplied different user ID subject to constraints. Reproduce in isolation and enforce `auth.uid() = user_id`; audit whether this legacy table remains used before changing grants.
3. **Catalogue integrity — excessive writes.** Public insert policies plus anonymous INSERT grants exist on artists and releases. Artists also permits any authenticated user to update rows. Move writes behind scoped, validated server paths after checking legitimate client dependencies.
4. **Avatar exposure and upload limits.** Avatars bucket is public and its SELECT policy permits public object metadata listing. Writes are user-folder-scoped. Bucket MIME and size limits are unset. Public pictures may be intentional; public listing and upload limits deserve hardening. Do not make the bucket private without a signed-URL migration.
5. **Demo reset remains available server-side.** `reset_my_demo_profile` is authenticated and self-scoped but is not limited to designated demo accounts. It deletes the caller's history and relationships and resets profile fields. The development-only UI does not restrict direct RPC access. Recommend server-side demo eligibility enforcement; never invoke on real users during verification.
6. **Resolved — legacy messages visibility.** Source search found no active app use. A metadata-only anonymous request confirmed two rows were selectable; their contents were not opened. Migration `20260913143000_lock_legacy_messages.sql` removed the public policy and all `PUBLIC`, `anon` and `authenticated` table grants without deleting either row. Recovery rehearsal and live post-deploy metadata verification passed.

All 16 public tables have RLS enabled; this does not guarantee safe policies. Current listen-list ownership and share-card privacy protections remain present. Profile identity is authenticated-readable; listening privacy is separately enforced.

## GitHub

- Public repository; only returned collaborator is the owner (admin).
- At audit time, `main` was unprotected and the repository settings page confirmed there were no rulesets. An active `Protect main` ruleset is now applied to the default branch: pull requests are required with zero approvals, deletions and force pushes are blocked, and ordinary feature-branch work is unaffected. GitHub confirmed the ruleset was created successfully.
- Secret scanning and push protection are enabled; the current secret alert list is empty. Dependency graph and Dependabot vulnerability alerts were subsequently enabled. Automatic security/version-update pull requests and grouped updates remain disabled to avoid unsolicited update noise.
- The owner's GitHub security page explicitly confirms that two-factor authentication is not enabled. Enabling it requires the owner to enrol an authenticator/passkey and store recovery codes; this was not changed automatically.
- Official Gitleaks 8.30.1 archive checksum verified. Scanned all local refs (131 commits) and a fresh remote mirror (115 commits), redacting secret values. Both returned the same four matches: two public anon JWTs in historical environment files, a private-key stripping regex, and a genre preference key constant. None of these four is a privileged secret.
- Pattern scanning is not proof no credentials ever existed. Previously identified development login is known to the owner and is not being treated as compromised. No credentials tested or published in this report.
- Recommended remaining account action: enable owner 2FA. Repository dependency analysis/alerts and the `main` protection ruleset are now enabled.
- A 15 September lockfile verification with `npm audit --omit=dev` reports 26 remaining transitive advisory entries: 9 high and 17 moderate, with no critical entry. npm's proposed fixes cross Expo/router framework boundaries and require forced breaking upgrades, so no automatic or forced upgrade was applied. Dependabot alerts remain enabled for review.

## Supabase authentication and Storage checks

- Live avatar Storage smoke test passed using the signed-in QA user: own-folder upload/list/delete, public delivery, MIME rejection and cross-user-folder rejection all behaved as intended. The probe object was removed and authoritative listing confirmed cleanup.
- Authentication URL configuration now uses `rppl://session` as the default Site URL instead of an ephemeral local Expo address. The existing Expo and `rppl://session` redirect entries were preserved, and `rppl://reset-password` was added for the recovery flow.
- Current authentication rate limits were reviewed. CAPTCHA and leaked-password protection are disabled; enabling either needs a deliberate provider/UX decision and remains follow-up work.
- No user listening history, messages, profiles or credentials were read or changed during these checks.

## Legacy messages production hardening

- Recovery-project rehearsal proved that both anonymous and authenticated client roles lose SELECT/INSERT/UPDATE/DELETE/TRUNCATE privileges, no policy remains, the existing table row survives, and the synthetic fixture is removed by rollback.
- The production deployment was guarded by an exact precondition of two existing rows and ran as one transaction with migration-history registration. Post-deploy verification reports two preserved rows, zero client grants, zero policies and the migration registered.
- No message content was selected, exported, rewritten or deleted.

## Feed rollout

Build 20 is live according to the owner. This does not establish installation by every tester. No app-level build adoption telemetry found in the inspected app/library source. The secured server rollout remains gated on tester compatibility/adoption, scheduler configuration, real-provider verification and explicit cutover approval. See FEED-SECURITY-ROLLOUT.md. No production function deployed during this review.

## Next decision

Prioritise an isolated regression test and narrow fix for connection self-approval and ratings ownership. Keep audit/remediation tasks open until required verification is finished. Preserve current features and legitimate recipient acceptance; do not apply broad grant changes blindly.

## Isolated fixes verified later on 13 September

Prepared migration `20260913090000_enforce_connection_and_rating_ownership.sql` and repeatable `scripts/test-social-permissions-recovery.cjs`. Both original vulnerabilities reproduced using synthetic records in recovery. With the migration applied inside a rolled-back transaction, self-approval, participant replacement and forged rating ownership were denied. Recipient decline/accept, requester retry after decline, own rating create/read/update/delete and modern username-follow recipient acceptance passed. A third party could not read the rating or accept the legacy request; modern requester self-acceptance left the request pending. Accepted follows were checked directly.

Tests use PostgreSQL authenticated-role impersonation with synthetic JWT subject claims, not real sign-ins or HTTP gateway requests. Recovery omitted client grants, so audited production table/function grants were reproduced inside the same transaction. Assertions after rollback confirmed fixture users/artist and new guard function were absent. No persistent recovery migration or production change was made. Rating display tests and whitespace checks also passed.

Production deployment and post-deployment verification remain pending. Existing accepted relationships were not modified or retrospectively classified. The migration does not address the separate catalogue, avatar, demo reset or legacy activity visibility findings.

## Production deployment — 13 September, owner approved

Applied only migration 20260913090000 to Wavemark (`jvojjtjklqtmdtmeqqyy`) in one transaction with migration-history registration and bounded lock/statement timeouts. No app release or Edge Function deployment. Existing user rows were not rewritten.

`node scripts/test-social-permissions-recovery.cjs --production-verify` passed against the installed rules, without granting permissions or applying migrations in test mode. Synthetic fixtures were rolled back. Verified ownership denials, participant immutability, legacy decline/retry/accept, rating CRUD, and modern private-follow recipient acceptance. Post-rollback assertions confirmed temporary users and artist were absent and the deployed guard remained present. This is live database-role verification, not a device/HTTP smoke test. Broader security audit tasks remain open for the other findings.
