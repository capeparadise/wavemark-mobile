import XCTest

final class RPPLProof: XCTestCase {
    @MainActor
    func testLaunchAndReadScreen() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.capeparadise.rppl")
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30))

        // The existing development client may need to select the local server.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let open = springboard.alerts.buttons["Open"]
        if open.waitForExistence(timeout: 3) { open.tap() }
        let server = app.staticTexts["http://localhost:8081"]
        if server.waitForExistence(timeout: 5) { server.tap() }

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "RPPL proof screen"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "RPPL accessibility hierarchy"
        tree.lifetime = .keepAlways
        add(tree)
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 20), "RPPL has no accessible window")
        XCTAssertGreaterThan(app.descendants(matching: .any).count, 1, "RPPL screen cannot be read")
        let discover = app.staticTexts["Your updates"].firstMatch
        XCTAssertTrue(discover.waitForExistence(timeout: 30), "Expected the real Discover screen, not just the development launcher")
    }

    @MainActor
    func testProfileNavigation() throws {
        executionTimeAllowance = 60
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.capeparadise.rppl")
        app.activate()
        let discover = app.staticTexts["Your updates"].firstMatch
        let profile = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Profile, tab,")).firstMatch
        XCTAssertTrue(profile.waitForExistence(timeout: 10))
        profile.tap()
        let profileContent = app.staticTexts["Recently listened"].firstMatch
        XCTAssertTrue(profileContent.waitForExistence(timeout: 30), "Profile content did not load after tab tap")
        let profileShot = XCTAttachment(screenshot: app.screenshot())
        profileShot.name = "RPPL profile after automated tap"
        profileShot.lifetime = .keepAlways
        add(profileShot)
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Discover, tab,")).firstMatch.tap()
        XCTAssertTrue(discover.waitForExistence(timeout: 10))
    }
}
