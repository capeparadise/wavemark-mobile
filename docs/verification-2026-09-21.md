# Verification batch — 21 September 2026

## Passed

- Cold-start synthetic tests: Save/Unsave races, duplicate taps, overlapping mutations, per-account cache separation, profile content before artwork, offline cache preservation.
- Existing listen-save, review, rating-display and feed-security regressions.
- Actual notification/Notes screen load callbacks with synthetic React/service dependencies: failed refresh preserves content, error feedback appears, successful retry clears error, rejected Notes authentication exits loading.
- Follow button mocked-component tests: rejected follow/unfollow requests show feedback, clear busy state and permit retry.
- TypeScript, targeted Notes/Notifications lint and diff whitespace checks.
- Separate recovery database, rollback-only synthetic role tests: request recipient acceptance/decline, requester retry, rating ownership, follower listing/status, owner-scoped removal, visible notes for accepted followers, no note activity for unrelated followers, and private music/activity no longer visible after removal. Positive private-music access was checked before removal as well.

The restored recovery database lacked the get_listener_music execute grant. The expanded test initially failed on that permission; the rerun supplied the grant documented in migration 20260907213000 inside the test transaction only. The rerun passed. No persistent grant or production changes were made. Existing recovery permission tests also apply candidate fixes transactionally; they are not proof of the current deployed production configuration.

## Fixed during verification

Notes could remain loading after a thrown connection error, and only loaded on mount. It now catches failures, always clears loading for the current request, refreshes on focus, ignores stale requests and exposes retry feedback even when old notes remain visible.

## Remaining gate

No simulator was booted during the read-only device check. No app was installed or launched on a physical device. Actual first-tap responsiveness, visual navigation into Releases, note expansion and follower UI must still be checked on a build containing these local changes. These tasks remain open rather than being marked fully complete. No IPA, deployment, commit or push was performed.
