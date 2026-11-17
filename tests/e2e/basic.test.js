// Browser tests without an organization policy.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { BAR, EXTENSION_ID, gotoAllowed, gotoAndContinue, gotoBlocked, launch, settle } = require("./helpers");

let app;
let page;

before(async () => {
  app = await launch();
  page = await app.newPage();
});

after(async () => {
  if (app) await app.close();
});

async function resetWhitelist(entries = []) {
  await app.evaluate((list) => setUserWhitelist(list), entries);
  await app.evaluate(() => chrome.storage.session.clear());
}

test("a non-whitelisted domain shows the confirmation page", async () => {
  await resetWhitelist();
  await gotoBlocked(page, "www.shop.example.co.uk", "/path");
  assert.equal(await page.textContent("#domain-name"), "www.shop.example.co.uk");
  assert.match(await page.textContent("#wildcard-continue"), /\*\.example\.co\.uk/);
});

test("lookup results are shown as text, not as markup", async () => {
  const details = page.locator("#security-details");
  assert.equal(await details.locator("img, b").count(), 0);
  assert.match(await details.innerText(), /Region<b>bold<\/b>/);
});

test("continuing loads the page and shows the warning bar", async () => {
  await page.click("#just-continue");
  await page.waitForURL("http://www.shop.example.co.uk/path");
  await page.locator(BAR).waitFor();
  assert.match(await page.locator(BAR).innerText(), /www\.shop\.example\.co\.uk/);
});

test("the session allowance survives a restart of the service worker", async () => {
  const cdp = await app.context.newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await gotoAllowed(page, "www.shop.example.co.uk", "/again");
});

test("whitelisting a wildcard from the bar covers subdomains but not lookalikes", async () => {
  await page.locator("#wildcard-whitelist-btn").click();
  await page.locator(BAR).waitFor({ state: "detached" });
  await gotoAllowed(page, "other.example.co.uk");
  await gotoAllowed(page, "example.co.uk");
  assert.equal(await page.locator(BAR).count(), 0);
  await gotoBlocked(page, "evilexample.co.uk");
});

test("a URL containing confirmation.html does not bypass the check", async () => {
  await gotoBlocked(page, "evil.test", "/confirmation.html");
});

test("whitelist and continue adds the domain", async () => {
  await page.click("#whitelist-continue");
  await page.waitForURL("http://evil.test/confirmation.html");
  assert.ok((await app.evaluate(() => getUserWhitelist())).includes("evil.test"));
});

test("a web page cannot open the confirmation page with its own parameters", async () => {
  await gotoAllowed(page, "evil.test");
  await page.evaluate((id) => {
    location.href = `chrome-extension://${id}/confirmation.html?domain=google.com&url=http://evil.test/`;
  }, EXTENSION_ID);
  await settle(page);
  assert.equal(await page.locator("#whitelist-continue").count(), 0);
});

test("a domain in a blocked country cannot be continued", async () => {
  await app.evaluate(() =>
    chrome.storage.sync.set({ blockedCountries: [JSON.stringify({ code: "RU", name: "Russia" })] }),
  );
  await gotoBlocked(page, "blocked.test");
  await page.locator("#title", { hasText: "Blocked Country" }).waitFor();
  assert.equal(await page.locator("#just-continue").count(), 0);
  await app.evaluate(() => chrome.storage.sync.remove("blockedCountries"));
});

test("lookalike characters are reported and cannot be whitelisted", async () => {
  await resetWhitelist(["amazon.de"]);
  await gotoBlocked(page, "xn--mazon-3ve.de"); // "аmazon.de" with a Cyrillic а
  const warning = await page.locator("#homograph-warning").innerText();
  assert.match(warning, /amazon\.de/);
  assert.match(warning, /xn--mazon-3ve\.de/);
  assert.equal(await page.locator("#whitelist-continue").count(), 0);
  assert.equal(await page.locator("#wildcard-continue").count(), 0);
  assert.ok(await page.locator("#suspicion-note").isVisible());

  await gotoBlocked(page, "xn--bcher-kva.de"); // "bücher.de"
  assert.ok(await page.locator("#homograph-warning").isHidden());
  assert.equal(await page.locator("#whitelist-continue").count(), 1);
});

test("similar domains are reported and cannot be whitelisted", async () => {
  await resetWhitelist(["*.sharepoint.com", "bbc.co.uk"]);
  await gotoBlocked(page, "sharepoimt.com");
  assert.match(await page.locator("#similar-warning").innerText(), /sharepoint\.com/);
  assert.equal(await page.locator("#whitelist-continue").count(), 0);

  // A request sent directly to the extension is refused as well
  await page.evaluate(() =>
    chrome.runtime.sendMessage({ action: "whitelistAndContinue", domain: "sharepoimt.com", url: "http://sharepoimt.com/" }),
  );
  await settle(page);
  assert.ok(!(await app.evaluate(() => getUserWhitelist())).includes("sharepoimt.com"));

  await page.click("#just-continue");
  await page.waitForURL("http://sharepoimt.com/");
  await page.locator(BAR).waitFor();
  assert.match(await page.locator(BAR).innerText(), /similar to sharepoint\.com/);
  assert.equal(await page.locator("#whitelist-btn").count(), 0);

  await gotoBlocked(page, "sharepoint.com.evil.net");
  assert.match(await page.locator("#similar-warning").innerText(), /sharepoint\.com/);
  await gotoBlocked(page, "bbc.co.uk.login.example.org");
  assert.match(await page.locator("#similar-warning").innerText(), /bbc\.co\.uk/);

  await gotoBlocked(page, "heise.de");
  assert.ok(await page.locator("#similar-warning").isHidden());
  assert.equal(await page.locator("#whitelist-continue").count(), 1);
});

