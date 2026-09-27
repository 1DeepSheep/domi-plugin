"use strict";
const path = require("node:path");

// The old importer used this wrapper, but a matching name (even in a directory
// called attachments) is not proof. Only authoritative name metadata can rename it.
const LEGACY_STORAGE_PREFIX = /^\d{13}-\d+-(?=.+)/u;
function validAttachmentName(value) {
  const name = String(value || "");
  if (!name || name === "." || name === ".." || /[\/\\\x00-\x1f]/.test(name)) throw new Error("附件文件名无效。");
  return name;
}
function stripLegacyStoragePrefix(name) { return String(name).replace(LEGACY_STORAGE_PREFIX, ""); }
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function attachmentArchiveName(sourceFile, { originalName } = {}) {
  if (originalName !== undefined && originalName !== null && originalName !== "") return validAttachmentName(originalName);
  return validAttachmentName(path.basename(sourceFile));
}
module.exports = { validAttachmentName, stripLegacyStoragePrefix, attachmentArchiveName, inside };
