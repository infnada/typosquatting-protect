// Prepares a self-hosted enterprise rollout for Chrome and Edge:
//   - the extension folder to pack (with the update URL built in)
//   - update.xml for the internal web server
//   - Group Policy templates (ADMX/ADML) for the extension's settings
//   - a text file with the exact values to enter in the GPO
//
// Usage:
//   node scripts/enterprise.js --url <https://server/path> (--key <key.pem> | --id <extension id>)
//
// With --key, the key file is created on first use.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { validateSource, buildDirectories, CHROME_DIR, DIST_DIR } = require("./build");

const OUT_DIR = path.join(DIST_DIR, "enterprise");
const PACKAGE_NAME = "domain-whitelist-protector";
const ADMX_NAME = "DomainWhitelistProtector";

const BROWSERS = [
  {
    prefix: "Chrome",
    label: { en: "Google Chrome", de: "Google Chrome" },
    policyRoot: "Software\\Policies\\Google\\Chrome",
  },
  {
    prefix: "Edge",
    label: { en: "Microsoft Edge", de: "Microsoft Edge" },
    policyRoot: "Software\\Policies\\Microsoft\\Edge",
  },
];

// Neutral location that no browser reads. Administrators configure the
// settings once here; scripts/Sync-DwpPolicy.ps1 copies them to the Chrome
// and Edge locations of the same GPO. The path does not contain the extension
// ID, so these settings survive a change of the ID.
const GLOBAL_KEY = "Software\\Policies\\DomainWhitelistProtector\\Global";
const GLOBAL = {
  prefix: "Global",
  label: {
    en: "Global (copy to Chrome and Edge with Sync-DwpPolicy.ps1)",
    de: "Global (per Sync-DwpPolicy.ps1 nach Chrome und Edge übertragen)",
  },
  explain: {
    en: "Settings in this folder are not read by any browser. Configure the extension here once, then run scripts/Sync-DwpPolicy.ps1. The script replaces the extension settings in the Google Chrome and Microsoft Edge folders of the same GPO with these values.",
    de: "Kein Browser liest die Einstellungen in diesem Ordner. Die Erweiterung hier einmal konfigurieren und danach scripts/Sync-DwpPolicy.ps1 ausführen. Das Skript ersetzt die Einstellungen der Erweiterung in den Ordnern Google Chrome und Microsoft Edge derselben GPO durch diese Werte.",
  },
};

function policyKeyFor(target, extensionId) {
  return target === GLOBAL
    ? GLOBAL_KEY
    : `${target.policyRoot}\\3rdparty\\extensions\\${extensionId}\\policy`;
}

