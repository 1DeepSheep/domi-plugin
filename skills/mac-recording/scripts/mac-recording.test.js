#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'domi-mac-recording-test-'));
process.env.DOMI_MAC_RECORDING_STATE_DIR = path.join(sandbox, 'state');
process.env.DOMI_MAC_RECORDING_CACHE_DIR = path.join(sandbox, 'cache');

const { __test } = require('./mac-recording.js');

function makeState(overrides = {}) {
  const sessionId = overrides.sessionId || '0123456789abcdef';
  const outputPath = overrides.outputPath || path.join(sandbox, 'recording.m4a');
  const base = outputPath.replace(/\.m4a$/i, '');
  const controlDir = path.join(__test.STATE_ROOT, 'sessions', sessionId);
  return {
    version: __test.VERSION,
    sessionId,
    token: 'a'.repeat(32),
    uid: __test.UID,
    binaryPath: __test.BINARY,
    pid: 4242,
    outputPath,
    workingPath: `${base}.partial.m4a`,
    logPath: `${base}.stdout.log`,
    errorLogPath: `${base}.stderr.log`,
    controlDir,
    stopRequestPath: path.join(controlDir, 'stop-request.json'),
    readyReceiptPath: path.join(controlDir, 'recording-ready.json'),
    startedAt: '2026-07-12T17:04:31Z',
    processStartedAt: 'Mon Jul 13 01:04:31 2026',
    ...overrides,
  };
}

function matchingSnapshot(state, overrides = {}) {
  return {
    uid: state.uid,
    startedAt: state.processStartedAt,
    processState: 'S',
    command: `${state.binaryPath} record --output ${state.outputPath} --session-id ${state.sessionId} --token ${state.token}`,
    ...overrides,
  };
}

function writeSilentWav(file, durationSec = 0.2, sampleRate = 8000) {
  const sampleCount = Math.max(1, Math.round(durationSec * sampleRate));
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(file, buffer, { mode: 0o600 });
}

function makeSilentM4a(file) {
  const wav = `${file}.wav`;
  writeSilentWav(wav);
  const converted = spawnSync('/usr/bin/afconvert', [
    wav, file, '-f', 'm4af', '-d', 'aac', '-q', '127',
  ], { encoding: 'utf8' });
  assert.equal(converted.status, 0, converted.stderr || converted.stdout);
  fs.chmodSync(file, 0o600);
  fs.unlinkSync(wav);
}

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('parses uid, start time, state, and command from one ps snapshot', () => {
  const parsed = __test.parsePsSnapshot(
    '  501 Mon Jul 13 01:04:31 2026     S+   /tmp/DomiMacRecorder record --token abc\n',
  );
  assert.deepEqual(parsed, {
    uid: 501,
    startedAt: 'Mon Jul 13 01:04:31 2026',
    processState: 'S+',
    command: '/tmp/DomiMacRecorder record --token abc',
  });
});

test('real ps snapshot preserves a Unicode output path', async () => {
  const unicodePath = path.join(sandbox, '测试一下这个skill效果.m4a');
  const child = spawn(process.execPath, [
    '-e', 'process.stdin.resume()', '--', __test.BINARY, unicodePath,
  ], { stdio: ['pipe', 'ignore', 'ignore'] });
  const snapshot = __test.queryProcessSnapshot(child.pid);
  assert.equal(snapshot.command.includes(unicodePath), true);
  child.stdin.end();
  await new Promise((resolve) => child.once('exit', resolve));
});

test('treats a zombie as exited even when its command line is truncated', () => {
  const state = makeState();
  const result = __test.classifyProcessSnapshot(state, matchingSnapshot(state, {
    processState: 'Z',
    command: '(DomiMacRecorder)',
  }));
  assert.equal(result.running, false);
  assert.equal(result.exitState, 'zombie');
});

test('refuses an unrelated live process before creating a stop request', () => {
  const state = makeState();
  assert.throws(
    () => __test.classifyProcessSnapshot(state, matchingSnapshot(state, {
      command: '/usr/bin/unrelated-process',
    })),
    (error) => error instanceof __test.CliError && error.code === 'UNSAFE_PROCESS',
  );
});

test('treats a replacement PID as the original recorder having exited after stop was requested', () => {
  const state = makeState();
  const result = __test.classifyProcessSnapshot(state, matchingSnapshot(state, {
    command: '/usr/bin/unrelated-process',
  }), { allowIdentityMismatchAsStopped: true });
  assert.equal(result.running, false);
  assert.equal(result.exitState, 'replaced');
});