test("closing the warning bar hides it for that website in that tab", async () => {
  await resetWhitelist(["*.sharepoint.com"]);
  await gotoAndContinue(page, "heise.de");
  await page.locator(BAR).waitFor();
  await page.click("#close-warning-btn");
  await page.locator(BAR).waitFor({ state: "detached" });

  await gotoAllowed(page, "heise.de", "/other-page");
  assert.equal(await page.locator(BAR).count(), 0, "next page of the same website");

  await gotoAndContinue(page, "golem.de");
  await page.locator(BAR).waitFor();

  const secondTab = await app.newPage();
  await gotoAllowed(secondTab, "heise.de");
  await secondTab.locator(BAR).waitFor();
  await secondTab.close();
});

test("the bar of a suspicious website comes back on every page", async () => {
  await gotoAndContinue(page, "sharepoimt.com");
  await page.locator(BAR).waitFor();
  await page.click("#close-warning-btn");
  await gotoAllowed(page, "sharepoimt.com", "/next");
  await page.locator(BAR).waitFor();
});

test("the warning bar is slim by default and can be set to normal or off", async () => {
  await gotoAndContinue(page, "spiegel.de");
  const height = () => page.locator(BAR).evaluate((bar) => bar.getBoundingClientRect().height);
  await page.locator(BAR).waitFor();
  const slim = await height();
  assert.ok(slim <= 30, `slim bar is ${slim}px high`);
  const edge = await page.locator("#close-warning-btn").evaluate((button) => button.getBoundingClientRect().right);
  assert.ok(edge <= 1000, "close button is inside the window");

  const popup = await app.openPopup();
  await popup.selectOption("#warning-bar-size", "normal");
  await page.waitForFunction((slimHeight) => document.querySelector("#whitelist-warning-bar")?.getBoundingClientRect().height > slimHeight, slim);

  await popup.locator("#warning-bar-toggle + .slider").click();
  await page.locator(BAR).waitFor({ state: "detached" });
  await popup.locator("#warning-bar-toggle + .slider").click();
  await page.locator(BAR).waitFor();
  await popup.selectOption("#warning-bar-size", "slim");
  await popup.close();
});

test("popup and confirmation page follow the dark color scheme", async () => {
  const background = (target, selector) =>
    target.locator(selector).evaluate((element) => getComputedStyle(element).backgroundColor);
  const isDark = (color) => color.match(/\d+/g).slice(0, 3).every((part) => Number(part) < 80);

  const popup = await app.openPopup();
  assert.ok(!isDark(await background(popup, "body")), "light by default");
  await popup.emulateMedia({ colorScheme: "dark" });
  assert.ok(isDark(await background(popup, "body")));
  assert.ok(isDark(await background(popup, ".toggle-container")));
  await popup.close();

  await gotoBlocked(page, "unknown-shop.net");
  await page.emulateMedia({ colorScheme: "dark" });
  assert.ok(isDark(await background(page, "body")));
  assert.ok(isDark(await background(page, ".container")));
  await page.emulateMedia({ colorScheme: "light" });
});

test("the popup normalizes input, asks before adding a lookalike and cleans up", async () => {
  await resetWhitelist(["*.sharepoint.com", "a.example.com", "*.example.com", "keep.de"]);
  const popup = await app.openPopup();
  assert.ok(await popup.locator("#managed-section").isHidden());

  await popup.fill("#new-domain", "https://Kunde.Beispiel.org/sites/x");
  await popup.click("#add-domain");
  await popup.locator("#whitelist li", { hasText: "kunde.beispiel.org" }).waitFor();

  // Lookalike: declined, then confirmed
  let message = null;
  let accept = false;
  popup.on("dialog", (dialog) => {
    message = dialog.message();
    return accept ? dialog.accept() : dialog.dismiss();
  });
  await popup.fill("#new-domain", "sharepoimt.com");
  await popup.click("#add-domain");
  await settle(popup, 600);
  assert.match(message, /sharepoint\.com/);
  assert.equal(await popup.locator("#whitelist li", { hasText: "sharepoimt.com" }).count(), 0);
  accept = true;
  await popup.fill("#new-domain", "sharepoimt.com");
  await popup.click("#add-domain");
  await popup.locator("#whitelist li", { hasText: "sharepoimt.com" }).waitFor();

  // Entries covered by a wildcard
  assert.match(await popup.locator("#redundant-text").innerText(), /: 1$/);
  await popup.click("#redundant-clean");
  await popup.locator("#redundant-note").waitFor({ state: "hidden" });
  const entries = await app.evaluate(() => getUserWhitelist());
  assert.ok(!entries.includes("a.example.com"));
  assert.ok(entries.includes("*.example.com") && entries.includes("keep.de"));
  await popup.close();
});
