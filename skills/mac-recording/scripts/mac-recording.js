#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { performance } = require('perf_hooks');

const VERSION = 2;
const UID = typeof process.getuid === 'function' ? process.getuid() : null;
const SCRIPT_DIR = __dirname;
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const SWIFT_SOURCE = path.join(SCRIPT_DIR, 'MacRecorder.swift');
const CACHE_ROOT = path.resolve(
  process.env.DOMI_MAC_RECORDING_CACHE_DIR || path.join(os.homedir(), '.cache', 'domi', 'mac-recording'),
);
const STATE_ROOT = path.resolve(
  process.env.DOMI_MAC_RECORDING_STATE_DIR || path.join(os.homedir(), '.domi', 'mac-recording'),
);
const APP_ROOT = path.join(CACHE_ROOT, 'DomiMacRecorder.app');
const CONTENTS_DIR = path.join(APP_ROOT, 'Contents');
const BINARY = path.join(CONTENTS_DIR, 'MacOS', 'DomiMacRecorder');
const INFO_PLIST_PATH = path.join(CONTENTS_DIR, 'Info.plist');
const BUILD_STAMP = path.join(CACHE_ROOT, 'build.sha256');
const ACTIVE_STATE = path.join(STATE_ROOT, 'active.json');
const LAST_STATE = path.join(STATE_ROOT, 'last.json');
const LOCK_FILE = path.join(STATE_ROOT, 'command.lock');

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>Domi Mac Recording</string>
  <key>CFBundleExecutable</key><string>DomiMacRecorder</string>
  <key>CFBundleIdentifier</key><string>com.domi.mac-recording</string>
  <key>CFBundleName</key><string>Domi Mac Recording</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>Domi uses the microphone only when you explicitly start a local recording.</string>
