// Chromium loads the helpers here; Firefox lists common.js in its manifest.
if (typeof loadSettings === "undefined") {
  importScripts("common.js");
}

const EXTENSION_ORIGIN = browserAPI.runtime.getURL("");
const CONFIRMATION_URL = browserAPI.runtime.getURL("confirmation.html");
const GEO_TIMEOUT_MS = 5000;

// Domains the user allowed "just for now". Kept in session storage because
// the service worker is stopped when idle and loses its variables.
async function getSessionAllowedDomains() {
  const result = await browserAPI.storage.session.get(["sessionAllowedDomains"]);
  return result.sessionAllowedDomains || [];
}

async function allowDomainForSession(domain) {
  const domains = await getSessionAllowedDomains();
  if (domain && !domains.includes(domain)) {
    domains.push(domain);
    await browserAPI.storage.session.set({ sessionAllowedDomains: domains });
  }
}

// Warning bars the user closed: { tabId: [domain, ...] }. A closed bar stays
// hidden for that website until the tab or the browser is closed.
async function getDismissedBars() {
  const result = await browserAPI.storage.session.get(["dismissedBars"]);
  return result.dismissedBars || {};
}

async function dismissBar(tabId, domain) {
  const dismissed = await getDismissedBars();
  const domains = dismissed[tabId] || [];
  if (domain && !domains.includes(domain)) {
    dismissed[tabId] = [...domains, domain];
    await browserAPI.storage.session.set({ dismissedBars: dismissed });
  }
}

browserAPI.tabs.onRemoved.addListener(async (tabId) => {
  const dismissed = await getDismissedBars();
  if (tabId in dismissed) {
    delete dismissed[tabId];
    await browserAPI.storage.session.set({ dismissedBars: dismissed });
  }
});

browserAPI.webNavigation.onCommitted.addListener((details) => {
  // Only check main frame navigations
  if (details.frameId === 0) {
    checkTabNavigation(details.tabId, details.url);
  }
});

async function fetchJson(url, headers) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function isIpAddress(hostname) {
  return /^\d+(\.\d+){3}$/.test(hostname) || hostname.includes(":");
}

// Resolves a hostname through Google Public DNS over HTTPS.
async function resolveIpAddress(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIpAddress(host)) return host;

  for (const [type, recordType] of [
    ["A", 1],
    ["AAAA", 28],
  ]) {
    const data = await fetchJson(
      `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`,
    );
    const record = (data.Answer || []).find((a) => a.type === recordType);
    if (record) return record.data;
  }
  throw new Error("Hostname could not be resolved");
}

// Each lookup returns { country, countryCode, region, city, ip, isp }.
const GEO_LOOKUPS = {
  // HTTPS, detailed
  async ipwhois(hostname) {
    const ip = await resolveIpAddress(hostname);
    const data = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (data.success === false) throw new Error(data.message || "Lookup failed");
    return {
      country: data.country,
      countryCode: data.country_code,
      region: data.region,
      city: data.city,
      ip: data.ip || ip,
      isp: data.connection && data.connection.isp,
    };
  },

  // HTTPS; has no country for some shared (anycast) addresses
  async geojs(hostname) {
    const ip = await resolveIpAddress(hostname);
    const data = await fetchJson(
      `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`,
    );
    return {
      country: data.country,
      countryCode: data.country_code,
      region: data.region,
      city: data.city,
      ip: data.ip || ip,
      isp: data.organization_name,
    };
  },

  // Unencrypted HTTP; the service resolves the domain itself
  async ipapi(hostname) {
    const data = await fetchJson(
      `http://ip-api.com/json/${encodeURIComponent(hostname)}`,
    );
    if (data.status === "fail") throw new Error(data.message || "Lookup failed");
    return {
      country: data.country,
      countryCode: data.countryCode,
      region: data.regionName,
      city: data.city,
      ip: data.query,
      isp: data.isp,
    };
  },
};

// Lookup results are kept for a few minutes, so the confirmation page and a
// following "continue" share one lookup instead of asking the services twice.
const GEO_CACHE_MS = 10 * 60 * 1000;
const GEO_CACHE_MAX = 200;
const geoCache = new Map();

function lookupGeo(provider, hostname) {
  const key = `${provider}|${hostname}`;
  const cached = geoCache.get(key);
  if (cached && Date.now() - cached.time < GEO_CACHE_MS) return cached.result;

  const result = GEO_LOOKUPS[provider](hostname);
  geoCache.set(key, { result, time: Date.now() });
  // Failed lookups are not kept, so the next check tries again.
  result.catch(() => geoCache.delete(key));
  if (geoCache.size > GEO_CACHE_MAX) {
    geoCache.delete(geoCache.keys().next().value);
  }
  return result;
}