test('wait-for-exit accepts a fast transition from matching to replaced without signaling again', async () => {
  const state = makeState();
  const sequence = [
    { running: true, identityMatches: true },
    { running: false, identityMatches: false, exitState: 'replaced' },
  ];
  const result = await __test.waitForProcess(state, false, 1000, {
    query: () => sequence.shift(),
    pause: async () => {},
  });
  assert.equal(result.running, false);
  assert.equal(result.exitState, 'replaced');
  assert.equal(sequence.length, 0);
});

test('private stop request is mode 0600, authenticated, and idempotent', () => {
  const state = makeState({ sessionId: '1111111111111111' });
  fs.mkdirSync(state.controlDir, { recursive: true, mode: 0o700 });
  const inspectProcess = () => ({ running: true, identityMatches: true });

  assert.equal(__test.writeStopRequestFile(state, { inspectProcess }), true);
  assert.equal(__test.writeStopRequestFile(state, { inspectProcess }), true);

  const request = JSON.parse(fs.readFileSync(state.stopRequestPath, 'utf8'));
  assert.equal(request.sessionId, state.sessionId);
  assert.equal(request.token, state.token);
  assert.equal(fs.statSync(state.stopRequestPath).mode & 0o777, 0o600);
});

test('a process verified by the caller is not re-probed before the harmless file request is written', () => {
  const state = makeState({ sessionId: '4444444444444444' });
  fs.mkdirSync(state.controlDir, { recursive: true, mode: 0o700 });
  assert.equal(__test.writeStopRequestFile(state, {
    processVerified: true,
    inspectProcess: () => { throw new Error('must not be called'); },
  }), true);
  assert.equal(fs.existsSync(state.stopRequestPath), true);
});

