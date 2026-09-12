# RPPL recovery checkpoint — 9 September 2026

## Current backup

In iCloud Drive → RPPL → Backups → Supabase:

`RPPL-Supabase-2026-09-09T16-13-06Z-with-avatars.rppl-backup.enc`

This is the database snapshot from 9 September at 16:13 UTC, supplemented with the nine avatar objects referenced by that snapshot and downloaded later the same day. The encrypted archive is about 8.1 MB. The original database-only archive is retained.

Archive format: gzip tar encrypted using OpenSSL AES-256-CBC, PBKDF2, 200000 iterations. The dedicated encryption key is in macOS Keychain under service `com.rppl.supabase-backup`, account equal to the Mac user name. Keep an independent copy in a password manager. Do not store the plaintext key next to the archive or in this repository. This format is not authenticated encryption; successful decryption and archive checks do not establish authenticity against deliberate tampering.

## Verification completed

- Full decryption and compressed archive integrity read succeeded.
- All 47 public/auth/storage table data sets restored to a temporary local PostgreSQL 17 server with no network listener.
- Every table row count matched the snapshot: 8271 total rows.
- Nine avatar files downloaded successfully, 11083764 bytes total. Their original object paths and SHA-256 hashes are stored in the encrypted manifest.

This rehearsal verifies table data recoverability. It does not verify a complete running Supabase project: service-owned extensions, roles, grants, RLS, functions, sign-in and application flows still need a separate Supabase rehearsal. The production restore helper remains disabled. The original database snapshot omitted privilege information. Future exports now retain grants, but custom roles and platform configuration still require separate recovery planning.

The backup contains sensitive account data. Never upload decrypted contents to GitHub. No production data was restored or changed during the rehearsal. Local presence in iCloud Drive does not prove remote sync has completed.

## Future backups

Run `scripts/backup-supabase.sh` from this project in Terminal. It prompts privately for the database password, exports the database, downloads the public avatar objects recorded in the dump, encrypts both and verifies archive readability. It stops on missing avatar downloads or unexpected storage buckets. It currently supports the public avatars bucket only. Storage and database exports are not a transactional snapshot; avoid avatar changes during capture. No automatic schedule or retention deletion is configured.

## Remaining work

1. Independent recovery key saved in the user's password manager, confirmed 10 September 2026.
2. Rehearse full recovery in a separate Supabase project and verify sign-in, ownership/privacy rules, avatar serving and app flows. Do not point recovery tools at Wavemark production.
3. Capture required roles, platform settings and deployed function configuration for a full rebuild, then agree a backup frequency and retention policy.

## Hosted rehearsal — 10 September 2026

Target: **RPPL Recovery Test**, `mlciopffwtbopluuahoj`, PostgreSQL 17.6, same organisation as production. The project was verified empty before import. No production writes were made.

Restored application schema, functions, policies and custom account-creation trigger, plus 40 public/private/auth table data sets (8122 rows), with per-table counts verified and sequence counters restored. The platform's own Auth migrations were retained. Storage metadata was recreated by uploading the actual files rather than inserting metadata pointing to absent blobs. All nine avatars were downloaded back from test storage and matched their SHA-256 hashes. The test bucket is private.

The snapshot predates the Listen List ownership fix; its two permissive INSERT policies were removed during the transactional restore before data was imported. API table/function grants were restricted, opened narrowly for the probes and revoked afterwards. This is intentionally not a complete copy of production's grants.

Two disposable accounts verified password sign-in, automatic profile creation, profile setup, saving and rating an item, direct row ownership isolation, forged-owner INSERT rejection, private-history hiding before and during a follow request, and visibility after acceptance. The temporary accounts were deleted. These tests use fresh test accounts, not existing testers' passwords, and exercise backend APIs rather than the simulator UI.

**Finding:** `get_share_card_top_rated` returns the private test account's rated item to an unrelated authenticated account when supplied with its public share identifier. Standard `get_listener_music` correctly blocks the same account. Reproduction used the synthetic release “Recovery test release” by “RPPL test”, rated 8/10 with non-null artwork. Review whether explicit shared links are intended to override profile privacy; no production exploit test or fix was performed. Test client access is closed again.

Remaining before claiming complete disaster recovery: settle/test the share-card privacy rule; reconstruct and validate production grants; restore required Edge Functions and their external-service secrets/configuration; verify existing-account login and actual app flows against the restored backend. Scheduled scanners were not recreated or invoked. This rehearsal follows the separation of application schema, managed Auth/Storage changes and object files described in https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore.

Share-card follow-up: privacy rule agreed, fixed and deployed on 10 September. Owner and accepted followers can see private share cards; unrelated/pending/former followers cannot. Public profiles remain available to signed-in viewers. All eight regression scenarios passed on the recovery project; the live function matches the tested definition. A future restore of this snapshot must apply migration `20260910160000_respect_share_card_profile_privacy.sql` as well as the earlier Listen List ownership migration before exposing APIs.
