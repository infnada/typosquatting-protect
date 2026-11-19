// Shared helpers for the service worker, the content script and the
// extension pages (popup, confirmation page).
const browserAPI = globalThis.browser ?? globalThis.chrome;

// Translated text for the browser's UI language (see _locales).
function t(key, substitutions) {
  return browserAPI.i18n.getMessage(key, substitutions) || key;
}

// Fills in elements marked with data-i18n (text) or data-i18n-placeholder.
function localizePage() {
  document.documentElement.lang = browserAPI.i18n.getUILanguage();
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
}

// Country name in the browser's language, e.g. "Deutschland" for "DE".
function countryDisplayName(code, fallback) {
  try {
    const names = new Intl.DisplayNames([browserAPI.i18n.getUILanguage()], {
      type: "region",
    });
    const name = names.of(String(code).toUpperCase());
    if (name && name !== code) return name;
  } catch (e) {
    // Unknown code or unsupported API
  }
  return fallback || code;
}

// storage.sync limits a single item to 8 KB, so the user whitelist is spread
// over "whitelist", "whitelist_1", "whitelist_2", ...
const WHITELIST_CHUNK_BYTES = 6000;

function isWhitelistKey(key) {
  return key === "whitelist" || /^whitelist_\d+$/.test(key);
}

function whitelistKeyIndex(key) {
  return key === "whitelist" ? 0 : parseInt(key.split("_")[1], 10);
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

// The website a URL belongs to: the hostname of http(s) URLs, and for blob:
// URLs the hostname of the page that created them
// (blob:https://example.com/... belongs to example.com). Empty for anything
// else, such as browser, extension or file pages.
function getWebDomain(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname;
    }
    if (parsed.protocol === "blob:" && isHttpUrl(parsed.origin)) {
      return new URL(parsed.origin).hostname;
    }
  } catch (e) {
    // Not a valid URL
  }
  return "";
}

// Turns user or admin input ("Example.com", "https://example.com/path",
// "*.example.com") into a canonical whitelist entry, or null if invalid.
function normalizeEntry(input) {
  if (typeof input !== "string") return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0];

  let wildcard = false;
  if (value.startsWith("*.")) {
    wildcard = true;
    value = value.substring(2);
  }
  if (!value || value.includes("*") || value.includes("@")) return null;

  let hostname;
  try {
    hostname = new URL(`http://${value}`).hostname;
  } catch (e) {
    return null;
  }
  hostname = hostname.replace(/\.$/, "");
  if (!hostname) return null;
  // "*.com" would whitelist every .com domain
  if (wildcard && !hostname.includes(".")) return null;

  return wildcard ? `*.${hostname}` : hostname;
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  for (const item of list) {
    const entry = normalizeEntry(item);
    if (entry && !result.includes(entry)) result.push(entry);
  }
  return result;
}

function isWhitelisted(domain, whitelist) {
  const host = (domain || "").toLowerCase().replace(/\.$/, "");
  if (!host) return false;

  for (const entry of whitelist) {
    if (entry === host) return true;
    if (entry.startsWith("*.")) {
      // "*.example.com" covers example.com and its subdomains, but not
      // lookalikes such as "evilexample.com".
      const base = entry.substring(2);
      if (host === base || host.endsWith(`.${base}`)) return true;
    }
  }
  return false;
}