</dict>
</plist>
`;

class CliError extends Error {
  constructor(code, message, details = {}, exitCode = 1) {
    super(message);
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

function emit(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function roundMs(value) {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function startTimingSnapshot(timings, commandStartedAt) {
  return {
    buildCacheHit: Boolean(timings.buildCacheHit),
    readyTransport: timings.readyTransport || 'not_started',
    identityProbeCount: Number(timings.identityProbeCount || 0),
    lockMs: roundMs(timings.lockMs || 0),
    preflightMs: roundMs(timings.preflightMs || 0),
    buildMs: roundMs(timings.buildMs || 0),
    permissionMs: roundMs(timings.permissionMs || 0),
    spawnMs: roundMs(timings.spawnMs || 0),
    identityMs: roundMs(timings.identityMs || 0),
    readyMs: roundMs(timings.readyMs || 0),
    totalMs: roundMs(performance.now() - commandStartedAt),
  };
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

function ensureRecordingDir(dir) {
  if (fs.existsSync(dir)) {
    if (!fs.statSync(dir).isDirectory()) {
      throw new CliError('INVALID_OUTPUT_DIR', `Recording output parent is not a directory: ${dir}`);
    }
    return;
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

function atomicWriteJson(file, value) {
  ensurePrivateDir(path.dirname(file));
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('INVALID_STATE', `Invalid JSON object in ${file}`);
  }
  return parsed;
}

function safeUnlink(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function withLock(callback) {
  ensurePrivateDir(STATE_ROOT);
  let fd;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fd = fs.openSync(LOCK_FILE, 'wx', 0o600);
      fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        if (!Number.isInteger(lock.pid) || lock.pid <= 0) {
          stale = true;
        } else {
          try { process.kill(lock.pid, 0); } catch (processError) {
            if (processError.code === 'ESRCH') stale = true;
          }
        }
      } catch (_) {
        const ageMs = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
        stale = ageMs > 10000;
      }
      if (stale && attempt === 0) {
        safeUnlink(LOCK_FILE);
        continue;
      }
      throw new CliError('COMMAND_IN_PROGRESS', 'Another Mac recording command is already running');
    }
  }
  if (fd === undefined) throw new CliError('COMMAND_IN_PROGRESS', 'Could not acquire the recording command lock');
  try {
    return await callback();
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
    safeUnlink(LOCK_FILE);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function tail(file, maxBytes = 6000) {
  if (!file || !fs.existsSync(file)) return '';
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function parseLastJson(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object') return value;
    } catch (_) {}
  }
  return null;
}

function buildHelper() {
  if (process.platform !== 'darwin') {
    throw new CliError('UNSUPPORTED_PLATFORM', 'mac-recording requires macOS');
  }
  if (!fs.existsSync(SWIFT_SOURCE)) {
    throw new CliError('MISSING_SOURCE', `Missing Swift helper source: ${SWIFT_SOURCE}`);
  }

  const source = fs.readFileSync(SWIFT_SOURCE);
  const hash = crypto.createHash('sha256').update(source).update(INFO_PLIST).digest('hex');
  const current = fs.existsSync(BUILD_STAMP) ? fs.readFileSync(BUILD_STAMP, 'utf8').trim() : null;
  if (current === hash && fs.existsSync(BINARY) && fs.existsSync(INFO_PLIST_PATH)) {
    return { appPath: APP_ROOT, binaryPath: BINARY, built: false, buildHash: hash };
  }

  ensurePrivateDir(CACHE_ROOT);
  fs.rmSync(APP_ROOT, { recursive: true, force: true });
  ensurePrivateDir(path.join(CONTENTS_DIR, 'MacOS'));
  fs.writeFileSync(INFO_PLIST_PATH, INFO_PLIST, { mode: 0o644 });

  const compile = run('/usr/bin/xcrun', [
    'swiftc', '-parse-as-library', '-O', '-framework', 'AVFoundation', SWIFT_SOURCE, '-o', BINARY,
  ], { timeout: 120000 });
  if (compile.status !== 0) {
    throw new CliError('HELPER_BUILD_FAILED', 'Swift helper compilation failed', {
      stderr: compile.stderr.trim(),
      stdout: compile.stdout.trim(),
    });
  }
  fs.chmodSync(BINARY, 0o755);

  const clearXattrs = run('/usr/bin/xattr', ['-cr', APP_ROOT], { timeout: 10000 });
  if (clearXattrs.status !== 0) {
    throw new CliError('HELPER_XATTR_FAILED', 'Could not clear generated app metadata before signing', {
      stderr: clearXattrs.stderr.trim(),
    });
  }
  const sign = run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', APP_ROOT], {
    timeout: 30000,
  });
  if (sign.status !== 0) {
    throw new CliError('HELPER_SIGN_FAILED', 'Swift helper signing failed', {
      stderr: sign.stderr.trim(),
    });
  }
  fs.writeFileSync(BUILD_STAMP, `${hash}\n`, { mode: 0o600 });
  fs.chmodSync(BUILD_STAMP, 0o600);
  return { appPath: APP_ROOT, binaryPath: BINARY, built: true, buildHash: hash };
}

function helperPermission(request) {
  const result = run(BINARY, [request ? 'authorize' : 'permission'], {
    timeout: request ? 60000 : 10000,
  });
  const payload = parseLastJson(`${result.stdout}\n${result.stderr}`);
  if (result.error && result.error.code === 'ETIMEDOUT') {
    throw new CliError('PERMISSION_PROMPT_TIMEOUT', 'Microphone permission was not answered within 60 seconds');
  }
  if (request && result.status !== 0) {
    throw new CliError('MIC_PERMISSION_DENIED', 'Microphone permission was not granted', {
      permission: payload?.permission || 'denied',
      remediation: 'System Settings → Privacy & Security → Microphone → Domi Mac Recording (or Codex)',
    }, 3);
  }
  if (!payload) {
    throw new CliError('PERMISSION_CHECK_FAILED', 'Could not read microphone permission status', {
      stderr: result.stderr.trim(),
    });
  }
  return payload;
}

function validateState(state) {
  if (state.version !== VERSION || typeof state.sessionId !== 'string' ||
      !/^[a-f0-9]{16}$/.test(state.sessionId)) {
    throw new CliError('INVALID_STATE', 'Active recording state has an unsupported version or invalid session identifier');
  }
  if (typeof state.outputPath === 'string' && path.isAbsolute(state.outputPath)) {
    state.controlDir ||= path.join(STATE_ROOT, 'sessions', state.sessionId);
    state.stopRequestPath ||= path.join(state.controlDir, 'stop-request.json');
    state.readyReceiptPath ||= path.join(state.controlDir, 'recording-ready.json');
  }
  if (state.uid !== UID || state.binaryPath !== BINARY ||
      !Number.isInteger(state.pid) || state.pid <= 0 ||
      typeof state.token !== 'string' || !/^[a-f0-9]{32}$/.test(state.token) ||
      typeof state.outputPath !== 'string' || !path.isAbsolute(state.outputPath) ||
      typeof state.workingPath !== 'string' || !path.isAbsolute(state.workingPath) ||
      typeof state.logPath !== 'string' || !path.isAbsolute(state.logPath) ||
      typeof state.errorLogPath !== 'string' || !path.isAbsolute(state.errorLogPath) ||
      typeof state.controlDir !== 'string' || !path.isAbsolute(state.controlDir) ||
      typeof state.stopRequestPath !== 'string' || !path.isAbsolute(state.stopRequestPath) ||
      typeof state.readyReceiptPath !== 'string' || !path.isAbsolute(state.readyReceiptPath)) {
    throw new CliError('UNSAFE_STATE', 'Active recording state does not match this user, helper, or process; refusing to control it');
  }
  if ((state.workflowKind !== null && state.workflowKind !== undefined) &&
      (state.workflowKind !== 'quick-discussion' || typeof state.workflowId !== 'string' ||
       !/^[a-f0-9]{16}$/.test(state.workflowId))) {
    throw new CliError('UNSAFE_STATE', 'Active recording workflow metadata is invalid; refusing to control it');
  }
  if ((state.workflowKind === null || state.workflowKind === undefined) &&
      state.workflowId !== null && state.workflowId !== undefined) {
    throw new CliError('UNSAFE_STATE', 'Active recording has an orphan workflow identifier; refusing to control it');
  }
  const base = state.outputPath.replace(/\.m4a$/i, '');
  if (!state.outputPath.toLowerCase().endsWith('.m4a') ||
      state.workingPath !== `${base}.partial.m4a` ||
      state.logPath !== `${base}.stdout.log` ||
      state.errorLogPath !== `${base}.stderr.log` ||
      state.controlDir !== path.join(STATE_ROOT, 'sessions', state.sessionId) ||
      state.stopRequestPath !== path.join(state.controlDir, 'stop-request.json') ||
      state.readyReceiptPath !== path.join(state.controlDir, 'recording-ready.json')) {
    throw new CliError('UNSAFE_STATE', 'Active recording paths are inconsistent; refusing to control the process');
  }
  return state;
}

function readActive() {
  const state = readJson(ACTIVE_STATE);
  return state ? validateState(state) : null;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw new CliError('PROCESS_QUERY_FAILED', `Could not query recorder process ${pid}`, {
      error: error.message,
    });
  }
}

function normalizePsStartedAt(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function parsePsSnapshot(text) {
  const line = String(text || '').trimEnd();
  if (!line.trim()) return null;
  const match = line.match(/^\s*(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.+)$/);
  if (!match) return null;
  return {
    uid: Number(match[1]),
    startedAt: normalizePsStartedAt(match[2]),
    processState: match[3],
    command: match[4].trim(),
  };
}

function queryProcessSnapshot(pid) {
  const result = run('/bin/ps', [
    '-ww', '-p', String(pid),
    '-o', 'uid=', '-o', 'lstart=', '-o', 'state=', '-o', 'command=',
  ], {
    timeout: 10000,
    env: { ...process.env, LC_ALL: 'C.UTF-8' },
  });
  if (!result.stdout.trim()) {
    if (!processExists(pid)) return null;
    throw new CliError('PROCESS_QUERY_FAILED', 'Recorder process exists but its identity could not be read; state was preserved', {
      pid,
      stderr: result.stderr.trim(),
    });
  }
  const snapshot = parsePsSnapshot(result.stdout);
  if (snapshot) return snapshot;
  if (!processExists(pid)) return null;
  throw new CliError('PROCESS_QUERY_FAILED', 'Recorder process identity had an unexpected format; state was preserved', {
    pid,
  });
}

function classifyProcessSnapshot(state, snapshot, options = {}) {
  if (!snapshot) return { running: false, pid: state.pid, identityMatches: false, exitState: 'missing' };
  if (/^Z/i.test(snapshot.processState)) {
    return {
      running: false,
      pid: state.pid,
      identityMatches: false,
      exitState: 'zombie',
      processState: snapshot.processState,
    };
  }
  const expectedStartedAt = normalizePsStartedAt(state.processStartedAt);
  const identityMatches = snapshot.uid === state.uid && snapshot.command.includes(state.binaryPath) &&
    snapshot.command.includes(state.token) && snapshot.command.includes(state.outputPath) &&
    (!expectedStartedAt || expectedStartedAt === snapshot.startedAt);
  if (identityMatches) {
    return {
      running: true,
      pid: state.pid,
      uid: snapshot.uid,
      startedAt: snapshot.startedAt,
      command: snapshot.command,
      processState: snapshot.processState,
      identityMatches: true,
    };
  }
  if (options.allowIdentityMismatchAsStopped) {
    return {
      running: false,
      pid: state.pid,
      identityMatches: false,
      exitState: 'replaced',
      processState: snapshot.processState,
    };
  }
  throw new CliError('UNSAFE_PROCESS', 'Recorder PID no longer matches the saved user, helper, token, output path, and start time; refusing to control it', {
    pid: state.pid,
    processState: snapshot.processState,
    checks: {
      uid: snapshot.uid === state.uid,
      helperPath: snapshot.command.includes(state.binaryPath),
      sessionToken: snapshot.command.includes(state.token),
      outputPath: snapshot.command.includes(state.outputPath),
      startTime: !expectedStartedAt || expectedStartedAt === snapshot.startedAt,
    },
  });
}

function processInfo(state, options = {}) {
  validateState(state);
  return classifyProcessSnapshot(state, queryProcessSnapshot(state.pid), options);
}

function recorderEvents(state) {
  const combined = `${tail(state.logPath)}\n${tail(state.errorLogPath)}`;
  const events = [];
  for (const line of combined.split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (event && typeof event === 'object') events.push(event);
    } catch (_) {}
  }
  return events;
}

function readStartReceipt(state) {
  if (!fs.existsSync(state.readyReceiptPath)) return null;
  const stat = fs.statSync(state.readyReceiptPath);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new CliError('UNSAFE_START_RECEIPT', 'Recording ready receipt is missing private file permissions', {
      readyReceiptPath: state.readyReceiptPath,
    });
  }
  const receipt = readJson(state.readyReceiptPath);
  if (receipt.event !== 'recording_started' || receipt.sessionId !== state.sessionId ||
      receipt.token !== state.token || receipt.outputPath !== state.outputPath ||
      receipt.workingPath !== state.workingPath || typeof receipt.startedAt !== 'string') {
    throw new CliError('UNSAFE_START_RECEIPT', 'Recording ready receipt does not match the active session', {
      readyReceiptPath: state.readyReceiptPath,
    });
  }
  return receipt;
}

function verifyAudio(file) {
  if (!fs.existsSync(file)) return { ok: false, reason: 'missing' };
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size <= 0) return { ok: false, reason: 'empty', bytes: stat.size };
  const permissions = stat.mode & 0o777;
  if (permissions !== 0o600) {
    return { ok: false, reason: 'unsafe_permissions', bytes: stat.size, permissions: permissions.toString(8) };
  }
  const check = run('/usr/bin/afinfo', [file], { timeout: 15000 });
  if (check.status !== 0) {
    return { ok: false, reason: 'afinfo_failed', bytes: stat.size, stderr: check.stderr.trim() };
  }
  const durationMatch = check.stdout.match(/estimated duration:\s*([0-9.]+)\s*sec/i);
  return {
    ok: true,
    bytes: stat.size,
    durationSec: durationMatch ? Number(durationMatch[1]) : null,
  };
}

function isCompletedRecording(audio, stoppedEvent, errorEvent) {
  return Boolean(audio?.ok && stoppedEvent && stoppedEvent.successful !== false && !errorEvent);
}

function archiveAndClear(state, options = {}) {
  if (!options.originalStopped) {
    const info = processInfo(state);
    if (info.running) {
      throw new CliError('ACTIVE_RECORDING', 'Refusing to archive or clear state while the recorder process is still running', {
        sessionId: state.sessionId,
        pid: info.pid,
      });
    }
  }
  const events = recorderEvents(state);
  const errorEvent = [...events].reverse().find((event) => event.event === 'error') || null;
  const stoppedEvent = [...events].reverse().find((event) => event.event === 'recording_stopped') || null;
  const audio = verifyAudio(state.outputPath);
  const partialExists = fs.existsSync(state.workingPath);
  const finalExists = fs.existsSync(state.outputPath);
  const completed = isCompletedRecording(audio, stoppedEvent, errorEvent);
  const result = {
    version: VERSION,
    sessionId: state.sessionId,
    recording: false,
    completed,
    status: completed ? 'completed' : 'failed',
    audioPath: completed ? state.outputPath : null,
    candidateAudioPath: !completed && finalExists ? state.outputPath : null,
    partialPath: partialExists ? state.workingPath : null,
    logPath: state.logPath,
    errorLogPath: state.errorLogPath,
    startedAt: state.startedAt,
    stoppedAt: stoppedEvent?.stoppedAt || new Date().toISOString(),
    workflowKind: state.workflowKind || null,
    workflowId: state.workflowId || null,
    durationSec: audio.durationSec ?? stoppedEvent?.durationSec ?? Math.max(0, (Date.now() - Date.parse(state.startedAt)) / 1000),
    bytes: audio.bytes || 0,
    reason: stoppedEvent?.reason || null,
    error: completed ? null : (
      errorEvent?.error || (!stoppedEvent && finalExists ? 'Final audio exists without a terminal recording receipt' : null) ||
      audio.reason || 'Recording did not produce a valid private M4A file'
    ),
    code: completed ? null : (errorEvent?.code || (!stoppedEvent && finalExists ? 'MISSING_STOP_EVENT' : 'INCOMPLETE_RECORDING')),
  };
  atomicWriteJson(LAST_STATE, result);
  safeUnlink(ACTIVE_STATE);
  safeUnlink(state.stopRequestPath);
  safeUnlink(state.readyReceiptPath);
  try { fs.rmdirSync(state.controlDir); } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForReadyOutcome(readySignal, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      readySignal.cancel();
      resolve({ received: false, timeout: true });
    }, timeoutMs);
    readySignal.promise.then((outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    });
  });
}

async function waitForProcess(state, shouldRun, timeoutMs, options = {}) {
  const deadline = Date.now() + timeoutMs;
  const query = options.query || ((value) => processInfo(value, {
    allowIdentityMismatchAsStopped: Boolean(options.allowIdentityMismatchAsStopped),
  }));
  const pause = options.pause || sleep;
  let info = query(state);
  while (Date.now() < deadline) {
    if (info.running === shouldRun) return info;
    await pause(250);
    info = query(state);
  }
  return info;
}

function finalizationSnapshot(state) {
  const events = recorderEvents(state);
  const stoppedEvent = [...events].reverse().find((event) => event.event === 'recording_stopped') || null;
  const errorEvent = [...events].reverse().find((event) => event.event === 'error') || null;
  const finalExists = fs.existsSync(state.outputPath);
  const partialExists = fs.existsSync(state.workingPath);
  return {
    ready: Boolean(errorEvent || (stoppedEvent && finalExists)),
    stoppedEvent,
    errorEvent,
    finalExists,
    partialExists,
  };
}

async function waitForFinalization(state, timeoutMs, options = {}) {
  const deadline = Date.now() + timeoutMs;
  const inspect = options.inspect || finalizationSnapshot;
  const pause = options.pause || sleep;
  let result = inspect(state);
  while (!result.ready && Date.now() < deadline) {
    await pause(100);
    result = inspect(state);
  }
  return result;
}

function stopWasRequested(state) {
  return state.status === 'stop_requested' || fs.existsSync(state.stopRequestPath);
}

function finalizingResult(state) {
  return {
    recording: false,
    completed: false,
    status: 'finalizing',
    sessionId: state.sessionId,
    startedAt: state.startedAt,
    outputPath: state.outputPath,
    workflowKind: state.workflowKind || null,
    workflowId: state.workflowId || null,
    message: 'Audio is finalized; waiting for the recorder process to exit',
  };
}

async function waitForRecordingStart(state, timeoutMs, options = {}) {
  const deadline = Date.now() + timeoutMs;
  const query = options.query || processInfo;
  const processStillExists = options.processStillExists || processExists;
  const readReceipt = options.readReceipt || readStartReceipt;
  const pause = options.pause || sleep;
  const pollIntervalMs = options.pollIntervalMs || 20;
  let info = options.initialInfo || query(state);
  if (options.readySignal) {
    const outcome = await waitForReadyOutcome(options.readySignal, timeoutMs);
    if (outcome.error) {
      return {
        started: false,
        event: null,
        info,
        events: recorderEvents(state),
        readyError: outcome.error,
      };
    }
    if (outcome.received) {
      return { started: Boolean(info.running), event: outcome.event, info, events: recorderEvents(state) };
    }
    if (outcome.timeout) {
      return {
        started: false,
        event: null,
        info,
        events: recorderEvents(state),
        readyError: new CliError(
          'START_READY_TIMEOUT',
          'The recorder did not acknowledge microphone readiness before the startup deadline',
          { sessionId: state.sessionId, outputPath: state.outputPath },
        ),
      };
    }
    if (!outcome.timeout) {
      info = query(state);
      return { started: false, event: null, info, events: recorderEvents(state), readyOutcome: outcome };
    }
  }
  while (Date.now() < deadline) {
    const receipt = readReceipt(state);
    if (receipt) {
      info = query(state);
      return { started: Boolean(info.running), event: receipt, info, events: recorderEvents(state) };
    }
    if (!processStillExists(state.pid)) {
      info = query(state);
      return { started: false, event: null, info, events: recorderEvents(state) };
    }
    await pause(pollIntervalMs);
  }
  info = query(state);
  const events = recorderEvents(state);
  const fallbackEvent = events.find((event) => event.event === 'recording_started') || null;
  return {
    started: Boolean(fallbackEvent && info.running),
    event: fallbackEvent,
    info,
    events,
  };
}

function writeStopRequestFile(state, options = {}) {
  validateState(state);
  const payload = {
    version: VERSION,
    sessionId: state.sessionId,
    token: state.token,
    requestedAt: new Date().toISOString(),
  };
  let fd;
  if (!options.processVerified) {
    const inspectProcess = options.inspectProcess || processInfo;
    const info = inspectProcess(state);
    if (!info.running) return false;
  }
  try {
    fd = fs.openSync(state.stopRequestPath, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(payload)}\n`);
    fs.fchmodSync(fd, 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      const existing = readJson(state.stopRequestPath);
      if (existing.sessionId === state.sessionId && existing.token === state.token) return true;
      throw new CliError('STOP_REQUEST_CONFLICT', 'An unrelated stop-request file already exists; state was preserved', {
        stopRequestPath: state.stopRequestPath,
      });
    }
    throw new CliError('STOP_REQUEST_FAILED', 'Could not create the private recorder stop request', {
      stopRequestPath: state.stopRequestPath,
      error: error.message,
    });
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
  return true;
}

