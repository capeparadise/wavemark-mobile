# RPPL — social checks, profile sharing and artist imports

17 September 2026. Local verification and feasibility research only. No phone interaction, account changes, deployments or purchases.

## 1. Existing social features

Passed: `node scripts/test-social-local.cjs` and `npx tsc --noEmit`.
The synthetic tests exercise the actual profileSocial service with mocked dependencies: follower statuses, errors and removal results; note trimming/empty notes; actor/rating mapping; permission errors do not trigger legacy fallback. They do not prove deployed database permissions or physical-device behaviour.

Source review confirms:
- Following feed preserves review text and provides Show note / Hide note, hidden initially and absent for blank notes.
- Accepting a modern follow request switches to Followers. Follow back / Requested / Following are implemented. Removal asks for confirmation.
- The SQL migration scopes activity to accepted follows and removal to the current owner's inbound relationship. This is a source review, not a fresh live security test.
- Notifications contains requests, recent followers and a bounded release summary, not routine listening/rating alerts. Settings Notes lists written rating notes.

Follow-ups found; do not mark the social work fully verified yet:
- Notifications converts failed loads to empty arrays, which can misleadingly suggest there are no updates. Preserve loaded content and show retry/error feedback.
- Its New releases → Open Feed action does not explicitly select Releases. Check/fix the case where Feed previously showed Following.
- ListenerFollowButton has finally cleanup but no catch for rejected network promises; verify transport errors produce useful feedback.
- Complete the device pass later: Maluma “Maluma - Hits Pa' Siempre” note “This slapped hard!” from @ripple_qa; @fraysisland request acceptance, Follow back and confirmed removal; private-profile access after removal. Do not alter demo accounts during recording.

## 2. Shareable profile links — recommended design

Feasible. Existing username profile screen and explicit follow/request button can be reused. The existing share-card screen already shares a username-based `rppl://profile/listener/...` link through the native share sheet. Extend this instead of building a duplicate sharing feature. App configuration has rppl/wavemark custom schemes but no associatedDomains configuration. A normal HTTPS sharing experience is not established by those schemes alone.

Use an owner-controlled HTTPS domain and a stable, opaque public profile identifier, rather than a username-only permanent link. Resolve to the current username without granting access. Never use legacy connection-invite acceptance as a substitute for viewing a profile: opening must never follow automatically.

Flow: Share profile → native share sheet/copy link → open profile → explicit Follow / Request to follow. Private content stays protected by server permissions. Logged-out recipients retain only a validated internal destination until sign-in, then permissions are checked again. Deleted/unavailable profiles get a neutral unavailable screen. Username changes must not redirect old links to someone who later takes that username.

When installed, Universal Links can open the app. Otherwise show a small privacy-safe web landing page with installation instructions and the link to reopen after installing. Do not promise automatic deferred routing across installation. During beta use the approved TestFlight invitation path; public App Store promotion only when available.

Implementation needs: confirm the owned domain/hosting, HTTPS landing page and AASA association file, associated-domain configuration/new native build, stable-ID resolver with privacy checks, pending destination handling and native Share action. Test installed/uninstalled, logged-in/out, private/public, renamed/deleted accounts and malformed links. No paid deep-link vendor is required by this design; domain/hosting costs depend on the existing setup.

Source: [Expo Universal Links](https://docs.expo.dev/linking/ios-universal-links/).

## 3. Artist imports — Apple first; Spotify gated

Apple Music: Apple's MusicKit documentation explicitly supports filtering a user's library by favourite artists with authorization. This is a viable investigation path, not a completed integration. Do not mislabel all library artists as favourites. Prototype the native MusicKit request, minimum OS support, authorization denial and subscription/catalog availability before committing to rollout. Existing public catalogue search does not authorize access to a person's music library.

Apple implementation: opt-in authorization → fetch favourite artists with pagination → preview/select → resolve provider identities → follow selected artists in RPPL. Preserve Apple IDs; do not match artists solely by name. Ambiguous or missing cross-service matches require review, not silent substitution. Use existing RPPL follow logic, deduplicate repeated imports and refresh the artist feed. No Apple library writes or ongoing listening sync are needed.

Costs: the Apple Developer Program is USD99/year or local equivalent; RPPL already has distribution signing, so do not assume another membership is needed. The referenced MusicKit overview does not publish a per-import fee. Confirm entitlement/account configuration and normal backend usage before implementation; this is not a promise of zero total running cost.

Sources: [Apple MusicKit](https://developer.apple.com/musickit/), [Apple membership](https://developer.apple.com/support/compare-memberships/).

Spotify: GET /me/following?type=artist supports user-follow-read and cursor pagination, up to50 per page. Use authorization-code PKCE and read-only consent; never embed a client secret in the app. Keep tokens secure and handle denied/revoked access,403 and429. Importing follows is separate from playback/history.

Important rollout constraint: current development mode requires the app owner to have Premium and permits only five allowlisted authenticated users. New extended-quota applications require an organization and published eligibility criteria including250k monthly active users. We have not inspected RPPL's actual Spotify app quota status, so cannot conclude its existing integration is approved or exempt. Do not promise a general-user import button until access is confirmed. A small allowed prototype is not a production solution. Premium pricing varies; no new subscription was purchased or recommended as a way around approval.

Sources: [Followed artists endpoint](https://developer.spotify.com/documentation/web-api/reference/get-followed), [Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes), [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow).

## Recommended next implementation

First address notification failure feedback and verify the social device flows after recording. Then prototype Apple Music favourite-artist import locally. Profile-link implementation needs a confirmed owned domain. Keep listening-history syncing as a separate future task. Exploration is complete; neither sharing nor imports has been built or deployed.
