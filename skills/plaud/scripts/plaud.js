#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const {
  BROWSER_SPECS,
  PlaudClient,
  configuredBrowserKind,
  managedProfilePath,
  mediaExecutable,
  removeManagedProfile,
  safeName,
} = require('../vendor/plaud-cli/src/plaud');

const STATE_DIR = path.resolve(process.env.DOMI_PLAUD_STATE_DIR || path.join(os.homedir(), '.domi'));
const STATE_FILE = path.join(STATE_DIR, 'plaud-workflow.json');
const STATE_WRITE_LOCK = path.join(STATE_DIR, 'plaud-workflow.lock');
const FINAL_STAGES = new Set(['notes_non_project', 'managed', 'discussion_complete']);
const ALLOWED_STAGES = new Set([
  'uploading',
  'uploaded',
  'upload_failed',
  'upload_unknown',
  'upload_recovery_ambiguous',
  'generation_submitting',
  'generation_unknown',
  'download_failed',
  'generating',
  'transcript_ready',
  'context_pending',
  'context_ready',
  'notes_project',
  'notes_non_project',
  'reviewed',
  'documented',
  'managed',
  'discussion_notes_ready',
  'discussion_complete',
  'generation_failed',
  'generation_timeout',
  'failed',
]);
let activeClient = null;
let signalShutdown = null;

function usage() {
  process.stdout.write(`Usage:
  node plaud.js doctor [chrome|tabbit]
  node plaud.js login [chrome|tabbit]
  node plaud.js connection [chrome|tabbit]
  node plaud.js logout [chrome|tabbit]
  node plaud.js status [limit]
  node plaud.js pending [limit]
  node plaud.js queue
  node plaud.js verify <fileId>
  node plaud.js sync-pending [count] [outDir] [timeoutSec] [pollSec]
  node plaud.js transcribe-local <audioPath> [outDir] [timeoutSec] [pollSec] [title] [--workflow-id ID] [--adopt-file-id ID] [--retry-upload] [--retry-generation]
  node plaud.js download <fileId> [outDir]
  node plaud.js mark <fileId> <stage> [artifactPath|-] [metadataJson]\n`);
}

function safeErrorMessage(error) {
  let message = error && error.message ? String(error.message) : String(error);
  if (/browserType\.connectOverCDP|WebSocket error:[\s\S]*ECONNREFUSED|connect ECONNREFUSED 127\.0\.0\.1/i.test(message)) {
    return 'PLAUD 专用浏览器未能建立本机连接。请重新同步；domi 会清理旧连接后自动重试。';
  }
  const homeDirectory = os.homedir();
  if (homeDirectory) message = message.split(homeDirectory).join('~');
  message = message.replace(
    /\b(?:authorization|proxy-authorization|authorization[_-]?header|cookie|cookies|set-cookie|x-pld-user|x-device-id)\s*[:=]\s*[^\r\n]+/gi,
    '[REDACTED_CREDENTIAL]',
  );
  message = message.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '[REDACTED_CREDENTIAL]');
  message = message.replace(/\b(?:https?|wss):(?:\\\/){2}[^\s"'<>]+/gi, '[REDACTED_URL]');
  message = message.replace(/\b(?:https?|wss):\/\/[^\s"'<>]+/gi, '[REDACTED_URL]');
  message = message.replace(
    /("?(?:part_urls?|upload_id|object_name|presigned_url|authorization|cookie|access_token|refresh_token|signature|credential)"?\s*[:=]\s*)("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;}\]]+)/gi,
    '$1[REDACTED]',
  );
  if (message.length > 1000) message = `${message.slice(0, 1000)}…`;
  return message;
}

const SENSITIVE_STRUCTURED_KEYS = new Set([
  'authorization',
  'authheader',
  'cookie',
  'cookies',
  'uploadid',
  'objectname',
  'datafile',
  'parturl',
  'parturls',
  'presignedurl',
  'presignedurls',
  'accesstoken',
  'refreshtoken',
  'headers',
  'response',
]);

function sanitizeStructuredValue(value, key = null) {
  if (key === 'error' && typeof value === 'string') return safeErrorMessage(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeStructuredValue(item));
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const normalizedKey = childKey.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (SENSITIVE_STRUCTURED_KEYS.has(normalizedKey)) continue;
    sanitized[childKey] = sanitizeStructuredValue(childValue, childKey);
  }
  return sanitized;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(sanitizeStructuredValue(value), null, 2)}\n`);
}

function positiveInt(raw, fallback, name, max = Number.MAX_SAFE_INTEGER) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

function parseTranscribeLocalArgs(args) {
  const positional = [];
  let retryUpload = false;
  let retryGeneration = false;
  let workflowId = null;
  let adoptFileId = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--retry-upload') {
      if (retryUpload) throw new Error('--retry-upload may only be provided once');
      retryUpload = true;
      continue;
    }
    if (arg === '--retry-generation') {
      if (retryGeneration) throw new Error('--retry-generation may only be provided once');
      retryGeneration = true;
      continue;
    }
    if (arg === '--workflow-id' || arg === '--adopt-file-id') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--workflow-id') {
        if (workflowId !== null) throw new Error('--workflow-id may only be provided once');
        workflowId = value;
      } else {
        if (adoptFileId !== null) throw new Error('--adopt-file-id may only be provided once');
        adoptFileId = value;
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown transcribe-local option: ${arg}`);
    positional.push(arg);
  }
  if (!positional[0]) throw new Error('transcribe-local requires audioPath');
  if (positional.length > 5) throw new Error('transcribe-local received too many positional arguments');
  if (adoptFileId && !/^[A-Za-z0-9_-]{1,128}$/.test(adoptFileId)) {
    throw new Error('--adopt-file-id contains unsupported characters');
  }
  return { positional, retryUpload, retryGeneration, workflowId, adoptFileId };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function knownGenerationRejection(message) {
  return /^Generate file failed: HTTP (?:4\d\d(?:;|$)|200; API status )/.test(message);
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { version: 1, records: {} };
  const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || typeof parsed.records !== 'object') {
    throw new Error(`Invalid domi state file: ${STATE_FILE}`);
  }
  return parsed;
}