function requestRecorderStop(state, options = {}) {
  return writeStopRequestFile(state, options);
}

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sanitizeName(raw) {
  const value = String(raw || 'local-mic')
    .normalize('NFKC')
    .replace(/\.m4a$/i, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return value || 'local-mic';
}

function parseStartArgs(args) {
  const options = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    const needsValue = ['--out-dir', '--output', '--name', '--duration-seconds', '--workflow-kind'];
    if (!needsValue.includes(arg)) throw new CliError('USAGE', `Unknown start option: ${arg}`, {}, 2);
    if (index + 1 >= args.length) throw new CliError('USAGE', `${arg} requires a value`, {}, 2);
    options[arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = args[++index];
  }
  if (options.durationSeconds !== undefined) {
    const seconds = Number(options.durationSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) {
      throw new CliError('USAGE', '--duration-seconds must be between 1 and 86400', {}, 2);
    }
    options.durationSeconds = seconds;
  }
  if (options.workflowKind !== undefined && options.workflowKind !== 'quick-discussion') {
    throw new CliError('USAGE', '--workflow-kind currently supports only quick-discussion', {}, 2);
  }
  return options;
}

function outputPaths(options, sessionId) {
  const stamp = localTimestamp();
  let outputPath;
  if (options.output) {
    outputPath = path.resolve(options.output);
    if (!outputPath.toLowerCase().endsWith('.m4a')) {
      throw new CliError('USAGE', '--output must end in .m4a', {}, 2);
    }
  } else {
    const directory = options.outDir
      ? path.resolve(options.outDir)
      : path.resolve(process.cwd(), 'work', 'domi', 'mac-recording', `${stamp}-${sessionId.slice(0, 8)}`);
    outputPath = path.join(directory, `${stamp}-${sanitizeName(options.name)}.m4a`);
  }
  const relativeToPlugin = path.relative(PLUGIN_ROOT, outputPath);
  if (relativeToPlugin === '' || (!relativeToPlugin.startsWith(`..${path.sep}`) &&
      relativeToPlugin !== '..' && !path.isAbsolute(relativeToPlugin))) {
    throw new CliError('UNSAFE_OUTPUT_PATH', 'Refusing to write a recording inside the domi plugin directory; run from a user workspace or pass --out-dir', {
      pluginRoot: PLUGIN_ROOT,
      outputPath,
    });
  }
  const base = outputPath.replace(/\.m4a$/i, '');
  const controlDir = path.join(STATE_ROOT, 'sessions', sessionId);
  return {
    outputPath,
    workingPath: `${base}.partial.m4a`,
    logPath: `${base}.stdout.log`,
    errorLogPath: `${base}.stderr.log`,
    controlDir,
    stopRequestPath: path.join(controlDir, 'stop-request.json'),
    readyReceiptPath: path.join(controlDir, 'recording-ready.json'),
  };
}

function validateReadyAck(state, event, pid) {
  if (!event || event.event !== 'recording_started' || event.sessionId !== state.sessionId ||
      event.pid !== pid || event.outputPath !== state.outputPath ||
      event.workingPath !== state.workingPath || typeof event.startedAt !== 'string') {
    throw new CliError('UNSAFE_START_ACK', 'Recorder readiness acknowledgement does not match the spawned session', {
      sessionId: state.sessionId,
      pid,
    });
  }
  return event;
}

function createReadySignal(child, state) {
  const stream = child.stdio?.[3];
  if (!stream) {
    return {
      promise: Promise.resolve({
        received: false,
        error: new CliError('READY_CHANNEL_MISSING', 'Recorder readiness pipe was not created'),
      }),
      cancel: () => {},
    };
  }
  stream.setEncoding('utf8');
  let cancel = () => {};
  const promise = new Promise((resolve) => {
    let buffer = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      stream.removeListener('data', onData);
      stream.removeListener('error', onStreamError);
      stream.removeListener('end', onEnd);
      child.removeListener('exit', onExit);
      child.removeListener('error', onChildError);
      try { stream.destroy(); } catch (_) {}
      resolve(result);
    };
    const onData = (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const event = JSON.parse(buffer.slice(0, newline));
        finish({ received: true, event: validateReadyAck(state, event, child.pid) });
      } catch (error) {
        finish({
          received: false,
          error: error instanceof CliError
            ? error
            : new CliError('INVALID_START_ACK', 'Recorder readiness acknowledgement was not valid JSON'),
        });
      }
    };
    const onStreamError = (error) => finish({
      received: false,
      error: new CliError('READY_CHANNEL_FAILED', 'Recorder readiness pipe failed', { error: error.message }),
    });
    const onEnd = () => finish({ received: false, code: 'READY_CHANNEL_CLOSED' });
    const onExit = (code, signal) => finish({
      received: false,
      code: 'RECORDER_EXITED_BEFORE_READY',
      exitCode: code,
      signal,
    });
    const onChildError = (error) => finish({
      received: false,
      error: new CliError('READY_CHANNEL_FAILED', 'Recorder failed before readiness acknowledgement', {
        error: error.message,
      }),
    });
    stream.on('data', onData);
    stream.once('error', onStreamError);
    stream.once('end', onEnd);
    child.once('exit', onExit);
    child.once('error', onChildError);
    cancel = () => finish({ received: false, cancelled: true });
  });
  return { promise, cancel };
}

