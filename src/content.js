// common.js is loaded before this file (see manifest).
let warningBar = null;

// The page is moved down by the height of the bar, so the bar does not cover
// the top of the page. The previous inline value is restored afterwards.
let savedPageMargin = null;
let barResizeObserver = null;

function reserveSpaceForBar(bar) {
  const html = document.documentElement;
  if (savedPageMargin === null) {
    savedPageMargin = {
      value: html.style.getPropertyValue("margin-top"),
      priority: html.style.getPropertyPriority("margin-top"),
    };
  }
  const apply = () => {
    if (!bar.isConnected) return;
    html.style.setProperty("margin-top", `${bar.offsetHeight}px`, "important");
  };
  apply();
  // The bar gets taller when its text wraps in a narrow window.
  barResizeObserver = new ResizeObserver(apply);
  barResizeObserver.observe(bar);
}

function releaseSpaceForBar() {
  if (barResizeObserver) {
    barResizeObserver.disconnect();
    barResizeObserver = null;
  }
  if (savedPageMargin === null) return;
  const html = document.documentElement;
  if (savedPageMargin.value) {
    html.style.setProperty("margin-top", savedPageMargin.value, savedPageMargin.priority);
  } else {
    html.style.removeProperty("margin-top");
  }
  savedPageMargin = null;
}

function removeWarningBar() {
  if (warningBar) {
    warningBar.remove();
    warningBar = null;
  }
  releaseSpaceForBar();
}

// The bar lives in a closed shadow root: page scripts can neither read its
// text nor reach its button. (The browser tests switch this to "open".)
const BAR_SHADOW_MODE = "closed";

const BAR_STYLES = `
  .bar {
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 20px;
    background-color: #ff5252;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    text-align: left;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  }
  .warning-text { flex-grow: 1; min-width: 0; }
  strong { font-weight: bold; }
  .hint { opacity: 0.9; }
  button {
    flex-shrink: 0;
    background: none;
    border: none;
    color: #fff;
    font-size: 20px;
    line-height: 1;
    padding: 0 5px;
    cursor: pointer;
  }
  .slim {
    padding: 2px 10px;
    font-size: 12px;
    line-height: 1.4;
    gap: 6px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }
  .slim .warning-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .slim button { font-size: 15px; padding: 0 3px; }
`;

async function createWarningBar(domain, allowUserWhitelist, homograph, size) {
  removeWarningBar();

  // The host element is all the page can see.
  const host = document.createElement("div");
  host.id = "whitelist-warning-bar";
  warningBar = host;
  const root = host.attachShadow({ mode: BAR_SHADOW_MODE });

  const style = document.createElement("style");
  style.textContent = BAR_STYLES;
  const bar = document.createElement("div");
  bar.className = size === "slim" ? "bar slim" : "bar";
  root.append(style, bar);

  const text = document.createElement("span");
  text.className = "warning-text";
  const strong = document.createElement("strong");
  strong.textContent = domain;
  text.append(t("barBefore"), strong, t("barAfter"));
  if (homograph) {
    const alert = document.createElement("strong");
    alert.textContent = homograph.imitates
      ? t("barHomographImitates", [homograph.imitates])
      : t("barHomograph");
    text.appendChild(alert);
  }
  bar.appendChild(text);

  let info = null;
  try {
    info = await browserAPI.runtime.sendMessage({
      action: "domainInfo",
      hostname: domain,
    });
  } catch (e) {
    // Extension was reloaded; show the bar without the extras.
  }

  if (!homograph && info && info.similarTo) {
    const alert = document.createElement("strong");
    alert.textContent = t("barSimilar", [info.similarTo]);
    text.appendChild(alert);
  }

  const suspicious = Boolean(homograph || (info && info.similarTo));

  // The user closed the bar for this website in this tab. Suspicious
  // domains show it again on every page.
  if (info && info.barDismissed && !suspicious) {
    if (warningBar === host) warningBar = null;
    return;
  }

  // Whitelisting happens only in the extension's own pages, which a website
  // cannot reach. The bar just points there.
  if (allowUserWhitelist && !suspicious) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = ` · ${t("barHint")}`;
    text.appendChild(hint);
  }

  const closeButton = document.createElement("button");
  closeButton.id = "close-warning-btn";
  closeButton.textContent = "×";
  closeButton.title = t("barClose");
  closeButton.addEventListener("click", () => {
    removeWarningBar();
    browserAPI.runtime.sendMessage({ action: "dismissBar" }).catch(() => {});
  });
  bar.appendChild(closeButton);

  // A newer check may have replaced or dismissed this bar in the meantime.
  if (warningBar === host && document.body) {
    document.body.insertBefore(host, document.body.firstChild);
    reserveSpaceForBar(host);
  }
}

// ---------------------------------------------------------------------------
// Sign-in guard: warns when the user types a company e-mail address (or one
// of their own sign-in names) into a field on a non-whitelisted page.
// ---------------------------------------------------------------------------
let protectedLogins = [];
let protectedEmailDomains = [];
let loginWarning = null;
let loginWarningField = null;
const markedFields = new Set();

function isTextField(element) {
  if (!(element instanceof HTMLInputElement)) {
    return element instanceof HTMLTextAreaElement;
  }
  return ["text", "email", "search", "tel", "url", ""].includes(
    (element.getAttribute("type") || "").toLowerCase(),
  );
}

