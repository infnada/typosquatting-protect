// Use the appropriate API based on browser environment
const browserAPI = typeof browser !== "undefined" ? browser : chrome;

document.addEventListener("DOMContentLoaded", function () {
  // Load and display whitelist
  loadWhitelist();

  // Load toggle state
  loadToggleState();

  // Add domain button
  document.getElementById("add-domain").addEventListener("click", function () {
    addDomain();
  });

  // Add current domain button
  document.getElementById("add-current").addEventListener("click", function () {
    addCurrentDomain();
  });

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
  const result = await browserAPI.storage.sync.get([
    "enablePreemptiveChecks",
    "enableCountryBlock",
  ]);
  document.getElementById("preemptive-check-toggle").checked =
    result.enablePreemptiveChecks === undefined
      ? true
      : result.enablePreemptiveChecks;
  document.getElementById("country-block-toggle").checked =
    result.enableCountryBlock === undefined ? true : result.enableCountryBlock;
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
