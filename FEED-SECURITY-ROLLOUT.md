# Feed-refresh security — local preparation, 12 September 2026

## Status

Prepared locally; production function not deployed and no tester upload performed. Isolated recovery testing used temporary fixtures and grants, subsequently cleaned up. Existing unrelated UI/rating/demo work is preserved. The production authorization gap remains until rollout.

## Change

- Both Discover's fallback scan and follow-triggered refresh now use a dedicated session-bearing POST request. Public catalog/search helpers are unchanged.
- The handler verifies ordinary callers with Supabase Auth, then checks the caller's own followed-artist row before a single-artist scan. Anonymous, expired/invalid sessions and unrelated artists fail closed.
- Only the exact server-side service-role credential retains a multi-artist scan path. Never put this credential in the app. Scans accept at most 200 artists and inspect at most 1,000 follow rows; this bounded scheduler path is not a complete paginated global sweep. A production scheduler needing broader coverage requires a separately reviewed cursor/job design.
- Market and artist-ID inputs are validated. Internal errors are not returned to callers.
- This is authorization and per-request bounding, not a distributed rate limiter: repeated authorized calls still need quota/caching review.

## Verification performed

`node scripts/test-feed-security.cjs` executes the actual transpiled handler/client/follow code with synthetic Auth, database and provider mocks. It covers denied anonymous/invalid tokens, caller-scoped follow checks, missing/invalid parameters, failed follow lookup, valid GET/POST release insertion and artwork, trusted bounded scans, session-bearing client headers, signed-out client suppression, and follow refresh events before/after provider completion.

`node scripts/test-listen-save.cjs`, `node scripts/test-rating-display.cjs`, TypeScript checking and diff whitespace checks also passed. These are not a live Supabase integration test or a simulator UI smoke test.

## Remaining verification and rollout order

### Isolated integration result — 12 September

User subsequently confirmed the updated simulator follow-to-Feed flow worked without manual refresh. This verifies the client against the existing backend, not deployment of the secured handler. Offline/session-expiry UI behavior and deployed gateway testing remain outstanding.

`node scripts/verify-feed-recovery.cjs` passed against recovery project `mlciopffwtbopluuahoj`: two real synthetic-user sign-ins, missing/anon/invalid token rejection, unrelated-user rejection without provider calls, owned-follow authorization and persisted synthetic release/artwork. The actual handler ran locally using real recovery Auth/Postgres and simulated Spotify responses. No Edge Function was deployed, so gateway behavior and real Spotify integration remain unverified. Temporary accounts and fixture rows were removed; the temporary service-role grants were restored to their previous state. Production was not contacted by this test.

1. Test in an isolated backend with synthetic users: real signed-in token succeeds for an owned follow; anonymous/expired token and another account's follow fail without provider work. Confirm the chosen deployed gateway settings accept the intended user and scheduler credentials while the handler remains the authority.
2. Verify in the simulator: follow an artist with releases; Feed updates without manual refresh; Discover fallback works; search, unfollow and offline/session-expiry behavior remain intact.
3. Prepare and distribute the updated tester app first. The current live handler accepts the new POST/user-token request, so the client can precede the server protection. Confirm this compatibility in testing rather than assuming it from source alone.
4. Explicitly coordinate tester adoption/cutover before deploying ONLY `check-new-releases`. Older builds send the anon app key and will lose provider refresh capability after enforcement; cached feed reads are separate. Do not silently deploy this breaking change or weaken authentication as a fallback.
5. Verify the deployed access checks and genuine follow-to-feed refresh. Keep the audit task open until these checks and remaining audit work are finished.

If a rollout fails, retain the secure handler and address client/session problems where possible. Restoring the old unprotected handler reopens the known gap and needs an explicit risk decision.
