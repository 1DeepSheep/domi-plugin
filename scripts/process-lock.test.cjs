const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { acquireProcessLock } = require("./process-lock.cjs");
const modulePath = path.join(__dirname, "process-lock.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-process-lock-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, lockPath: path.join(root, "resource.lock") };
}

function child(t, lockPath, mode = "hold") {
  const script = `
    const { acquireProcessLock } = require(process.argv[1]);
    const lockPath = process.argv[2], mode = process.argv[3];
    function acquire() {
      try {
        const release = acquireProcessLock(lockPath);
        process.send({ status: 'acquired' });
        if (mode === 'exit') process.exit(0);
        process.on('message', message => { if (message === 'release') { release(); process.exit(0); } });
        setInterval(() => {}, 1000);
      } catch (error) { process.send({ status: 'blocked', code: error.code, message: error.message }); process.exit(0); }
    }
    if (mode === 'race') { process.send({ status: 'ready' }); process.once('message', acquire); }
    else acquire();
  `;
  const processChild = spawn(process.execPath, ["-e", script, modulePath, lockPath, mode], {
    stdio: ["ignore", "pipe", "pipe", "ipc"], env: { PATH: process.env.PATH }
  });
  t.after(() => { if (processChild.exitCode === null && processChild.signalCode === null) processChild.kill("SIGKILL"); });
  return processChild;
}

async function message(processChild) {
  return Promise.race([
    once(processChild, "message").then(([value]) => value),
    once(processChild, "error").then(([error]) => { throw error; })
  ]);
}

async function stop(processChild, signal = "SIGKILL") {
  const exited = once(processChild, "exit");
  processChild.kill(signal);
  await exited;
}

