// Helpers for the browser tests: a local web server that answers for every
// hostname, a Chromium with the built extension loaded, and (where the
// system allows it) an organization policy for the extension.
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const BUILT_EXTENSION = path.join(ROOT, "dist", "chrome");

// A fixed public key gives the test copy of the extension a stable ID, which
// the policy file needs. The matching private key was discarded.
const TEST_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA04MfFYG/xyosEEtXH3tZg/+21JlN6WLKAsorHgG4YHT+mHr3fiOeC9BEfHkjXN9JYOTA15qk7VsuFlkvVfLozQV8MZfdssa0RiUmM10IkYIfIM8cjl0Y5HB9XFtCxfduo3mNJyfT/5nF/DMZdIOzg55FF8Ci3pGhYnyhpNvPlQple4wiIXk6rzIm9FDyTXBAk1ukpKkJni/MG5lkGxrkZlck+NKvqKgnkj486qj5q9cfFkB+n8WN7FdEHBQu2Y46hh1vhYYheNAC6tJDuYJGIJKcH3NZmJJ63cZQk1svp7ZkYmhoDVk44BgQsQeuFJKIwR7j+jiyd2blXpOX1qmg9QIDAQAB";
const EXTENSION_ID = "dbpabnanlllihmhhpdpijgoikmiaocih";

// Where Playwright's Chromium (Chrome for Testing) reads policies on Linux
const POLICY_DIR = "/etc/opt/chrome_for_testing/policies/managed";
const POLICY_FILE = path.join(POLICY_DIR, "domain-whitelist-protector-test.json");

