// common.js is loaded before this file (see popup.html).

document.addEventListener("DOMContentLoaded", function () {
  localizePage();

  // Load and display whitelist
  loadWhitelist();

  // Load toggle state
  loadToggleState();

  // Add domain button
  document.getElementById("add-domain").addEventListener("click", function () {
    addDomain();
  });

  // Remove entries that are covered by other entries
  document
    .getElementById("redundant-clean")
    .addEventListener("click", function () {
      cleanUpRedundantEntries();
    });

  // Current website and its whitelisting options
  loadCurrentPage();

  // Enter key in input field
  document
    .getElementById("new-domain")
    .addEventListener("keyup", function (event) {
      if (event.key === "Enter") {
        addDomain();
      }
    });

  // Export data button
  document.getElementById("export-data").addEventListener("click", function () {
    exportData();
  });

  // Import data button
  document.getElementById("import-data").addEventListener("click", function () {
    document.getElementById("import-file").click();
  });

  // Import file change
  document
    .getElementById("import-file")
    .addEventListener("change", function (event) {
      importData(event);
    });

  // Preemptive check toggle
  document
    .getElementById("preemptive-check-toggle")
    .addEventListener("change", function () {
      togglePreemptiveChecks(this.checked);
    });
  // CountryBlock check toggle
  document
    .getElementById("country-block-toggle")
    .addEventListener("change", function () {
      toggleCountryBlock(this.checked);
    });

  // Lookup service for country checks
  document
    .getElementById("geo-provider")
    .addEventListener("change", function () {
      browserAPI.storage.sync.set({ geoProvider: this.value });
    });

  // Warning bar toggle
  document
    .getElementById("warning-bar-toggle")
    .addEventListener("change", function () {
      browserAPI.runtime.sendMessage({
        action: "toggleWarningBar",
        enabled: this.checked,
      });
    });

  // Height of the warning bar
  document
    .getElementById("warning-bar-size")
    .addEventListener("change", function () {
      browserAPI.storage.sync.set({ warningBarSize: this.value });
    });

  // Load countries selector
  loadCountries();

  // Load blocked countries
  loadBlockedCountries();

  // Block country button
  document
    .getElementById("block-country")
    .addEventListener("click", async function () {
      const countrySelect = document.getElementById("country-select");
      const selectedCountry = countrySelect.value;
      if (selectedCountry) {
        blockCountry(selectedCountry);
      }
    });

  // Tab switching functionality
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      // Remove active class from all tabs and tab contents
      document
        .querySelectorAll(".tab")
        .forEach((t) => t.classList.remove("active"));
      document
        .querySelectorAll(".tab-content")
        .forEach((tc) => tc.classList.remove("active"));

      // Add active class to clicked tab and corresponding content
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab).classList.add("active");
    });
  });
});

async function loadToggleState() {
  const settings = await loadSettings();
  const toggles = [
    ["preemptive-check-toggle", "preemptive-managed", "enablePreemptiveChecks"],
    ["country-block-toggle", "country-managed", "enableCountryBlock"],
    ["warning-bar-toggle", "warning-bar-managed", "enableWarningBar"],
  ];
  for (const [toggleId, noteId, key] of toggles) {
    const toggle = document.getElementById(toggleId);
    toggle.checked = settings[key];
    toggle.disabled = settings.locked[key];
    document.getElementById(noteId).hidden = !settings.locked[key];
  }

  // Country checks switched off by the organization: hide the whole tab.
  const countryOff = settings.locked.enableCountryBlock && !settings.enableCountryBlock;
  const countryTab = document.querySelector('.tab[data-tab="country"]');
  countryTab.hidden = countryOff;
  if (countryOff && countryTab.classList.contains("active")) {
    document.querySelector('.tab[data-tab="domains"]').click();
  }

  const barSize = document.getElementById("warning-bar-size");
  barSize.value = settings.warningBarSize;
  barSize.disabled = settings.locked.warningBarSize;

  const provider = document.getElementById("geo-provider");
  provider.value = settings.geoProvider;
  provider.disabled = settings.locked.geoProvider;
  document.getElementById("geo-provider-managed").hidden =
    !settings.locked.geoProvider;
  document.getElementById("geo-provider-info").textContent = t(
    `geoProviderInfo_${settings.geoProvider}`,
  );
}

function togglePreemptiveChecks(enabled) {
  browserAPI.runtime.sendMessage({
    action: "togglePreemptiveChecks",
    enabled: enabled,
  });
}

function toggleCountryBlock(enabled) {
  browserAPI.runtime.sendMessage({
    action: "toggleCountryBlock",
    enabled: enabled,
  });
}

// Keep the popup in sync with policy and storage changes
browserAPI.storage.onChanged.addListener((changes, areaName) => {
  if (settingsChanged(changes, areaName)) {
    loadToggleState();
    loadWhitelist();
    loadCurrentPage();
    loadBlockedCountries();
  }
});
