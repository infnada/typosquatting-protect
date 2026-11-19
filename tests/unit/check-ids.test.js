const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { idFromKey, idFromCrx, idFromUpdateXml, idsFromAdmx } = require("../../scripts/check-ids");

const ROOT = path.join(__dirname, "..", "..");

function varint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

function field(number, data) {
  return Buffer.concat([varint(number * 8 + 2), varint(data.length), data]);
}

// Builds the header of a CRX3 file for the given public key (no signature).
function fakeCrx(spki) {
  const crxId = crypto.createHash("sha256").update(spki).digest().subarray(0, 16);
  const header = Buffer.concat([field(2, field(1, spki)), field(10000, field(1, crxId))]);
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0, "latin1");
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, Buffer.from("zip")]);
}

function newKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    pem: privateKey.export({ type: "pkcs8", format: "pem" }),
    spki: publicKey.export({ type: "spki", format: "der" }),
  };
}

test("reads the same ID from key and CRX", () => {
  const key = newKey();
  const id = idFromKey(key.pem);
  assert.match(id, /^[a-p]{32}$/);
  assert.equal(idFromCrx(fakeCrx(key.spki)), id);
  assert.notEqual(idFromCrx(fakeCrx(newKey().spki)), id);
});

test("rejects files that are not CRX3", () => {
  assert.throws(() => idFromCrx(Buffer.from("PK\u0003\u0004 not a crx")), /not a CRX/);
});

test("matches the files created by enterprise.js", () => {
  // Work on a copy so an existing dist/enterprise is left alone.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dwp-ids-"));
  fs.cpSync(path.join(ROOT, "scripts"), path.join(dir, "scripts"), { recursive: true });
  fs.cpSync(path.join(ROOT, "src"), path.join(dir, "src"), { recursive: true });
  const key = newKey();
  const keyFile = path.join(dir, "key.pem");
  fs.writeFileSync(keyFile, key.pem);
  execFileSync(process.execPath, [
    path.join(dir, "scripts", "enterprise.js"),
    "--url", "https://intranet.test/extensions",
    "--key", keyFile,
  ], { cwd: dir, stdio: "ignore" });

  const out = path.join(dir, "dist", "enterprise");
  const id = idFromKey(key.pem);
  assert.equal(idFromUpdateXml(fs.readFileSync(path.join(out, "update.xml"), "utf8")), id);
  assert.deepEqual(
    idsFromAdmx(fs.readFileSync(path.join(out, "PolicyDefinitions", "DomainWhitelistProtector.admx"), "utf8")),
    [id],
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