// name: policy name in managed_schema.json;
// type: "list", "boolean", "text" or "enum"
const POLICIES = [
  {
    name: "managedWhitelist",
    type: "list",
    en: {
      title: "Organization whitelist",
      listLabel: "Whitelisted domains",
      explain:
        "Domains that are always whitelisted for all users. Enter one domain per line.\n\nExamples:\n  example.com\n  *.sharepoint.com\n\nAn entry starting with *. covers the domain and all of its subdomains. Users see these entries in the extension but cannot remove them.",
    },
    de: {
      title: "Firmen-Whitelist",
      listLabel: "Erlaubte Domains",
      explain:
        "Domains, die für alle Benutzer immer erlaubt sind. Eine Domain pro Zeile eintragen.\n\nBeispiele:\n  example.com\n  *.sharepoint.com\n\nEin Eintrag, der mit *. beginnt, gilt für die Domain und alle ihre Subdomains. Benutzer sehen diese Einträge in der Erweiterung, können sie aber nicht entfernen.",
    },
  },
  {
    name: "allowUserWhitelist",
    type: "boolean",
    en: {
      title: "Allow users to whitelist their own domains",
      explain:
        "Enabled or not configured: users can add their own domains in addition to the organization whitelist.\n\nDisabled: only the organization whitelist applies. Users can still open other websites after confirming the warning, but cannot whitelist them.",
    },
    de: {
      title: "Benutzer dürfen eigene Domains erlauben",
      explain:
        "Aktiviert oder nicht konfiguriert: Benutzer können zusätzlich zur Firmen-Whitelist eigene Domains eintragen.\n\nDeaktiviert: Es gilt nur die Firmen-Whitelist. Benutzer können andere Webseiten nach Bestätigung der Warnung weiterhin öffnen, sie aber nicht dauerhaft erlauben.",
    },
  },
  {
    name: "enablePreemptiveChecks",
    type: "boolean",
    en: {
      title: "Force the confirmation page for non-whitelisted domains",
      explain:
        "Enabled: the confirmation page is always shown before a non-whitelisted domain loads, and users cannot turn it off.\n\nDisabled: the confirmation page is never shown; only the warning bar appears.\n\nNot configured: users decide.",
    },
    de: {
      title: "Bestätigungsseite für nicht erlaubte Domains erzwingen",
      explain:
        "Aktiviert: Vor dem Laden einer nicht erlaubten Domain erscheint immer die Bestätigungsseite; Benutzer können das nicht abschalten.\n\nDeaktiviert: Die Bestätigungsseite erscheint nie, nur die Warnleiste.\n\nNicht konfiguriert: Benutzer entscheiden selbst.",
    },
  },
  {
    name: "enableWarningBar",
    type: "boolean",
    en: {
      title: "Force the warning bar on non-whitelisted pages",
      explain:
        "Enabled: the red warning bar is always shown on non-whitelisted pages. Users can still close it for a website; it then stays hidden for that website until the tab is closed.\n\nDisabled: the warning bar is never shown. The confirmation page and the sign-in warning are not affected.\n\nNot configured: users decide.",
    },
    de: {
      title: "Warnleiste auf nicht erlaubten Seiten erzwingen",
      explain:
        "Aktiviert: Die rote Warnleiste erscheint immer auf nicht erlaubten Seiten. Benutzer können sie für eine Website schließen; sie bleibt dann für diese Website ausgeblendet, bis der Tab geschlossen wird.\n\nDeaktiviert: Die Warnleiste erscheint nie. Bestätigungsseite und Warnung bei Anmeldung sind davon nicht betroffen.\n\nNicht konfiguriert: Benutzer entscheiden selbst.",
    },
  },
  {
    name: "warningBarSize",
    type: "enum",
    options: ["slim", "normal"],
    en: {
      title: "Height of the warning bar",
      enumLabel: "Height",
      optionLabels: ["Slim (one small line)", "Normal"],
      explain:
        "Sets the height of the red warning bar on non-whitelisted pages; users cannot change it.\n\nNot configured: users decide (default: slim).",
    },
    de: {
      title: "Höhe der Warnleiste",
      enumLabel: "Höhe",
      optionLabels: ["Schmal (eine kleine Zeile)", "Normal"],
      explain:
        "Legt die Höhe der roten Warnleiste auf nicht erlaubten Seiten fest; Benutzer können sie nicht ändern.\n\nNicht konfiguriert: Benutzer entscheiden selbst (Standard: schmal).",
    },
  },
  {
    name: "enableCountryBlock",
    type: "boolean",
    en: {
      title: "Force country checks",
      explain:
        "Enabled: the country of non-whitelisted domains is always looked up through the selected lookup service.\n\nDisabled: no country lookups, no requests to lookup services.\n\nNot configured: users decide.",
    },
    de: {
      title: "Länderprüfung erzwingen",
      explain:
        "Aktiviert: Für nicht erlaubte Domains wird immer das Herkunftsland über den gewählten Abfragedienst abgefragt.\n\nDeaktiviert: Keine Länderabfrage, keine Anfragen an Abfragedienste.\n\nNicht konfiguriert: Benutzer entscheiden selbst.",
    },
  },
  {
    name: "protectedEmailDomains",
    type: "list",
    en: {
      title: "Company e-mail domains (sign-in warning)",
      listLabel: "E-mail domains",
      explain:
        "The e-mail domains of your organization, one per line, without the @ sign.\n\nExample:\n  example.com\n\nWhen a user types an e-mail address of one of these domains into a field on a non-whitelisted page, the field and the password fields on the page are marked red and a warning appears next to the field. The check happens in the browser; nothing is sent anywhere.\n\nSubdomains are included: example.com also covers name@mail.example.com.",
    },
    de: {
      title: "Firmen-Maildomains (Warnung bei Anmeldung)",
      listLabel: "Maildomains",
      explain:
        "Die Maildomains Ihrer Organisation, eine pro Zeile, ohne @-Zeichen.\n\nBeispiel:\n  example.com\n\nGibt ein Benutzer eine E-Mail-Adresse einer dieser Domains in ein Feld auf einer nicht erlaubten Seite ein, werden das Feld und die Passwortfelder der Seite rot markiert, und ein Hinweis erscheint neben dem Feld. Die Prüfung findet im Browser statt; es wird nichts gesendet.\n\nSubdomains sind eingeschlossen: example.com gilt auch für name@mail.example.com.",
    },
  },
  {
    name: "noticeText",
    type: "text",
    en: {
      title: "Note on the confirmation page",
      textLabel: "Text",
      explain:
        "A text shown to users on the confirmation page for non-whitelisted domains, for example whom to contact when in doubt.\n\nExample: If unsure, call the IT help desk on extension 123.",
    },
    de: {
      title: "Hinweistext auf der Bestätigungsseite",
      textLabel: "Text",
      explain:
        "Ein Text, der Benutzern auf der Bestätigungsseite für nicht erlaubte Domains angezeigt wird, zum Beispiel an wen sie sich im Zweifel wenden sollen.\n\nBeispiel: Im Zweifel bitte den IT-Helpdesk unter Durchwahl 123 anrufen.",
    },
  },
  {
    name: "geoProvider",
    type: "enum",
    options: ["ipwhois", "geojs", "ipapi"],
    en: {
      title: "Lookup service for country checks",
      enumLabel: "Service",
      optionLabels: [
        "ipwho.is (encrypted)",
        "geojs.io (encrypted)",
        "ip-api.com (not encrypted)",
      ],
      explain:
        "Sets which service is used to look up the country of non-whitelisted domains; users cannot change it.\n\nThe encrypted services first resolve the domain through Google Public DNS (dns.google) and then send the IP address to the service. ip-api.com receives the domain name over an unencrypted connection.\n\nNot configured: users decide (default: ipwho.is). Check the terms of use of the service before using it commercially.",
    },
    de: {
      title: "Abfragedienst für die Länderprüfung",
      enumLabel: "Dienst",
      optionLabels: [
        "ipwho.is (verschlüsselt)",
        "geojs.io (verschlüsselt)",
        "ip-api.com (unverschlüsselt)",
      ],
      explain:
        "Legt fest, über welchen Dienst das Herkunftsland nicht erlaubter Domains abgefragt wird; Benutzer können das nicht ändern.\n\nDie verschlüsselten Dienste lösen die Domain zuerst über Google Public DNS (dns.google) auf und senden dann die IP-Adresse an den Dienst. ip-api.com erhält den Domainnamen über eine unverschlüsselte Verbindung.\n\nNicht konfiguriert: Benutzer entscheiden selbst (Standard: ipwho.is). Bitte vor gewerblicher Nutzung die Nutzungsbedingungen des Dienstes prüfen.",
    },
  },
  {
    name: "blockedCountries",
    type: "list",
    en: {
      title: "Blocked countries",
      listLabel: "Country codes",
      explain:
        "Countries that are always blocked, as two-letter ISO 3166-1 codes, one per line (for example RU or KP). Only effective while country checks are on.\n\nA domain hosted in one of these countries cannot be opened or whitelisted from the confirmation page. Domains on a whitelist are not checked, and if the lookup service cannot be reached, the page can still be opened.",
    },
    de: {
      title: "Blockierte Länder",
      listLabel: "Ländercodes",
      explain:
        "Länder, die immer blockiert sind, als zweistellige ISO-3166-1-Codes, einer pro Zeile (zum Beispiel RU oder KP). Wirkt nur, solange die Länderprüfung eingeschaltet ist.\n\nEine Domain, die in einem dieser Länder gehostet wird, lässt sich auf der Bestätigungsseite weder öffnen noch freigeben. Domains auf einer Whitelist werden nicht geprüft, und ist der Abfragedienst nicht erreichbar, lässt sich die Seite trotzdem öffnen.",
    },
  },
];