// Decodes one punycode label body (the part after "xn--"), RFC 3492.
function punycodeDecode(input) {
  const base = 36;
  const tMin = 1;
  const tMax = 26;
  let n = 128;
  let i = 0;
  let bias = 72;
  const output = [];

  const basicEnd = Math.max(input.lastIndexOf("-"), 0);
  for (let j = 0; j < basicEnd; j++) output.push(input.charCodeAt(j));

  let index = basicEnd > 0 ? basicEnd + 1 : 0;
  while (index < input.length) {
    const oldI = i;
    let weight = 1;
    for (let k = base; ; k += base) {
      if (index >= input.length) throw new Error("Invalid punycode");
      const code = input.charCodeAt(index++);
      let digit = base;
      if (code >= 48 && code <= 57) digit = code - 22;
      else if (code >= 65 && code <= 90) digit = code - 65;
      else if (code >= 97 && code <= 122) digit = code - 97;
      if (digit >= base) throw new Error("Invalid punycode");
      i += digit * weight;
      const threshold = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < threshold) break;
      weight *= base - threshold;
    }

    const length = output.length + 1;
    let delta = oldI === 0 ? Math.floor((i - oldI) / 700) : (i - oldI) >> 1;
    delta += Math.floor(delta / length);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    bias = k + Math.floor(((base - tMin + 1) * delta) / (delta + 38));

    n += Math.floor(i / length);
    i %= length;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

// "xn--mller-kva.de" -> "müller.de"
function toUnicodeHostname(hostname) {
  return (hostname || "")
    .toLowerCase()
    .split(".")
    .map((label) => {
      if (!label.startsWith("xn--")) return label;
      try {
        return punycodeDecode(label.substring(4));
      } catch (e) {
        return label;
      }
    })
    .join(".");
}

// Letters from other alphabets that look like a Latin letter.
const CONFUSABLE_LETTERS = {
  // Cyrillic
  а: "a", с: "c", е: "e", о: "o", р: "p", х: "x", у: "y", і: "i", ј: "j",
  ѕ: "s", һ: "h", ԁ: "d", ԛ: "q", ԝ: "w", ӏ: "l", к: "k", м: "m", г: "r",
  ь: "b", п: "n", т: "t", в: "b", н: "h", ё: "e", ї: "i", ґ: "r",
  // Greek
  ο: "o", α: "a", ν: "v", ρ: "p", τ: "t", υ: "u", ι: "i", κ: "k", χ: "x",
  ε: "e", η: "n", ω: "w", β: "b", γ: "y",
  // Armenian
  ո: "n", ս: "u", օ: "o", հ: "h", ց: "g", ք: "p", ա: "w",
  // Latin letters that do not decompose
  ı: "i", ɑ: "a", ɡ: "g", ł: "l", ø: "o", đ: "d", ƅ: "b", ɩ: "i",
};

const LATIN_LETTER = /\p{Script=Latin}/u;
const OTHER_LOOKALIKE_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}]/u;

// What the label looks like when read as plain Latin letters.
function latinSkeleton(label) {
  return [...label.normalize("NFD").replace(/\p{M}/gu, "")]
    .map((char) => CONFUSABLE_LETTERS[char] || char)
    .join("");
}

// Detects domains that use lookalike characters from other alphabets
// (homograph attacks, e.g. a Cyrillic "а" in "аmazon.com").
// Returns null if nothing is suspicious, otherwise:
//   { unicode, imitates, mixedScripts, lookalikeScript }
function analyzeHomograph(hostname, whitelist) {
  const host = (hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host.includes("xn--")) return null;

  const unicode = toUnicodeHostname(host);
  const labels = unicode.split(".");
  let mixedScripts = false;
  let lookalikeScript = false;

  for (const label of labels) {
    if (/^[\x00-\x7f]*$/.test(label)) continue;
    const hasOther = OTHER_LOOKALIKE_SCRIPT.test(label);
    if (hasOther && LATIN_LETTER.test(label)) mixedScripts = true;
    // Written entirely in lookalikes, e.g. Cyrillic "аррӏе"
    if (hasOther && /^[a-z0-9-]+$/.test(latinSkeleton(label))) {
      lookalikeScript = true;
    }
  }

  // Reads like a whitelisted domain, but is a different one
  let imitates = null;
  const skeleton = labels.map(latinSkeleton).join(".");
  if (
    skeleton !== host &&
    /^[a-z0-9.-]+$/.test(skeleton) &&
    !isWhitelisted(host, whitelist) &&
    isWhitelisted(skeleton, whitelist)
  ) {
    imitates = skeleton;
  }

  if (!imitates && !mixedScripts && !lookalikeScript) return null;
  return { unicode, imitates, mixedScripts, lookalikeScript };
}

// User entries that are already covered by a wildcard entry or by the
// organization list and can be removed without changing anything.
function findRedundantEntries(userWhitelist, managedWhitelist) {
  return userWhitelist.filter((entry) => {
    const others = [
      ...managedWhitelist,
      ...userWhitelist.filter((other) => other !== entry),
    ];
    if (!entry.startsWith("*.")) return isWhitelisted(entry, others);

    const base = entry.substring(2);
    return others.some((other) => {
      if (!other.startsWith("*.")) return false;
      const otherBase = other.substring(2);
      return base === otherBase || base.endsWith(`.${otherBase}`);
    });
  });
}

