# Security, track ratings and bulk actions — 13 September

## Latest continuation

### Approved production deployment (later)

Owner explicitly approved catalogue/avatar protections, private bookmarks, and reset eligibility for ripple_qa. Applied only migrations 20260913100000 and 20260913120000 atomically with migration-history registration. Granted eligibility to verified QA account 411d016c-f17d-44b2-88a0-938e250c9fbc, not Maya's account. Post-deploy read-only verification confirmed both migrations, saved_artists RLS, revoked catalogue writes/internal-reset execution, 10 MB image MIME limits with public avatar delivery retained, and ripple_qa as the sole opted-in demo user. No reset, tester upload, or user-history rewrite performed. Device bookmark save/remove and real upload/download smoke tests remain separate verification gates.

- Confirmed simulator demo identity: Maya Ellis / @mayafinds; permanent ID e8d3da0c-33ed-43fa-a1c7-23c97ecc0752. Read-only lookup; no reset or permission grant executed.
- Security recovery test passed again. Production apply was rejected by safety review pending explicit approval of the exact production changes. Neither 20260913100000 nor 20260913120000 was applied by this continuation.
- Artists to Check Out implemented locally: profile bookmark buttons, Listen entry, private cloud-backed list, revisit/remove. New saved_artists migration is pending deployment. Mock service tests passed (idempotence, user scope, failure retention, no follow/history mutations); recovery database tests passed (owner CRUD, RLS, forged ownership/cross-user deletion denied), all fixtures rolled back.
- Bulk-action synthetic regression suite passed again. Interactive confirmation/cancellation and device smoke testing remain outstanding; do not mark the whole bulk task complete from these tests alone.
- No tester build, commit, push, reset, or production migration completed in this continuation.

## Prepared locally, not released

- Catalogue client writes revoked in migration 20260913100000. Source search found no active app catalogue mutation path; legacy testSupabase only reads releases.
- Avatar metadata listing restricted to owner folders while preserving public image URLs. New uploads limited to 10 MB and JPEG/PNG/WebP/HEIC/HEIF; client gives matching validation feedback. Existing images are not rewritten.
- Demo reset requires trusted auth app metadata `rppl_demo_reset_allowed: true`. Internal reset cannot be called by normal clients. No account opted in; owner must identify intended demo accounts before production deployment. Approved demo resets still remove their own relationships as previously designed.
- Individual track Rate/Change rating uses existing track listen-list rows, filtered by owner/provider/ID/type; album rows are not reused. Existing review/details preserved, simple and advanced mode supported. Rating marks that track listened, not the album. No automatic album-score averaging. Track ratings load in provider batches. Cross-provider identity merging remains unchanged.
- Listen List Select allows up to 100 items, mark listened or remove, with confirmation. Selection resets on user/filter change. Swipes and per-row menus are disabled during selection. Database predicates protect history and ratings/reviews/details from bulk removal, including concurrent changes from another device. Partial eligible results are reported; no streaming queue integration.

## Verification

- `node scripts/test-hardening-recovery.cjs`: passed in recovery; transaction rolled back including grants/fixtures/migration. Covers catalogue grants, own-folder avatar listing, denied ordinary reset, approved synthetic reset and preservation of public bucket delivery setting. This is database-role verification, not real Storage API upload/download testing.
- `node scripts/test-listen-save.cjs`: passed existing save regressions plus independent track/album simple and detailed rating updates.
- `node scripts/test-listen-bulk.cjs`: passed owner scoping, deduplication, size limits, protected history/ratings/reviews/details and failure handling with synthetic mocks.
- Feed-security and rating-display tests passed; TypeScript and whitespace checks passed. Local iOS bundle export succeeded.
- Reconnected simulator to current local server. Visually confirmed Listen List Select and PRIMA by ADÉLA track-list Rate controls. No real rating changes or bulk deletes performed during visual inspection.

## Remaining gates

The owner completed the interactive track-rating and Listen List bulk-action checks without issues. The approved security migrations are live, and the live avatar Storage upload/list/delete, public-delivery, MIME-limit and folder-ownership smoke test passed with cleanup confirmed.

Password recovery is implemented locally and its production callback configuration is saved. Automated link parsing, password validation, TypeScript and regression checks pass. A complete email-delivery/new-password/old-password device test still requires an account with a real reachable email address.

The unused legacy messages table is now closed to public clients in production. Its two rows were preserved, their contents were not read, recovery rehearsal passed, and live verification confirmed zero client grants and zero policies. GitHub dependency graph and Dependabot vulnerability alerts are enabled. The active `Protect main` ruleset now requires pull requests for `main` and blocks deletion and force pushes; owner 2FA remains a separate account action.

No TestFlight build, commit or push was made in this batch. Existing unrelated working-tree changes and `supabase/.temp/linked-project.json` were preserved. Separate follow-up findings remain: GitHub owner 2FA, optional Supabase abuse protections, password-recovery email delivery testing, and the feed rollout decision.