async function spawnRecorder(state, options = {}) {
  const args = [
    'record', '--output', state.outputPath,
    '--stop-file', state.stopRequestPath,
    '--ready-file', state.readyReceiptPath,
    '--session-id', state.sessionId,
    '--token', state.token,
  ];
  if (state.durationSeconds) args.push('--max-seconds', String(state.durationSeconds));

  let outFd;
  let errFd;
  let child;
  const closeDescriptors = () => {
    if (outFd !== undefined) {
      try { fs.closeSync(outFd); } catch (_) {}
      outFd = undefined;
    }
    if (errFd !== undefined) {
      try { fs.closeSync(errFd); } catch (_) {}
      errFd = undefined;
    }
  };
  try {
    outFd = fs.openSync(state.logPath, 'wx', 0o600);
    errFd = fs.openSync(state.errorLogPath, 'wx', 0o600);
    const spawnImpl = options.spawnImpl || spawn;
    child = spawnImpl(BINARY, args, {
      detached: true,
      stdio: ['ignore', outFd, errFd, 'pipe'],
    });
  } catch (error) {
    closeDescriptors();
    throw new CliError('SPAWN_FAILED', 'Could not spawn the recorder helper', { error: error.message });
  }
  return await new Promise((resolve, reject) => {
    let settled = false;
    const onError = (error) => {
      if (settled) return;
      settled = true;
      child.removeListener('spawn', onSpawn);
      closeDescriptors();
      reject(new CliError('SPAWN_FAILED', 'Could not spawn the recorder helper', { error: error.message }));
    };
    const onSpawn = () => {
      if (settled) return;
      settled = true;
      child.removeListener('error', onError);
      child.on('error', () => {});
      closeDescriptors();
      if (!Number.isInteger(child.pid) || child.pid <= 0) {
        reject(new CliError('SPAWN_FAILED', 'Recorder helper started without a valid process identifier'));
        return;
      }
      const readySignal = createReadySignal(child, state);
      child.unref();
      resolve({ pid: child.pid, readySignal });
    };
    child.once('error', onError);
    child.once('spawn', onSpawn);
  });
}