function collectUserWhitelist(syncData) {
  const keys = Object.keys(syncData)
    .filter(isWhitelistKey)
    .sort((a, b) => whitelistKeyIndex(a) - whitelistKeyIndex(b));
  const raw = [];
  for (const key of keys) {
    if (Array.isArray(syncData[key])) raw.push(...syncData[key]);
  }
  return normalizeList(raw);
}

async function getUserWhitelist() {
  return collectUserWhitelist(await browserAPI.storage.sync.get(null));
}

async function setUserWhitelist(list) {
  const entries = normalizeList(list);
  const encoder = new TextEncoder();
  const chunks = [[]];
  let size = 2;
  for (const entry of entries) {
    const entrySize = encoder.encode(JSON.stringify(entry)).length + 1;
    if (size + entrySize > WHITELIST_CHUNK_BYTES && chunks.at(-1).length) {
      chunks.push([]);
      size = 2;
    }
    chunks.at(-1).push(entry);
    size += entrySize;
  }

  const data = {};
  chunks.forEach((chunk, index) => {
    data[index === 0 ? "whitelist" : `whitelist_${index}`] = chunk;
  });

  const existing = Object.keys(await browserAPI.storage.sync.get(null));
  await browserAPI.storage.sync.set(data);
  const stale = existing.filter((key) => isWhitelistKey(key) && !(key in data));
  if (stale.length) await browserAPI.storage.sync.remove(stale);
}

// Returns true if the entry was added, false if it was invalid or present.
async function addToUserWhitelist(input) {
  const entry = normalizeEntry(input);
  if (!entry) return false;
  const whitelist = await getUserWhitelist();
  if (whitelist.includes(entry)) return false;
  whitelist.push(entry);
  await setUserWhitelist(whitelist);
  return true;
}

async function removeFromUserWhitelist(entry) {
  const whitelist = await getUserWhitelist();
  await setUserWhitelist(whitelist.filter((item) => item !== entry));
}

// Settings an administrator rolled out via policy (GPO); empty if none.
//
// Right after the browser starts, storage.managed can take several seconds to
// answer. The last known policy is therefore cached, and used if the browser
// has not answered in time. Once the real answer arrives the cache is updated,
// which triggers a re-check through storage.onChanged.
const POLICY_CACHE_KEY = "managedPolicyCache";
const POLICY_WAIT_MS = 250;

async function getManagedPolicy() {
  let cached;
  try {
    cached = (await browserAPI.storage.local.get([POLICY_CACHE_KEY]))[
      POLICY_CACHE_KEY
    ];
  } catch (e) {
    // No cache available
  }

  const fresh = (async () => {
    let policy = {};
    try {
      policy = (await browserAPI.storage.managed.get(null)) || {};
    } catch (e) {
      // No policy support or no policy set
    }
    if (!cached || JSON.stringify(policy) !== JSON.stringify(cached)) {
      browserAPI.storage.local
        .set({ [POLICY_CACHE_KEY]: policy })
        .catch(() => {});
    }
    return policy;
  })();

  if (!cached) return fresh;
  return Promise.race([
    fresh,
    new Promise((resolve) => setTimeout(() => resolve(cached), POLICY_WAIT_MS)),
  ]);
}

function parseUserBlockedCountries(list) {
  const countries = [];
  for (const item of Array.isArray(list) ? list : []) {
    try {
      const country = JSON.parse(item);
      if (country && typeof country.code === "string") countries.push(country);
    } catch (e) {
      // Ignore malformed entries
    }
  }
  return countries;
}

// Services for the country lookup. The HTTPS ones resolve the domain through
// Google Public DNS (DNS over HTTPS) and then look up the IP address.
const GEO_PROVIDERS = ["ipwhois", "geojs", "ipapi"];
const DEFAULT_GEO_PROVIDER = "ipwhois";

// Heights of the warning bar
const WARNING_BAR_SIZES = ["slim", "normal"];
const DEFAULT_WARNING_BAR_SIZE = "slim";

