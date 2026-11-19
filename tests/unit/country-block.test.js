const test = require("node:test");
const assert = require("node:assert/strict");
const { loadExtension } = require("./load");

const CONFIRMATION = { id: "test", url: "chrome-extension://test/confirmation.html?domain=x", tab: { id: 7 } };

// Country lookups through the ip-api provider; blocked.test is in Russia,
// every other host in Germany. `delay` holds the answer back.
function setup({ policy = {}, delay = 0 } = {}) {
  const lookups = [];
  const fetch = async (url) => {
    lookups.push(url);
    await new Promise((resolve) => setTimeout(resolve, delay));
    const host = decodeURIComponent(url.split("/").pop());
    const countryCode = host.endsWith("blocked.test") ? "RU" : "DE";
    return { ok: true, json: async () => ({ status: "success", countryCode, country: countryCode }) };
  };
  const ext = loadExtension({
    policy: { enableCountryBlock: true, blockedCountries: ["RU"], ...policy },
    sync: { geoProvider: "ipapi" },
    fetch,
  });
  const updates = [];
  ext.chrome.tabs.update = async (tabId, { url }) => updates.push(url);
  return { ext, updates, lookups };
}

test("continuing to a domain in a blocked country is refused by the service worker", async () => {
  const { ext, updates } = setup({ delay: 50 });
  // A click before the confirmation page has shown the result
  await ext.handleMessage({ action: "continueNavigation", url: "http://shop.blocked.test/" }, CONFIRMATION);
  await ext.handleMessage(
    { action: "whitelistAndContinue", domain: "shop.blocked.test", url: "http://shop.blocked.test/" },
    CONFIRMATION,
  );
  assert.deepEqual(updates, []);
  assert.deepEqual([...(await ext.getUserWhitelist())], []);
  const session = await ext.chrome.storage.session.get(["sessionAllowedDomains"]);
  assert.deepEqual(session.sessionAllowedDomains || [], []);
});

test("the block also holds when users may not whitelist domains", async () => {
  const { ext, updates } = setup({ policy: { allowUserWhitelist: false } });
  await ext.handleMessage({ action: "continueNavigation", url: "http://blocked.test/" }, CONFIRMATION);
  assert.deepEqual(updates, []);
});

test("domains in other countries can still be continued and whitelisted", async () => {
  const { ext, updates } = setup();
  await ext.handleMessage({ action: "continueNavigation", url: "http://shop.example/" }, CONFIRMATION);
  await ext.handleMessage(
    { action: "whitelistAndContinue", domain: "other.example", url: "http://other.example/" },
    CONFIRMATION,
  );
  assert.deepEqual(updates, ["http://shop.example/", "http://other.example/"]);
  assert.deepEqual([...(await ext.getUserWhitelist())], ["other.example"]);
});

test("the confirmation page and the following click share one lookup", async () => {
  const { ext, lookups } = setup({ delay: 20 });
  const shown = ext.handleMessage({ action: "securityCheck", url: "http://shop.example/" }, CONFIRMATION);
  await ext.handleMessage({ action: "continueNavigation", url: "http://shop.example/" }, CONFIRMATION);
  assert.equal((await shown).geo.risk, "Low");
  assert.equal(lookups.length, 1);
});
