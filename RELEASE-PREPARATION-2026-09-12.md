# Next tester build preparation

RPPL 1.0.0 build 20 finished successfully on EAS after explicit user approval. Build ID: `4bd4c3c5-d2ed-4ce9-9f15-0ed28ddb717c`. IPA saved at `/Users/f4f/Downloads/RPPL-1.0.0-20-beta-polish.ipa` (about 21 MB). ZIP integrity passed; packaged Info.plist confirms version 1.0.0, build 20, bundle `com.capeparadise.rppl`. SHA-256: `3497369b9fee297de1a8b4fdf54c18f4ba941e75cdc99d9f32ac764b0a86eb92`. Earlier IPA files were not overwritten. Nothing has been submitted to Apple; production backend protection is not deployed.

## Dependency maintenance

Applied targeted npm updates within existing dependency ranges, with install scripts disabled. Expo, React Native, routing and native module versions remain unchanged. Updated shell-quote, ws, tar, undici, nanoid, brace-expansion, js-yaml, fast-uri, xmldom, browserslist, Babel and humanfs/browser-data dependencies. package.json is unchanged; package-lock.json records exact versions.

Audit affected-entry counts fell from 43 (1 critical, 17 high, 24 moderate, 1 low) to 30 (0 critical, 9 high, 21 moderate). Remaining root advisory packages are decode-uri-component, image-size, postcss and uuid, with transitive dependent entries. They require further compatibility/reachability review; suggested automatic fixes cross framework/router boundaries. No blanket audit fix or forced upgrade was run. These counts are not claims of independently exploitable mobile-app vulnerabilities or a complete clean security audit.

## Verification

- Feed security, duplicate-save and rating-display regression tests passed.
- TypeScript and whitespace checks passed.
- Production-mode iOS Hermes bundle exported successfully.
- Read-only production schema check confirmed listen_list.rating_details is jsonb.
- Source archive inspection confirmed the current profile/history/settings, rating, demo helper and feed client files match the working tree. No local env, signing-key or backup files were found outside Git metadata.
- Development-only demo UI and reset helper are guarded by __DEV__; no backend demo-reset deployment performed.
- Current uncommitted profile/rating/demo changes remain intact and are included in the inspected candidate source. They were not silently reverted or committed as part of dependency work.

## Build gate

The initial EAS invocation was blocked before starting. The user subsequently explicitly approved using EAS as before to upload source and use existing signing credentials. Build 20 was then started successfully; submitting the finished IPA to Apple remains the user's task. No alternative route was used to bypass the block.

## Suggested What to Test text

Please test the latest improvements to saving, ratings and your release feed:

- Follow an artist, then check that their releases appear in Feed without pulling to refresh.
- Save a release that is already in your Listen List and check that the app clearly tells you it is already saved.
- Rate or change a rating from History, then check that you can keep scrolling and opening releases normally.
- Try advanced ratings and switch back to simple ratings. Check that saved category scores are preserved and your overall score remains consistent.
- Check Profile, Recently listened and Top rated for correct artwork and rating displays.

If something goes wrong, please include the artist/release name, the screen, what you tapped and a screenshot.
