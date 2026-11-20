const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR = path.join(__dirname, "..");
const SOURCE_DIR = path.join(ROOT_DIR, "src");
const DIST_DIR = path.join(ROOT_DIR, "dist");
// The Chromium package is used for both Google Chrome and Microsoft Edge.
const CHROME_DIR = path.join(DIST_DIR, "chrome");
const FIREFOX_DIR = path.join(DIST_DIR, "firefox");

const SHARED_FILES = [
  "common.js",
  "background.js",
  "content.js",
  "styles.css",
  "confirmation.html",
  "confirmation.js",
];
const SHARED_DIRECTORIES = ["images", "popup", "_locales"];
const CHROME_ONLY_FILES = ["managed_schema.json"];

const REQUIRED_FILES = [
  "manifest.json",
  "manifest.firefox.json",
  "popup/popup.html",
  "popup/popup.js",
  "_locales/en/messages.json",
  "_locales/de/messages.json",
  ...SHARED_FILES,
  ...CHROME_ONLY_FILES,
];

function copyInto(targetDir, manifestName, extraFiles) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of [...SHARED_FILES, ...extraFiles]) {
    fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(targetDir, file));
  }
  for (const dir of SHARED_DIRECTORIES) {
    fs.cpSync(path.join(SOURCE_DIR, dir), path.join(targetDir, dir), {
      recursive: true,
    });
  }
  fs.copyFileSync(
    path.join(SOURCE_DIR, manifestName),
    path.join(targetDir, "manifest.json"),
  );
}

function zip(sourceDir, zipName) {
  execSync(`zip -r ../${zipName} .`, { cwd: sourceDir, stdio: "ignore" });
}

function clean() {
  console.log("Cleaning previous builds...");
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  console.log("Clean complete!");
}

function validateSource() {
  console.log("Validating source files...");

  const missing = REQUIRED_FILES.filter(
    (file) => !fs.existsSync(path.join(SOURCE_DIR, file)),
  );
  missing.forEach((file) =>
    console.error(`ERROR: Required file not found: src/${file}`),
  );

  for (const manifest of ["manifest.json", "manifest.firefox.json"]) {
    if (missing.includes(manifest)) continue;
    try {
      JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, manifest), "utf8"));
    } catch (error) {
      console.error(`ERROR: src/${manifest} is not valid JSON: ${error.message}`);
      missing.push(manifest);
    }
  }

  if (missing.length) {
    console.error("Validation failed.");
    process.exit(1);
  }

  console.log("Source validation complete!");
}

// Copies the unpacked extensions to dist/chrome and dist/firefox.
function buildDirectories() {
  fs.rmSync(CHROME_DIR, { recursive: true, force: true });
  fs.rmSync(FIREFOX_DIR, { recursive: true, force: true });
  copyInto(CHROME_DIR, "manifest.json", CHROME_ONLY_FILES);
  copyInto(FIREFOX_DIR, "manifest.firefox.json", []);
}

function build() {
  console.log("Building extensions for Chrome/Edge and Firefox...");
  buildDirectories();

  console.log("Creating ZIP archives...");
  fs.rmSync(path.join(DIST_DIR, "chrome-extension.zip"), { force: true });
  fs.rmSync(path.join(DIST_DIR, "firefox-extension.zip"), { force: true });
  zip(CHROME_DIR, "chrome-extension.zip");
  zip(FIREFOX_DIR, "firefox-extension.zip");

  console.log("Build complete!");
  console.log("Chrome/Edge extension: dist/chrome-extension.zip");
  console.log("Firefox extension: dist/firefox-extension.zip");
}

function main() {
  switch (process.argv[2]) {
    case "clean":
      clean();
      break;
    case "validate":
      validateSource();
      break;
    case "build":
      validateSource();
      build();
      break;
    default:
      console.log("Usage: node build.js [clean|validate|build]");
      console.log("  clean     - Remove previous builds");
      console.log("  validate  - Check that all required source files exist");
      console.log("  build     - Build extensions for Chrome/Edge and Firefox");
      break;
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateSource, buildDirectories, CHROME_DIR, DIST_DIR };
