const test = require("node:test");
const assert = require("node:assert/strict");
const { loadExtension } = require("./load");

// Minimal evaluation of the rule features the extension uses, to check which
// main-frame URLs the browser would let through.
function allowed(rules, url) {
  const host = new URL(url).hostname;
  const matches = (rule) => {
    const c = rule.condition;
    if (c.regexFilter) return new RegExp(c.regexFilter).test(url);
    if (c.urlFilter) return url.startsWith(c.urlFilter.replace(/^\|/, ""));
    if (c.requestDomains) return c.requestDomains.some((d) => host === d || host.endsWith(`.${d}`));
    return false;
  };
  const hits = rules.filter(matches).sort((a, b) => b.priority - a.priority);
  return !hits.length || hits[0].action.type === "allow";
}

test("rules let whitelisted pages through and block everything else", () => {
  const ext = loadExtension();
  const rules = ext.buildNavigationRules(["*.sharepoint.com", "intranet.example", "127.0.0.1"]);
  const ids = rules.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length, "rule ids are unique");

  for (const url of [
    "https://sharepoint.com/",
    "https://firma.sharepoint.com/sites/x",
    "https://intranet.example/start?a=1",
    "http://intranet.example:8080/",
    "http://127.0.0.1/",
  ]) {
    assert.ok(allowed(rules, url), url);
  }
  for (const url of [
    "https://sharepoint.com.evil.net/",
    "https://evilsharepoint.com/",
    "https://sub.intranet.example/",
    "https://intranet.example.evil.net/",
    "https://evil.net/?next=https://intranet.example/",
  ]) {
    assert.ok(!allowed(rules, url), url);
  }
});

test("the rules follow the whitelist and the preemptive-check setting", async () => {
  const on = loadExtension({ sync: { whitelist: ["*.example.com"] } });
  await on.syncNavigationRules();
  const rules = await on.chrome.declarativeNetRequest.getDynamicRules();
  assert.ok(allowed(rules, "https://www.example.com/"));
  assert.ok(!allowed(rules, "https://other.test/"));

  const off = loadExtension({ sync: { whitelist: ["*.example.com"], enablePreemptiveChecks: false } });
  await off.syncNavigationRules();
  assert.deepEqual([...(await off.chrome.declarativeNetRequest.getDynamicRules())], []);
});

test("continuing allows the domain for the session before the page is requested", async () => {
  const ext = loadExtension();
  const sessionRulesAtNavigation = [];
  ext.chrome.tabs.update = async () => {
    sessionRulesAtNavigation.push(...(await ext.chrome.declarativeNetRequest.getSessionRules()));
  };
  const sender = { id: "test", url: "chrome-extension://test/confirmation.html?x", tab: { id: 4 } };
  await ext.handleMessage({ action: "continueNavigation", url: "https://shop.test/cart" }, sender);
  assert.ok(allowed(sessionRulesAtNavigation, "https://shop.test/cart"));
  assert.ok(!allowed(sessionRulesAtNavigation.concat(ext.buildNavigationRules([])), "https://other.test/"));
});
