const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const SCHEMA = "domi.process-lock.v1";
const HOSTNAME = os.hostname();
const HOST_KEY = crypto.createHash("sha256").update(HOSTNAME).digest("hex").slice(0, 16);
const MAX_CONTENTION_MS = 1000;
const CONTENTION_WAIT = new Int32Array(new SharedArrayBuffer(4));

function busy(lockPath, reason) {
  const error = new Error(`Cannot acquire process lock ${lockPath}: ${reason}`);
  error.code = "EEXIST";
  return error;
}

function processState(pid) {
  try { process.kill(pid, 0); return "alive"; }
  catch (error) { return error.code === "ESRCH" ? "dead" : "unknown"; }
}

function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }

function unlinkIfPresent(file) {
  try { fs.unlinkSync(file); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

function readOwner(file, lockPath) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 16384) {
    throw busy(lockPath, "legacy or invalid owner metadata; an unknown owner must not be stolen");
  }
  let owner;
  try { owner = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw busy(lockPath, "invalid owner metadata; an unknown owner must not be stolen"); }
  if (owner.schema !== SCHEMA || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
    || typeof owner.hostname !== "string" || !/^[a-f0-9-]{36}$/.test(owner.token || "")) {
    throw busy(lockPath, "legacy or invalid owner metadata; an unknown owner must not be stolen");
  }
  return { owner, stat };
}

function removeDeadLinks(lockPath, capturedStat, capturePath) {
  const directory = path.dirname(lockPath);
  const prefix = `.${path.basename(lockPath)}.domi-${HOST_KEY}-`;
  for (const name of fs.readdirSync(directory)) {
    if (!name.startsWith(prefix)) continue;
    const match = name.slice(prefix.length).match(/^(?:owner|reclaim)-(\d+)-[a-f0-9-]{36}$/);
    if (!match || processState(Number(match[1])) !== "dead") continue;
    const file = path.join(directory, name);
    if (file === capturePath) continue;
    try {
      const stat = fs.lstatSync(file);
      // Never touch another lock's contents or an unrelated user file.
      if (stat.isFile() && sameFile(stat, capturedStat)) fs.unlinkSync(file);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function reclaimDeadOwner(lockPath) {
  let entry;
  try { entry = fs.lstatSync(lockPath); }
  catch (error) { if (error.code === "ENOENT") return true; throw error; }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw busy(lockPath, "legacy or invalid owner metadata; an unknown owner must not be stolen");
  }
  const capturePath = path.join(path.dirname(lockPath),
    `.${path.basename(lockPath)}.domi-${HOST_KEY}-reclaim-${process.pid}-${crypto.randomUUID()}`);
  try { fs.linkSync(lockPath, capturePath); }
  catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
  try {
    const { owner, stat } = readOwner(capturePath, lockPath);
    if (owner.hostname !== HOSTNAME) throw busy(lockPath, "owner belongs to another host");
    const state = processState(owner.pid);
    if (state !== "dead") throw busy(lockPath, `owner process ${owner.pid} is ${state}`);
    removeDeadLinks(lockPath, stat, capturePath);

    // A hardlink pins the exact inode we inspected. Only a sole reclaimer may
    // unlink it: canonical path + this capture must be its only two links.
    // A competing reclaimer keeps its capture until after its unlink/checks,
    // so a loser cannot remove a newly published owner at the same pathname.
    if (fs.lstatSync(capturePath).nlink !== 2) return false;
    let current;
    try { current = fs.lstatSync(lockPath); }
    catch (error) { if (error.code === "ENOENT") return true; throw error; }
    if (!sameFile(current, stat)) return true;
    if (fs.lstatSync(capturePath).nlink !== 2) return false;
    fs.unlinkSync(lockPath);
    return true;
  } finally { unlinkIfPresent(capturePath); }
}

/**
 * Synchronous, process-owned lock. No TTL can evict a living/unknown owner.
 * The returned release function is idempotent and never removes a new owner.
 * Use an explicit local lock path; foreign-host and legacy empty locks fail
 * conservatively because their original process cannot be proven dead.
 */
function acquireProcessLock(lockPath) {
  if (!path.isAbsolute(lockPath || "")) throw new Error("Process lock path must be absolute");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const token = crypto.randomUUID();
  const owner = { schema: SCHEMA, pid: process.pid, hostname: HOSTNAME, token, createdAt: Date.now() };
  const ownerPath = path.join(path.dirname(lockPath),
    `.${path.basename(lockPath)}.domi-${HOST_KEY}-owner-${process.pid}-${token}`);
  let acquiredStat;
  const fd = fs.openSync(ownerPath, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(owner)}\n`);
    fs.fsyncSync(fd);
  } catch (error) {
    unlinkIfPresent(ownerPath);
    throw error;
  } finally { fs.closeSync(fd); }
  try {
    const deadline = performance.now() + MAX_CONTENTION_MS;
    for (let attempt = 0; ; attempt += 1) {
      try {
        // Atomic publication of already-complete metadata: there is no empty
        // canonical lock if the process exits between creation and writing.
        fs.linkSync(ownerPath, lockPath);
        acquiredStat = fs.lstatSync(ownerPath);
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const reclaimed = reclaimDeadOwner(lockPath);
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw busy(lockPath, "another recovery is in progress; retry after it finishes");
        // The capture has already been removed by reclaimDeadOwner's finally.
        // Jitter prevents simultaneous reclaimers repeatedly pinning each
        // other's inode until all exhaust their retries. This is contention
        // backoff only: live/unknown owners throw above and are never timed out.
        if (!reclaimed || attempt > 0) {
          Atomics.wait(CONTENTION_WAIT, 0, 0,
            Math.min(remaining, crypto.randomInt(1, Math.min(26, 5 + attempt * 2))));
        }
      }
    }
  } finally { unlinkIfPresent(ownerPath); }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    let current;
    try { current = fs.lstatSync(lockPath); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (sameFile(current, acquiredStat)) fs.unlinkSync(lockPath);
  };
}

module.exports = { acquireProcessLock };