const TEXT = {
  en: {
    displayName: "Domain Whitelist Protector",
    description: "Policy settings for the Domain Whitelist Protector extension",
    supported: "Domain Whitelist Protector 3.0 or later",
  },
  de: {
    displayName: "Domain Whitelist Protector",
    description: "Richtlinien für die Erweiterung Domain Whitelist Protector",
    supported: "Domain Whitelist Protector 3.0 oder neuer",
  },
};

function xml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pascal(name) {
  return name[0].toUpperCase() + name.slice(1);
}

// Chromium derives the extension ID from the public key of the packing key.
function extensionIdFromKey(pemPath) {
  if (!fs.existsSync(pemPath)) {
    // First run: create the packing key. It defines the extension ID.
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    fs.writeFileSync(
      pemPath,
      privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600 },
    );
    console.log(`Created new packing key: ${pemPath}`);
    console.log("Keep this file safe and private. Without it you cannot publish updates.");
  }
  const privateKey = crypto.createPrivateKey(fs.readFileSync(pemPath));
  const publicDer = crypto
    .createPublicKey(privateKey)
    .export({ type: "spki", format: "der" });
  const hash = crypto.createHash("sha256").update(publicDer).digest("hex");
  return [...hash.slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
    .join("");
}

function buildAdmx(extensionId) {
  const policies = [];
  for (const browser of [GLOBAL, ...BROWSERS]) {
    const policyKey = policyKeyFor(browser, extensionId);
    for (const policy of POLICIES) {
      const id = pascal(policy.name);
      const common = `name="${browser.prefix}_${id}" class="Both" displayName="$(string.${id})" explainText="$(string.${id}_Explain)"`;
      const parents = `      <parentCategory ref="Cat_${browser.prefix}" />\n      <supportedOn ref="SUPPORTED_Extension" />`;
      if (policy.type === "list") {
        policies.push(
          `    <policy ${common} presentation="$(presentation.${id})" key="${policyKey}\\${policy.name}">\n${parents}\n      <elements>\n        <list id="${id}_List" valuePrefix="" />\n      </elements>\n    </policy>`,
        );
      } else if (policy.type === "enum") {
        const items = policy.options
          .map(
            (option) =>
              `          <item displayName="$(string.${id}_${option})">\n            <value>\n              <string>${option}</string>\n            </value>\n          </item>`,
          )
          .join("\n");
        policies.push(
          `    <policy ${common} presentation="$(presentation.${id})" key="${policyKey}">\n${parents}\n      <elements>\n        <enum id="${id}_Enum" valueName="${policy.name}" required="true">\n${items}\n        </enum>\n      </elements>\n    </policy>`,
        );
      } else if (policy.type === "text") {
        policies.push(
          `    <policy ${common} presentation="$(presentation.${id})" key="${policyKey}">\n${parents}\n      <elements>\n        <text id="${id}_Text" valueName="${policy.name}" required="true" maxLength="1000" />\n      </elements>\n    </policy>`,
        );
      } else {
        policies.push(
          `    <policy ${common} key="${policyKey}" valueName="${policy.name}">\n${parents}\n      <enabledValue>\n        <decimal value="1" />\n      </enabledValue>\n      <disabledValue>\n        <decimal value="0" />\n      </disabledValue>\n    </policy>`,
        );
      }
    }
  }

  const categories = [GLOBAL, ...BROWSERS].map((browser) => {
    const explain = browser.explain ? ` explainText="$(string.Cat_${browser.prefix}_Explain)"` : "";
    return `    <category name="Cat_${browser.prefix}" displayName="$(string.Cat_${browser.prefix})"${explain}>\n      <parentCategory ref="Cat_Root" />\n    </category>`;
  });

  return `<?xml version="1.0" encoding="utf-8"?>
<policyDefinitions xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" revision="1.0" schemaVersion="1.0" xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions">
  <policyNamespaces>
    <target prefix="dwp" namespace="DomainWhitelistProtector.Policies" />
  </policyNamespaces>
  <resources minRequiredRevision="1.0" />
  <supportedOn>
    <definitions>
      <definition name="SUPPORTED_Extension" displayName="$(string.SUPPORTED_Extension)" />
    </definitions>
  </supportedOn>
  <categories>
    <category name="Cat_Root" displayName="$(string.Cat_Root)" />
${categories.join("\n")}
  </categories>
  <policies>
${policies.join("\n")}
  </policies>
</policyDefinitions>
`;
}

