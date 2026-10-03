# RPPL product batch — 22 September 2026

## Delivery status

1. Custom rating order: implemented locally; device verification pending.
2. Track previews: source/code feasibility pass complete; not enabled, coverage and provider-use approval still unresolved.
3. Taste-based people suggestions: privacy-first implementation proposal prepared; no matching of live users, backend changes or UI rollout.

## Check together: custom rating order

Profile → Settings → Ratings → Rating settings → Rating order.

- Move Artwork to the top, then open an album or single rating with artwork enabled.
- Move Production above Overall impression with advanced ratings enabled. Change both; confirm the correct score changes and the total remains /50.
- Move Your note; confirm it scrolls with the other sections and Expand/Done keeps the draft.
- Turn a section off and back on: its position should remain. Reopen Settings to confirm persistence.
- Reset order restores Overall, Production, Vocals, Lyrics, Replay, Artwork, Note, without changing scores or switches.

The total stays at the top as a summary. Individual sections below follow the chosen order. Preferences remain per account on this device. No new IPA or deployment.

## Track previews — findings and proposed first slice

Code evidence: lib/apple.ts already maps optional previewUrl values from iTunes lookup results. A repository search found no preview player; package.json contains neither expo-audio nor expo-av. The presence of metadata is not evidence of current catalogue coverage or permission for the intended product use.

Spotify's November 2024 announcement restricts preview URLs in multi-get responses for affected applications. Do not infer that every endpoint or this app's access status is identical, and do not promise universal previews. Its policy requires attribution and a corresponding Spotify link, and restricts cross-service streaming integrations. Review compatibility before mixing providers. [Spotify announcement](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api), [Spotify policy](https://developer.spotify.com/policy).

Apple documents optional preview assets. The existing RPPL mapping uses iTunes Search, whose archived documentation limits samples to promotional use, requires an appropriate store badge/link and attribution, and prohibits downloading/caching or synchronizing samples with video. These constraints need checking against RPPL's intended UI before enabling playback; MusicKit documentation does not automatically override iTunes terms. [MusicKit preview assets](https://developer.apple.com/documentation/musickit/track/previewassets), [iTunes Search overview and terms](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/).

Recommended bounded implementation after that review:

- One release/track detail screen first, not autoplay in scrolling lists.
- Play preview only following a deliberate tap, on a verified provider ID, with artwork/title/provider attribution and a direct provider link.
- Missing preview: retain Open in Apple Music/Spotify, never a permanently disabled play button or fabricated 30-second promise.
- One audio session at a time; stop on navigation, backgrounding, sign-out and interruptions. No loop, background playback, download or auto-mark-as-listened.
- Request fresh metadata if a URL expires; one retry, then graceful fallback. Do not scrape another source to bypass missing access.
- Validate current native audio package compatibility and build a new development client if required. No package installed in this batch.

Before marking complete: test several verified tracks across genres and markets, missing/expired URLs, offline failure, rapid play/stop, headset disconnect, phone interruption, provider link, screen exit, and retention of the user's existing playback context. Do not use preview audio in promotional screen recordings.

Decision: preview playback is feasible to prototype, but not yet cleared or verified for release. No live coverage test or legal approval is claimed.

## Taste-based people suggestions — proposed contract

Code evidence: profileSocial.ts provides profile search, following/follower lists and permission-aware profile/activity operations. No suggestion/discoverability or blocking implementation was found in the inspected profile service and migrations. Reusing client-visible search results to calculate taste overlap would not establish a privacy-safe recommendation system.

Recommended first version: an opt-in panel under Find people, with a maximum of five public, opted-in candidates. Private profiles are excluded even if followed; this deliberately conservative first release avoids leaking their tastes through discovery. Do not match contacts, emails, connected-service listening or private notes. No push notifications and no compatibility percentages.

Server-side eligibility must precede scoring: current viewer authenticated; exclude self, existing follows/pending requests, deleted accounts, opted-out accounts, private profiles, dismissed suggestions and either-direction blocks. Blocking must be implemented before rollout, not assumed to exist.

Proposed explainable scoring: deduplicated canonical releases rated at least 8/10 by both people. Require at least three shared releases; sort by shared count, then shared followed-artist count only where artist-follow visibility is explicitly permitted, then stable ID. Overall scores only, never artwork or /50 totals. Do not fuzzy-match names or editions. Sparse data should show a helpful Find people/search empty state, not arbitrary users.

Display: avatar, name, username, “3 highly rated releases in common”, Follow and Dismiss. Named examples must only reference data authorized for the viewer. Do not reveal hidden counts, private tastes, email or raw history. Existing explicit follow/request flow remains unchanged.

New backend work required: opt-in discoverability setting; per-viewer dismissal records; two-way block storage/enforcement; authenticated bounded suggestion endpoint using auth.uid rather than a supplied viewer ID; permission checks on every request; short-lived or invalidated result caches. Opt-out, privacy changes and blocks must remove a candidate immediately on the next fetch.

Tests before rollout: unauthenticated denial, forged identity, no private candidate/reason leakage, opt-in/out, private↔public changes, two-way blocks, dismissal persistence, deleted users, follows/pending, duplicate provider records, ties, fewer-than-three overlap, request bounds and stale cached results.

Owner decision before implementation: approve opt-in public-only suggestions and the three-shared-release minimum. These are proposals, not defaults silently applied to existing accounts.
