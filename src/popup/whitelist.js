function sortDomains(list) {
  return [...list].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function createBadge(className, label) {
  const badge = document.createElement("span");
  badge.className = className;
  badge.textContent = label;
  return badge;
}

function renderDomainList(element, domains, { emptyText, onRemove }) {
  element.textContent = "";

  if (domains.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-list";
    empty.textContent = emptyText;
    element.appendChild(empty);
    return;
  }

  sortDomains(domains).forEach(function (domain) {
    const li = document.createElement("li");

    const domainEntry = document.createElement("div");
    domainEntry.className = "domain-entry";
    domainEntry.appendChild(document.createTextNode(domain));
    if (domain.startsWith("*.")) {
      domainEntry.appendChild(createBadge("wildcard-badge", t("badgeWildcard")));
    }
    li.appendChild(domainEntry);

    if (onRemove) {
      const removeButton = document.createElement("button");
      removeButton.textContent = t("remove");
      removeButton.className = "remove-btn";
      removeButton.addEventListener("click", function () {
        onRemove(domain);
      });
      li.appendChild(removeButton);
    } else {
      li.appendChild(createBadge("managed-badge", t("badgeManaged")));
    }

    element.appendChild(li);
  });
}

async function loadWhitelist() {
  const settings = await loadSettings();

  // Domains rolled out by the organization: visible, but not editable
  document.getElementById("managed-section").hidden =
    settings.managedWhitelist.length === 0;
  renderDomainList(
    document.getElementById("managed-whitelist"),
    settings.managedWhitelist,
    { emptyText: "" },
  );

  document.getElementById("user-section").hidden = !settings.allowUserWhitelist;
  document.getElementById("user-whitelist-locked").hidden =
    settings.allowUserWhitelist;
  const redundant = settings.allowUserWhitelist
    ? findRedundantEntries(settings.userWhitelist, settings.managedWhitelist)
    : [];
  document.getElementById("redundant-note").hidden = redundant.length === 0;
  document.getElementById("redundant-text").textContent = t("redundantNote", [
    String(redundant.length),
  ]);

  renderDomainList(document.getElementById("whitelist"), settings.userWhitelist, {
    emptyText: t("emptyWhitelist"),
    onRemove: removeDomain,
  });
}

async function addEntry(input) {
  const entry = normalizeEntry(input);
  if (!entry) {
    alert(t("alertInvalidDomain"));
    return false;
  }

  // Adding a domain that looks like a trusted one needs explicit confirmation
  let suspicion = null;
  try {
    const info = await browserAPI.runtime.sendMessage({
      action: "domainInfo",
      hostname: entry.replace(/^\*\./, ""),
    });
    if (entry.startsWith("*.") && info && info.suffixWildcard) {
      alert(t("alertSuffixWildcard"));
      return false;
    }
    suspicion = info && info.suspicion;
  } catch (e) {
    // Background not reachable; add without the extra check
  }
  if (suspicion && !confirm(t("confirmSuspicious", [entry, suspicion]))) {
    return false;
  }
  if (!(await addToUserWhitelist(entry))) {
    alert(t("alertAlreadyListed"));
    return false;
  }
  loadWhitelist();
  return true;
}

async function addDomain() {
  const input = document.getElementById("new-domain");
  if (!input.value.trim()) {
    return;
  }
  await addEntry(input.value);
  input.value = "";
}

// Box at the top of the popup: the website in the current tab and whether
// it can be whitelisted. This replaces the buttons that used to sit in the
// warning bar, where the website itself could reach them.
async function loadCurrentPage() {
  const box = document.getElementById("current-page");
  const status = document.getElementById("current-status");
  const buttons = document.getElementById("current-buttons");

  const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
  const domain = tabs[0] ? getWebDomain(tabs[0].url) : "";
  if (!domain) {
    box.hidden = true;
    return;
  }

  const settings = await loadSettings();
  box.hidden = false;
  box.classList.remove("suspicious");
  document.getElementById("current-domain").textContent = domain;
  buttons.textContent = "";

  const showStatus = (text) => {
    status.textContent = text;
    status.hidden = false;
  };
  status.hidden = true;

  if (isWhitelisted(domain, settings.managedWhitelist)) {
    showStatus(t("currentManaged"));
    return;
  }
  if (settings.allowUserWhitelist && isWhitelisted(domain, settings.userWhitelist)) {
    showStatus(t("currentWhitelisted"));
    return;
  }
  if (!settings.allowUserWhitelist) {
    showStatus(t("userLocked"));
    return;
  }

  let info = null;
  try {
    info = await browserAPI.runtime.sendMessage({ action: "domainInfo", hostname: domain });
  } catch (e) {
    // Without the check, no one-click whitelisting
  }
  if (!info) {
    box.hidden = true;
    return;
  }
  if (info.suspicion) {
    box.classList.add("suspicious");
    showStatus(t("currentSuspicious", [info.suspicion]));
    return;
  }

  const addButton = (id, label, entry) => {
    const button = document.createElement("button");
    button.id = id;
    button.textContent = label;
    button.addEventListener("click", async () => {
      await addToUserWhitelist(entry);
      loadWhitelist();
      loadCurrentPage();
    });
    buttons.appendChild(button);
  };
  addButton("release-exact", t("releaseExact", [domain]), domain);
  if (info.rootDomain) {
    const wildcard = `*.${info.rootDomain}`;
    addButton("release-wildcard", t("releaseWildcard", [wildcard]), wildcard);
  }
}

// Removes entries that other entries already cover; the protection is unchanged
async function cleanUpRedundantEntries() {
  const settings = await loadSettings();
  const redundant = findRedundantEntries(
    settings.userWhitelist,
    settings.managedWhitelist,
  );
  await setUserWhitelist(
    settings.userWhitelist.filter((entry) => !redundant.includes(entry)),
  );
  loadWhitelist();
}

async function removeDomain(domain) {
  await removeFromUserWhitelist(domain);
  loadWhitelist();
}