function buildAdml(language) {
  const text = TEXT[language];
  const strings = [
    ["SUPPORTED_Extension", text.supported],
    ["Cat_Root", text.displayName],
    ...[GLOBAL, ...BROWSERS].map((browser) => [`Cat_${browser.prefix}`, browser.label[language]]),
    [`Cat_${GLOBAL.prefix}_Explain`, GLOBAL.explain[language]],
  ];
  const presentations = [];
  for (const policy of POLICIES) {
    const id = pascal(policy.name);
    strings.push([id, policy[language].title]);
    strings.push([`${id}_Explain`, policy[language].explain]);
    if (policy.type === "enum") {
      policy.options.forEach((option, index) => {
        strings.push([`${id}_${option}`, policy[language].optionLabels[index]]);
      });
      presentations.push(
        `      <presentation id="${id}">\n        <dropdownList refId="${id}_Enum" noSort="true" defaultItem="0">${xml(policy[language].enumLabel)}</dropdownList>\n      </presentation>`,
      );
    }
    if (policy.type === "text") {
      presentations.push(
        `      <presentation id="${id}">\n        <textBox refId="${id}_Text">\n          <label>${xml(policy[language].textLabel)}</label>\n        </textBox>\n      </presentation>`,
      );
    }
    if (policy.type === "list") {
      presentations.push(
        `      <presentation id="${id}">\n        <listBox refId="${id}_List">${xml(policy[language].listLabel)}</listBox>\n      </presentation>`,
      );
    }
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<policyDefinitionResources xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" revision="1.0" schemaVersion="1.0" xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions">
  <displayName>${xml(text.displayName)}</displayName>
  <description>${xml(text.description)}</description>
  <resources>
    <stringTable>
${strings.map(([id, value]) => `      <string id="${id}">${xml(value)}</string>`).join("\n")}
    </stringTable>
    <presentationTable>
${presentations.join("\n")}
    </presentationTable>
  </resources>
</policyDefinitionResources>
`;
}

function buildUpdateXml(extensionId, crxUrl, version) {
  return `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extensionId}'>
    <updatecheck codebase='${xml(crxUrl)}' version='${version}' />
  </app>
</gupdate>
`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) {
      return null;
    }
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  console.error(
    "Usage: node scripts/enterprise.js --url <https://server/path> (--key <key.pem> | --id <extension id>)",
  );
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args || !args.url || (!args.key && !args.id)) {
    fail("--url and one of --key or --id are required.");
  }
  if (!/^https?:\/\//i.test(args.url)) {
    fail("--url must start with https:// or http://");
  }

  const extensionId = args.key ? extensionIdFromKey(args.key) : args.id;
  if (!/^[a-p]{32}$/.test(extensionId)) {
    fail("The extension ID must consist of 32 letters from a to p.");
  }

  const baseUrl = args.url.replace(/\/+$/, "");
  const updateUrl = `${baseUrl}/update.xml`;
  const crxUrl = `${baseUrl}/${PACKAGE_NAME}.crx`;

  validateSource();
  buildDirectories();

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const extensionDir = path.join(OUT_DIR, PACKAGE_NAME);
  fs.cpSync(CHROME_DIR, extensionDir, { recursive: true });

  // Browsers look for later updates at the URL stored in the manifest.
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.update_url = updateUrl;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  fs.writeFileSync(
    path.join(OUT_DIR, "update.xml"),
    buildUpdateXml(extensionId, crxUrl, manifest.version),
  );

  fs.copyFileSync(
    path.join(__dirname, "Sync-DwpPolicy.ps1"),
    path.join(OUT_DIR, "Sync-DwpPolicy.ps1"),
  );

  const policyDir = path.join(OUT_DIR, "PolicyDefinitions");
  fs.mkdirSync(path.join(policyDir, "en-US"), { recursive: true });
  fs.mkdirSync(path.join(policyDir, "de-DE"), { recursive: true });
  fs.writeFileSync(path.join(policyDir, `${ADMX_NAME}.admx`), buildAdmx(extensionId));
  fs.writeFileSync(path.join(policyDir, "en-US", `${ADMX_NAME}.adml`), buildAdml("en"));
  fs.writeFileSync(path.join(policyDir, "de-DE", `${ADMX_NAME}.adml`), buildAdml("de"));

  const values = [
    "Domain Whitelist Protector - values for the Group Policy",
    "",
    `Extension ID:        ${extensionId}`,
    `Extension version:   ${manifest.version}`,
    `Update URL:          ${updateUrl}`,
    `Package URL:         ${crxUrl}`,
    "",
    "Value for the force-install list (Chrome and Edge):",
    `  ${extensionId};${updateUrl}`,
    "",
    "Registry paths the policy templates write to (below HKLM when set",
    "under Computer Configuration, below HKCU under User Configuration):",
    ...BROWSERS.map((browser) => `  ${policyKeyFor(browser, extensionId)}`),
    "",
    "Folder \"Global\" (read by no browser, copied by the script):",
    `  ${GLOBAL_KEY}`,
    "",
    "After changing the Global folder, copy it to Chrome and Edge:",
    `  .\\Sync-DwpPolicy.ps1 -GpoName "<GPO name>" -ExtensionId ${extensionId}`,
    "",
  ].join("\r\n");
  fs.writeFileSync(path.join(OUT_DIR, "gpo-values.txt"), values);

  console.log("");
  console.log(`Extension ID: ${extensionId}`);
  console.log(`Force-install value: ${extensionId};${updateUrl}`);
  console.log("");
  console.log("Created in dist/enterprise:");
  console.log(`  ${PACKAGE_NAME}/      extension folder to pack as ${PACKAGE_NAME}.crx`);
  console.log("  update.xml                       for the web server");
  console.log("  PolicyDefinitions/               Group Policy templates");
  console.log("  gpo-values.txt                   values to enter in the GPO");
  console.log("  Sync-DwpPolicy.ps1               copies the Global settings to Chrome and Edge");
}

main();
