// common.js is loaded before this file (see confirmation.html).
document.addEventListener("DOMContentLoaded", async function () {
  localizePage();

  const urlParams = new URLSearchParams(window.location.search);
  const domain = urlParams.get("domain");
  const url = urlParams.get("url");

  document.getElementById("domain-name").textContent = domain;

  const whitelistButton = document.getElementById("whitelist-continue");
  const wildcardButton = document.getElementById("wildcard-continue");
  const continueButton = document.getElementById("just-continue");
  let wildcardDomain = null;

  whitelistButton.addEventListener("click", function () {
    browserAPI.runtime.sendMessage({
      action: "whitelistAndContinue",
      domain: domain,
      url: url,
    });
  });

  wildcardButton.addEventListener("click", function () {
    if (!wildcardDomain) return;
    browserAPI.runtime.sendMessage({
      action: "whitelistAndContinue",
      domain: wildcardDomain,
      url: url,
    });
  });

  continueButton.addEventListener("click", function () {
    browserAPI.runtime.sendMessage({
      action: "continueNavigation",
      url: url,
    });
  });

  document.getElementById("exit-page").addEventListener("click", function () {
    browserAPI.runtime.sendMessage({ action: "exitNavigation" });
  });

  // Lookalike characters and the organization's note
  const settings = await loadSettings();
  const homograph = analyzeHomograph(domain, settings.whitelist);
  renderHomograph(homograph);
  if (settings.noticeText) {
    const notice = document.getElementById("org-notice");
    const heading = document.createElement("strong");
    heading.textContent = t("noticeHeading");
    notice.append(heading, settings.noticeText);
    notice.hidden = false;
  }

  // Whitelisting options depend on the organization policy
  const info = await browserAPI.runtime.sendMessage({
    action: "confirmationInfo",
    domain: domain,
  });
  if (!homograph && info && info.similarTo) {
    const box = document.getElementById("similar-warning");
    const heading = document.createElement("strong");
    heading.textContent = `⚠️ ${t("similarTitle")}`;
    box.appendChild(heading);
    addParagraph(box, (p) => {
      p.textContent = t("similarText", [info.similarTo]);
    });
    box.hidden = false;
  }

  const suspicious = Boolean(homograph || (info && info.similarTo));

  if (suspicious) {
    // A domain that looks like a trusted one cannot be whitelisted here
    whitelistButton.remove();
    wildcardButton.remove();
    document.getElementById("suspicion-note").hidden = false;
  } else if (info && info.allowUserWhitelist === false) {
    whitelistButton.remove();
    wildcardButton.remove();
    document.getElementById("managed-note").hidden = false;
  } else if (info && info.rootDomain) {
    wildcardDomain = `*.${info.rootDomain}`;
    wildcardButton.textContent = t("confirmWildcard", [wildcardDomain]);
  } else {
    wildcardButton.remove();
  }

  // Geolocation details
  const response = await browserAPI.runtime.sendMessage({
    action: "securityCheck",
    url: url,
  });
  renderGeo(response && response.geo);
  // Marks the page as complete (used by the browser tests).
  document.body.dataset.ready = "true";

  function addParagraph(parent, build) {
    const p = document.createElement("p");
    build(p);
    parent.appendChild(p);
  }

  function renderHomograph(finding) {
    if (!finding) return;
    const box = document.getElementById("homograph-warning");

    const heading = document.createElement("strong");
    heading.textContent = `⚠️ ${t("homographTitle")}`;
    box.appendChild(heading);

    const reasons = [];
    if (finding.imitates) {
      reasons.push(t("homographImitates", [finding.imitates]));
    } else if (finding.mixedScripts) {
      reasons.push(t("homographMixed"));
    } else {
      reasons.push(t("homographLookalike"));
    }
    reasons.push(`${t("homographShownAs")} ${finding.unicode}`);
    reasons.push(`${t("homographRealName")} ${domain}`);
    reasons.forEach((text) => addParagraph(box, (p) => (p.textContent = text)));

    box.hidden = false;
  }

  function renderGeo(geo) {
    const details = document.getElementById("security-details");
    details.textContent = "";
    if (!geo) return;

    // Country checks switched off: show nothing about them.
    if (geo.status === "disabled") return;

    if (geo.status !== "enabled") {
      addParagraph(details, (p) => {
        p.textContent = t("geoFailed");
      });
      return;
    }

    if (geo.risk === "High") {
      document.getElementById("icon").textContent = "❗";
      document.getElementById("title").textContent = t("geoBlockedTitle");
      addParagraph(details, (p) => {
        const strong = document.createElement("strong");
        strong.textContent = t("geoRiskHeading");
        p.append(
          strong,
          document.createElement("br"),
          t("geoRiskText"),
        );
      });
      wildcardButton.remove();
      continueButton.remove();
    }

    addParagraph(details, (p) => {
      const heading = document.createElement("strong");
      heading.textContent = t("geoHeading");
      p.appendChild(heading);
      const rows = [
        [
          t("geoCountry"),
          geo.countryCode
            ? countryDisplayName(geo.countryCode, geo.country)
            : geo.country,
        ],
        [t("geoRegion"), geo.region],
        [t("geoIp"), geo.ip],
        [t("geoIsp"), geo.isp],
      ];
      for (const [label, value] of rows) {
        // Some lookup services only return the country
        if (value === undefined && label !== t("geoCountry")) continue;
        p.append(document.createElement("br"), `${label}: ${value || t("unknown")}`);
      }
      const risk = document.createElement("strong");
      risk.textContent =
        geo.risk === "High"
          ? t("geoRiskHigh")
          : geo.risk === "Low"
            ? t("geoRiskLow")
            : t("unknown");
      p.append(document.createElement("br"), `${t("geoRisk")}: `, risk);
    });
  }
});