function policySupported() {
  if (process.platform !== "linux") return false;
  try {
    fs.mkdirSync(POLICY_DIR, { recursive: true });
    fs.accessSync(POLICY_DIR, fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
}

const POLICY_SKIP_REASON = `needs write access to ${POLICY_DIR}`;

function writePolicy(policy) {
  fs.writeFileSync(
    POLICY_FILE,
    JSON.stringify({ "3rdparty": { extensions: { [EXTENSION_ID]: policy } } }),
  );
}

function removePolicy() {
  fs.rmSync(POLICY_FILE, { force: true });
}

// Answers for any hostname. "ip-api.com" returns sample geolocation data:
// hosts containing "blocked" are located in Russia, all others in Germany.
function startServer() {
  const server = http.createServer((request, response) => {
    const host = (request.headers.host || "").split(":")[0];

    if (host === "ip-api.com") {
      const target = decodeURIComponent(request.url.replace("/json/", ""));
      const blocked = target.includes("blocked");
      // Hosts with "slow" in the name answer late, to test the waiting state
      const delay = target.includes("slow") ? 1500 : 0;
      response.setHeader("content-type", "application/json");
      setTimeout(() => response.end(
        JSON.stringify({
          status: "success",
          country: blocked ? "Russia" : "Germany<img src=x>",
          countryCode: blocked ? "RU" : "DE",
          regionName: "Region<b>bold</b>",
          city: "City",
          query: "203.0.113.24",
          isp: "Example Hosting",
        }),
      ), delay);
      return;
    }

    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url.startsWith("/login")) {
      response.end(
        `<!doctype html><title>Sign in</title><body style="margin:120px 60px">
         <form><input id="user" type="email"><br><br><input id="pass" type="password"></form></body>`,
      );
      return;
    }
    response.end(`<!doctype html><title>${host}</title><body><h1>${host}</h1></body>`);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// Copy of the built extension with the fixed key
function prepareExtension(directory) {
  if (!fs.existsSync(path.join(BUILT_EXTENSION, "manifest.json"))) {
    throw new Error("Build the extension first: node scripts/build.js build");
  }
  fs.cpSync(BUILT_EXTENSION, directory, { recursive: true });
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.key = TEST_KEY;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  // The warning bar uses a closed shadow root; the tests need to look inside.
  const contentPath = path.join(directory, "content.js");
  const content = fs.readFileSync(contentPath, "utf8");
  const opened = content.replace('const BAR_SHADOW_MODE = "closed";', 'const BAR_SHADOW_MODE = "open";');
  if (opened === content) throw new Error("BAR_SHADOW_MODE not found in content.js");
  fs.writeFileSync(contentPath, opened);
}

// Starts the server and a browser with the extension. Options:
//   policy  organization policy for the extension (see policySupported)
//   sync    values for the extension's sync storage, set before the tests
//   locale  browser language, e.g. "de-DE"
async function launch({ policy = null, sync = null, locale = "en-US", deviceScaleFactor = 1 } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dwp-test-"));
  const extensionDir = path.join(tempDir, "extension");
  prepareExtension(extensionDir);

  if (policy) writePolicy(policy);
  else removePolicy();

  const server = await startServer();
  const language = locale.split("-")[0];
  const context = await chromium.launchPersistentContext(path.join(tempDir, "profile"), {
    channel: "chromium",
    headless: true,
    locale,
    viewport: { width: 1000, height: 800 },
    deviceScaleFactor,
    env: { ...process.env, LANGUAGE: language },
    args: [
      `--lang=${language}`,
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      // Every hostname resolves to the local test server
      `--host-resolver-rules=MAP * 127.0.0.1:${server.address().port}`,
      "--no-proxy-server",
    ],
  });

  const worker = async () =>
    context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));

  const app = {
    context,
    extensionId: EXTENSION_ID,
    worker,
    writePolicy,

    async newPage() {
      return context.newPage();
    },

    // Runs a function inside the extension's service worker
    async evaluate(fn, arg) {
      return (await worker()).evaluate(fn, arg);
    },

    // Makes the tab showing `page` the active tab and refreshes the popup's
    // "current page" box, as if the popup had been opened on that page.
    async showInPopup(popup, page) {
      const url = page.url();
      await (await worker()).evaluate(async (target) => {
        const [tab] = await chrome.tabs.query({ url: target.split("#")[0] });
        await chrome.tabs.update(tab.id, { active: true });
      }, url);
      await popup.evaluate(() => loadCurrentPage());
    },

    async openPopup() {
      const popup = await context.newPage();
      await popup.setViewportSize({ width: 430, height: 700 });
      await popup.goto(`chrome-extension://${EXTENSION_ID}/popup/popup.html`);
      await popup.locator("#whitelist li").first().waitFor({ state: "attached" });
      return popup;
    },

    async close() {
      await context.close();
      await new Promise((resolve) => server.close(resolve));
      removePolicy();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };

  const id = (await worker()).url().split("/")[2];
  if (id !== EXTENSION_ID) {
    await app.close();
    throw new Error(`Unexpected extension ID ${id}`);
  }

  // The lookup services are unreachable in tests except the local stand-in
  await app.evaluate(
    (values) => chrome.storage.sync.set(values),
    { geoProvider: "ipapi", ...(sync || {}) },
  );

  // The browser delivers the policy a few seconds after start; wait for it
  // so that the first check already sees it.
  await app.evaluate(() => chrome.storage.managed.get(null));
  return app;
}

function isConfirmationFor(page, host) {
  const url = new URL(page.url());
  return (
    url.protocol === "chrome-extension:" &&
    url.pathname === "/confirmation.html" &&
    url.searchParams.get("domain") === host
  );
}

// Opens a non-whitelisted host and waits for the confirmation page.
async function gotoBlocked(page, host, pathname = "/") {
  await page.goto(`http://${host}${pathname}`).catch(() => {});
  await page.waitForURL(() => isConfirmationFor(page, host), { timeout: 15000 });
  // Buttons are adjusted once the page has asked the extension for details
  await page.locator("body[data-ready]").waitFor({ state: "attached" });
}

// Opens a non-whitelisted host and chooses "Continue Without Whitelisting".
async function gotoAndContinue(page, host, pathname = "/") {
  await gotoBlocked(page, host, pathname);
  await page.click("#just-continue");
  await page.waitForURL(`http://${host}${pathname}`);
  await page.waitForLoadState("domcontentloaded");
}

// Opens a host that is expected to load without a confirmation page.
async function gotoAllowed(page, host, pathname = "/") {
  await page.goto(`http://${host}${pathname}`);
  await settle(page);
  if (page.url() !== `http://${host}${pathname}`) {
    throw new Error(`${host} was not allowed: ${page.url()}`);
  }
}

// Time for the extension to react when the expected result is "nothing".
function settle(page, ms = 1200) {
  return page.waitForTimeout(ms);
}

const BAR = "#whitelist-warning-bar";

// Text of the warning bar, which lives in the bar's shadow root
function barText(page) {
  return page.locator(`${BAR} .bar`).innerText();
}

module.exports = {
  barText,
  BAR,
  EXTENSION_ID,
  POLICY_SKIP_REASON,
  gotoAllowed,
  gotoAndContinue,
  gotoBlocked,
  launch,
  policySupported,
  settle,
};