test("a real live owner is never evicted by old timestamps; release is idempotent", { timeout: 10000 }, async t => {
  const f = fixture(t), owner = child(t, f.lockPath);
  assert.equal((await message(owner)).status, "acquired");
  const old = new Date("2000-01-01T00:00:00Z"); fs.utimesSync(f.lockPath, old, old);
  assert.throws(() => acquireProcessLock(f.lockPath), error => error.code === "EEXIST" && /alive/.test(error.message));
  const exited = once(owner, "exit"); owner.send("release"); await exited;
  const release = acquireProcessLock(f.lockPath);
  release(); release();
  assert.equal(fs.existsSync(f.lockPath), false);
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test("normal process exit without cleanup and SIGKILL both permit verified recovery", { timeout: 10000 }, async t => {
  for (const mode of ["exit", "hold"]) {
    const f = fixture(t), owner = child(t, f.lockPath, mode);
    const exited = once(owner, "exit");
    assert.equal((await message(owner)).status, "acquired");
    const metadata = JSON.parse(fs.readFileSync(f.lockPath, "utf8"));
    assert.equal(metadata.pid, owner.pid);
    assert.equal(metadata.schema, "domi.process-lock.v1");
    if (mode === "hold") owner.kill("SIGKILL");
    await exited;
    const release = acquireProcessLock(f.lockPath);
    assert.equal(JSON.parse(fs.readFileSync(f.lockPath, "utf8")).pid, process.pid);
    release();
    assert.deepEqual(fs.readdirSync(f.root), []);
  }
});

test("eight rounds of simultaneous recovery elect one owner and never overlap", { timeout: 15000 }, async t => {
  const f = fixture(t);
  for (let round = 0; round < 8; round += 1) {
    const old = child(t, f.lockPath);
    assert.equal((await message(old)).status, "acquired");
    await stop(old);
    const workers = Array.from({ length: 8 }, () => child(t, f.lockPath, "race"));
    const exits = workers.map(worker => once(worker, "exit"));
    await Promise.all(workers.map(async worker => assert.equal((await message(worker)).status, "ready")));
    const responses = workers.map(worker => message(worker));
    for (const worker of workers) worker.send("go");
    const results = await Promise.all(responses);
    const winners = results.flatMap((result, i) => result.status === "acquired" ? [workers[i]] : []);
    // Every winner keeps its critical section open until explicitly killed.
    // A second success would therefore be an overlapping lock acquisition.
    assert.equal(winners.length, 1, `round ${round}: ${JSON.stringify(results)}`);
    assert.equal(JSON.parse(fs.readFileSync(f.lockPath, "utf8")).pid, winners[0].pid);
    assert.throws(() => acquireProcessLock(f.lockPath), error => error.code === "EEXIST");
    await stop(winners[0]);
    await Promise.all(exits);
    const release = acquireProcessLock(f.lockPath); release();
    assert.deepEqual(fs.readdirSync(f.root), []);
  }
});

test("dead publisher and dead reclaimer hardlinks are recovered after crashes", { timeout: 10000 }, async t => {
  const f = fixture(t), owner = child(t, f.lockPath);
  assert.equal((await message(owner)).status, "acquired");
  const metadata = JSON.parse(fs.readFileSync(f.lockPath, "utf8"));
  const crypto = require("node:crypto");
  const host = crypto.createHash("sha256").update(os.hostname()).digest("hex").slice(0, 16);
  // Simulate death immediately after atomic publication or while inspecting a
  // stale lock. Both links contain the complete same inode, never empty data.
  for (const kind of ["owner", "reclaim"]) {
    fs.linkSync(f.lockPath, path.join(f.root, `.resource.lock.domi-${host}-${kind}-${owner.pid}-${crypto.randomUUID()}`));
  }
  await stop(owner);
  const release = acquireProcessLock(f.lockPath);
  assert.notEqual(JSON.parse(fs.readFileSync(f.lockPath, "utf8")).token, metadata.token);
  release();
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test("an unfinished concurrent recovery has a bounded wait and remains intact", { timeout: 10000 }, async t => {
  const f = fixture(t), owner = child(t, f.lockPath);
  assert.equal((await message(owner)).status, "acquired");
  await stop(owner);
  const crypto = require("node:crypto");
  const host = crypto.createHash("sha256").update(os.hostname()).digest("hex").slice(0, 16);
  const capture = path.join(f.root, `.resource.lock.domi-${host}-reclaim-${process.pid}-${crypto.randomUUID()}`);
  fs.linkSync(f.lockPath, capture);
  const started = performance.now();
  assert.throws(() => acquireProcessLock(f.lockPath), error => error.code === "EEXIST" && /recovery is in progress/.test(error.message));
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 900 && elapsed < 5000, `bounded 1-second backoff took ${elapsed} ms`);
  assert.equal(fs.existsSync(capture), true);
  assert.equal(fs.existsSync(f.lockPath), true);
  fs.unlinkSync(capture);
  const release = acquireProcessLock(f.lockPath); release();
});

test("foreign, legacy, symlink and unidentifiable locks are never silently stolen", t => {
  const f = fixture(t);
  fs.writeFileSync(f.lockPath, "");
  assert.throws(() => acquireProcessLock(f.lockPath), /legacy or invalid owner/);
  fs.unlinkSync(f.lockPath);
  const release = acquireProcessLock(f.lockPath);
  const metadata = JSON.parse(fs.readFileSync(f.lockPath, "utf8")); release();
  fs.writeFileSync(f.lockPath, JSON.stringify({ ...metadata, hostname: "other-synthetic-host" }));
  assert.throws(() => acquireProcessLock(f.lockPath), /another host/);
  fs.unlinkSync(f.lockPath);
  const target = path.join(f.root, "user-file"); fs.writeFileSync(target, "preserve me"); fs.symlinkSync(target, f.lockPath);
  assert.throws(() => acquireProcessLock(f.lockPath), /legacy or invalid owner/);
  assert.equal(fs.readFileSync(target, "utf8"), "preserve me");
});

test("late release does not unlink a replacement inode", t => {
  const f = fixture(t), release = acquireProcessLock(f.lockPath);
  fs.renameSync(f.lockPath, path.join(f.root, "original.lock"));
  const newerRelease = acquireProcessLock(f.lockPath);
  release();
  assert.equal(fs.existsSync(f.lockPath), true);
  newerRelease();
});
