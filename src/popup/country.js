function loadCountries() {
  const countrySelect = document.getElementById("country-select");

  // Fetch countries from JSON
  fetch("countries.json")
    .then((response) => response.json())
    .then((data) => {
      // Sort countries alphabetically by their localized name
      const sortedCountries = data
        .map((country) => ({
          country,
          label: countryDisplayName(country.code, country.name),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      // Populate dropdown with sorted countries
      sortedCountries.forEach(({ country, label }) => {
        const option = document.createElement("option");
        option.value = JSON.stringify(country);
        option.textContent = label;
        countrySelect.appendChild(option);
      });
    })
    .catch((error) => {
      console.error("Error loading countries:", error);

      // Fallback to a basic list if JSON loading fails
      const fallbackCountries = [
        { code: "US", name: "United States" },
        { code: "RU", name: "Russia" },
        { code: "CN", name: "China" },
      ].sort((a, b) => a.name.localeCompare(b.name));

      fallbackCountries.forEach((country) => {
        const option = document.createElement("option");
        option.value = JSON.stringify(country);
        option.textContent = country.name;
        countrySelect.appendChild(option);
      });
    });
}

async function blockCountry(country) {
  const countrySelect = document.getElementById("country-select");

  const result = await browserAPI.storage.sync.get(["blockedCountries"]);
  const blockedCountries = result.blockedCountries || [];
  if (!blockedCountries.includes(country)) {
    blockedCountries.push(country);
    await browserAPI.storage.sync.set({ blockedCountries });
    loadBlockedCountries();
    countrySelect.value = ""; // Reset selection
  }
}

async function removeCountry(coutryCode) {
  const result = await browserAPI.storage.sync.get(["blockedCountries"]);
  const blockedCountries = result.blockedCountries || [];
  const updatedCountries = blockedCountries.filter(
    (c) => JSON.parse(c).code !== coutryCode,
  );

  await browserAPI.storage.sync.set({
    blockedCountries: updatedCountries,
  });
  loadBlockedCountries();
}

let countryNames = null;

async function getCountryName(code) {
  if (!countryNames) {
    countryNames = {};
    try {
      const data = await (await fetch("countries.json")).json();
      data.forEach((country) => {
        countryNames[country.code] = country.name;
      });
    } catch (error) {
      // Fall back to showing the country code
    }
  }
  return countryDisplayName(code, countryNames[code]);
}

function appendCountry(listElement, name, onRemove) {
  const li = document.createElement("li");

  const countryEntry = document.createElement("div");
  countryEntry.className = "domain-entry";
  countryEntry.appendChild(document.createTextNode(name));
  li.appendChild(countryEntry);

  if (onRemove) {
    const removeButton = document.createElement("button");
    removeButton.textContent = t("remove");
    removeButton.className = "remove-btn";
    removeButton.addEventListener("click", onRemove);
    li.appendChild(removeButton);
  } else {
    const badge = document.createElement("span");
    badge.className = "managed-badge";
    badge.textContent = t("badgeManaged");
    li.appendChild(badge);
  }

  listElement.appendChild(li);
}

async function loadBlockedCountries() {
  const settings = await loadSettings();
  const managedNames = await Promise.all(
    settings.managedBlockedCountries.map(getCountryName),
  );
  const blockedCountriesElement = document.getElementById("blocked-countries");
  blockedCountriesElement.textContent = "";

  if (
    settings.managedBlockedCountries.length === 0 &&
    settings.userBlockedCountries.length === 0
  ) {
    const empty = document.createElement("li");
    empty.className = "empty-list";
    empty.textContent = t("emptyCountries");
    blockedCountriesElement.appendChild(empty);
    return;
  }

  // Countries blocked by the organization cannot be removed
  managedNames.forEach((name) => appendCountry(blockedCountriesElement, name));

  settings.userBlockedCountries
    .filter((country) => !settings.managedBlockedCountries.includes(country.code))
    .forEach((country) => {
      appendCountry(
        blockedCountriesElement,
        countryDisplayName(country.code, country.name),
        () => removeCountry(country.code),
      );
    });
}