function writeStateUnlocked(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(STATE_DIR, 0o700);
  const temp = `${STATE_FILE}.tmp-${process.pid}`;
  const sanitizedState = sanitizeStructuredValue(state);
  fs.writeFileSync(temp, `${JSON.stringify(sanitizedState, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, STATE_FILE);
}

function syncPause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withStateWriteLock(callback) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 5000;
  let fd;
  while (Date.now() < deadline) {
    try {
      fd = fs.openSync(STATE_WRITE_LOCK, 'wx', 0o600);
      fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const lock = JSON.parse(fs.readFileSync(STATE_WRITE_LOCK, 'utf8'));
        if (!Number.isInteger(lock.pid) || lock.pid <= 0) stale = true;
        else {
          try { process.kill(lock.pid, 0); } catch (processError) {
            if (processError.code === 'ESRCH') stale = true;
          }
        }
      } catch (_) {
        try { stale = Date.now() - fs.statSync(STATE_WRITE_LOCK).mtimeMs > 10000; } catch (_) {}
      }
      if (stale) {
        fs.rmSync(STATE_WRITE_LOCK, { force: true });
        continue;
      }
      syncPause(10);
    }
  }
  if (fd === undefined) throw new Error('Timed out waiting for the PLAUD workflow state lock');
  try {
    return callback();
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
    fs.rmSync(STATE_WRITE_LOCK, { force: true });
  }
}

function updateRecord(state, fileId, patch) {
  return withStateWriteLock(() => {
    const latest = loadState();
    const previous = latest.records[fileId] || { fileId };
    latest.records[fileId] = {
      ...previous,
      ...patch,
      fileId,
      updatedAt: new Date().toISOString(),
    };
    writeStateUnlocked(latest);
    state.version = latest.version;
    state.records = latest.records;
    return latest.records[fileId];
  });
}

function safePendingFile(file) {
  return {
    fileId: file.id || file.file_id,
    fileName: file.filename || file.file_name,
    duration: file.duration || null,
    createdAt: file.start_time || file.create_time || null,
    editedAt: file.edit_time || null,
  };
}

function doctor(requestedBrowser) {
  const browser = configuredBrowserKind(requestedBrowser);
  const spec = BROWSER_SPECS[browser];
  const ffmpegPath = mediaExecutable('ffmpeg');
  const ffprobePath = mediaExecutable('ffprobe');
  let playwrightAvailable = false;
  try {
    require.resolve('playwright');
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
  }
  const checks = {
    node: { ok: Boolean(process.execPath), version: process.version },
    browser: {
      ok: [spec.executable, spec.userExecutable].some((candidate) => fs.existsSync(candidate)),
      kind: browser,
      label: spec.label
    },
    playwright: { ok: playwrightAvailable },
    ffmpeg: {
      ok: Boolean(ffmpegPath),
      source: process.env.DOMI_FFMPEG_PATH ? 'bundled' : 'system'
    },
    ffprobe: {
      ok: Boolean(ffprobePath),
      source: process.env.DOMI_FFPROBE_PATH ? 'bundled' : 'system'
    },
    managedProfile: { ok: fs.existsSync(managedProfilePath(browser)) },
  };
  const issues = [];
  if (!checks.browser.ok) issues.push(`未找到 ${spec.label}，请安装后重试，或选择另一种浏览器。`);
  if (!checks.playwright.ok) issues.push('domi 缺少 PLAUD 浏览器运行组件，请重新安装最新版 domi。');
  if (!checks.ffmpeg.ok || !checks.ffprobe.ok) {
    issues.push('domi 内置音频运行时不完整，请重新安装最新版 domi。');
  }
  const ok = checks.node.ok
    && checks.browser.ok
    && checks.playwright.ok
    && checks.ffmpeg.ok
    && checks.ffprobe.ok;
  printJson({
    ok,
    browser,
    browserLabel: spec.label,
    checks,
    ...(issues.length ? { error: issues.join(' ') } : {}),
  });
  if (!ok) process.exitCode = 1;
}

function isTransientClientInitializationError(error) {
  return /PLAUD_SESSION_PROBE_INCOMPLETE|page\.goto|connectOverCDP|WebSocket error|ECONNREFUSED|ECONNRESET|ERR_CONNECTION_(?:CLOSED|RESET|REFUSED)|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|socket hang up/i
    .test(error instanceof Error ? error.message : String(error));
}

async function withClient(callback, options = {}) {
  const clientFactory = options.clientFactory || ((clientOptions) => new PlaudClient(clientOptions));
  const clientOptions = { ...options };
  delete clientOptions.clientFactory;
  delete clientOptions.initializationAttempts;
  delete clientOptions.initializationPause;
  const attempts = Math.min(Math.max(Number(options.initializationAttempts) || 2, 1), 5);
  const pause = options.initializationPause || sleep;
  let client;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = clientFactory(clientOptions);
    activeClient = candidate;
    try {
      client = await candidate.init();
      break;
    } catch (error) {
      lastError = error;
      await candidate.close().catch(() => {});
      if (activeClient === candidate) activeClient = null;
      if (!isTransientClientInitializationError(error) || attempt + 1 >= attempts) throw error;
      await pause(500 * (attempt + 1));
    }
  }
  if (!client) throw lastError || new Error('PLAUD 会话初始化失败。');
  try {
    return await callback(client);
  } finally {
    if (signalShutdown) {
      await signalShutdown;
    } else {
      await client.close();
    }
    if (activeClient === client) activeClient = null;
  }
}

function installSignalCleanup() {
  const stop = (signal) => {
    if (signalShutdown) return;
    const exitCode = signal === 'SIGINT' ? 130 : 143;
    signalShutdown = (async () => {
      const timer = setTimeout(() => process.exit(exitCode), 4000);
      try {
        await activeClient?.close();
      } catch {
        // The parent process is already stopping; exact-profile cleanup in the
        // next launch provides a second recovery layer.
      } finally {
        clearTimeout(timer);
        process.exit(exitCode);
      }
    })();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

async function connection(requestedBrowser, options = {}) {
  const browser = configuredBrowserKind(requestedBrowser);
  const result = await withClient(async (client) => {
    await client.listFiles({ limit: 1 });
    return {
      ok: true,
      connected: true,
      browser,
      browserLabel: client.browserLabel,
      accountFingerprint: client.accountFingerprint(),
    };
  }, {
    browserKind: browser,
    headless: options.headless !== false,
    loginTimeoutMs: options.loginTimeoutMs,
  });
  printJson(result);
}

async function login(requestedBrowser) {
  return connection(requestedBrowser, { headless: false, loginTimeoutMs: 10 * 60 * 1000 });
}

function logout(requestedBrowser) {
  const browser = configuredBrowserKind(requestedBrowser);
  const removed = removeManagedProfile(browser);
  printJson({
    ok: true,
    connected: false,
    browser,
    browserLabel: BROWSER_SPECS[browser].label,
    removed,
  });
}

async function status(limit) {
  const items = await withClient((client) => client.listStatuses({ limit }));
  printJson({ count: items.length, items });
}

async function pending(limit) {
  const files = await withClient((client) => client.listPendingFiles({ limit }));
  const items = files.map(safePendingFile);
  printJson({ count: items.length, items });
}

function queue() {
  const state = loadState();
  const items = Object.values(state.records)
    .filter((item) => !FINAL_STAGES.has(item.stage))
    .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
  printJson({ stateFile: STATE_FILE, count: items.length, items });
}

function verify(fileId) {
  const state = loadState();
  const record = state.records[fileId];
  if (!record) {
    printJson({ ok: false, fileId, error: 'queue record not found' });
    process.exitCode = 1;
    return;
  }
  const checks = { notesAudit: 'not_required', reviewAudit: 'not_required', discussionAudit: 'not_required' };
  try {
    if (['notes_project', 'reviewed', 'documented', 'managed'].includes(record.stage)) {
      validateStoredNotesAudit(record);
      checks.notesAudit = 'passed';
    }
    if (['reviewed', 'documented', 'managed'].includes(record.stage)) {
      validateStoredReviewAudit(record);
      checks.reviewAudit = 'passed';
    }
    if (['discussion_notes_ready', 'discussion_complete'].includes(record.stage)) {
      validateStoredDiscussionNotes(record);
      checks.discussionNotesAudit = 'passed';
    }
    if (record.stage === 'discussion_complete') {
      validateStoredDiscussionAudit(record);
      checks.discussionAudit = 'passed';
    }
    printJson({ ok: true, fileId, stage: record.stage, checks });
  } catch (error) {
    printJson({ ok: false, fileId, stage: record.stage, checks, error: safeErrorMessage(error) });
    process.exitCode = 1;
  }
}

async function syncPending(count, outDir, timeoutSec, pollSec) {
  fs.mkdirSync(outDir, { recursive: true });
  const state = loadState();

  const result = await withClient(async (client) => {
    const files = await client.listPendingFiles({ limit: count });
    const submitted = [];
    const results = [];

    for (const file of files) {
      const info = safePendingFile(file);
      updateRecord(state, info.fileId, { ...info, stage: 'generating', outputDir: outDir });
      try {
        await client.generateFile(info.fileId);
        submitted.push(info);
      } catch (error) {
        const message = safeErrorMessage(error);
        updateRecord(state, info.fileId, { stage: 'generation_failed', error: message });
        results.push({ ...info, ok: false, stage: 'generation_failed', error: message });
      }
    }

    const remaining = new Map(submitted.map((item) => [item.fileId, item]));
    const deadline = Date.now() + timeoutSec * 1000;

    while (remaining.size > 0 && Date.now() < deadline) {
      for (const [fileId, info] of [...remaining.entries()]) {
        try {
          const transcript = await client.downloadTranscript(fileId, outDir);
          const record = updateRecord(state, fileId, {
            ...info,
            stage: 'transcript_ready',
            transcriptPath: transcript.mdPath,
            transcriptRawPath: transcript.rawPath,
            error: null,
          });
          results.push({ ...record, ok: true });
          remaining.delete(fileId);
        } catch (error) {
          const message = safeErrorMessage(error);
          if (!message.includes('Transcript not found')) {
            updateRecord(state, fileId, { stage: 'generation_failed', error: message });
            results.push({ ...info, ok: false, stage: 'generation_failed', error: message });
            remaining.delete(fileId);
          }
        }
      }
      if (remaining.size > 0 && Date.now() < deadline) await sleep(pollSec * 1000);
    }

    for (const [fileId, info] of remaining.entries()) {
      const message = `Transcript was not ready within ${timeoutSec} seconds`;
      updateRecord(state, fileId, { stage: 'generation_timeout', error: message });
      results.push({ ...info, ok: false, stage: 'generation_timeout', error: message });
    }

    return { requested: count, found: files.length, submitted: submitted.length, results };
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestPath = path.join(outDir, `domi-plaud-manifest-${timestamp}.json`);
  const manifest = {
    generatedAt: new Date().toISOString(),
    outputDir: outDir,
    ...result,
    manifestPath,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  printJson(manifest);
}

async function download(fileId, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const transcript = await withClient((client) => client.downloadTranscript(fileId, outDir));
  const state = loadState();
  const record = updateRecord(state, fileId, {
    fileName: transcript.fileName,
    stage: 'transcript_ready',
    outputDir: outDir,
    transcriptPath: transcript.mdPath,
    transcriptRawPath: transcript.rawPath,
    error: null,
  });
  printJson({ ok: true, ...record });
}

function fingerprintAudio(audioPath) {
  const resolved = fs.realpathSync(path.resolve(audioPath));
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`Audio path is not a file: ${resolved}`);
  if (stat.size <= 0) throw new Error(`Audio file is empty: ${resolved}`);
  return {
    sourceAudioPath: resolved,
    sourceAudioBytes: stat.size,
    sourceAudioMtimeMs: Math.floor(stat.mtimeMs),
    sourceAudioSha256: sha256File(resolved),
  };
}

function findRecordBySource(state, fingerprint) {
  return Object.values(state.records)
    .filter((record) => record.sourceAudioSha256 === fingerprint.sourceAudioSha256 &&
      record.sourceAudioBytes === fingerprint.sourceAudioBytes)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
}

function replaceRecordKey(state, oldFileId, newFileId, patch) {
  return withStateWriteLock(() => {
    const latest = loadState();
    const previous = latest.records[oldFileId] || {};
    const existing = latest.records[newFileId] || {};
    if (oldFileId !== newFileId) delete latest.records[oldFileId];
    latest.records[newFileId] = {
      ...previous,
      ...existing,
      ...patch,
      fileId: newFileId,
      updatedAt: new Date().toISOString(),
    };
    writeStateUnlocked(latest);
    state.version = latest.version;
    state.records = latest.records;
    return latest.records[newFileId];
  });
}

function usableTranscript(record) {
  return Boolean(record?.transcriptPath && fs.existsSync(record.transcriptPath) &&
    fs.statSync(record.transcriptPath).isFile() && fs.statSync(record.transcriptPath).size > 0);
}

async function withSourceLock(fingerprint, callback) {
  const lockDir = path.join(STATE_DIR, 'locks');
  fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(lockDir, 0o700);
  const lockPath = path.join(lockDir, `${fingerprint.sourceAudioSha256}.lock`);
  let fd;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, sourceAudioSha256: fingerprint.sourceAudioSha256 })}\n`);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (!Number.isInteger(lock.pid) || lock.pid <= 0) stale = true;
        else {
          try { process.kill(lock.pid, 0); } catch (processError) {
            if (processError.code === 'ESRCH') stale = true;
          }
        }
      } catch (_) {
        try { stale = Date.now() - fs.statSync(lockPath).mtimeMs > 10000; } catch (_) {}
      }
      if (stale && attempt === 0) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      throw new Error('This local audio file is already being processed by another PLAUD command');
    }
  }
  if (fd === undefined) throw new Error('Could not acquire the local-audio processing lock');
  try {
    return await callback();
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(lockPath); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function remoteFileIdentity(file) {
  return {
    fileId: file.id || file.file_id || null,
    fileName: file.filename || file.file_name || null,
  };
}

async function findRemoteUpload(client, uploadTitle, options = {}) {
  const attempts = options.attempts || 1;
  const pause = options.pause || sleep;
  const pollMs = options.pollMs || 2000;
  const adoptFileId = options.adoptFileId || null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const matchesById = new Map();
    for (let skip = 0; skip < 500; skip += 100) {
      const files = await client.listFiles({ limit: 100, skip });
      for (const item of files.map(remoteFileIdentity)) {
        if (item.fileId && item.fileName === uploadTitle) matchesById.set(item.fileId, item);
      }
      if (files.length < 100) break;
    }
    const matches = [...matchesById.values()];
    if (adoptFileId) {
      const adopted = matchesById.get(adoptFileId);
      if (adopted) return adopted;
      if (matches.length > 0 || attempt + 1 === attempts) {
        const error = new Error(`Requested PLAUD fileId ${adoptFileId} does not match the stable upload title`);
        error.candidateFileIds = matches.map((item) => item.fileId);
        throw error;
      }
    }
    if (matches.length > 1) {
      const error = new Error(`Multiple PLAUD files match the stable upload title ${uploadTitle}; choose one with --adopt-file-id`);
      error.candidateFileIds = matches.map((item) => item.fileId);
      throw error;
    }
    if (matches.length === 1) return matches[0];
    if (attempt + 1 < attempts) await pause(pollMs);
  }
  return null;
}

