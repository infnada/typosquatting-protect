const test = require("node:test");
const assert = require("node:assert/strict");
const { loadExtension, toAscii } = require("./load");

const ext = loadExtension();
const whitelist = ["*.sharepoint.com", "microsoft.com", "amazon.de", "intranet.firma.de", "*.office.com", "sap.com", "bahn.de", "paypal.com", "deutsche-bank.de", "bbc.co.uk", "apple.com", "muller.de"];

test("punycode hostnames are decoded", () => {
  assert.equal(ext.toUnicodeHostname("xn--mller-kva.de"), "müller.de");
  assert.equal(ext.toUnicodeHostname("xn--80ak6aa92e.com"), "аррӏе.com");
  assert.equal(ext.toUnicodeHostname("www.example.com"), "www.example.com");
  assert.equal(ext.toUnicodeHostname("xn--d1acpjx3f.xn--p1ai"), "яндекс.рф");
});

test("characters from other alphabets that imitate a whitelisted domain are detected", () => {
  const cases = {
    "аmazon.de": "amazon.de", // Cyrillic а
    "amazοn.de": "amazon.de", // Greek ο
    "ạmazon.de": "amazon.de", // dot below
    "аррӏе.com": "apple.com", // all Cyrillic
    "firma.shаrepoint.com": "firma.sharepoint.com",
  };
  for (const [domain, imitates] of Object.entries(cases)) {
    const finding = ext.analyzeHomograph(toAscii(domain), whitelist);
    assert.ok(finding, domain);
    assert.equal(finding.imitates, imitates, domain);
  }
});

test("mixed alphabets are flagged even without a whitelisted original", () => {
  const finding = ext.analyzeHomograph(toAscii("pаypaӏ-secure.com"), []);
  assert.ok(finding && finding.mixedScripts);
  assert.equal(finding.imitates, null);
});

test("ordinary international domains are not flagged", () => {
  for (const domain of ["bücher.de", "яндекс.рф", "пример.испытание", "ελληνικά.gr", "amazon.de", "example.com"]) {
    assert.equal(ext.analyzeHomograph(toAscii(domain), whitelist), null, domain);
  }
});

test("an umlaut domain is flagged only when the plain spelling is whitelisted", () => {
  assert.equal(ext.analyzeHomograph(toAscii("müller.de"), whitelist).imitates, "muller.de");
  assert.equal(ext.analyzeHomograph(toAscii("müller.de"), ["amazon.de"]), null);
});

test("similar domains are matched to the whitelisted original", () => {
  const cases = {
    "sharepoimt.com": "sharepoint.com", // typo
    "mircosoft.com": "microsoft.com", // swapped letters
    "rnicrosoft.com": "microsoft.com", // rn looks like m
    "amaz0n.de": "amazon.de", // 0 looks like o
    "paypa1.com": "paypal.com", // 1 looks like l
    "sharepoint.co": "sharepoint.com", // other ending
    "firma.com": "firma.de",
    "sharepoint-login.com": "sharepoint.com", // added word
    "securesharepoint.net": "sharepoint.com",
    "deutschebank.de": "deutsche-bank.de", // hyphen removed
    "deutsche-bnak.de": "deutsche-bank.de",
    "sharepoint.com.evil.net": "sharepoint.com", // trusted name as subdomain
    "login.microsoft.com.x.ru": "microsoft.com",
    "bbc.co.uk.login.example.org": "bbc.co.uk",
  };
  for (const [domain, expected] of Object.entries(cases)) {
    assert.equal(ext.findSimilarWhitelisted(domain, whitelist), expected, domain);
  }
});

test("unrelated domains and domains of the same organization are not matched", () => {
  for (const domain of ["google.com", "heise.de", "spiegel.de", "postbank.de", "amazing.de", "team.sharepoint.com", "mail.firma.de", "sap.de", "wahn.de", "bbc.com", "192.168.1.1", "localhost"]) {
    assert.equal(ext.findSimilarWhitelisted(domain, whitelist), null, domain);
  }
});

test("findSuspicion combines both checks", () => {
  assert.equal(ext.findSuspicion(toAscii("аmazon.de"), whitelist), "amazon.de");
  assert.equal(ext.findSuspicion("sharepoimt.com", whitelist), "sharepoint.com");
  assert.equal(ext.findSuspicion("heise.de", whitelist), null);
});

test("getRootDomain returns the registrable domain", () => {
  assert.equal(ext.getRootDomain("www.shop.example.co.uk"), "example.co.uk");
  assert.equal(ext.getRootDomain("a.b.example.com"), "example.com");
  assert.equal(ext.getRootDomain("192.168.1.1"), null);
  assert.equal(ext.getRootDomain("localhost"), null);
});