// Effective settings: organization policy combined with the user's own.
async function loadSettings() {
  const [policy, syncData] = await Promise.all([
    getManagedPolicy(),
    browserAPI.storage.sync.get(null),
  ]);

  const managedWhitelist = normalizeList(policy.managedWhitelist);
  const allowUserWhitelist = policy.allowUserWhitelist !== false;
  const userWhitelist = collectUserWhitelist(syncData);

  const locked = {
    enablePreemptiveChecks: typeof policy.enablePreemptiveChecks === "boolean",
    enableCountryBlock: typeof policy.enableCountryBlock === "boolean",
    enableWarningBar: typeof policy.enableWarningBar === "boolean",
    geoProvider: GEO_PROVIDERS.includes(policy.geoProvider),
    warningBarSize: WARNING_BAR_SIZES.includes(policy.warningBarSize),
  };
  let warningBarSize = locked.warningBarSize
    ? policy.warningBarSize
    : syncData.warningBarSize;
  if (!WARNING_BAR_SIZES.includes(warningBarSize)) {
    warningBarSize = DEFAULT_WARNING_BAR_SIZE;
  }
  let geoProvider = locked.geoProvider
    ? policy.geoProvider
    : syncData.geoProvider;
  if (!GEO_PROVIDERS.includes(geoProvider)) geoProvider = DEFAULT_GEO_PROVIDER;

  const managedBlockedCountries = (
    Array.isArray(policy.blockedCountries) ? policy.blockedCountries : []
  )
    .filter((code) => typeof code === "string" && code.trim())
    .map((code) => code.trim().toUpperCase());
  const userBlockedCountries = parseUserBlockedCountries(
    syncData.blockedCountries,
  );

  // The user's own sign-in names (logon name, e-mail address), provided per
  // user by the organization. Typing one of them on a non-whitelisted page
  // triggers a warning. Compared locally, never sent anywhere.
  const protectedLogins = [
    ...new Set(
      (Array.isArray(policy.protectedLogins) ? policy.protectedLogins : [])
        .filter((login) => typeof login === "string")
        .map((login) => login.trim().toLowerCase())
        .filter((login) => login.length >= 3),
    ),
  ];

  // The organization's e-mail domains ("example.com"). Typing an address of
  // such a domain on a non-whitelisted page triggers the same warning.
  const protectedEmailDomains = [
    ...new Set(
      (Array.isArray(policy.protectedEmailDomains)
        ? policy.protectedEmailDomains
        : []
      )
        .filter((domain) => typeof domain === "string")
        .map((domain) => normalizeEntry(domain.trim().replace(/^.*@/, "")))
        .filter((domain) => domain && !domain.startsWith("*.")),
    ),
  ];

  return {
    protectedLogins,
    protectedEmailDomains,
    // Optional text from the organization, shown on the confirmation page
    noticeText:
      typeof policy.noticeText === "string"
        ? policy.noticeText.trim().slice(0, 1000)
        : "",
    managedWhitelist,
    userWhitelist,
    allowUserWhitelist,
    whitelist: allowUserWhitelist
      ? [...managedWhitelist, ...userWhitelist]
      : managedWhitelist,
    locked,
    enablePreemptiveChecks: locked.enablePreemptiveChecks
      ? policy.enablePreemptiveChecks
      : syncData.enablePreemptiveChecks !== false,
    enableCountryBlock: locked.enableCountryBlock
      ? policy.enableCountryBlock
      : syncData.enableCountryBlock !== false,
    enableWarningBar: locked.enableWarningBar
      ? policy.enableWarningBar
      : syncData.enableWarningBar !== false,
    warningBarSize,
    geoProvider,
    managedBlockedCountries,
    userBlockedCountries,
    blockedCountryCodes: [
      ...new Set([
        ...managedBlockedCountries,
        ...userBlockedCountries.map((country) => country.code.toUpperCase()),
      ]),
    ],
  };
}

// True if a storage.onChanged event may have altered the effective settings.
function settingsChanged(changes, areaName) {
  if (areaName === "managed") return true;
  if (areaName === "local") return POLICY_CACHE_KEY in changes;
  if (areaName !== "sync") return false;
  return Object.keys(changes).some(
    (key) =>
      isWhitelistKey(key) ||
      key === "enablePreemptiveChecks" ||
      key === "enableCountryBlock" ||
      key === "enableWarningBar" ||
      key === "warningBarSize" ||
      key === "geoProvider" ||
      key === "blockedCountries",
  );
}
