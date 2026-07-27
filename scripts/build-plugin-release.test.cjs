const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildReleaseArtifacts,
  publicKeyDerBase64
} = require("./build-plugin-release.cjs");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plugin-release-test-"));
try {
  const archivePath = path.join(temporaryRoot, "domi-plugin.tar.gz");
  const outputDir = path.join(temporaryRoot, "dist");
  const manifestPath = path.join(temporaryRoot, "plugin.json");
  fs.writeFileSync(archivePath, "fixture archive");
  fs.writeFileSync(manifestPath, JSON.stringify({ name: "domi", version: "0.2.0" }));

  const keys = crypto.generateKeyPairSync("ed25519");
  const privateKeyPem = keys.privateKey.export({ format: "pem", type: "pkcs8" });
  const expectedPublicKey = publicKeyDerBase64(keys.privateKey);
  const result = buildReleaseArtifacts({
    archivePath,
    outputDir,
    pluginManifestPath: manifestPath,
    repository: "example/domi-plugin",
    commit: "a".repeat(40),
    tag: "plugin-0.2.0-aaaaaaaaaaaa",
    minClientVersion: "0.3.0",
    publishedAt: "2026-07-27T00:00:00.000Z",
    privateKeyPem,
    expectedPublicKeyDerBase64: expectedPublicKey
  });

  assert.equal(result.manifest.name, "domi");
  assert.equal(result.manifest.version, "0.2.0");
  assert.equal(result.manifest.gitCommit, "a".repeat(40));
  assert.equal(result.manifest.archiveRoot, "domi");
  assert.match(result.manifest.sha256, /^[0-9a-f]{64}$/);

  const manifestBytes = fs.readFileSync(result.manifestPath);
  const signature = fs.readFileSync(result.signaturePath);
  assert.equal(crypto.verify(null, manifestBytes, keys.publicKey, signature), true);
  assert.throws(() => buildReleaseArtifacts({
    archivePath,
    outputDir,
    pluginManifestPath: manifestPath,
    repository: "example/domi-plugin",
    commit: "a".repeat(40),
    tag: "plugin-0.2.0-aaaaaaaaaaaa",
    minClientVersion: "0.3.0",
    privateKeyPem,
    expectedPublicKeyDerBase64: "not-the-key"
  }), /does not match/);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("Domi plugin release build tests passed.");
