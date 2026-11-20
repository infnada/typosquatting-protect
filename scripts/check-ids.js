// Checks that all rollout files belong to the same extension ID:
// the key file, the packed CRX, update.xml and the Group Policy template.
// A CRX packed with a different key is silently rejected by the browser,
// so run this before copying the files to the web server.
//
// Usage:
//   node scripts/check-ids.js [--key <key.pem>] [--crx <file.crx>]
//                             [--update-xml <update.xml>] [--admx <file.admx>]
//                             [--id <extension id from the GPO>]
//
// Without arguments, key.pem in the current folder and the files in
// dist/enterprise are checked. Files that do not exist are skipped.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT_DIR = path.join(__dirname, "..", "dist", "enterprise");
const DEFAULTS = {
  key: "key.pem",
  crx: path.join(OUT_DIR, "domain-whitelist-protector.crx"),
  "update-xml": path.join(OUT_DIR, "update.xml"),
  admx: path.join(OUT_DIR, "PolicyDefinitions", "DomainWhitelistProtector.admx"),
};

// Chromium extension IDs are the first 32 hex digits of a SHA-256 hash,
// written with the letters a-p instead of 0-f.
function hexToId(hex) {
  return [...hex.slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
    .join("");
}

function idFromKey(pem) {
  const spki = crypto.createPublicKey(pem).export({ type: "spki", format: "der" });
  return hexToId(crypto.createHash("sha256").update(spki).digest("hex"));
}

function readVarint(buffer, position) {
  let value = 0;
  let shift = 0;
  let byte;
  do {
    if (position >= buffer.length) throw new Error("truncated CRX header");
    byte = buffer[position++];
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [value, position];
}

// Minimal protobuf reader: returns [fieldNumber, bytes] for every
// length-delimited field and skips integer fields.
function readFields(buffer) {
  const fields = [];
  let position = 0;
  while (position < buffer.length) {
    let tag;
    [tag, position] = readVarint(buffer, position);
    const field = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (wireType === 2) {
      let length;
      [length, position] = readVarint(buffer, position);
      fields.push([field, buffer.subarray(position, position + length)]);
      position += length;
    } else if (wireType === 0) {
      [, position] = readVarint(buffer, position);
    } else {
      throw new Error("unexpected data in CRX header");
    }
  }
  return fields;
}

// CRX3: "Cr24", version 3, header length, then a CrxFileHeader whose
// signed_header_data (field 10000) holds the crx_id (field 1, 16 bytes).
function idFromCrx(crx) {
  if (crx.length < 12 || crx.toString("latin1", 0, 4) !== "Cr24") {
    throw new Error("not a CRX file");
  }
  if (crx.readUInt32LE(4) !== 3) throw new Error("only CRX version 3 is supported");
  const header = crx.subarray(12, 12 + crx.readUInt32LE(8));
  const signedData = readFields(header).find(([field]) => field === 10000);
  const crxId = signedData && readFields(signedData[1]).find(([field]) => field === 1);
  if (!crxId) throw new Error("no extension ID found in the CRX header");
  return hexToId(crxId[1].toString("hex"));
}

function idFromUpdateXml(xml) {
  const match = xml.match(/appid=['"]([a-p]{32})['"]/);
  if (!match) throw new Error("no appid found");
  return match[1];
}

// Returns the IDs in the browser policy paths. The "Global" folder has no ID.
function idsFromAdmx(admx) {
  const ids = new Set();
  for (const match of admx.matchAll(/extensions\\([a-p]{32})\\policy/g)) {
    ids.add(match[1]);
  }
  if (!ids.size) throw new Error("no extension ID found");
  return [...ids];
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, "");
    if (!argv[i].startsWith("--") || !["key", "crx", "update-xml", "admx", "id"].includes(name)) {
      return null;
    }
    if (i + 1 >= argv.length) return null;
    args[name] = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(
      "Usage: node scripts/check-ids.js [--key <key.pem>] [--crx <file.crx>] [--update-xml <update.xml>] [--admx <file.admx>] [--id <extension id>]",
    );
    process.exit(1);
  }

  const readers = {
    key: ["key.pem", (file) => [idFromKey(fs.readFileSync(file))]],
    crx: ["CRX", (file) => [idFromCrx(fs.readFileSync(file))]],
    "update-xml": ["update.xml", (file) => [idFromUpdateXml(fs.readFileSync(file, "utf8"))]],
    admx: ["ADMX", (file) => idsFromAdmx(fs.readFileSync(file, "utf8"))],
  };

  const results = [];
  let failed = false;
  if (args.id) results.push(["GPO", args.id.trim().toLowerCase()]);

  for (const [option, [label, read]] of Object.entries(readers)) {
    const file = args[option] || DEFAULTS[option];
    if (!fs.existsSync(file)) {
      if (args[option]) {
        console.error(`${label.padEnd(12)} file not found: ${file}`);
        failed = true;
      }
      continue;
    }
    try {
      for (const id of read(file)) results.push([label, id]);
    } catch (error) {
      console.error(`${label.padEnd(12)} ${error.message}: ${file}`);
      failed = true;
    }
  }

  for (const [label, id] of results) console.log(`${label.padEnd(12)} ${id}`);

  if (!results.length) {
    console.error("Nothing to check: no files found.");
    process.exit(1);
  }
  const distinct = new Set(results.map(([, id]) => id));
  if (distinct.size > 1) {
    console.error("\nMISMATCH: the files belong to different extension IDs.");
    process.exit(1);
  }
  if (failed) process.exit(1);
  console.log(`\nAll IDs match: ${[...distinct][0]}`);
}

if (require.main === module) {
  main();
}

module.exports = { hexToId, idFromKey, idFromCrx, idFromUpdateXml, idsFromAdmx };
