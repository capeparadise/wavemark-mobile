# Device Hub computer-control recovery

Verified on macOS 27 (26A428), Xcode 27 (27A266a), iPhone 17 Pro / iOS 26.5.

Normal launch left DeviceHub running as PID 15256 while AppKit reported its processIdentifier as -1. Computer Use could not select the application.

Recovery used:
1. Stop only the confirmed DeviceHub process, preserving simulator data. TERM did not exit; targeted KILL was required. Never blindly reuse a PID from this document.
2. In Finder, Go to Folder: `/Applications/Xcode.app/Contents/Applications/DeviceHub.app/Contents/MacOS/`.
3. Open `DeviceHub`, not `DevicesTrampoline` or the outer app. Keep the resulting launcher Terminal open.
4. Verify the real process and AppKit report the same positive PID and finished launching. This run: 22332.
5. Select `com.apple.dt.Devices` using Computer Use; verify reading, screenshot capture and reversible input independently.

All three succeeded: Following feed read, native screenshot captured, Show note revealed “Nice album” for August 26 by Post Malone, then Hide note removed it. No account writes, app changes, Xcode downgrade or privacy resets. One full accessibility snapshot took about 61 seconds; subsequent hide/read took about 5 seconds. This restores functionality but does not establish perfect speed or permanent reliability, nor fix XCTest idleness.

If the normal launcher is used later and timeouts return, check the process identity before repeating recovery. No automatic process termination or persistent system modification was installed.