async function checkIPGeolocation(url) {
  const settings = await loadSettings();
  if (!settings.enableCountryBlock) {
    return { status: "disabled" };
  }

  try {
    const data = await lookupGeo(settings.geoProvider, new URL(url).hostname);
    const countryCode =
      typeof data.countryCode === "string" ? data.countryCode.toUpperCase() : "";

    return {
      status: "enabled",
      ...data,
      countryCode,
      risk: settings.blockedCountryCodes.includes(countryCode) ? "High" : "Low",
    };
  } catch (error) {
    return { error: "Geolocation lookup failed" };
  }
}

// The country block is enforced here and not only by hiding buttons on the
// confirmation page: a click before the lookup has finished must not get
// through either. A failed lookup does not block (see README).
async function isCountryBlocked(url) {
  const geo = await checkIPGeolocation(url);
  return geo.status === "enabled" && geo.risk === "High";
}

// Registrable domain ("example.co.uk" for "www.example.co.uk"), used for the
// wildcard suggestion. Null when there is none (IP addresses, "localhost").
function getRootDomain(hostname) {
  const host = (hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host || !host.includes(".") || host.includes(":")) return null;
  if (/^\d+(\.\d+){3}$/.test(host)) return null;

  if (browserAPI.publicSuffix?.getDomain) {
    try {
      // allowUnknownSuffix keeps internal names like "wiki.corp.internal" usable
      return (
        browserAPI.publicSuffix.getDomain(host, { allowUnknownSuffix: true }) ||
        null
      );
    } catch (e) {
      return null;
    }
  }

  // Browsers without the publicSuffix API: last two labels.
  return host.split(".").slice(-2).join(".");
}

// ---------------------------------------------------------------------------
// Similarity check: does a domain resemble one on the whitelist?
// Everything is computed locally by comparing names; nothing is looked up.
// ---------------------------------------------------------------------------

// Number of edits (insert, delete, replace, swap neighbours) between a and b.
function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) d[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// Reduces a name to how it looks at a glance: "rn" reads like "m",
// "0" like "o", "1" and "i" like "l", "vv" like "w".
function visualForm(name) {
  return name
    .replace(/-/g, "")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/cl/g, "d")
    .replace(/0/g, "o")
    .replace(/[1i|]/g, "l")
    .replace(/5/g, "s");
}

// Splits "www.share-point.co.uk" into name "share-point" and ending "co.uk".
function splitRegistrableDomain(hostname) {
  const root = getRootDomain(hostname);
  if (!root) return null;
  const dot = root.indexOf(".");
  if (dot < 1) return null;
  return { root, name: root.slice(0, dot), ending: root.slice(dot + 1) };
}

// Returns the whitelisted domain that `hostname` resembles, or null.
function findSimilarWhitelisted(hostname, whitelist) {
  const host = (hostname || "").toLowerCase().replace(/\.$/, "");
  const candidate = splitRegistrableDomain(host);
  if (!candidate) return null;
  const candidateVisual = visualForm(candidate.name);

  let best = null;
  const seen = new Set();
  for (const entry of whitelist) {
    const trusted = splitRegistrableDomain(entry.replace(/^\*\./, ""));
    if (!trusted || seen.has(trusted.root)) continue;
    seen.add(trusted.root);

    // Same organization, e.g. another subdomain of a whitelisted domain
    if (trusted.root === candidate.root) return null;

    // "sharepoint.com.evil.net": the trusted domain is only a subdomain
    if (host.startsWith(`${trusted.root}.`) || host.includes(`.${trusted.root}.`)) {
      return trusted.root;
    }

    const name = trusted.name;
    if (name.length < 4) continue;

    let score = null;
    if (candidate.name === name) {
      score = 0; // same name, different ending (.co instead of .com)
    } else if (candidateVisual === visualForm(name)) {
      score = 0; // "rnicrosoft", "amaz0n"
    } else if (
      name.length >= 6 &&
      candidate.name.length > name.length &&
      (candidate.name.split(/[-_0-9]+/).includes(name) ||
        candidate.name.startsWith(name) ||
        candidate.name.endsWith(name))
    ) {
      score = 1; // "sharepoint-login", "securesharepoint"
    } else if (
      name.length >= 5 && // short names differ by one letter too often
      Math.abs(candidate.name.length - name.length) <= 2
    ) {
      const allowed = name.length >= 10 ? 2 : 1;
      const distance = editDistance(candidate.name, name);
      if (distance <= allowed) score = distance; // typos
    }

    if (score !== null && (!best || score < best.score)) {
      best = { score, root: trusted.root };
    }
  }
  return best ? best.root : null;
}

