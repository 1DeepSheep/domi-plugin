const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) throw new Error(`Unexpected argument: ${current}`);
    const key = current.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function publicKeyDerBase64(privateKey) {
  return crypto.createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .toString("base64");
}

function validateOptions(options) {
  if (!fs.existsSync(options.archivePath)) throw new Error("Plugin archive does not exist.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
    throw new Error("Repository must use owner/name format.");
  }
  if (!/^[0-9a-f]{40}$/i.test(options.commit)) throw new Error("Commit must be a full SHA.");
  if (!/^[A-Za-z0-9._-]+$/.test(options.tag)) throw new Error("Release tag is invalid.");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options.minClientVersion)) {
    throw new Error("Minimum client version must be semver-like.");
  }
  if (!String(options.privateKeyPem || "").includes("PRIVATE KEY")) {
    throw new Error("DOMI_PLUGIN_SIGNING_PRIVATE_KEY is missing.");
  }
}

function buildReleaseArtifacts(options) {
  validateOptions(options);
  const pluginManifestPath = path.resolve(options.pluginManifestPath);
  const pluginManifest = JSON.parse(fs.readFileSync(pluginManifestPath, "utf8"));
  if (pluginManifest.name !== "domi" || !pluginManifest.version) {
    throw new Error("Invalid Domi plugin manifest.");
  }

  const privateKey = crypto.createPrivateKey(options.privateKeyPem);
  const derivedPublicKey = publicKeyDerBase64(privateKey);
  if (options.expectedPublicKeyDerBase64
      && derivedPublicKey !== options.expectedPublicKeyDerBase64.trim()) {
    throw new Error("Configured signing public key does not match the private key.");
  }

  const archiveSha256 = sha256File(options.archivePath);
  const archiveUrl = `https://github.com/${options.repository}/releases/download/${options.tag}/domi-plugin.tar.gz`;
  const manifest = {
    schemaVersion: 1,
    name: "domi",
    version: pluginManifest.version,
    gitCommit: options.commit.toLowerCase(),
    sha256: archiveSha256,
    archiveUrl,
    archiveFormat: "tar.gz",
    archiveRoot: "domi",
    minClientVersion: options.minClientVersion,
    publishedAt: options.publishedAt || new Date().toISOString()
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const signature = crypto.sign(null, manifestBytes, privateKey);
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(derivedPublicKey, "base64"),
    format: "der",
    type: "spki"
  });
  if (!crypto.verify(null, manifestBytes, publicKey, signature)) {
    throw new Error("Generated release signature could not be verified.");
  }

  fs.mkdirSync(options.outputDir, { recursive: true });
  const manifestPath = path.join(options.outputDir, "latest.json");
  const signaturePath = path.join(options.outputDir, "latest.json.sig");
  fs.writeFileSync(manifestPath, manifestBytes);
  fs.writeFileSync(signaturePath, signature);
  return { manifest, manifestPath, signaturePath, publicKeyDerBase64: derivedPublicKey };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, "..");
  const result = buildReleaseArtifacts({
    archivePath: path.resolve(args.archive || ""),
    outputDir: path.resolve(args.output || ""),
    pluginManifestPath: path.join(root, ".codex-plugin", "plugin.json"),
    repository: args.repository || "",
    commit: args.commit || "",
    tag: args.tag || "",
    minClientVersion: args["min-client-version"] || "",
    publishedAt: process.env.SOURCE_DATE_EPOCH
      ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
      : "",
    privateKeyPem: process.env.DOMI_PLUGIN_SIGNING_PRIVATE_KEY || "",
    expectedPublicKeyDerBase64: process.env.DOMI_PLUGIN_SIGNING_PUBLIC_KEY_DER_B64 || ""
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    version: result.manifest.version,
    gitCommit: result.manifest.gitCommit,
    sha256: result.manifest.sha256,
    archiveUrl: result.manifest.archiveUrl
  })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Domi plugin release build failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  buildReleaseArtifacts,
  parseArgs,
  publicKeyDerBase64,
  sha256File
};