async function doctor() {
  return withLock(async () => {
    const checks = {
      macOS: process.platform === 'darwin',
      xcrun: run('/usr/bin/xcrun', ['--find', 'swiftc'], { timeout: 10000 }).status === 0,
      processControl: fs.existsSync('/bin/ps') && UID !== null,
    };
    let build = null;
    let permission = null;
    if (checks.macOS && checks.xcrun) {
      build = buildHelper();
      permission = helperPermission(false).permission;
    }
    const ok = Object.values(checks).every(Boolean) && Boolean(build);
    return { ok, checks, helper: build, permission, microphoneOpened: false };
  });
}

async function status() {
  return withLock(async () => {
    const state = readActive();
    if (!state) return { recording: false, active: null, last: readJson(LAST_STATE) };
    const terminal = finalizationSnapshot(state);
    if (terminal.ready) {
      const exited = await waitForProcess(state, false, 2000, {
        allowIdentityMismatchAsStopped: true,
      });
      if (exited.running) return finalizingResult(state);
      return archiveAndClear(state, { originalStopped: true });
    }
    const info = processInfo(state, {
      allowIdentityMismatchAsStopped: stopWasRequested(state),
    });
    if (!info.running) {
      await waitForFinalization(state, 2000);
      return archiveAndClear(state, { originalStopped: true });
    }
    const elapsedSec = Math.max(0, (Date.now() - Date.parse(state.startedAt)) / 1000);
    const partialBytes = fs.existsSync(state.workingPath) ? fs.statSync(state.workingPath).size : 0;
    return {
      recording: true,
      status: state.status === 'stop_requested' ? 'stopping' : 'recording',
      sessionId: state.sessionId,
      pid: state.pid,
      startedAt: state.startedAt,
      elapsedSec,
      durationLimitSec: state.durationSeconds || null,
      outputPath: state.outputPath,
      partialBytes,
      startTimings: state.startTimings || null,
      workflowKind: state.workflowKind || null,
      workflowId: state.workflowId || null,
    };
  });
}

