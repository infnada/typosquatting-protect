// Browser tests with an organization policy. They need write access to the
// browser's policy directory and are skipped otherwise.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { BAR, barText, POLICY_SKIP_REASON, gotoAllowed, gotoAndContinue, gotoBlocked, launch, policySupported, settle } = require("./helpers");

const skip = policySupported() ? false : POLICY_SKIP_REASON;
let app;

after(async () => {
  if (app) await app.close();
});

async function relaunch(options) {
  if (app) await app.close();
  app = await launch(options);
  return app.newPage();
}

const marked = (page, selector) => page.locator(selector).evaluate((field) => field.style.outline !== "");

test("organization whitelist and locked settings", { skip }, async () => {
  const page = await relaunch({
    policy: {
      managedWhitelist: ["*.sharepoint.com", "https://Intranet.Firma.de/start"],
      allowUserWhitelist: false,
      enablePreemptiveChecks: true,
      blockedCountries: ["ru"],
      noticeText: "Call the help desk on extension 123.",
    },
    sync: { whitelist: ["userallowed.test"], enablePreemptiveChecks: false },
  });

  await gotoAllowed(page, "firma.sharepoint.com", "/sites/x");
  assert.equal(await page.locator(BAR).count(), 0);
  await gotoAllowed(page, "intranet.firma.de");

  // Forced check, lookalike of the managed entry, no whitelisting
  await gotoBlocked(page, "evilsharepoint.com");
  assert.equal(await page.locator("#whitelist-continue").count(), 0);
  assert.equal(await page.locator("#just-continue").count(), 1);
  assert.match(await page.locator("#org-notice").innerText(), /extension 123/);

  // The user's own list does not count
  await gotoBlocked(page, "userallowed.test");
  assert.ok(await page.locator("#managed-note").isVisible());
  await page.click("#just-continue");
  await page.waitForURL("http://userallowed.test/");
  await page.locator(BAR).waitFor();
  assert.doesNotMatch(await barText(page), /extension icon/);

  await gotoBlocked(page, "blocked.test");
  await page.locator("#title", { hasText: "Blocked Country" }).waitFor();

  const popup = await app.openPopup();
  assert.deepEqual(
    (await popup.locator("#managed-whitelist li .domain-entry").allTextContents()).map((text) => text.replace("WILDCARD", "").trim()),
    ["*.sharepoint.com", "intranet.firma.de"],
  );
  assert.ok(await popup.locator("#user-section").isHidden());
  assert.ok(await popup.locator("#user-whitelist-locked").isVisible());
  assert.ok(await popup.locator("#preemptive-check-toggle").isDisabled());
  assert.ok(await popup.locator("#preemptive-check-toggle").isChecked());
  assert.ok(!(await popup.locator("#country-block-toggle").isDisabled()));
});

test("a policy change applies without restarting the browser", { skip }, async () => {
  const page = await relaunch({ policy: { managedWhitelist: ["*.sharepoint.com"] } });
  await gotoAndContinue(page, "newpartner.test");
  await page.locator(BAR).waitFor();

  app.writePolicy({ managedWhitelist: ["*.sharepoint.com", "newpartner.test"] });
  await page.locator(BAR).waitFor({ state: "detached", timeout: 40000 });
});

test("sign-in guard warns for company e-mail domains only", { skip }, async () => {
  const page = await relaunch({
    policy: {
      managedWhitelist: ["*.sharepoint.com"],
      protectedEmailDomains: ["@Firma.de", "firma-gruppe.com"],
      protectedLogins: ["MustermannM"],
    },
  });
  await gotoAndContinue(page, "unknown-shop.net", "/login");

  const type = async (value) => {
    await page.locator("#user").fill(value);
    await settle(page, 300);
    return marked(page, "#user");
  };

  assert.equal(await type("max.mustermann@firma.d"), false, "incomplete address");
  assert.equal(await type("Max.Mustermann@firma.de"), true);
  assert.ok(await page.locator("#whitelist-login-warning").isVisible());
  assert.ok(await marked(page, "#pass"), "password field is marked too");

  assert.equal(await type("max@gmail.com"), false);
  assert.equal(await page.locator("#whitelist-login-warning").count(), 0);
  assert.equal(await marked(page, "#pass"), false);

  assert.equal(await type("b@firma-gruppe.com"), true, "second domain");
  assert.equal(await type("x@mail.firma.de"), true, "subdomain");
  assert.equal(await type("max@firma.de.evil.com"), false);
  assert.equal(await type("max@nichtfirma.de"), false);
  assert.equal(await type("mustermannm"), true, "per-user sign-in name");
  assert.equal(await type("someone"), false);

  await gotoAllowed(page, "firma.sharepoint.com", "/login");
  assert.equal(await type("max.mustermann@firma.de"), false, "whitelisted page");
});

test("switching the bar off by policy keeps the other protections", { skip }, async () => {
  const page = await relaunch({
    policy: {
      managedWhitelist: ["*.sharepoint.com"],
      protectedEmailDomains: ["firma.de"],
      enableWarningBar: false,
    },
  });
  await gotoAndContinue(page, "unknown-shop.net", "/login");
  await settle(page);
  assert.equal(await page.locator(BAR).count(), 0);

  await page.locator("#user").fill("max@firma.de");
  await page.locator("#whitelist-login-warning").waitFor();

  await gotoBlocked(page, "sharepoimt.com");
  assert.ok(await page.locator("#similar-warning").isVisible());

  const popup = await app.openPopup();
  assert.ok(await popup.locator("#warning-bar-toggle").isDisabled());
  assert.ok(!(await popup.locator("#warning-bar-toggle").isChecked()));
});

test("country checks switched off by the organization are hidden", { skip }, async () => {
  const page = await relaunch({ policy: { enableCountryBlock: false } });
  await gotoBlocked(page, "unknown-shop.net");
  assert.ok(await page.locator("#security-details").isHidden());
  assert.equal(await page.locator("#security-details").innerText(), "");

  const popup = await app.openPopup();
  assert.ok(await popup.locator('.tab[data-tab="country"]').isHidden());
  assert.ok(await popup.locator('.tab[data-tab="domains"]').isVisible());
});

test("the interface follows the browser language", { skip: false }, async () => {
  const page = await relaunch({ locale: "de-DE" });
  await gotoBlocked(page, "unknown-shop.net");
  assert.equal(await page.textContent("#title"), "Domain nicht auf der Whitelist");
  assert.match(await page.locator("#security-details").innerText(), /Land: Deutschland/);
  const popup = await app.openPopup();
  assert.equal((await popup.locator('[data-tab="country"]').innerText()).trim(), "Länder");
});
