# RPPL security audit — 9 September 2026

Audit in progress. Initial findings below record the read-only review; the latest remediation status is recorded at the end.

## Checkpoint

Discover polish and required rating-display dependencies committed locally as `c1fe24e` on `feature/beta-polish`. Not pushed. Other pre-existing work remains uncommitted. `supabase/.temp/linked-project.json` was not touched.

## Confirmed GitHub settings

- Repository `capeparadise/wavemark-mobile` is public; default branch is main.
- Only capeparadise was returned by the collaborators endpoint, with admin access.
- Main branch protection endpoint returns “Branch not protected”; repository rulesets endpoint returned no rulesets. Direct/force-push protection needs review.
- Secret scanning and secret-scanning push protection are enabled. Secret-scanning alerts endpoint returned no alerts.
- Dependabot security updates are disabled; alerts endpoint reports alerts disabled.
- Account 2FA was not returned by the account API. This is unknown, not evidence that 2FA is disabled.
- Git history contains `.env` and `.env.backup` with development-login fields. No values were printed or tested. The Supabase JWTs inspected there have the anon role, not service_role. This is the previously discussed test account, not evidence of compromise. Full-history secret scanning remains outstanding.

## Local Supabase source findings (live deployment unverified)

1. High-priority review: upcoming-scan and check-new-releases use service-role access without checking caller identity inside their handlers. Upcoming-scan also deletes manual upcoming rows across users. Verify deployed gateway/scheduler authorization and restrict invocation to trusted callers. No request to these mutating endpoints was made.
2. Demo reset RPC grants execution to every authenticated user; it scopes deletion to auth.uid(), but is not limited to demo accounts. The development-only UI is not a server authorization boundary. Review whether this should be demo-account-only before wider release.
3. Avatar migration intentionally makes images public; write policies restrict paths to the caller's user ID. Confirm public avatars are intended for private profiles too.
4. Delete-account handler validates the bearer token, rejects user selection, and derives the deletion target from the authenticated caller.
5. Social-profile RPC source checks relationships/privacy before returning listening content. This does not establish that all direct-table policies are correct in production.
6. Spotify search config disables JWT verification. Review public-endpoint rate limiting and third-party API quota protections.

## Remaining checks / access required

Supabase dashboard redirected to sign-in. No Supabase connector is available in this session. Live RLS coverage, actual policies and grants, deployed Edge Function authorization, auth settings, backup/PITR/recovery configuration, and storage settings remain unverified. Do not mark the Supabase audit complete until these are checked. GitHub 2FA and a comprehensive redacted history scan remain outstanding as well.

## Recommended order after review

Verify live background-function authorization first; assess exposed test-login history without assuming compromise; protect main and enable dependency alerts; restrict the demo reset if intended to be internal; then validate RLS/privacy and recovery settings. Apply changes only after approval of findings.

## Live dashboard follow-up after sign-in

Project confirmed: Wavemark, jvojjtjklqtmdtmeqqyy, production, capeparadise Free organization.

- Security Advisor reports 0 errors, 35 warnings and 3 suggestions. Its overview initially said no issues, but the dedicated Security Advisor contains the warnings; do not rely on the overview summary.
- HIGH: live policy `Owner insert listen_list (dev)` is PERMISSIVE, INSERT, authenticated, WITH CHECK (true). Verified in the policy editor without saving. It does not enforce row ownership. Other ownership policies coexist but this permissive policy undermines their INSERT restriction. No cross-account write test was performed; constraints/triggers may still affect exploitability.
- HIGH: deployed `upcoming-scan` has gateway JWT verification OFF. Read deployed source via the editor: no caller authentication check, service-role client reads followed artists across users and upserts upcoming releases. Thus untrusted invocation can trigger privileged cross-user processing and consume resources. Did not invoke it. Important correction: the deployed source does NOT include the local manual-row deletion block; that deletion risk is local-source-only.
- Recovery gap: scheduled-backups page explicitly says Free Plan does not include project backups. Project overview says No backups. No claim is made about any user-maintained external backups.
- Further Advisor warnings include permissive write policies on artists, ratings and releases; public avatar bucket listing; mutable search_path on set_updated_at and ensure_profiles_public_id; and public execution of get_share_card_top_rated, get_social_activity and handle_new_user. These require individual policy/function review; a warning alone is not proof of data disclosure.

