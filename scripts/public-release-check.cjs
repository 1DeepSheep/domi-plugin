const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const checkerPath = path.resolve(__filename);
const localTermsPath = path.join(root, ".privacy-terms.local");
const checkHistory = process.argv.includes("--history");
const failures = [];
const seenFailures = new Set();
const allowedEmailDomains = new Set([
  "example.com",
  "example.org",
  "example.net",
  "users.noreply.github.com"
]);
const forbiddenExtensions = new Set([
  ".cer", ".crt", ".db", ".key", ".log", ".m4a", ".mobileprovision",
  ".mp3", ".mp4", ".p12", ".p8", ".pem", ".provisionprofile",
  ".sqlite", ".sqlite3", ".wav"
]);
const forbiddenNames = [
  /^\.env(?:\.|$)/i,
  /^\.npmrc$/i,
  /^\.privacy-terms\.local$/i,
  /^domi-plugin-config\.json$/i,
  /^domi\.sqlite3?(?:-.+)?$/i,
  /^(?:threads?|sessions?|history|runtime-state)\.json$/i,
  /^(?:plaud|lark|feishu).*(?:session|cookie|token|credential)/i
];
const skippedDirectories = new Set([
  ".git", "node_modules", "outputs", "work"
]);

function privateIdentityTerms() {
  return [...new Set([
    process.env.DOMI_PRIVATE_IDENTITY_TERMS || "",
    fs.existsSync(localTermsPath) ? fs.readFileSync(localTermsPath, "utf8") : ""
  ]
    .join("\n")
    .split(/\r?\n|,/)
    .map((term) => term.trim().toLocaleLowerCase("en-US"))
    .filter((term) => term.length >= 2))];
}

function fail(category, relativePath) {
  const message = `${category}：${relativePath}`;
  if (seenFailures.has(message)) return;
  seenFailures.add(message);
  failures.push(message);
}

function inspectContent(content, relativePath, terms, identityOnly = false) {
  const normalized = content.toLocaleLowerCase("en-US");
  if (terms.some((term) => normalized.includes(term))) {
    fail("发现本机配置的禁止公开身份标识", relativePath);
  }
  if (identityOnly) return;

  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
    /\b(?:client_secret|access_token|refresh_token|api_key|authorization|cookie)\b\s*[:=]\s*["'][^"']{12,}["']/i
  ];
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    fail("疑似硬编码密钥或登录凭据", relativePath);
  }

  if (!/(?:^|[/:])(?:package-lock|npm-shrinkwrap)\.json$/i.test(relativePath)) {
    const emails = content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z][A-Za-z0-9.-]*\.[A-Za-z]{2,}\b/g) || [];
    for (const email of emails) {
      const domain = email.split("@").pop().toLowerCase();
      if (!allowedEmailDomains.has(domain)) {
        fail("发现非示例或 noreply 邮箱", relativePath);
        break;
      }
    }
  }

  if (/\/Users\/(?!Shared(?:\/|\b))[^/\s"'<>]+\//.test(content)) {
    fail("发现 macOS 用户绝对路径", relativePath);
  }
  if (/OneDrive-[^/\s"'<>]+/.test(content)) {
    fail("发现 OneDrive 租户或账户路径", relativePath);
  }
  if (/https?:\/\/[A-Za-z0-9-]+\.(?:feishu\.cn|larksuite\.com)(?:\/|\b)/i.test(content)) {
    fail("发现飞书租户域名", relativePath);
  }
  if (/\bou_[A-Za-z0-9_-]{20,}\b/.test(content)) {
    fail("发现飞书用户标识", relativePath);
  }
  if (/\b(?:bascn|wikcn|doccn|shtcn)[A-Za-z0-9_-]{10,}\b/.test(content)) {
    fail("发现飞书文档或数据资源标识", relativePath);
  }

  const feishuAssignment = /(?:app[_ -]?token|base[_ -]?token|table[_ -]?id|field[_ -]?id|wiki[_ -]?(?:space|node)?[_ -]?(?:id|token)|space[_ -]?id|parent[_ -]?node[_ -]?token)["'`\s]*[：:=]["'`\s]*([A-Za-z0-9_-]{8,})/gi;
  for (const match of content.matchAll(feishuAssignment)) {
    if (!/^(?:example|placeholder|configured|employee|user|node_token|field_id|table_id)$/i.test(match[1])) {
      fail("发现硬编码飞书标识", relativePath);
      break;
    }
  }
}

function gitReleaseCandidates() {
  try {
    return execFileSync(
      "git",
      ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"],
      { encoding: "utf8" }
    ).split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

function walkedReleaseCandidates() {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".privacy-terms.local") continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) stack.push(target);
        continue;
      }
      files.push(path.relative(root, target));
    }
  }
  return files;
}

function inspectCandidate(relativePath, terms) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    fail("禁止发布符号链接", relativePath);
    return;
  }
  if (!stat.isFile()) return;

  const extension = path.extname(relativePath).toLowerCase();
  const name = path.basename(relativePath);
  if (forbiddenExtensions.has(extension) || forbiddenNames.some((pattern) => pattern.test(name))) {
    fail("禁止发布运行数据、凭据或本地配置", relativePath);
    return;
  }
  if (stat.size > 8 * 1024 * 1024) return;
  inspectContent(
    fs.readFileSync(absolutePath).toString("utf8"),
    relativePath,
    terms,
    path.resolve(absolutePath) === checkerPath
  );
}

const terms = privateIdentityTerms();
const candidates = gitReleaseCandidates() || walkedReleaseCandidates();
for (const relativePath of candidates) inspectCandidate(relativePath, terms);

if (checkHistory) {
  try {
    const commits = execFileSync("git", ["-C", root, "rev-list", "--all"], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
    for (const commit of commits) {
      const files = execFileSync(
        "git",
        ["-C", root, "ls-tree", "-r", "--name-only", "-z", commit],
        { encoding: "utf8" }
      ).split("\0").filter(Boolean);
      for (const relativePath of files) {
        const extension = path.extname(relativePath).toLowerCase();
        const name = path.basename(relativePath);
        const historyPath = `${commit.slice(0, 12)}:${relativePath}`;
        if (forbiddenExtensions.has(extension) || forbiddenNames.some((pattern) => pattern.test(name))) {
          fail("Git 历史包含运行数据、凭据或本地配置", historyPath);
          continue;
        }
        let content;
        try {
          const blob = execFileSync(
            "git",
            ["-C", root, "show", `${commit}:${relativePath}`],
            { maxBuffer: 12 * 1024 * 1024 }
          );
          if (blob.length > 8 * 1024 * 1024) continue;
          content = blob.toString("utf8");
        } catch {
          continue;
        }
        inspectContent(
          content,
          historyPath,
          terms,
          path.resolve(root, relativePath) === checkerPath
        );
      }
    }
  } catch (error) {
    fail("无法检查 Git 历史", error instanceof Error ? error.message : String(error));
  }
}

if (failures.length) {
  console.error("Public release privacy check failed:");
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(terms.length
  ? `Public release privacy check passed with ${terms.length} private terms.`
  : "Public release privacy check passed; no private identity term source was configured.");
