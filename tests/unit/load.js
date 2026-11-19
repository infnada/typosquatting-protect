// Loads the extension's scripts into an isolated context with a minimal
// stand-in for the browser APIs, so the logic can be tested with plain Node.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "..", "src");

// Stand-in for the browser's public suffix list
const MULTI_PART_ENDINGS = ["co.uk", "com.au"];
function getDomain(hostname) {
  const parts = hostname.split(".");
  const size = MULTI_PART_ENDINGS.includes(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.length >= size ? parts.slice(-size).join(".") : undefined;
}

function loadExtension({ policy = {}, sync = {}, fetch } = {}) {
  const listener = { addListener() {} };
  const area = (data) => ({
    async get(keys) {
      if (keys === null || keys === undefined) return { ...data };
      const result = {};
      for (const key of [].concat(keys)) {
        if (key in data) result[key] = data[key];
      }
      return result;
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of [].concat(keys)) delete data[key];
    },
  });

  const chrome = {
    runtime: {
      id: "test",
      getURL: (file) => `chrome-extension://test/${file}`,
      onMessage: listener,
    },
    i18n: { getMessage: () => "", getUILanguage: () => "en" },
    webNavigation: { onCommitted: listener },
    tabs: { onRemoved: listener },
    publicSuffix: { getDomain },
    storage: {
      sync: area(sync),
      local: area({}),
      session: area({}),
      managed: area(policy),
    },
  };

  const context = vm.createContext({
    chrome,
    URL,
    TextEncoder,
    Intl,
    AbortSignal,
    setTimeout,
    console,
    ...(fetch ? { fetch } : {}),
  });
  for (const file of ["common.js", "background.js"]) {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), "utf8"), context, {
      filename: file,
    });
  }

  // Top-level functions and constants of the scripts, by name
  return new Proxy(
    {},
    { get: (_, name) => vm.runInContext(String(name), context) },
  );
}

// "аmazon.de" -> "xn--mazon-3ve.de", as the browser reports hostnames
function toAscii(hostname) {
  return new URL(`http://${hostname}`).hostname;
}

module.exports = { loadExtension, toAscii };