No settings, policies, code deployments or production data were changed. Remaining audit work includes other table policies, deployed check-new-releases, auth settings, storage scope and public RPC privacy checks. Pause for review of the confirmed high-priority findings before implementing fixes.

## Remediation and backup checkpoint

After approval of the backup/fix plan, migration `20260909173000_secure_listen_list_inserts.sql` was applied to Wavemark. It removes both permissive INSERT policies (`Owner insert listen_list (dev)` and `Listen: authenticated can insert`). A subsequent live catalog query returned four remaining INSERT policies, all enforcing auth.uid() = user_id. No cross-account write test was performed.

`upcoming-scan` was deployed with POST-only service-role bearer authentication. Unauthenticated POST returned `Authentication required`; GET returned 405. Gateway JWT verification remains off because authentication is enforced in the handler. The local manual-row deletion block was removed to avoid introducing behavior absent from the prior deployment. The only observed database cron job targets spotify-search; external scanner callers remain unverified. An authenticated full scan was not run.

Encrypted database backup created at `RPPL/Backups/Supabase/RPPL-Supabase-2026-09-09T16-13-06Z.rppl-backup.enc` in the local iCloud Drive folder, 532512 bytes. Full decryption and tar integrity read passed; PostgreSQL archive catalog was readable. This does not establish successful restoration or remote iCloud sync. Actual Storage files (including avatars) are not included. The encryption key is in this Mac's dedicated Keychain entry; independent key recovery remains outstanding. The dump omits ownership/privilege restoration, so grants and managed-schema recovery require review. Restore helper is deliberately disabled pending a disposable-project restore rehearsal. No production restore was attempted. No paid Supabase plan enabled and no recurring backup schedule configured.

The broader security audit remains open. These source changes and backup helpers are not committed or pushed yet.

Recovery follow-up: an additional encrypted `-with-avatars` archive is now saved in the same iCloud directory (about 8.1 MB). It includes all nine public avatar objects referenced by the snapshot and an object-path/SHA-256 manifest. Isolated PostgreSQL 17 rehearsal restored all 47 public/auth/storage table data sets and verified 8271 rows by per-table counts. This is a data-only recovery rehearsal, not full Supabase service/permission recovery. Independent key storage in the user's password manager is pending user confirmation. See BACKUP-RECOVERY.md for scope and remaining work. Future backup exports now include avatars and retain privilege records; the old snapshot still omits privileges.

10 September: user confirmed password-manager key storage. Hosted rehearsal in `mlciopffwtbopluuahoj` passed table restoration, avatar byte checks, fresh-account sign-in, own save/rating, direct RLS ownership and profile follow-request privacy checks. Share-card RPC returned a private probe's rating to an unrelated authenticated probe given its public share identifier; review intended share-link/privacy semantics before fixing. Only synthetic test accounts were used and removed. Test grants were revoked again. Complete production-grant, Edge Function/configuration and app-UI recovery remains unverified. Details in BACKUP-RECOVERY.md.

Share-card remediation: user approved matching profile privacy. Migration `20260910160000_respect_share_card_profile_privacy.sql` passed eight hosted test cases (owner, unrelated, pending, accepted, former follower, public profile, missing identifier, anonymous). Deployed to Wavemark using db push after confirming it was the sole pending migration. Live and tested function definitions have identical hashes (`a829813547d8478c5ada39c309f64604`). Temporary probes removed and test function grants revoked. Output fields, ordering, limits and the existing sign-in requirement are preserved. The privacy finding is resolved; the overall audit remains open. Source changes remain uncommitted.
