async function exportData() {
  // Only the user's own entries; the organization list lives in the policy
  const whitelist = await getUserWhitelist();
  const resultCountryBlock = await browserAPI.storage.sync.get([
    "blockedCountries",
  ]);
  const countryBlock = resultCountryBlock.blockedCountries || [];
  const dataStr = JSON.stringify({ whitelist, countryBlock }, null, 2);
  const dataUri =
    "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);

  const exportLink = document.createElement("a");
  exportLink.setAttribute("href", dataUri);
  exportLink.setAttribute(
    "download",
    "whitelist_domains_" + new Date().toISOString().split("T")[0] + ".json",
  );
  exportLink.click();
}

// Returns false if the entry looks like a trusted domain and the user does not
// confirm it. If the check itself fails, the entry is not imported.
async function confirmImportedEntry(entry) {
  let suspicion;
  try {
    const info = await browserAPI.runtime.sendMessage({
      action: "domainInfo",
      hostname: entry.replace(/^\*\./, ""),
    });
    suspicion = info && info.suspicion;
  } catch (e) {
    return false;
  }
  return !suspicion || confirm(t("confirmSuspicious", [entry, suspicion]));
}

function importData(event) {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();

  reader.onload = async function (e) {
    try {
      const importedData = JSON.parse(e.target.result);

      if (
        !importedData ||
        typeof importedData !== "object" ||
        !Array.isArray(importedData.whitelist) ||
        !Array.isArray(importedData.countryBlock)
      ) {
        alert(t("alertImportFormat"));
        return;
      }

      const result = await browserAPI.storage.sync.get(["blockedCountries"]);

      let whitelist = await getUserWhitelist();
      let countryBlock = result.blockedCountries || [];

      // Imported entries get the same lookalike check as entries added by
      // hand: an entry that resembles a trusted domain needs confirmation.
      const accepted = [];
      for (const raw of importedData.whitelist) {
        const entry = normalizeEntry(raw);
        if (!entry || whitelist.includes(entry) || accepted.includes(entry)) continue;
        if (await confirmImportedEntry(entry)) accepted.push(entry);
      }
      whitelist = normalizeList([...whitelist, ...accepted]);

      // Add unique countries from imported countryBlock
      importedData.countryBlock.forEach(function (country) {
        if (typeof country === "string" && !countryBlock.includes(country)) {
          countryBlock.push(country);
        }
      });

      await setUserWhitelist(whitelist);
      await browserAPI.storage.sync.set({ blockedCountries: countryBlock });

      loadWhitelist();
      loadBlockedCountries();

      alert(
        t("alertImportDone", [
          String(accepted.length),
          String(importedData.countryBlock.length),
        ]),
      );
    } catch (error) {
      alert(t("alertImportError", [error.message]));
    }
  };

  reader.readAsText(file);
  // Reset the file input so the same file can be imported again if needed
  event.target.value = null;
}
