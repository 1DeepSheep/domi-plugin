const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { attachmentArchiveName } = require("./attachment-names.cjs");

const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

// Import an explicitly supplied original without changing its bytes or deleting the source.
function importProjectAttachment(repository, input) {
  if (input.ownerType !== "project") throw new Error("原始附件导入目前仅支持已有项目。");
  if (input.content || input.contentFile) throw new Error("原始附件与 Markdown 正文不能同时提交。");
  const project = repository.getProject(String(input.ownerId || ""));
  if (!project?.documentPath || path.basename(project.documentPath) !== "项目主页.md") {
    throw new Error("请先为已有项目修复规范主页，再导入附件。");
  }
  const source = path.resolve(String(input.sourceFile || ""));
  if (!fs.statSync(source).isFile()) throw new Error("附件来源不是普通文件。");
  const name = attachmentArchiveName(source, { originalName: input.originalName });
  const projectRoot = path.dirname(project.documentPath);
  const libraryRoot = fs.realpathSync(repository.libraryDir);
  if (!inside(libraryRoot, fs.realpathSync(projectRoot))) throw new Error("项目目录越过资料库边界。");
  const targetRoot = path.join(projectRoot, "原始材料");
  fs.mkdirSync(targetRoot, { recursive: true });
  if (!inside(libraryRoot, fs.realpathSync(targetRoot))) throw new Error("附件目录越过资料库边界。");
  const sha256 = digest(source);
  let target = path.join(targetRoot, name);
  const assertTarget = () => {
    if (fs.existsSync(target) && (!fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink())) {
      throw new Error("附件目标不是普通文件。");
    }
  };
  assertTarget();
  if (fs.existsSync(target) && digest(target) !== sha256) {
    const extension = path.extname(name);
    target = path.join(targetRoot, `${path.basename(name, extension)}-${sha256.slice(0, 12)}${extension}`);
    assertTarget();
    if (fs.existsSync(target) && digest(target) !== sha256) throw new Error("附件版本路径冲突，未覆盖已有文件。");
  }
  let copied = false;
  const temporary = path.join(targetRoot, `.attachment-${crypto.randomUUID()}.tmp`);
  let transaction = false;
  try {
    repository.database.exec("BEGIN IMMEDIATE");
    transaction = true;
    const current = repository.getProject(project.id);
    if (current?.documentPath !== project.documentPath) throw new Error("项目目录已改变，请重新读取后导入。");
    const existing = repository.database.prepare("SELECT * FROM documents WHERE path=?").get(target);
    if (existing && (existing.owner_type !== "project" || existing.owner_id !== project.id)) {
      throw new Error("附件路径已关联其他项目。");
    }
    if (!fs.existsSync(target)) {
      fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
      if (digest(temporary) !== sha256 || digest(source) !== sha256) throw new Error("附件读取期间发生变化，未完成导入。");
      // Exclusive link publishes the complete copy without replacing a concurrent file.
      fs.linkSync(temporary, target);
      copied = true;
    }
    if (digest(target) !== sha256) throw new Error("附件回读校验失败。");
    const id = existing?.id || `doc_${crypto.createHash("sha256").update(`project:${project.id}:${target}`).digest("hex").slice(0, 16)}`;
    const kind = String(input.kind || "原始材料");
    const suppliedTitle = String(input.title || "");
    const title = !suppliedTitle || suppliedTitle === path.basename(source) ? name : suppliedTitle;
    if (!existing) repository.database.prepare(
      "INSERT INTO documents (id,owner_type,owner_id,kind,title,path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)"
    ).run(id, "project", project.id, kind, title, target, Date.now(), Date.now());
    repository.database.exec("COMMIT");
    transaction = false;
    const stored = repository.database.prepare("SELECT * FROM documents WHERE id=?").get(id);
    if (stored?.path !== target || digest(target) !== sha256) throw new Error("附件索引回读失败。");
    const homepageRefresh = repository.refreshProjectHomepageMaterials(current.id);
    return {
      ok: true,
      action: copied ? "imported" : "unchanged",
      homepageRefresh,
      document: { id, ownerType: "project", ownerId: project.id, kind: stored.kind, title: stored.title, path: target, uri: pathToFileURL(target).href, sha256 },
      industryOverviews: repository.maintainIndustryOverviews(),
      storageReceipt: { backend: "local", documentUri: pathToFileURL(target).href, documentVerified: true, recordVerified: true, filesVerified: true, sha256, status: "archived" }
    };
  } catch (error) {
    if (transaction) {
      repository.database.exec("ROLLBACK");
      if (copied && fs.existsSync(target) && digest(target) === sha256) fs.unlinkSync(target);
    }
    throw error;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

module.exports = { importProjectAttachment };