async function transcribeLocal(audioPath, outDir, timeoutSec, pollSec, title, options = {}) {
  const fingerprint = fingerprintAudio(audioPath);
  return withSourceLock(fingerprint, async () => transcribeLocalLocked(
    fingerprint, outDir, timeoutSec, pollSec, title, options,
  ));
}

async function transcribeLocalLocked(fingerprint, outDir, timeoutSec, pollSec, title, options = {}) {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(outDir, 0o700);
  const state = loadState();
  let record = findRecordBySource(state, fingerprint);
  const reusedSource = Boolean(record);
  const requestedTitle = safeName(String(
    title || path.basename(fingerprint.sourceAudioPath, path.extname(fingerprint.sourceAudioPath)),
  ).trim()).slice(0, 80) || 'Quick Discussion';
  if (record?.workflowId && options.workflowId && record.workflowId !== options.workflowId) {
    throw new Error('This source audio is already bound to a different quick-discussion workflowId');
  }
  const workflowId = options.workflowId || record?.workflowId || null;
  if (workflowId !== null && !/^[a-f0-9]{16}$/.test(workflowId)) {
    throw new Error('workflowId must be a 16-character lowercase hexadecimal identifier');
  }
  if (options.workflowId && record?.workflow &&
      !['local_transcription', 'quick_discussion'].includes(record.workflow)) {
    throw new Error(`This source audio belongs to the ${record.workflow} workflow and cannot be rebound`);
  }
  const workflow = workflowId ? 'quick_discussion' : (record?.workflow || 'local_transcription');
  if (workflow === 'quick_discussion' && !workflowId) {
    throw new Error('quick_discussion records require a valid workflowId');
  }
  const discussionTopic = workflow === 'quick_discussion'
    ? (record?.discussionTopic || requestedTitle)
    : null;
  if (record && (record.workflow !== workflow || record.workflowId !== workflowId ||
      record.discussionTopic !== discussionTopic)) {
    record = updateRecord(state, record.fileId, { workflow, workflowId, discussionTopic });
  }
  const uncertainGenerationStages = new Set([
    'generation_submitting',
    'generation_unknown',
    'generation_timeout',
  ]);
  if (options.allowUnknownGenerationRetry &&
      (!record || !uncertainGenerationStages.has(record.stage))) {
    throw new Error('--retry-generation may only resolve generation_submitting, generation_unknown, or generation_timeout');
  }
  if (usableTranscript(record)) {
    return { ok: true, reused: true, ...record };
  }

  const provisionalId = record?.fileId || `local:${fingerprint.sourceAudioSha256.slice(0, 32)}`;
  const titlePrefix = workflow === 'quick_discussion' ? 'QD' : 'LOCAL';
  const uploadTitle = record?.uploadTitle || `${titlePrefix}-${requestedTitle}-${fingerprint.sourceAudioSha256.slice(0, 16)}`;
  if (!record) {
    record = updateRecord(state, provisionalId, {
      ...fingerprint,
      workflow,
      workflowId,
      discussionTopic,
      stage: 'uploading',
      outputDir: outDir,
      uploadTitle,
      error: null,
    });
  }

  const runWithClient = options.withClientImpl || withClient;
  const pause = options.pause || sleep;
  const now = options.now || (() => Date.now());
  return runWithClient(async (client) => {
    if (String(record.fileId).startsWith('local:')) {
      const recoveringUnknownUpload = ['upload_unknown', 'upload_recovery_ambiguous'].includes(record.stage);
      if (options.adoptFileId && !recoveringUnknownUpload) {
        throw new Error('--adopt-file-id may only resolve upload_unknown or upload_recovery_ambiguous');
      }
      record = updateRecord(state, record.fileId, {
        ...fingerprint,
        workflow,
        workflowId,
        discussionTopic,
        stage: recoveringUnknownUpload ? record.stage : 'uploading',
        outputDir: outDir,
        uploadTitle,
        uploadAttemptedAt: new Date().toISOString(),
        error: null,
      });
      let uploaded;
      let uploadPhase = 'recover';
      try {
        const recovered = await findRemoteUpload(client, uploadTitle, {
          attempts: recoveringUnknownUpload ? (options.uploadRecoveryAttempts || 5) : 1,
          pause,
          pollMs: options.uploadRecoveryPollMs || 2000,
          adoptFileId: options.adoptFileId,
        });
        if (!recovered && recoveringUnknownUpload && !options.allowUnknownUploadRetry) {
          record = updateRecord(state, record.fileId, {
            stage: record.stage === 'upload_recovery_ambiguous'
              ? 'upload_recovery_ambiguous'
              : 'upload_unknown',
            error: 'Upload confirmation is uncertain and the remote file is not visible yet; retry later or explicitly allow re-upload',
          });
          return { ok: false, reused: true, ...record };
        }
        uploaded = recovered || await client.uploadAudioFile(fingerprint.sourceAudioPath, {
          fileName: uploadTitle,
          onProgress: (progress) => {
            uploadPhase = progress.stage || uploadPhase;
            if (uploadPhase === 'confirm') {
              record = updateRecord(state, record.fileId, {
                stage: 'upload_unknown',
                uploadPhase,
                error: 'PLAUD upload confirmation was submitted; awaiting a confirmed fileId',
              });
            }
          },
        });
        if (!uploaded.fileId) throw new Error('PLAUD upload completed without a fileId');
      } catch (error) {
        const message = safeErrorMessage(error);
        const ambiguous = Array.isArray(error.candidateFileIds) ||
          message.startsWith('Multiple PLAUD files match') ||
          message.startsWith('Requested PLAUD fileId');
        const uncertainStage = record.stage === 'upload_recovery_ambiguous'
          ? 'upload_recovery_ambiguous'
          : 'upload_unknown';
        updateRecord(state, record.fileId, {
          stage: ambiguous
            ? 'upload_recovery_ambiguous'
            : ((uploadPhase === 'confirm' || recoveringUnknownUpload) ? uncertainStage : 'upload_failed'),
          uploadPhase,
          uploadCandidateFileIds: Array.isArray(error.candidateFileIds)
            ? error.candidateFileIds.slice(0, 20)
            : record.uploadCandidateFileIds,
          error: message,
        });
        throw new Error(message);
      }
      record = replaceRecordKey(state, record.fileId, uploaded.fileId, {
        ...fingerprint,
        workflow,
        workflowId,
        discussionTopic,
        stage: 'uploaded',
        outputDir: outDir,
        uploadTitle,
        fileName: uploaded.fileName || uploadTitle,
        uploadedBytes: uploaded.uploadedBytes,
        originalBytes: uploaded.originalBytes,
        uploadFileType: uploaded.fileType,
        uploadTranscoded: uploaded.transcode,
        uploadedAt: new Date().toISOString(),
        uploadCandidateFileIds: null,
        error: null,
      });
    }

    const retryingUncertainGeneration = options.allowUnknownGenerationRetry &&
      uncertainGenerationStages.has(record.stage);
    if (retryingUncertainGeneration) {
      try {
        const transcript = await client.downloadTranscript(record.fileId, outDir);
        record = updateRecord(state, record.fileId, {
          stage: 'transcript_ready',
          transcriptPath: transcript.mdPath,
          transcriptRawPath: transcript.rawPath,
          fileName: transcript.fileName || record.fileName,
          error: null,
        });
        return { ok: true, reused: true, ...record };
      } catch (error) {
        const message = safeErrorMessage(error);
        if (!message.includes('Transcript not found')) {
          updateRecord(state, record.fileId, { stage: 'download_failed', error: message });
          throw new Error(message);
        }
      }
    }
    if (['uploaded', 'generation_failed'].includes(record.stage) || retryingUncertainGeneration) {
      record = updateRecord(state, record.fileId, {
        stage: 'generation_submitting',
        generationRequestedAt: new Date().toISOString(),
        generationRetryConfirmedAt: retryingUncertainGeneration ? new Date().toISOString() : null,
        error: null,
      });
      try {
        await client.generateFile(record.fileId);
        record = updateRecord(state, record.fileId, {
          stage: 'generating',
          error: null,
        });
      } catch (error) {
        const message = safeErrorMessage(error);
        const knownRejection = knownGenerationRejection(message);
        record = updateRecord(state, record.fileId, {
          stage: knownRejection ? 'generation_failed' : 'generation_unknown',
          error: message,
        });
        if (knownRejection) throw error;
      }
    }

    const deadline = now() + timeoutSec * 1000;
    while (true) {
      try {
        const transcript = await client.downloadTranscript(record.fileId, outDir);
        const generationStage = new Set([
          'uploaded', 'generation_submitting', 'generating', 'generation_unknown',
          'generation_failed', 'generation_timeout', 'download_failed',
        ]);
        record = updateRecord(state, record.fileId, {
          stage: generationStage.has(record.stage) ? 'transcript_ready' : record.stage,
          transcriptPath: transcript.mdPath,
          transcriptRawPath: transcript.rawPath,
          fileName: transcript.fileName || record.fileName,
          error: null,
        });
        return { ok: true, reused: reusedSource, ...record };
      } catch (error) {
        const message = safeErrorMessage(error);
        if (!message.includes('Transcript not found')) {
          updateRecord(state, record.fileId, { stage: 'download_failed', error: message });
          throw error;
        }
      }
      if (now() >= deadline) break;
      await pause(pollSec * 1000);
    }

    record = updateRecord(state, record.fileId, {
      stage: 'generation_timeout',
      error: `Transcript was not ready within ${timeoutSec} seconds`,
    });
    return { ok: false, reused: reusedSource, ...record };
  });
}