function markField(field) {
  if (markedFields.has(field)) return;
  markedFields.add(field);
  field.style.setProperty("outline", "3px solid #d50000", "important");
  field.style.setProperty("outline-offset", "1px", "important");
  field.style.setProperty("background-color", "#ffebee", "important");
  field.style.setProperty("color", "#000", "important");
}

function unmarkField(field) {
  if (!markedFields.delete(field)) return;
  for (const property of ["outline", "outline-offset", "background-color", "color"]) {
    field.style.removeProperty(property);
  }
}

function positionLoginWarning() {
  if (!loginWarning || !loginWarningField) return;
  if (!loginWarningField.isConnected) {
    hideLoginWarning();
    return;
  }
  const rect = loginWarningField.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 16);
  loginWarning.style.setProperty("width", `${width}px`, "important");

  // Prefer a spot beside or above the field so the fields below stay visible
  const height = loginWarning.offsetHeight;
  let left;
  let top;
  if (rect.right + 10 + width <= window.innerWidth - 8) {
    left = rect.right + 10;
    top = rect.top;
  } else {
    left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    top = rect.top - height - 6 >= 0 ? rect.top - height - 6 : rect.bottom + 6;
  }
  loginWarning.style.setProperty("left", `${left + window.scrollX}px`, "important");
  loginWarning.style.setProperty("top", `${top + window.scrollY}px`, "important");
}

function showLoginWarning(field) {
  if (!loginWarning) {
    loginWarning = document.createElement("div");
    loginWarning.id = "whitelist-login-warning";
    loginWarning.setAttribute("role", "alert");
    const title = document.createElement("strong");
    title.textContent = t("loginWarningTitle");
    const text = document.createElement("span");
    text.textContent = t("loginWarningText", [getPageDomain()]);
    loginWarning.append(title, text);
  }
  loginWarningField = field;
  if (!loginWarning.isConnected) document.documentElement.appendChild(loginWarning);
  positionLoginWarning();
}

function hideLoginWarning() {
  if (loginWarning) loginWarning.remove();
  loginWarningField = null;
}

function clearLoginGuard() {
  [...markedFields].forEach(unmarkField);
  hideLoginWarning();
}

// True for "name@example.com" if example.com (or a parent of the address's
// domain) is one of the organization's e-mail domains.
function isCompanyEmail(value) {
  const match = /^[^\s@]+@([^\s@]+)$/.exec(value);
  if (!match) return false;
  const domain = match[1].replace(/\.$/, "");
  return protectedEmailDomains.some(
    (company) => domain === company || domain.endsWith(`.${company}`),
  );
}

function isLoginGuardActive() {
  return protectedLogins.length > 0 || protectedEmailDomains.length > 0;
}

function checkField(field) {
  if (!isLoginGuardActive() || !isTextField(field)) return;
  const value = (field.value || "").trim().toLowerCase();

  if (value && (protectedLogins.includes(value) || isCompanyEmail(value))) {
    markField(field);
    showLoginWarning(field);
    // The password usually follows: mark those fields as well
    document.querySelectorAll('input[type="password"]').forEach(markField);
  } else if (markedFields.has(field)) {
    unmarkField(field);
    if (loginWarningField === field) {
      hideLoginWarning();
      document.querySelectorAll('input[type="password"]').forEach(unmarkField);
    }
  }
}

function onFieldEvent(event) {
  // composedPath reaches fields inside open shadow roots
  const field = event.composedPath ? event.composedPath()[0] : event.target;
  if (field && field.nodeType === Node.ELEMENT_NODE) checkField(field);
}

// Fields that were filled in by the browser or a password manager
function scanFields() {
  if (!isLoginGuardActive()) return;
  document.querySelectorAll("input, textarea").forEach(checkField);
}

document.addEventListener("input", onFieldEvent, true);
document.addEventListener("change", onFieldEvent, true);
document.addEventListener("focusin", onFieldEvent, true);
window.addEventListener("scroll", positionLoginWarning, true);
window.addEventListener("resize", positionLoginWarning);

// The website this page belongs to. about:blank and about:srcdoc pages,
// which a website can fill with its own content, count as that website.
function getPageDomain() {
  return getWebDomain(window.location.href) || getWebDomain(self.origin);
}

async function checkDomain() {
  const currentDomain = getPageDomain();
  if (!currentDomain) return;
  const settings = await loadSettings();

  if (isWhitelisted(currentDomain, settings.whitelist)) {
    removeWarningBar();
    protectedLogins = [];
    protectedEmailDomains = [];
    clearLoginGuard();
  } else {
    protectedLogins = settings.protectedLogins;
    protectedEmailDomains = settings.protectedEmailDomains;
    scanFields();
    setTimeout(scanFields, 1500);
    if (settings.enableWarningBar) {
      createWarningBar(
        currentDomain,
        settings.allowUserWhitelist,
        analyzeHomograph(currentDomain, settings.whitelist),
        settings.warningBarSize,
      );
    } else {
      removeWarningBar();
    }
  }
}

// Wait for the DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", checkDomain);
} else {
  checkDomain();
}

// React to whitelist changes made by the user or by organization policy
browserAPI.storage.onChanged.addListener((changes, areaName) => {
  if (settingsChanged(changes, areaName) && document.body) {
    checkDomain();
  }
});