async function settleUnconfirmedStart(state, info, confirmation, options = {}) {
  const requestStop = options.requestStop || requestRecorderStop;
  const persistState = options.persistState || ((value) => atomicWriteJson(ACTIVE_STATE, value));
  const waitProcess = options.waitProcess || waitForProcess;
  const waitFinalization = options.waitFinalization || waitForFinalization;
  const archive = options.archive || archiveAndClear;
  if (info.running) {
    requestStop(state, { processVerified: true });
    state.status = 'stop_requested';
    state.stopRequestedAt ||= new Date().toISOString();
    persistState(state);
    const stopped = await waitProcess(state, false, 15000, {
      allowIdentityMismatchAsStopped: true,
    });
    if (stopped.running) {
      throw new CliError('START_CONFIRMATION_STOP_TIMEOUT', 'Recording start was not confirmed and the helper did not stop within 15 seconds; active state was preserved', {
        sessionId: state.sessionId,
        outputPath: state.outputPath,
      });
    }
  }
  await waitFinalization(state, 2000);
  const settled = archive(state, { originalStopped: true });
  if (confirmation.readyError) {
    const readyError = confirmation.readyError;
    throw new CliError(readyError.code, readyError.message, {
      ...readyError.details,
      cleanup: settled,
      logTail: tail(state.errorLogPath) || tail(state.logPath),
    }, readyError.exitCode);
  }
  if (settled.completed) return { ok: true, startedAndCompleted: true, ...settled };
  throw new CliError('START_CONFIRMATION_FAILED', 'The helper did not confirm that microphone recording started', {
    ...settled,
    logTail: tail(state.errorLogPath) || tail(state.logPath),
  });
}

