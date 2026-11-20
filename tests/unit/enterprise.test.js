const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");

// Runs enterprise.js on a copy so an existing dist/enterprise is left alone.
function generate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dwp-enterprise-"));
  fs.cpSync(path.join(ROOT, "scripts"), path.join(dir, "scripts"), { recursive: true });
  fs.cpSync(path.join(ROOT, "src"), path.join(dir, "src"), { recursive: true });
  execFileSync(process.execPath, [
    path.join(dir, "scripts", "enterprise.js"),
    "--url", "https://intranet.test/it's/extensions",
    "--id", "abcdefghijklmnopabcdefghijklmnop",
  ], { cwd: dir, stdio: "ignore" });
  return { dir, out: path.join(dir, "dist", "enterprise") };
}

test("policy template has a Global folder outside the browser policy paths", () => {
  const { dir, out } = generate();
  const admx = fs.readFileSync(path.join(out, "PolicyDefinitions", "DomainWhitelistProtector.admx"), "utf8");
  const keys = [...admx.matchAll(/<policy name="(\w+)_ManagedWhitelist"[^>]* key="([^"]+)"/g)]
    .map(([, prefix, key]) => [prefix, key]);
  assert.deepEqual(keys, [
    ["Global", "Software\\Policies\\DomainWhitelistProtector\\Global\\managedWhitelist"],
    ["Chrome", "Software\\Policies\\Google\\Chrome\\3rdparty\\extensions\\abcdefghijklmnopabcdefghijklmnop\\policy\\managedWhitelist"],
    ["Edge", "Software\\Policies\\Microsoft\\Edge\\3rdparty\\extensions\\abcdefghijklmnopabcdefghijklmnop\\policy\\managedWhitelist"],
  ]);
  // Every setting exists once per folder.
  const names = [...admx.matchAll(/<policy name="(\w+?)_/g)].map(([, prefix]) => prefix);
  const count = (prefix) => names.filter((name) => name === prefix).length;
  assert.equal(count("Global"), count("Chrome"));
  assert.equal(count("Global"), count("Edge"));

  for (const language of ["de-DE", "en-US"]) {
    const adml = fs.readFileSync(path.join(out, "PolicyDefinitions", language, "DomainWhitelistProtector.adml"), "utf8");
    assert.match(adml, /<string id="Cat_Global">Global \(/);
    assert.match(adml, /<string id="Cat_Global_Explain">/);
  }
  assert.ok(fs.existsSync(path.join(out, "Sync-DwpPolicy.ps1")));
  // An apostrophe in the URL cannot break the single-quoted attribute
  const updateXml = fs.readFileSync(path.join(out, "update.xml"), "utf8");
  assert.match(updateXml, /codebase='https:\/\/intranet\.test\/it&apos;s\/extensions\/domain-whitelist-protector\.crx'/);
  fs.rmSync(dir, { recursive: true, force: true });
});
