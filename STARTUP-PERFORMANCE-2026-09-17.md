# Startup loading and Discover Save — 17 September 2026

Implemented locally after the owner reported cold-launch delays on all Discover releases, slow Your updates and generic Profile identity/loading blocks. These changes are NOT in the already-exported build 21. No deployment, IPA, commit or push was performed in this fix pass.

## Changes

- Discover saved-state refreshes use a mutation revision/read-order guard: reads started before or during Save/Unsave cannot replace optimistic state. Repeated pending taps are deduplicated; a new reconciliation read runs after completion or rollback.
- Saved-state reads explicitly filter by account and no longer wait for a separate remote getUser request.
- Discover preserves a canonical Spotify URL for known IDs when the result omits its URL, avoiding the Apple fallback lookup in that case. Hero Save taps stop propagation to release navigation.
- Your updates hydrates an account-specific cache and reads the existing release feed independently of the broad genre/catalogue refresh. The full refresh retains authority; follow changes invalidate startup hydration/cache. Cached releases remain date/follow filtered.
- Profile reads cached identity and statistics independently of network requests; one focus load replaces the mount/focus/tabPress duplication. It displays statistics before artwork resolution and uses neutral first-load wording rather than a fictitious Listener identity. Failed refreshes preserve cached content and expose retry.
- Profile/Discover content remounts by account. Shared legacy profile cache is not read. Account deletion/demo reset include new cache keys. Session startup also warms the identity cache.
- Achievements/Insights consumers handle snapshot failures and display cached content before artwork instead of waiting indefinitely.

## Verification

- New synthetic suite: scripts/test-startup-loading.cjs passes Save/Unsave stale-read races, duplicate taps, concurrent mutations, account cache isolation/corrupt data, profile content before deferred artwork, and offline-cache preservation.
- Existing listen-save, track-rating-cache, rating-display and artist-release-filter suites passed.
- TypeScript and whitespace checks pass. Targeted lint reports no errors (existing Discover warnings remain).
- Production-mode iOS Hermes bundle export passed; final small error-state adjustments also passed TypeScript.
- No real-device timing measurements or interactive verification performed. These results do not prove that every source of startup latency has been eliminated.

## Device gate before marking Todoist complete

Install a build containing this fix first; restarting build 21 cannot exercise it. Fully close/relaunch, immediately save an unsaved release once, check immediate state and eventual Listen List persistence. Return between Profile and Discover, check cached identity/content and fresh updates. Repeat with a slow/offline connection (visible failure and rollback), follow/unfollow an artist, and verify account switching cannot display the prior account. Record exact artist/release used; owner reported the issue applies to all releases rather than one specific example.

Todoist: Verify cold-start loading and first-tap Discover Save fixes (6hWrQxM54JRmH877), undated and open pending device verification.