async function start(args) {
  const commandStartedAt = performance.now();
  const options = parseStartArgs(args);
  return withLock(async () => {
    const timings = {
      lockMs: performance.now() - commandStartedAt,
      preflightMs: 0,
      buildMs: 0,
      permissionMs: 0,
      spawnMs: 0,
      identityMs: 0,
      readyMs: 0,
      buildCacheHit: false,
      readyTransport: options.dryRun ? 'not_started' : 'pipe-v1',
      identityProbeCount: 0,
    };
    const preflightStartedAt = performance.now();
    const previous = readActive();
    if (previous) {
      const terminal = finalizationSnapshot(previous);
      if (terminal.ready) {
        const exited = await waitForProcess(previous, false, 2000, {
          allowIdentityMismatchAsStopped: true,
        });
        if (exited.running) {
          throw new CliError('RECORDING_FINALIZING', 'The previous recording is finalized but its helper is still exiting; retry shortly', {
            sessionId: previous.sessionId,
            outputPath: previous.outputPath,
          });
        }
        archiveAndClear(previous, { originalStopped: true });
      } else {
        const info = processInfo(previous, {
          allowIdentityMismatchAsStopped: stopWasRequested(previous),
        });
        if (info.running) {
          throw new CliError(
            stopWasRequested(previous) ? 'RECORDING_STOPPING' : 'ALREADY_RECORDING',
            stopWasRequested(previous)
              ? 'The previous recording is still stopping; retry shortly'
              : 'A local microphone recording is already active', {
            sessionId: previous.sessionId,
            outputPath: previous.outputPath,
            startedAt: previous.startedAt,
            elapsedSec: Math.max(0, (Date.now() - Date.parse(previous.startedAt)) / 1000),
            startTimings: previous.startTimings || null,
            workflowKind: previous.workflowKind || null,
            workflowId: previous.workflowId || null,
          });
        }
        await waitForFinalization(previous, 2000);
        archiveAndClear(previous, { originalStopped: true });
      }
    }
    timings.preflightMs = performance.now() - preflightStartedAt;

    const buildStartedAt = performance.now();
    const helper = buildHelper();
    timings.buildMs = performance.now() - buildStartedAt;
    timings.buildCacheHit = !helper.built;
    const sessionId = crypto.randomBytes(8).toString('hex');
    const token = crypto.randomBytes(16).toString('hex');
    const workflowId = options.workflowKind ? crypto.randomBytes(8).toString('hex') : null;
    const paths = outputPaths(options, sessionId);
    const state = {
      version: VERSION,
      sessionId,
      token,
      uid: UID,
      binaryPath: BINARY,
      ...paths,
      durationSeconds: options.durationSeconds || null,
      workflowKind: options.workflowKind || null,
      workflowId,
      startedAt: new Date().toISOString(),
      status: options.dryRun ? 'dry_run' : 'starting',
    };

    const existingPath = [
      state.outputPath, state.workingPath, state.logPath, state.errorLogPath,
      state.stopRequestPath, state.readyReceiptPath,
    ]
      .find((candidate) => fs.existsSync(candidate));
    if (existingPath) {
      throw new CliError('OUTPUT_EXISTS', 'Recording output path already exists', { outputPath: existingPath });
    }

    if (options.dryRun) {
      return {
        ok: true,
        dryRun: true,
        recording: false,
        helper,
        outputPath: state.outputPath,
        durationLimitSec: state.durationSeconds,
        workflowKind: state.workflowKind,
        workflowId: state.workflowId,
        microphoneOpened: false,
        timings: startTimingSnapshot(timings, commandStartedAt),
      };
    }

    const permissionStartedAt = performance.now();
    helperPermission(true);
    timings.permissionMs = performance.now() - permissionStartedAt;
    ensureRecordingDir(path.dirname(state.outputPath));
    ensurePrivateDir(state.controlDir);
    state.startedAt = new Date().toISOString();
    const spawnStartedAt = performance.now();
    let spawned;
    try {
      spawned = await spawnRecorder(state);
      state.pid = spawned.pid;
    } catch (error) {
      safeUnlink(state.logPath);
      safeUnlink(state.errorLogPath);
      try { fs.rmdirSync(state.controlDir); } catch (_) {}
      throw error;
    }
    timings.spawnMs = performance.now() - spawnStartedAt;
    const identityStartedAt = performance.now();
    atomicWriteJson(ACTIVE_STATE, state);

    timings.identityProbeCount += 1;
    let info = processInfo(state);
    state.processStartedAt = info?.startedAt || null;
    atomicWriteJson(ACTIVE_STATE, state);
    timings.identityMs = performance.now() - identityStartedAt;

    if (!info?.running) {
      await sleep(250);
      await waitForFinalization(state, 2000);
      const settled = archiveAndClear(state, { originalStopped: true });
      throw new CliError('RECORDING_START_FAILED', 'The recording helper exited before its process identity could be confirmed', {
        ...settled,
        logTail: tail(state.errorLogPath) || tail(state.logPath),
      });
    }

    const readyStartedAt = performance.now();
    const confirmation = await waitForRecordingStart(state, 5000, {
      initialInfo: info,
      readySignal: spawned.readySignal,
    });
    timings.readyMs = performance.now() - readyStartedAt;
    info = confirmation.info;
    if (!confirmation.started) {
      return await settleUnconfirmedStart(state, info, confirmation);
    }

    state.status = 'recording';
    state.startedAt = confirmation.event.startedAt || state.startedAt;
    state.startTimings = startTimingSnapshot(timings, commandStartedAt);
    atomicWriteJson(ACTIVE_STATE, state);
    return {
      ok: true,
      recording: true,
      sessionId,
      pid: state.pid,
      startedAt: state.startedAt,
      outputPath: state.outputPath,
      durationLimitSec: state.durationSeconds,
      workflowKind: state.workflowKind,
      workflowId: state.workflowId,
      permission: 'granted',
      timings: state.startTimings,
    };
  });
}

