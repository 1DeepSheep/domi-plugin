"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { DatabaseSync } = require("node:sqlite");
const { readConfig } = require("./domi-repo.cjs");
const { artifact, verifyArtifact } = require("./domi-workflow.cjs");

function verifyPersonNotesArchive(record) {
  const receipt = record.storageReceipt;
  assert(receipt?.backend === "local" && receipt.entityType === "person"
    && receipt.personId && !receipt.projectId && !record.projectId,
  "Person notes require a local person storage receipt without a project binding");
  assert(receipt.recordVerified === true && receipt.documentVerified === true && receipt.filesVerified === true,
    "Person archive readback is incomplete");
  const config = readConfig();
  assert(config.backend === "local" && !config.legacyFeishuPrimary, "Person archive requires the configured local backend");
  const database = new DatabaseSync(config.databasePath, { readOnly: true });
  try {
    const person = database.prepare("SELECT * FROM people WHERE id=?").get(receipt.personId);
    assert(person, "Archived person does not exist in the current library");
    const directory = fs.realpathSync(path.dirname(person.document_path));
    const root = fs.realpathSync(config.repositoryDir);
    assert(directory.startsWith(root + path.sep) && directory === fs.realpathSync(receipt.libraryPath),
      "Person archive directory does not match the current library");
    const notesHash = artifact({ path: record.notesPath }).sha256;
    const documents = database.prepare("SELECT * FROM documents WHERE owner_type='person' AND owner_id=?").all(person.id);
    const files = (receipt.artifacts || []).map(verifyArtifact);
    const notes = files.find(file => file.role === "notes" && file.sha256 === notesHash
      && fs.realpathSync(file.path).startsWith(directory + path.sep)
      && documents.some(document => path.resolve(document.path) === path.resolve(file.path)
        && /纪要|交流|会议/.test(document.kind)));
    assert(notes, "The verified notes are not indexed under this person");
    const target = fileURLToPath(receipt.documentUri);
    assert([person.document_path, notes.path].some(file => path.resolve(file) === path.resolve(target)),
      "Person archive document link does not match the verified record or notes");
    return receipt.personId;
  } finally { database.close(); }
}
module.exports = { verifyPersonNotesArchive };