function resolveArtifactFile(artifactPath, stage) {
  if (!artifactPath || artifactPath === '-') {
    throw new Error(`${stage} requires an artifact file path`);
  }
  const resolved = path.resolve(artifactPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${stage} artifact file does not exist: ${resolved}`);
  }
  return resolved;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function notesAuditAttestationPassed(audit) {
  return Boolean(audit)
    && typeof audit === 'object'
    && !Array.isArray(audit)
    && audit.status === 'passed'
    && audit.evidenceLedgerComplete === true
    && audit.degreeIsolation === true
    && audit.claimConsistency === true
    && audit.careerLedgerComplete === true
    && audit.modelWorkLedgerComplete === true
    && audit.attributionConsistency === true
    && audit.unresolvedDefinitiveEducationClaims === 0
    && audit.unresolvedDefinitiveCareerClaims === 0
    && audit.unresolvedDefinitiveModelWorkClaims === 0
    && Number.isInteger(audit.educationClaimCount)
    && audit.educationClaimCount >= 0
    && Number.isInteger(audit.careerClaimCount)
    && audit.careerClaimCount >= 0
    && Number.isInteger(audit.modelWorkClaimCount)
    && audit.modelWorkClaimCount >= 0;
}

function validateStoredNotesAudit(record) {
  if (!notesAuditAttestationPassed(record.notesAudit) || !record.notesAudit.notesSha256) {
    throw new Error('project stage requires a passed notesAudit bound to the notes file');
  }
  if (!record.notesPath || !fs.existsSync(record.notesPath) || !fs.statSync(record.notesPath).isFile()) {
    throw new Error(`audited notes file is missing: ${record.notesPath || 'unset'}`);
  }
  const currentHash = sha256File(record.notesPath);
  if (currentHash !== record.notesAudit.notesSha256) {
    throw new Error('audited notes file changed after notesAudit; re-run the fact audit and mark notes_project again');
  }
}

function reviewAuditAttestationPassed(audit) {
  return Boolean(audit)
    && typeof audit === 'object'
    && !Array.isArray(audit)
    && audit.status === 'passed'
    && audit.educationConsistency === true
    && audit.careerModelConsistency === true;
}

function reviewDecisionValid(record) {
  return Number.isInteger(record.score)
    && record.score >= 1
    && record.score <= 10
    && record.score !== 5
    && ['B', 'A', 'S'].includes(record.rating);
}

function validateStoredReviewAudit(record) {
  if (!reviewAuditAttestationPassed(record.reviewAudit) || !record.reviewAudit.reviewSha256) {
    throw new Error('downstream project stage requires a passed reviewAudit bound to the review file');
  }
  if (!record.reviewPath || !fs.existsSync(record.reviewPath) || !fs.statSync(record.reviewPath).isFile()) {
    throw new Error(`audited review file is missing: ${record.reviewPath || 'unset'}`);
  }
  const currentHash = sha256File(record.reviewPath);
  if (currentHash !== record.reviewAudit.reviewSha256) {
    throw new Error('audited review file changed after reviewAudit; re-check it against the notes and mark reviewed again');
  }
  if (!reviewDecisionValid(record)) {
    throw new Error('reviewed project requires an integer score from 1-10 excluding 5 and rating B, A, or S');
  }
}

function validateStoredDiscussionAudit(record) {
  const audit = record.discussionAudit;
  if (!audit || audit.status !== 'passed' || !audit.notesSha256 || !audit.briefSha256) {
    throw new Error('discussion_complete requires a passed discussionAudit bound to notes and brief files');
  }
  validateStoredDiscussionNotes(record);
  if (record.discussionNotesAudit.notesSha256 !== audit.notesSha256) {
    throw new Error('discussion notes audit does not match the completed discussion audit');
  }
  if (!record.briefPath || !fs.existsSync(record.briefPath) || !fs.statSync(record.briefPath).isFile()) {
    throw new Error(`discussion brief file is missing: ${record.briefPath || 'unset'}`);
  }
  if (sha256File(record.briefPath) !== audit.briefSha256) {
    throw new Error('discussion brief file changed after discussionAudit');
  }
}

function normalizedDiscussionContext(record) {
  return JSON.stringify({
    workflow: record.workflow || null,
    workflowId: record.workflowId || null,
    discussionTopic: record.discussionTopic || null,
    contextStatus: record.contextStatus || null,
    conversationType: record.conversationType || null,
    conversationPurpose: record.conversationPurpose || null,
    participants: Array.isArray(record.participants) ? record.participants : [],
    userContext: record.userContext || null,
  });
}

function validateQuickDiscussionBinding(record) {
  if (record.workflow !== 'quick_discussion' ||
      typeof record.workflowId !== 'string' ||
      !/^[a-f0-9]{16}$/.test(record.workflowId)) {
    throw new Error('quick-discussion stages require workflow=quick_discussion and a valid workflowId');
  }
  if (typeof record.discussionTopic !== 'string' || !record.discussionTopic.trim()) {
    throw new Error('quick-discussion stages require a non-empty discussionTopic');
  }
}

function discussionInputFingerprint(record) {
  validateQuickDiscussionBinding(record);
  if (!record.transcriptPath || !fs.existsSync(record.transcriptPath) ||
      !fs.statSync(record.transcriptPath).isFile()) {
    throw new Error(`discussion transcript file is missing: ${record.transcriptPath || 'unset'}`);
  }
  return crypto.createHash('sha256')
    .update(sha256File(record.transcriptPath))
    .update('\0')
    .update(normalizedDiscussionContext(record))
    .digest('hex');
}

function validateStoredDiscussionNotes(record) {
  const audit = record.discussionNotesAudit;
  if (!audit || audit.status !== 'passed' || !audit.notesSha256 || !audit.inputFingerprint) {
    throw new Error('discussion_notes_ready requires a passed audit bound to transcript, context, and notes');
  }
  if (!record.notesPath || !fs.existsSync(record.notesPath) || !fs.statSync(record.notesPath).isFile()) {
    throw new Error(`discussion notes file is missing: ${record.notesPath || 'unset'}`);
  }
  if (sha256File(record.notesPath) !== audit.notesSha256) {
    throw new Error('discussion notes file changed after discussionNotesAudit');
  }
  if (discussionInputFingerprint(record) !== audit.inputFingerprint) {
    throw new Error('discussion transcript or context changed after discussionNotesAudit');
  }
}

function mark(fileId, stage, artifactPath, metadataRaw) {
  if (!ALLOWED_STAGES.has(stage)) {
    throw new Error(`Unsupported stage: ${stage}`);
  }
  let metadata = {};
  if (metadataRaw) {
    metadata = JSON.parse(metadataRaw);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error('metadataJson must be a JSON object');
    }
  }
  const state = loadState();
  const previous = state.records[fileId] || { fileId };
  let resolvedArtifactPath = artifactPath && artifactPath !== '-' ? path.resolve(artifactPath) : null;

  const immutableMarkFields = [
    'fileId',
    'workflow',
    'workflowId',
    'sourceAudioPath',
    'sourceAudioBytes',
    'sourceAudioMtimeMs',
    'sourceAudioSha256',
    'uploadTitle',
    'transcriptPath',
    'transcriptRawPath',
    'discussionNotesAudit',
  ];
  const forbiddenImmutableFields = immutableMarkFields.filter((field) => Object.hasOwn(metadata, field));
  if (forbiddenImmutableFields.length > 0) {
    throw new Error(`metadataJson may not override workflow identity or bound artifacts: ${forbiddenImmutableFields.join(', ')}`);
  }
  if (['discussion_notes_ready', 'discussion_complete'].includes(stage) &&
      Object.keys(metadata).length > 0) {
    throw new Error(`${stage} does not accept caller-provided metadata; its audit fields are computed by the CLI`);
  }

  if (stage !== 'notes_project' && (Object.hasOwn(metadata, 'notesAudit') || Object.hasOwn(metadata, 'notesPath'))) {
    throw new Error('notesAudit and notesPath may only be set by mark notes_project');
  }
  if (stage !== 'reviewed' && (Object.hasOwn(metadata, 'reviewAudit') || Object.hasOwn(metadata, 'reviewPath'))) {
    throw new Error('reviewAudit and reviewPath may only be set by mark reviewed');
  }
  if (stage !== 'discussion_complete' &&
      (Object.hasOwn(metadata, 'discussionAudit') || Object.hasOwn(metadata, 'briefPath'))) {
    throw new Error('discussionAudit and briefPath may only be set by mark discussion_complete');
  }

  if (stage === 'notes_project') {
    if (!['context_ready', 'notes_project', 'notes_non_project', 'reviewed', 'documented', 'managed'].includes(previous.stage)) {
      throw new Error(`notes_project requires context_ready, a notes retry/reclassification, or a legacy downstream record needing re-audit; current stage is ${previous.stage || 'unset'}`);
    }
    const audit = metadata.notesAudit;
    if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
      throw new Error('notes_project requires metadata object: notesAudit');
    }
    if (!notesAuditAttestationPassed(audit)) {
      throw new Error('notes_project requires passed notesAudit with complete education/career/model ledgers, degree and attribution consistency, non-negative claim counts, and zero unresolved definitive education/career/model claims');
    }
    resolvedArtifactPath = resolveArtifactFile(artifactPath, stage);
    metadata = {
      ...metadata,
      notesPath: resolvedArtifactPath,
      notesAudit: { ...audit, notesSha256: sha256File(resolvedArtifactPath) },
      reviewPath: null,
      reviewAudit: null,
      score: null,
      rating: null,
      wikiUrl: null,
      wikiNodeToken: null,
      docToken: null,
      oneDrivePath: null,
      recordId: null,
      projectId: null,
      storageReceipt: null,
      action: null,
    };
  }
  if (stage === 'notes_non_project') {
    if (!['context_ready', 'notes_project', 'notes_non_project'].includes(previous.stage)) {
      throw new Error(`notes_non_project requires previous stage context_ready, notes_project, or notes_non_project; current stage is ${previous.stage || 'unset'}`);
    }
    resolvedArtifactPath = resolveArtifactFile(artifactPath, stage);
    metadata = {
      ...metadata,
      notesPath: resolvedArtifactPath,
      notesAudit: null,
      reviewPath: null,
      reviewAudit: null,
      score: null,
      rating: null,
      wikiUrl: null,
      wikiNodeToken: null,
      docToken: null,
      oneDrivePath: null,
      recordId: null,
      projectId: null,
      storageReceipt: null,
      action: null,
      archiveError: null,
    };
  }
  if (stage === 'discussion_notes_ready') {
    if (!['context_ready', 'discussion_notes_ready'].includes(previous.stage)) {
      throw new Error(`discussion_notes_ready requires previous stage context_ready or discussion_notes_ready retry; current stage is ${previous.stage || 'unset'}`);
    }
    validateQuickDiscussionBinding(previous);
    resolvedArtifactPath = resolveArtifactFile(artifactPath, 'discussion_notes_ready notes');
    const inputFingerprint = discussionInputFingerprint(previous);
    metadata = {
      ...metadata,
      notesPath: resolvedArtifactPath,
      discussionNotesAudit: {
        status: 'passed',
        inputFingerprint,
        notesSha256: sha256File(resolvedArtifactPath),
      },
      briefPath: null,
      discussionAudit: null,
    };
  }
  if (stage === 'reviewed') {
    if (!['notes_project', 'reviewed'].includes(previous.stage)) {
      throw new Error(`reviewed requires previous stage notes_project or reviewed retry; current stage is ${previous.stage || 'unset'}`);
    }
    validateStoredNotesAudit(previous);
    const audit = metadata.reviewAudit;
    if (!reviewAuditAttestationPassed(audit)) {
      throw new Error('reviewed requires reviewAudit with status=passed, educationConsistency=true, and careerModelConsistency=true');
    }
    if (!reviewDecisionValid(metadata)) {
      throw new Error('reviewed requires a fresh integer score from 1-10 excluding 5 and rating B, A, or S');
    }
    resolvedArtifactPath = resolveArtifactFile(artifactPath, stage);
    metadata = {
      ...metadata,
      reviewPath: resolvedArtifactPath,
      reviewAudit: { ...audit, reviewSha256: sha256File(resolvedArtifactPath) },
      wikiUrl: null,
      wikiNodeToken: null,
      docToken: null,
      oneDrivePath: null,
      recordId: null,
      projectId: null,
      storageReceipt: null,
      action: null,
    };
  }
  if (stage === 'discussion_complete') {
    if (!['discussion_notes_ready', 'discussion_complete'].includes(previous.stage)) {
      throw new Error(`discussion_complete requires previous stage discussion_notes_ready or discussion_complete retry; current stage is ${previous.stage || 'unset'}`);
    }
    validateQuickDiscussionBinding(previous);
    validateStoredDiscussionNotes(previous);
    resolvedArtifactPath = resolveArtifactFile(artifactPath, 'discussion_complete brief');
    metadata = {
      ...metadata,
      briefPath: resolvedArtifactPath,
      discussionAudit: {
        status: 'passed',
        notesSha256: previous.discussionNotesAudit.notesSha256,
        briefSha256: sha256File(resolvedArtifactPath),
      },
    };
  }
  const candidate = { ...previous, ...metadata, stage };
  if (stage === 'documented') {
    if (!['reviewed', 'documented'].includes(previous.stage)) {
      throw new Error(`documented requires previous stage reviewed or documented retry; current stage is ${previous.stage || 'unset'}`);
    }
    validateStoredNotesAudit(candidate);
    validateStoredReviewAudit(candidate);
    if (candidate.storageReceipt?.backend === 'local') {
      const receipt = candidate.storageReceipt;
      const required = ['projectId', 'documentUri', 'libraryPath'];
      const missing = required.filter((key) => !receipt[key]);
      if (missing.length > 0 ||
          !receipt.recordVerified ||
          !receipt.documentVerified ||
          !receipt.filesVerified) {
        throw new Error(`documented local backend requires a verified storageReceipt${missing.length ? `: ${missing.join(', ')}` : ''}`);
      }
      metadata = { ...metadata, projectId: receipt.projectId };
    } else {
      const required = ['wikiUrl', 'wikiNodeToken', 'docToken', 'oneDrivePath'];
      const missing = required.filter((key) => !candidate[key]);
      if (missing.length > 0) {
        throw new Error(`documented requires metadata fields: ${missing.join(', ')}`);
      }
    }
    metadata = { ...metadata, archiveError: null };
  }
  if (stage === 'managed') {
    if (!['documented', 'managed'].includes(previous.stage)) {
      throw new Error(`managed requires previous stage documented or managed retry; current stage is ${previous.stage || 'unset'}`);
    }
    validateStoredNotesAudit(candidate);
    validateStoredReviewAudit(candidate);
    if (!candidate.recordId && !candidate.projectId && !candidate.storageReceipt?.projectId) {
      throw new Error('managed requires metadata field: recordId or projectId');
    }
    metadata = { ...metadata, archiveError: null };
  }
  const patch = { ...metadata, stage };
  if (resolvedArtifactPath) patch.artifactPath = resolvedArtifactPath;
  const record = updateRecord(state, fileId, patch);
  printJson({ ok: true, record });
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    usage();
    return;
  }

  if (command === 'doctor') return doctor(args[0]);
  if (command === 'login') return login(args[0]);
  if (command === 'connection') return connection(args[0]);
  if (command === 'logout') return logout(args[0]);
  if (command === 'queue') return queue();
  if (command === 'verify') {
    if (!args[0]) throw new Error('verify requires fileId');
    return verify(args[0]);
  }
  if (command === 'status') return status(positiveInt(args[0], 20, 'limit', 100));
  if (command === 'pending') return pending(positiveInt(args[0], 20, 'limit', 100));
  if (command === 'sync-pending') {
    const count = positiveInt(args[0], 3, 'count', 100);
    const outDir = path.resolve(args[1] || path.join(process.cwd(), 'work', 'domi', 'plaud'));
    const timeoutSec = positiveInt(args[2], 1800, 'timeoutSec', 7200);
    const pollSec = positiveInt(args[3], 15, 'pollSec', 300);
    return syncPending(count, outDir, timeoutSec, pollSec);
  }
  if (command === 'transcribe-local') {
    const { positional, retryUpload, retryGeneration, workflowId, adoptFileId } = parseTranscribeLocalArgs(args);
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.resolve(positional[1] || path.join(process.cwd(), 'work', 'domi', 'plaud', runId));
    const timeoutSec = positiveInt(positional[2], 1800, 'timeoutSec', 7200);
    const pollSec = positiveInt(positional[3], 15, 'pollSec', 300);
    const result = await transcribeLocal(positional[0], outDir, timeoutSec, pollSec, positional[4], {
      allowUnknownUploadRetry: retryUpload,
      allowUnknownGenerationRetry: retryGeneration,
      workflowId,
      adoptFileId,
    });
    printJson(result);
    if (!result.ok) process.exitCode = 2;
    return;
  }
  if (command === 'download') {
    if (!args[0]) throw new Error('download requires fileId');
    const outDir = path.resolve(args[1] || path.join(process.cwd(), 'work', 'domi', 'plaud'));
    return download(args[0], outDir);
  }
  if (command === 'mark') {
    if (!args[0] || !args[1]) throw new Error('mark requires fileId and stage');
    return mark(args[0], args[1], args[2], args[3]);
  }

  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  installSignalCleanup();
  main().catch((error) => {
    printJson({ ok: false, error: safeErrorMessage(error) });
    process.exitCode = 1;
  });
}

module.exports = {
  __test: {
    ALLOWED_STAGES,
    FINAL_STAGES,
    STATE_DIR,
    STATE_FILE,
    findRecordBySource,
    fingerprintAudio,
    loadState,
    mark,
    parseTranscribeLocalArgs,
    isTransientClientInitializationError,
    safeErrorMessage,
    sha256File,
    transcribeLocal,
    updateRecord,
    usableTranscript,
    validateStoredDiscussionAudit,
    validateStoredDiscussionNotes,
    verify,
    withClient,
  },
};
