# Isolated simulator UI proof

Uses XCTest directly, without the Device Hub computer-control connection. The runner has its own bundle ID and launches the existing `com.capeparadise.rppl` simulator installation. It does not build/install RPPL, reset storage, enter credentials, save music or change follows.

Prerequisites: booted simulator with the RPPL development build and Metro serving this checkout on localhost:8081. Existing local CocoaPods includes xcodeproj; no new gems required on this Mac.

Generate into a new temporary directory:

```sh
GEM_PATH=/opt/homebrew/Cellar/cocoapods/1.17.0/libexec:/opt/homebrew/Cellar/ruby/4.0.6/lib/ruby/gems/4.0.0 ruby scripts/ios-ui-proof/generate.rb /tmp/rppl-xctest-proof-20260921
```

Run (choose a fresh result-bundle filename for each run):

```sh
xcodebuild test -project /tmp/rppl-xctest-proof-20260921/RPPLProof.xcodeproj -scheme RPPLProof -destination 'platform=iOS Simulator,id=18C20ADA-CE98-4551-87BC-88AD6B32BB34' -derivedDataPath /tmp/rppl-xctest-proof-20260921/DerivedData -resultBundlePath /tmp/rppl-xctest-proof-20260921/NextRun.xcresult -parallel-testing-enabled NO -test-timeouts-enabled YES -default-test-execution-time-allowance 60 -maximum-test-execution-time-allowance 90 -only-testing:RPPLProof/RPPLProof/testLaunchAndReadScreen CODE_SIGNING_ALLOWED=NO
```

The launch proof captures screenshots and an accessibility hierarchy and checks real Discover content. A separate `testProfileNavigation` attempts Profile then Discover. A signed-in account with profile content is expected; it never signs in automatically.

21 Sep results: initial launch/read proof passed on iPhone 17 Pro / iOS26.5 and captured populated Discover. Navigation initially used an incorrect label; corrected to the observed tab label. The corrected navigation test then stalled at `Wait for com.capeparadise.rppl to idle` before the tap and exceeded its 60-second allowance. This is NOT a navigation pass. Keep the smaller proof separate while diagnosing idleness; no private XCTest overrides or application timing changes have been applied.

This proves launch/read automation only, not successful tap/navigation automation, Save performance, notifications or follow/privacy acceptance. In the timed-out run, XCTest eventually synthesized the tap after reporting a missing animation-completion notification, but never completed the navigation assertions. Test artifacts may contain demo profile/music information; keep local.

The saved split launch-only test was rebuilt with fresh derived data and passed on 21 Sep (exit 0, approximately 16 seconds). Result: `/tmp/rppl-xctest-proof-fresh-20260921/Launch.xcresult`. Reusing the earlier derived-data folder appeared to execute an older combined test; use fresh derived data when validating test-source changes.

Final bounded navigation experiment (21 Sep): a runtime-guarded, test-runner-only `idleAnimationWaitEnabled = false` override still stalled during application activation waiting for idle, then exceeded the 60-second test allowance. Result: `/tmp/rppl-xctest-animation-proof-20260921/Navigation.xcresult`. The unsuccessful private-API experiment was removed from source. No RPPL code, animations, account data or physical device settings were changed. Do not keep retrying this path as if navigation were verified; use physical-device acceptance checks until the automation problem is resolved separately.

Local regression checks rerun and passed: `test-startup-loading.cjs`, `test-social-screen-loading.cjs`, `test-follow-network-errors.cjs`. These exercise synthetic state/service scenarios, not rendered UI.