test('an unrelated pre-existing stop request is never reused', () => {
  const state = makeState({ sessionId: '2222222222222222' });
  fs.mkdirSync(state.controlDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(state.stopRequestPath, JSON.stringify({
    sessionId: 'ffffffffffffffff',
    token: 'b'.repeat(32),
  }), { mode: 0o600 });

  assert.throws(
    () => __test.writeStopRequestFile(state, {
      inspectProcess: () => ({ running: true, identityMatches: true }),
    }),
    (error) => error instanceof __test.CliError && error.code === 'STOP_REQUEST_CONFLICT',
  );
});

test('ready receipt is private and bound to the active session', () => {
  const state = makeState({ sessionId: 'abababababababab' });
  fs.mkdirSync(state.controlDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(state.readyReceiptPath, `${JSON.stringify({
    event: 'recording_started',
    sessionId: state.sessionId,
    token: state.token,
    outputPath: state.outputPath,
    workingPath: state.workingPath,
    startedAt: state.startedAt,
  })}\n`, { mode: 0o600 });

  assert.equal(__test.readStartReceipt(state).sessionId, state.sessionId);
  fs.chmodSync(state.readyReceiptPath, 0o644);
  assert.throws(
    () => __test.readStartReceipt(state),
    (error) => error instanceof __test.CliError && error.code === 'UNSAFE_START_RECEIPT',
  );
});

test('ready receipt confirms start without a 250ms polling delay', async () => {
  const state = makeState({ sessionId: 'acacacacacacacac' });
  const receipt = {
    event: 'recording_started',
    sessionId: state.sessionId,
    token: state.token,
    outputPath: state.outputPath,
    workingPath: state.workingPath,
    startedAt: state.startedAt,
  };
  let queryCount = 0;
  const result = await __test.waitForRecordingStart(state, 1000, {
    initialInfo: { running: true, identityMatches: true },
    readReceipt: () => receipt,
    query: () => {
      queryCount += 1;
      return { running: true, identityMatches: true };
    },
    processStillExists: () => { throw new Error('must not be called after receipt'); },
    pause: async () => { throw new Error('must not pause after receipt'); },
  });
  assert.equal(result.started, true);
  assert.equal(result.event, receipt);
  assert.equal(queryCount, 1);
});

test('readiness pipe uses the existing identity snapshot without another ps probe', async () => {
  const state = makeState({ sessionId: 'adadadadadadadad' });
  const event = {
    event: 'recording_started',
    sessionId: state.sessionId,
    pid: state.pid,
    outputPath: state.outputPath,
    workingPath: state.workingPath,
    startedAt: state.startedAt,
  };
  const result = await __test.waitForRecordingStart(state, 1000, {
    initialInfo: { running: true, identityMatches: true },
    readySignal: {
      promise: Promise.resolve({ received: true, event }),
      cancel: () => {},
    },
    query: () => { throw new Error('must not run a second ps probe'); },
  });
  assert.equal(result.started, true);
  assert.equal(result.event, event);
});

test('asynchronous helper spawn failure is rejected before any PID can be persisted', async () => {
  const state = makeState({
    sessionId: '8888888888888888',
    outputPath: path.join(sandbox, 'spawn-failure.m4a'),
  });
  const base = state.outputPath.replace(/\.m4a$/i, '');
  state.workingPath = `${base}.partial.m4a`;
  state.logPath = `${base}.stdout.log`;
  state.errorLogPath = `${base}.stderr.log`;
  delete state.pid;
  fs.mkdirSync(state.controlDir, { recursive: true, mode: 0o700 });

  const spawnImpl = () => {
    const child = new EventEmitter();
    child.pid = undefined;
    child.unref = () => {};
    queueMicrotask(() => child.emit('error', Object.assign(new Error('synthetic EAGAIN'), { code: 'EAGAIN' })));
    return child;
  };
  await assert.rejects(
    __test.spawnRecorder(state, { spawnImpl }),
    (error) => error instanceof __test.CliError && error.code === 'SPAWN_FAILED',
  );
  assert.equal(state.pid, undefined);
});

test('spawned helper confirms readiness over the inherited pipe', async () => {
  const state = makeState({
    sessionId: '8989898989898989',
    outputPath: path.join(sandbox, 'ready-pipe.m4a'),
  });
  const base = state.outputPath.replace(/\.m4a$/i, '');
  state.workingPath = `${base}.partial.m4a`;
  state.logPath = `${base}.stdout.log`;
  state.errorLogPath = `${base}.stderr.log`;
  const readyStream = new PassThrough();
  const fakeChild = new EventEmitter();
  fakeChild.pid = 5151;
  fakeChild.stdio = [null, null, null, readyStream];
  fakeChild.unref = () => {};
  const spawnImpl = () => {
    queueMicrotask(() => {
      fakeChild.emit('spawn');
      queueMicrotask(() => readyStream.write(`${JSON.stringify({
        event: 'recording_started',
        sessionId: state.sessionId,
        pid: fakeChild.pid,
        outputPath: state.outputPath,
        workingPath: state.workingPath,
        startedAt: state.startedAt,
      })}\n`));
    });
    return fakeChild;
  };

  const spawned = await __test.spawnRecorder(state, { spawnImpl });
  const outcome = await spawned.readySignal.promise;
  assert.equal(spawned.pid, fakeChild.pid);
  assert.equal(outcome.received, true);
  assert.equal(outcome.event.sessionId, state.sessionId);
});

test('real readiness pipe listeners and stream are released on timeout', async () => {
  const state = makeState({
    sessionId: '8c8c8c8c8c8c8c8c',
    outputPath: path.join(sandbox, 'ready-timeout.m4a'),
  });
  const base = state.outputPath.replace(/\.m4a$/i, '');
  state.workingPath = `${base}.partial.m4a`;
  state.logPath = `${base}.stdout.log`;
  state.errorLogPath = `${base}.stderr.log`;
  const readyStream = new PassThrough();
  const fakeChild = new EventEmitter();
  fakeChild.pid = 5252;
  fakeChild.stdio = [null, null, null, readyStream];
  fakeChild.unref = () => {};
  const spawnImpl = () => {
    queueMicrotask(() => fakeChild.emit('spawn'));
    return fakeChild;
  };
  const spawned = await __test.spawnRecorder(state, { spawnImpl });
  const result = await __test.waitForRecordingStart(state, 15, {
    initialInfo: { running: true, identityMatches: true },
    readySignal: spawned.readySignal,
    query: () => ({ running: true, identityMatches: true }),
  });
  assert.equal(result.started, false);
  assert.equal(readyStream.destroyed, true);
  assert.equal(readyStream.listenerCount('data'), 0);
  assert.equal(fakeChild.listenerCount('exit'), 0);
});

test('readiness timeout cancels the pipe lifecycle before returning', async () => {
  const state = makeState({ sessionId: '8a8a8a8a8a8a8a8a' });
  let cancelled = false;
  let resolveSignal;
  const readySignal = {
    promise: new Promise((resolve) => { resolveSignal = resolve; }),
    cancel: () => {
      cancelled = true;
      resolveSignal({ received: false, cancelled: true });
    },
  };
  const result = await __test.waitForRecordingStart(state, 15, {
    initialInfo: { running: true, identityMatches: true },
    readySignal,
    query: () => ({ running: true, identityMatches: true }),
  });
  assert.equal(cancelled, true);
  assert.equal(result.started, false);
});

test('pipe timeout never accepts a log-only recording_started fallback', async () => {
  const state = makeState({ sessionId: '8e8e8e8e8e8e8e8e' });
  fs.writeFileSync(state.logPath, `${JSON.stringify({
    event: 'recording_started',
    sessionId: state.sessionId,
    outputPath: state.outputPath,
    workingPath: state.workingPath,
    startedAt: state.startedAt,
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(state.errorLogPath, '', { mode: 0o600 });
  let resolveSignal;
  const readySignal = {
    promise: new Promise((resolve) => { resolveSignal = resolve; }),
    cancel: () => resolveSignal({ received: false, cancelled: true }),
  };
  const result = await __test.waitForRecordingStart(state, 15, {
    initialInfo: { running: true, identityMatches: true },
    readySignal,
    readReceipt: () => { throw new Error('fd3 timeout must not fall back to a receipt'); },
    query: () => { throw new Error('fd3 timeout must not run a fallback identity probe'); },
  });
  assert.equal(result.started, false);
  assert.equal(result.event, null);
  assert.equal(result.readyError.code, 'START_READY_TIMEOUT');
  assert.equal(result.events.some((event) => event.event === 'recording_started'), true);
});

test('malformed readiness acknowledgement becomes a recoverable start result', async () => {
  const state = makeState({ sessionId: '8b8b8b8b8b8b8b8b' });
  const readyError = new __test.CliError('INVALID_START_ACK', 'synthetic malformed acknowledgement');
  const result = await __test.waitForRecordingStart(state, 1000, {
    initialInfo: { running: true, identityMatches: true },
    readySignal: {
      promise: Promise.resolve({ received: false, error: readyError }),
      cancel: () => {},
    },
  });
  assert.equal(result.started, false);
  assert.equal(result.info.running, true);
  assert.equal(result.readyError, readyError);
});

test('readiness error requests authenticated stop and archives before surfacing the error', async () => {
  const state = makeState({ sessionId: '8d8d8d8d8d8d8d8d' });
  const readyError = new __test.CliError('INVALID_START_ACK', 'synthetic malformed acknowledgement');
  let stopRequested = false;
  let persistedStatus = null;
  let archived = false;
  await assert.rejects(
    __test.settleUnconfirmedStart(
      state,
      { running: true, identityMatches: true },
      { started: false, readyError },
      {
        requestStop: (_state, options) => {
          stopRequested = options.processVerified;
          return true;
        },
        persistState: (value) => { persistedStatus = value.status; },
        waitProcess: async () => ({ running: false, exitState: 'missing' }),
        waitFinalization: async () => ({ ready: true }),
        archive: () => {
          archived = true;
          return { completed: true, status: 'completed', audioPath: state.outputPath };
        },
      },
    ),
    (error) => error instanceof __test.CliError &&
      error.code === 'INVALID_START_ACK' && error.details.cleanup.completed === true,
  );
  assert.equal(stopRequested, true);
  assert.equal(persistedStatus, 'stop_requested');
  assert.equal(archived, true);
});

test('final audio alone is not terminal; stopped receipt plus final audio is terminal', () => {
  const state = makeState({ sessionId: '3333333333333333' });
  fs.writeFileSync(state.outputPath, 'not-real-audio', { mode: 0o600 });
  fs.writeFileSync(state.logPath, '', { mode: 0o600 });
  fs.writeFileSync(state.errorLogPath, '', { mode: 0o600 });

  assert.equal(__test.finalizationSnapshot(state).ready, false);
  fs.appendFileSync(state.logPath, `${JSON.stringify({
    event: 'recording_stopped',
    stoppedAt: '2026-07-12T17:07:29Z',
    reason: 'stop_request',
  })}\n`);
  assert.equal(__test.finalizationSnapshot(state).ready, true);
});

test('valid audio is completed only when a stopped receipt exists and no error was emitted', () => {
  const audio = { ok: true, bytes: 1234 };
  const stopped = { event: 'recording_stopped' };
  assert.equal(__test.isCompletedRecording(audio, null, null), false);
  assert.equal(__test.isCompletedRecording(audio, stopped, null), true);
  assert.equal(__test.isCompletedRecording(audio, { ...stopped, successful: false }, null), false);
  assert.equal(__test.isCompletedRecording(audio, stopped, { event: 'error' }), false);
});

test('verifyAudio accepts a real synthetic M4A through afinfo and rejects a non-audio file', () => {
  const valid = path.join(sandbox, 'synthetic.m4a');
  const invalid = path.join(sandbox, 'invalid.m4a');
  makeSilentM4a(valid);
  fs.writeFileSync(invalid, 'not audio', { mode: 0o600 });

  const verified = __test.verifyAudio(valid);
  assert.equal(verified.ok, true);
  assert.ok(verified.durationSec > 0);
  assert.equal(__test.verifyAudio(invalid).ok, false);
});

test('dry-run reports phase timings without opening the microphone', () => {
  const result = spawnSync(process.execPath, [
    path.join(__dirname, 'mac-recording.js'),
    'start', '--dry-run', '--out-dir', path.join(sandbox, 'dry-run-output'), '--name', 'latency-check',
    '--workflow-kind', 'quick-discussion',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOMI_MAC_RECORDING_STATE_DIR: __test.STATE_ROOT,
      DOMI_MAC_RECORDING_CACHE_DIR: __test.CACHE_ROOT,
    },
    timeout: 120000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.microphoneOpened, false);
  assert.equal(payload.workflowKind, 'quick-discussion');
  assert.match(payload.workflowId, /^[a-f0-9]{16}$/);
  for (const field of ['lockMs', 'preflightMs', 'buildMs', 'permissionMs', 'spawnMs', 'identityMs', 'readyMs', 'totalMs']) {
    assert.equal(typeof payload.timings[field], 'number', field);
    assert.ok(payload.timings[field] >= 0, field);
  }
  assert.equal(typeof payload.timings.buildCacheHit, 'boolean');
  assert.equal(payload.timings.readyTransport, 'not_started');
  assert.equal(payload.timings.identityProbeCount, 0);
  assert.ok(payload.timings.totalMs >= payload.timings.buildMs);
});

test('compiled Swift helper accepts only a matching session and token without opening the microphone', () => {
  const doctor = spawnSync(process.execPath, [path.join(__dirname, 'mac-recording.js'), 'doctor'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOMI_MAC_RECORDING_STATE_DIR: __test.STATE_ROOT,
      DOMI_MAC_RECORDING_CACHE_DIR: __test.CACHE_ROOT,
    },
    timeout: 120000,
  });
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  assert.equal(JSON.parse(doctor.stdout).microphoneOpened, false);

  const requestPath = path.join(sandbox, 'swift-auth-request.json');
  const sessionId = '7777777777777777';
  const token = 'e'.repeat(32);
  fs.writeFileSync(requestPath, `${JSON.stringify({ sessionId, token })}\n`, { mode: 0o600 });

  const accepted = spawnSync(__test.BINARY, [
    'verify-stop-request', '--stop-file', requestPath, '--session-id', sessionId, '--token', token,
  ], { encoding: 'utf8' });
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  assert.equal(JSON.parse(accepted.stdout).matches, true);

  const rejected = spawnSync(__test.BINARY, [
    'verify-stop-request', '--stop-file', requestPath, '--session-id', sessionId, '--token', 'f'.repeat(32),
  ], { encoding: 'utf8' });
  assert.equal(rejected.status, 4);
  assert.equal(JSON.parse(rejected.stdout).matches, false);

  const wrongSession = spawnSync(__test.BINARY, [
    'verify-stop-request', '--stop-file', requestPath,
    '--session-id', '9999999999999999', '--token', token,
  ], { encoding: 'utf8' });
  assert.equal(wrongSession.status, 4);
  assert.equal(JSON.parse(wrongSession.stdout).matches, false);
});

test('stop main flow uses one authenticated file request and completes without microphone or signals', async () => {
  const state = makeState({
    sessionId: '5555555555555555',
    token: 'c'.repeat(32),
    outputPath: path.join(sandbox, 'e2e-recording.m4a'),
  });
  const base = state.outputPath.replace(/\.m4a$/i, '');
  state.workingPath = `${base}.partial.m4a`;
  state.logPath = `${base}.stdout.log`;
  state.errorLogPath = `${base}.stderr.log`;
  const fixture = path.join(sandbox, 'e2e-fixture.m4a');
  makeSilentM4a(fixture);
  fs.mkdirSync(state.controlDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(state.logPath, `${JSON.stringify({
    event: 'recording_started',
    startedAt: state.startedAt,
    workingPath: state.workingPath,
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(state.errorLogPath, '', { mode: 0o600 });

  const fakeHelper = path.join(sandbox, 'fake-recorder.js');
  fs.writeFileSync(fakeHelper, `
    'use strict';
    const fs = require('node:fs');
    const [stopFile, sessionId, token, output, log, fixture] = process.argv.slice(2, 8);
    const timer = setInterval(() => {
      if (!fs.existsSync(stopFile)) return;
      const request = JSON.parse(fs.readFileSync(stopFile, 'utf8'));
      if (request.sessionId !== sessionId || request.token !== token) return;
      fs.copyFileSync(fixture, output);
      fs.chmodSync(output, 0o600);
      fs.appendFileSync(log, JSON.stringify({
        event: 'recording_stopped',
        successful: true,
        reason: 'stop_request',
        stoppedAt: new Date().toISOString(),
      }) + '\\n');
      clearInterval(timer);
      process.exit(0);
    }, 20);
  `, { mode: 0o600 });

  const fake = spawn(process.execPath, [
    fakeHelper,
    state.stopRequestPath,
    state.sessionId,
    state.token,
    state.outputPath,
    state.logPath,
    fixture,
    __test.BINARY,
  ], { stdio: 'ignore' });
  state.pid = fake.pid;
  state.processStartedAt = null;
  fs.mkdirSync(__test.STATE_ROOT, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(__test.STATE_ROOT, 'active.json'), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  const stopped = spawnSync(process.execPath, [path.join(__dirname, 'mac-recording.js'), 'stop'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOMI_MAC_RECORDING_STATE_DIR: __test.STATE_ROOT,
      DOMI_MAC_RECORDING_CACHE_DIR: __test.CACHE_ROOT,
    },
    timeout: 10000,
  });
  if (fake.exitCode === null) await new Promise((resolve) => fake.once('exit', resolve));

  assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout);
  const result = JSON.parse(stopped.stdout);
  assert.equal(result.completed, true);
  assert.equal(result.reason, 'stop_request');
  assert.equal(result.stopped, true);
  assert.equal(fs.existsSync(state.stopRequestPath), false);
  assert.equal(fs.existsSync(path.join(__test.STATE_ROOT, 'active.json')), false);
});

test('status recovers a completed stop after the recorder PID has been reused without touching the new process', async () => {
  const state = makeState({
    sessionId: '6666666666666666',
    token: 'd'.repeat(32),
    outputPath: path.join(sandbox, 'replacement-recovery.m4a'),
    status: 'stop_requested',
    stopRequestedAt: new Date().toISOString(),
  });
  const base = state.outputPath.replace(/\.m4a$/i, '');
  state.workingPath = `${base}.partial.m4a`;
  state.logPath = `${base}.stdout.log`;
  state.errorLogPath = `${base}.stderr.log`;
  makeSilentM4a(state.outputPath);
  fs.writeFileSync(state.logPath, `${JSON.stringify({
    event: 'recording_stopped',
    successful: true,
    reason: 'stop_request',
    stoppedAt: new Date().toISOString(),
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(state.errorLogPath, '', { mode: 0o600 });
  fs.mkdirSync(state.controlDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(state.stopRequestPath, `${JSON.stringify({
    version: __test.VERSION,
    sessionId: state.sessionId,
    token: state.token,
  })}\n`, { mode: 0o600 });

  const replacement = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  state.pid = replacement.pid;
  state.processStartedAt = null;
  fs.writeFileSync(path.join(__test.STATE_ROOT, 'active.json'), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  const recovered = spawnSync(process.execPath, [path.join(__dirname, 'mac-recording.js'), 'status'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOMI_MAC_RECORDING_STATE_DIR: __test.STATE_ROOT,
      DOMI_MAC_RECORDING_CACHE_DIR: __test.CACHE_ROOT,
    },
    timeout: 10000,
  });
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  assert.equal(JSON.parse(recovered.stdout).completed, true);
  assert.equal(replacement.exitCode, null);
  replacement.stdin.end();
  await new Promise((resolve) => replacement.once('exit', resolve));
});