// The whitelisted domain that `hostname` imitates (lookalike characters) or
// resembles (typos and similar tricks), or null if nothing is suspicious.
function findSuspicion(hostname, whitelist) {
  const homograph = analyzeHomograph(hostname, whitelist);
  if (homograph) return homograph.imitates || homograph.unicode;
  return findSimilarWhitelisted(hostname, whitelist);
}

async function checkTabNavigation(tabId, url) {
  // Only web pages are checked; browser, extension and file pages are not.
  if (!isHttpUrl(url)) return;

  const domain = getDomain(url);
  if (!domain) return;

  const settings = await loadSettings();
  if (!settings.enablePreemptiveChecks) return;
  if (isWhitelisted(domain, settings.whitelist)) return;
  if ((await getSessionAllowedDomains()).includes(domain)) return;

  browserAPI.tabs.update(tabId, {
    url: `${CONFIRMATION_URL}?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(url)}`,
  });
}

async function handleMessage(message, sender) {
  const fromExtensionPage =
    typeof sender.url === "string" && sender.url.startsWith(EXTENSION_ORIGIN);
  const fromConfirmation =
    fromExtensionPage && sender.url.startsWith(CONFIRMATION_URL) && sender.tab;

  switch (message.action) {
    case "domainInfo": {
      const settings = await loadSettings();
      return {
        rootDomain: getRootDomain(message.hostname),
        similarTo: findSimilarWhitelisted(message.hostname, settings.whitelist),
        suspicion: findSuspicion(message.hostname, settings.whitelist),
        barDismissed: Boolean(
          sender.tab &&
            ((await getDismissedBars())[sender.tab.id] || []).includes(
              message.hostname,
            ),
        ),
      };
    }

    case "dismissBar":
      // Only for the page's own domain, as reported by the browser
      if (sender.tab && isHttpUrl(sender.url)) {
        await dismissBar(sender.tab.id, getDomain(sender.url));
      }
      return {};

    case "confirmationInfo": {
      if (!fromConfirmation) return {};
      const settings = await loadSettings();
      return {
        rootDomain: getRootDomain(message.domain),
        similarTo: findSimilarWhitelisted(message.domain, settings.whitelist),
        allowUserWhitelist: settings.allowUserWhitelist,
      };
    }

    case "securityCheck":
      if (!fromConfirmation) return {};
      return { geo: await checkIPGeolocation(message.url) };

    case "continueNavigation":
      if (!fromConfirmation || !isHttpUrl(message.url)) return {};
      if (await isCountryBlocked(message.url)) return {};
      await allowDomainForSession(getDomain(message.url));
      await browserAPI.tabs.update(sender.tab.id, { url: message.url });
      return {};

    case "whitelistAndContinue": {
      if (!fromConfirmation || !isHttpUrl(message.url)) return {};
      const settings = await loadSettings();
      const entry = normalizeEntry(message.domain);
      // The entry must cover the page that is being opened.
      // Suspicious domains cannot be whitelisted from the confirmation page.
      if (
        settings.allowUserWhitelist &&
        entry &&
        isWhitelisted(getDomain(message.url), [entry]) &&
        !findSuspicion(getDomain(message.url), settings.whitelist) &&
        !(await isCountryBlocked(message.url))
      ) {
        await addToUserWhitelist(entry);
        await browserAPI.tabs.update(sender.tab.id, { url: message.url });
      }
      return {};
    }

    case "exitNavigation":
      if (fromConfirmation) await browserAPI.tabs.remove(sender.tab.id);
      return {};

    case "togglePreemptiveChecks":
    case "toggleCountryBlock":
    case "toggleWarningBar": {
      if (!fromExtensionPage) return {};
      const key = {
        togglePreemptiveChecks: "enablePreemptiveChecks",
        toggleCountryBlock: "enableCountryBlock",
        toggleWarningBar: "enableWarningBar",
      }[message.action];
      const settings = await loadSettings();
      if (!settings.locked[key]) {
        await browserAPI.storage.sync.set({ [key]: Boolean(message.enabled) });
      }
      return {};
    }

    default:
      return {};
  }
}

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || sender.id !== browserAPI.runtime.id) return false;
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }));
  return true;
});
