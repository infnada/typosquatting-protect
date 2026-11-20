const test = require("node:test");
const assert = require("node:assert/strict");
const { loadExtension } = require("./load");

test("defaults without policy or user settings", async () => {
  const settings = await loadExtension().loadSettings();
  assert.equal(settings.enablePreemptiveChecks, true);
  assert.equal(settings.enableCountryBlock, true);
  assert.equal(settings.enableWarningBar, true);
  assert.equal(settings.warningBarSize, "slim");
  assert.equal(settings.geoProvider, "ipwhois");
  assert.equal(settings.allowUserWhitelist, true);
  assert.deepEqual([...settings.whitelist], []);
  assert.equal(settings.noticeText, "");
});

test("user settings apply when no policy is set", async () => {
  const settings = await loadExtension({
    sync: { whitelist: ["user.test"], enablePreemptiveChecks: false, warningBarSize: "normal", geoProvider: "geojs" },
  }).loadSettings();
  assert.equal(settings.enablePreemptiveChecks, false);
  assert.equal(settings.warningBarSize, "normal");
  assert.equal(settings.geoProvider, "geojs");
  assert.deepEqual([...settings.whitelist], ["user.test"]);
  assert.equal(settings.locked.enablePreemptiveChecks, false);
});

test("policy overrides user settings and locks them", async () => {
  const settings = await loadExtension({
    policy: {
      managedWhitelist: ["*.SharePoint.com", "https://Intranet.Firma.de/start", "not valid!*"],
      enablePreemptiveChecks: true,
      enableWarningBar: false,
      warningBarSize: "normal",
      geoProvider: "ipapi",
      noticeText: "  Call IT  ",
      blockedCountries: ["ru"],
    },
    sync: { whitelist: ["user.test"], enablePreemptiveChecks: false, enableWarningBar: true },
  }).loadSettings();

  assert.deepEqual([...settings.managedWhitelist], ["*.sharepoint.com", "intranet.firma.de"]);
  assert.deepEqual([...settings.whitelist], ["*.sharepoint.com", "intranet.firma.de", "user.test"]);
  assert.equal(settings.enablePreemptiveChecks, true);
  assert.equal(settings.enableWarningBar, false);
  assert.equal(settings.warningBarSize, "normal");
  assert.equal(settings.geoProvider, "ipapi");
  assert.equal(settings.noticeText, "Call IT");
  assert.deepEqual([...settings.blockedCountryCodes], ["RU"]);
  assert.ok(settings.locked.enablePreemptiveChecks && settings.locked.enableWarningBar);
  assert.equal(settings.locked.enableCountryBlock, false);
});

test("allowUserWhitelist false ignores the user's own entries", async () => {
  const settings = await loadExtension({
    policy: { managedWhitelist: ["firma.de"], allowUserWhitelist: false },
    sync: { whitelist: ["user.test"] },
  }).loadSettings();
  assert.deepEqual([...settings.whitelist], ["firma.de"]);
  assert.deepEqual([...settings.userWhitelist], ["user.test"]);
});

test("invalid policy values fall back to defaults", async () => {
  const settings = await loadExtension({
    policy: { geoProvider: "something", warningBarSize: "huge", managedWhitelist: "firma.de", noticeText: 5 },
  }).loadSettings();
  assert.equal(settings.geoProvider, "ipwhois");
  assert.equal(settings.warningBarSize, "slim");
  assert.deepEqual([...settings.managedWhitelist], []);
  assert.equal(settings.noticeText, "");
});

test("sign-in guard settings are normalized", async () => {
  const settings = await loadExtension({
    policy: {
      protectedEmailDomains: ["@Firma.de", "firma-gruppe.com", "*.wild.de", ""],
      protectedLogins: [" MustermannM ", "ab", "Max@Firma.de"],
    },
  }).loadSettings();
  assert.deepEqual([...settings.protectedEmailDomains], ["firma.de", "firma-gruppe.com"]);
  assert.deepEqual([...settings.protectedLogins], ["mustermannm", "max@firma.de"]);
});