async function stop() {
  return withLock(async () => {
    const state = readActive();
    if (!state) {
      const last = readJson(LAST_STATE);
      if (last) return { ...last, stopped: true, alreadyStopped: true };
      return { recording: false, stopped: false, message: 'No active recording', last: null };
    }
    const terminal = finalizationSnapshot(state);
    if (terminal.ready) {
      const exited = await waitForProcess(state, false, 5000, {
        allowIdentityMismatchAsStopped: true,
      });
      if (exited.running) {
        throw new CliError('STOP_FINALIZATION_TIMEOUT', 'Audio finalized but the recorder helper is still exiting; state was preserved', {
          sessionId: state.sessionId,
          outputPath: state.outputPath,
        });
      }
      const result = archiveAndClear(state, { originalStopped: true });
      if (!result.completed) {
        throw new CliError(result.code || 'INCOMPLETE_RECORDING', result.error || 'Recording did not finalize', result);
      }
      return { ...result, stopped: true, alreadyStopped: true };
    }
    let info = processInfo(state, {
      allowIdentityMismatchAsStopped: stopWasRequested(state),
    });
    if (info.running) {
      requestRecorderStop(state, { processVerified: true });
      state.status = 'stop_requested';
      state.stopRequestedAt ||= new Date().toISOString();
      atomicWriteJson(ACTIVE_STATE, state);
      info = await waitForProcess(state, false, 15000, {
        allowIdentityMismatchAsStopped: true,
      });
      if (info.running) {
        throw new CliError('STOP_TIMEOUT', 'Recorder did not stop within 15 seconds; state and the private stop request were preserved', {
          sessionId: state.sessionId,
          outputPath: state.outputPath,
        });
      }
    }
    await waitForFinalization(state, 5000);
    const result = archiveAndClear(state, { originalStopped: true });
    if (!result.completed) {
      throw new CliError(result.code || 'INCOMPLETE_RECORDING', result.error || 'Recording did not finalize', result);
    }
    return { ...result, stopped: true };
  });
}

function usage() {
  return {
    usage: [
      'node mac-recording.js doctor',
      'node mac-recording.js status',
      'node mac-recording.js start [--out-dir DIR] [--output FILE.m4a] [--name NAME] [--duration-seconds N] [--workflow-kind quick-discussion] [--dry-run]',
      'node mac-recording.js stop',
      'node mac-recording.js last',
    ],
  };
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') return usage();
  if (command === 'doctor') return doctor();
  if (command === 'status') return status();
  if (command === 'start') return start(args);
  if (command === 'stop') return stop();
  if (command === 'last') return { last: readJson(LAST_STATE) };
  throw new CliError('USAGE', `Unknown command: ${command}`, usage(), 2);
}

if (require.main === module) {
  main()
    .then((result) => emit(result))
    .catch((error) => {
      const payload = error instanceof CliError
        ? { ok: false, code: error.code, error: error.message, ...error.details }
        : { ok: false, code: 'UNEXPECTED_ERROR', error: error.message || String(error) };
      emit(payload, process.stderr);
      process.exitCode = error.exitCode || 1;
    });
}

module.exports = {
  __test: {
    BINARY,
    CACHE_ROOT,
    STATE_ROOT,
    UID,
    VERSION,
    CliError,
    classifyProcessSnapshot,
    finalizationSnapshot,
    isCompletedRecording,
    normalizePsStartedAt,
    parsePsSnapshot,
    queryProcessSnapshot,
    readStartReceipt,
    settleUnconfirmedStart,
    spawnRecorder,
    startTimingSnapshot,
    validateState,
    verifyAudio,
    waitForFinalization,
    waitForProcess,
    waitForRecordingStart,
    writeStopRequestFile,
  },
};
