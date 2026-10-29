const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

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
  assert.equal(result.manifest.minClientVersion, "0.3.0");
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

console.log("domi plugin release build tests passed.");

// Standalone Slides resources and the QA v3 completion gate require the matching
// client. Older releases must keep their installed, compatible plugin.
const publishWorkflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "publish-plugin.yml"), "utf8");
// Older clients may rewrite brand metadata and move directories without
// updating material indexes when a renamed project is edited.
assert.match(publishWorkflow, /--min-client-version "7\.0\.12"/);


// History scanning must keep both path policy and every distinct content version.
{
  const checkerName = "public-release-check.cjs";
  const exemptPath = "scripts/public-release-check.cjs";
  const supportFiles = [checkerName];

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "domi-history-dedupe-test-"));
  const tracePath = path.join(os.tmpdir(), `domi-history-trace-${path.basename(fixture)}.jsonl`);
  try {
    const git = (...args) => execFileSync("git", ["-C", fixture, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const write = (name, content) => { fs.mkdirSync(path.dirname(path.join(fixture, name)), { recursive: true }); fs.writeFileSync(path.join(fixture, name), content); };
    const commit = () => { git("add", "."); git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"); return git("rev-parse", "HEAD"); };
    git("init", "-q");
    git("config", "user.name", "Privacy Test");
    git("config", "user.email", "test@example.com");
    const email = ["historical-author", "private.invalid"].join("@");
    const oldContent = JSON.stringify({ email });
    write("stable.txt", "unchanged safe content");
    write("changed.txt", oldContent);
    write("legacy-lock.json", oldContent);
    write("legacy-checker.txt", oldContent);
    write("runtime.sqlite", "unchanged safe content");
    write("docs/review\tnotes.md", "safe tabbed path");
    const oldest = commit();
    git("mv", "legacy-lock.json", "package-lock.json");
    fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
    git("mv", "legacy-checker.txt", exemptPath);
    const renamed = commit();
    fs.unlinkSync(path.join(fixture, "runtime.sqlite"));
    write("changed.txt", "current safe content");
    for (const name of supportFiles) write(`scripts/${name}`, fs.readFileSync(path.join(__dirname, name)));
    commit();
    git("-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-qm", "unchanged tree");
    const result = spawnSync(process.execPath, [path.join(fixture, "scripts", checkerName), "--history"], {
      encoding: "utf8", timeout: 20_000,
      env: { ...process.env, DOMI_PRIVATE_IDENTITY_TERMS: "", NODE_PATH: path.join(__dirname, "..", "node_modules"), GIT_TRACE2_EVENT: tracePath }
    });
    assert.equal(result.status, 1, result.error?.message || result.stderr);
    for (const name of ["changed.txt", "legacy-lock.json", "legacy-checker.txt"]) {
      const firstOccurrence = name === "changed.txt" ? renamed : oldest;
      assert.ok(result.stderr.includes(`${firstOccurrence.slice(0, 12)}:${name}`), `Historical content is checked after it is fixed or renamed: ${name}`);
    }
    for (const revision of [oldest, renamed]) {
      assert.ok(result.stderr.includes(`${revision.slice(0, 12)}:runtime.sqlite`), "Forbidden paths are checked at every commit even for identical blobs");
    }
    assert.equal(result.stderr.includes(`${renamed.slice(0, 12)}:package-lock.json`), false, "Lockfile email exemption remains path-specific");
    assert.equal(result.stderr.includes(`${renamed.slice(0, 12)}:${exemptPath}`), false, "Checker content exemption remains path-specific");
    const reads = fs.readFileSync(tracePath, "utf8").trim().split("\n").map(line => JSON.parse(line))
      .filter(event => event.event === "start" && event.argv?.includes("show"))
      .map(event => event.argv[event.argv.indexOf("show") + 1].split(":").slice(1).join(":"));
    assert.equal(reads.filter(name => name === "stable.txt").length, 1, "Identical path and blob is read once across commits");
    assert.equal(reads.filter(name => name === "changed.txt").length, 2, "Every different historical content version is read");
    assert.equal(reads.filter(name => name === "docs/review\tnotes.md").length, 1, "NUL-delimited tree parsing preserves tabs in paths");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(tracePath, { force: true });
  }
}
console.log("Public plugin history privacy regression checks passed.");
