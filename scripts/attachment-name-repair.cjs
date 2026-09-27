"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { validAttachmentName, stripLegacyStoragePrefix, inside } = require("./attachment-names.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const digest = file => hash(fs.readFileSync(file));
function assert(ok, message) { if (!ok) throw new Error(message); }
function regularInside(root, file) {
  assert(path.isAbsolute(file), "附件修复路径必须是绝对路径。");
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && inside(fs.realpathSync(root), fs.realpathSync(file)), "附件修复路径不是资料库内的普通文件。");
}
function encodedPath(value) { return value.split(path.sep).map(encodeURIComponent).join("/"); }
function replaceReferencePaths(content, referencePath, previousPath, targetPath) {
  const previousRelative = path.relative(path.dirname(referencePath), previousPath);
  const targetRelative = path.relative(path.dirname(referencePath), targetPath);
  // Only exact path spellings are changed. A filename in ordinary prose is not
  // a reference; link labels are only changed together with a matching target.
  const pairs = [
    [pathToFileURL(previousPath).href, pathToFileURL(targetPath).href],
    [previousPath, targetPath],
    [encodedPath(previousPath), encodedPath(targetPath)]
  ];
  const relativePairs = [[previousRelative, targetRelative], [encodedPath(previousRelative), encodedPath(targetRelative)],
    [previousPath, targetPath], [encodedPath(previousPath), encodedPath(targetPath)],
    [pathToFileURL(previousPath).href, pathToFileURL(targetPath).href]];
  for (const [before, after] of relativePairs) {
    for (const prefix of ["", "./"]) {
      pairs.push([`](${prefix}${before})`, `](${prefix}${after})`]);
      pairs.push([`](<${prefix}${before}>)`, `](<${prefix}${after}>)`]);
      pairs.push([`](${prefix}${before} "`, `](${prefix}${after} "`]);
      pairs.push([`href="${prefix}${before}"`, `href="${prefix}${after}"`]);
    }
  }
  const oldName = path.basename(previousPath), newName = path.basename(targetPath);
  const links = [...pairs.filter(([before]) => before.startsWith("]("))];
  for (const [before, after] of links) pairs.unshift([`[${oldName}${before}`, `[${newName}${after}`]);
  const replacements = new Map(pairs.filter(([before, after]) => before && before !== after));
  const expression = [...replacements.keys()].sort((a, b) => b.length - a.length).map(value => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return value.startsWith("/") || value.startsWith("file:")
      ? `(?<![\\p{L}\\p{N}_/?=&%.-])${escaped}(?=$|[\\s\\x22\\x27<>()[\\]{};,])` : escaped;
  }).join("|");
  return expression ? content.replace(new RegExp(expression, "gu"), match => replacements.get(match)) : content;
}
function buildPlan(repository, request) {
  const row = repository.database.prepare("SELECT * FROM documents WHERE id=?").get(String(request.documentId || ""));
  assert(row?.owner_type === "project", "修复必须指定已登记的项目附件 documentId。");
  const previousPath = String(request.expectedPath || "");
  assert(row.path === previousPath, "附件索引路径已变化，请重新预览。");
  assert(/^[a-f0-9]{64}$/.test(request.expectedSha256 || ""), "必须提供附件 expectedSha256。");
  const project = repository.getProject(row.owner_id);
  assert(project?.documentPath && path.basename(project.documentPath) === "项目主页.md", "项目主页未就绪。");
  const targetRoot = path.join(path.dirname(project.documentPath), "原始材料");
  assert(path.dirname(previousPath) === targetRoot, "只修复项目原始材料目录内的附件。");
  regularInside(repository.libraryDir, previousPath);
  const sourceStat = fs.statSync(previousPath);
  assert(digest(previousPath) === request.expectedSha256, "附件内容已变化，请重新预览。");
  const originalName = validAttachmentName(request.originalName);
  const oldName = path.basename(previousPath);
  assert(stripLegacyStoragePrefix(oldName) !== oldName && stripLegacyStoragePrefix(oldName) === originalName,
    "原名证据与旧版存储编号不匹配；不会根据数字猜测或任意改名。");
  let targetPath = path.join(targetRoot, originalName);
  if (fs.existsSync(targetPath)) {
    regularInside(repository.libraryDir, targetPath);
    if (digest(targetPath) !== request.expectedSha256) {
      const extension = path.extname(originalName);
      targetPath = path.join(targetRoot, `${path.basename(originalName, extension)}-${request.expectedSha256.slice(0, 12)}${extension}`);
    }
  }
  const targetExists = fs.existsSync(targetPath);
  if (targetExists) {
    regularInside(repository.libraryDir, targetPath);
    assert(digest(targetPath) === request.expectedSha256, "附件版本路径冲突；保留已有文件。");
  }
  assert(!repository.database.prepare("SELECT id FROM documents WHERE path=? AND id<>?").get(targetPath, row.id), "目标文件已有另一份文档索引，需先核实重复记录。");
  const indexed = repository.database.prepare("SELECT path FROM documents WHERE owner_type='project' AND owner_id=?").all(row.owner_id).map(item => item.path);
  const supplied = request.references || [];
  assert(Array.isArray(supplied), "references 必须是显式引用文件列表。");
  const referencePaths = [...new Set([project.documentPath, ...indexed.filter(file => file !== previousPath && /\.(?:md|markdown)$/i.test(file)), ...supplied.map(item => item.path)])].sort();
  const writes = [], referenceChecks = [];
  for (const referencePath of referencePaths) {
    assert(referencePath !== previousPath, "原始附件只改名，不修改其内容。");
    assert(/\.(?:md|markdown)$/i.test(referencePath), "引用修复仅支持资料库 Markdown 文档。");
    regularInside(repository.libraryDir, referencePath);
    const before = fs.readFileSync(referencePath), beforeSha256 = hash(before);
    const expected = supplied.find(item => item.path === referencePath);
    if (expected) assert(expected.expectedSha256 === beforeSha256, "引用文档已变化，请重新预览。");
    const after = Buffer.from(replaceReferencePaths(before.toString("utf8"), referencePath, previousPath, targetPath));
    referenceChecks.push({ path: referencePath, sha256: beforeSha256 });
    if (!before.equals(after)) writes.push({ path: referencePath, before, after, beforeSha256, afterSha256: hash(after) });
  }
  const title = row.title === oldName ? path.basename(targetPath) : row.title;
  const plan = {
    schema: "domi.attachment-name-repair.v1", documentId: row.id, projectId: row.owner_id,
    previousPath, targetPath, originalName, sha256: request.expectedSha256,
    sourceMetadata: { mode: sourceStat.mode & 0o777, mtimeMs: sourceStat.mtimeMs },
    previousTitle: row.title, title, expectedUpdatedAt: row.updated_at,
    targetExists, referenceChecks,
    references: writes.map(({ path, beforeSha256, afterSha256 }) => ({ path, beforeSha256, afterSha256 }))
  };
  return { plan, planHash: hash(JSON.stringify(plan)), writes, row, sourceStat };
}
function atomicWrite(file, bytes) {
  const temporary = `${file}.repair-${crypto.randomUUID()}.tmp`;
  try {
    const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600;
    fs.writeFileSync(temporary, bytes, { flag: "wx", mode });
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, file);
  }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function repairAttachmentName(repository, request = {}, hooks = {}) {
  const preview = buildPlan(repository, request);
  if (request.dryRun !== false) return { ok: true, dryRun: true, ...preview.plan, planHash: preview.planHash };
  assert(request.expectedPlanHash === preview.planHash, "修复计划已变化，请重新预览并提交 expectedPlanHash。");
  const { plan, planHash, writes, row, sourceStat } = preview;
  const backupRoot = path.join(path.dirname(repository.databasePath), "attachment-name-repairs", crypto.randomUUID());
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupRoot, "original-attachment"), journalPath = path.join(backupRoot, "repair.json");
  const journal = { ...plan, planHash, state: "prepared", backupPath, referenceBackups: [] };
  fs.copyFileSync(plan.previousPath, backupPath, fs.constants.COPYFILE_EXCL);
  assert(digest(backupPath) === plan.sha256, "附件备份校验失败，未修改原件。");
  writes.forEach((write, index) => {
    const backup = path.join(backupRoot, `reference-${index}.md`);
    fs.writeFileSync(backup, write.before, { flag: "wx", mode: 0o600 });
    journal.referenceBackups.push({ path: write.path, backup, sha256: write.beforeSha256 });
  });
  atomicWrite(journalPath, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`));
  let transaction = false, createdTarget = false, removedSource = false;
  const written = [];
  try {
    repository.database.exec("BEGIN IMMEDIATE"); transaction = true;
    assert(buildPlan(repository, request).planHash === planHash, "附件或引用已并发变化，未应用修复。");
    if (!plan.targetExists) {
      fs.copyFileSync(backupPath, plan.targetPath, fs.constants.COPYFILE_EXCL);
      createdTarget = true;
      fs.chmodSync(plan.targetPath, plan.sourceMetadata.mode);
      fs.utimesSync(plan.targetPath, sourceStat.atime, sourceStat.mtime);
    }
    assert(digest(plan.targetPath) === plan.sha256, "附件目标校验失败。");
    for (const write of writes) {
      assert(digest(write.path) === write.beforeSha256, "引用文档正在修改，已停止修复。");
      atomicWrite(write.path, write.after); written.push(write);
      assert(digest(write.path) === write.afterSha256, "引用写入校验失败。");
    }
    const changed = repository.database.prepare("UPDATE documents SET path=?,title=? WHERE id=? AND path=? AND updated_at=?")
      .run(plan.targetPath, plan.title, row.id, plan.previousPath, row.updated_at);
    assert(changed.changes === 1, "附件索引正在修改，已停止修复。");
    hooks.beforeCommit?.();
    regularInside(repository.libraryDir, plan.previousPath);
    assert(digest(plan.previousPath) === plan.sha256, "附件原件正在修改，已停止修复。");
    fs.unlinkSync(plan.previousPath); removedSource = true;
    assert(digest(plan.targetPath) === plan.sha256, "附件最终回读失败。");
    repository.database.exec("COMMIT"); transaction = false;
    journal.state = "committed";
    atomicWrite(journalPath, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`));
    return { ok: true, dryRun: false, ...plan, planHash, journalPath, filesVerified: true, recordVerified: true, referencesVerified: true };
  } catch (error) {
    if (!transaction) throw error;
    try { repository.database.exec("ROLLBACK"); } catch {}
    const rollbackConflicts = [];
    if (removedSource) {
      try {
        fs.copyFileSync(backupPath, plan.previousPath, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(plan.previousPath, plan.sourceMetadata.mode);
        fs.utimesSync(plan.previousPath, sourceStat.atime, sourceStat.mtime);
      }
      catch { rollbackConflicts.push(plan.previousPath); }
    }
    for (const write of written.reverse()) {
      try {
        if (digest(write.path) !== write.afterSha256) { rollbackConflicts.push(write.path); continue; }
        atomicWrite(write.path, write.before);
      } catch { rollbackConflicts.push(write.path); }
    }
    if (createdTarget) {
      try { if (digest(plan.targetPath) === plan.sha256) fs.unlinkSync(plan.targetPath); else rollbackConflicts.push(plan.targetPath); }
      catch { rollbackConflicts.push(plan.targetPath); }
    }
    journal.state = rollbackConflicts.length ? "rollback-conflict" : "rolled-back";
    journal.rollbackConflicts = rollbackConflicts;
    atomicWrite(journalPath, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`));
    error.repairJournalPath = journalPath;
    throw error;
  }
}
module.exports = { repairAttachmentName, replaceReferencePaths };
