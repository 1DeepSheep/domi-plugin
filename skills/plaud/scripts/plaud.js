#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { artifact, verifyArtifact, evidenceCheck } = require('../../../scripts/domi-workflow.cjs');

const {
  BROWSER_SPECS,
  PlaudClient,
  SIGNAL_SHUTDOWN_BUDGET_MS,
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
  node plaud.js capabilities
  node plaud.js recover-pending [count] [outDir] [timeoutSec] [pollSec]
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
  return /^(?:Generate file failed: HTTP (?:4\d\d(?:;|$)|200; API status )|PLAUD_(?:AUTH_REQUIRED|UNAUTHORIZED|ACCESS_DENIED|RATE_LIMITED)\b)/.test(message);
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
  const fd = fs.openSync(temp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(sanitizedState, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, STATE_FILE);
  const directory = fs.openSync(STATE_DIR, 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
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

function plaudCommandClientOptions(command, extra = {}) {
  return {
    ...extra,
    // Only the user-triggered login command may create a visible window.
    headless: command !== 'login',
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
  return /PLAUD_SESSION_PROBE_INCOMPLETE|page\.(?:goto|reload)|connectOverCDP|WebSocket error|Protocol error.*(?:Page|Target)|Not attached to an active page|Target page, context or browser has been closed|Execution context was destroyed|ECONNREFUSED|ECONNRESET|ERR_CONNECTION_(?:CLOSED|RESET|REFUSED)|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|socket hang up/i
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
      // Browser.close and exact-profile termination deliberately have enough
      // time to flush rotated PLAUD session state before the process exits.
      const timer = setTimeout(() => process.exit(exitCode), SIGNAL_SHUTDOWN_BUDGET_MS);
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
  const command = options.command === 'login' ? 'login' : 'connection';
  const result = await withClient(async (client) => {
    await client.listFiles({ limit: 1 });
    return {
      ok: true,
      connected: true,
      browser,
      browserLabel: client.browserLabel,
      accountFingerprint: client.accountFingerprint(),
    };
  }, plaudCommandClientOptions(command, {
    browserKind: browser,
    loginTimeoutMs: options.loginTimeoutMs,
  }));
  printJson(result);
}

async function login(requestedBrowser) {
  return connection(requestedBrowser, { command: 'login', loginTimeoutMs: 10 * 60 * 1000 });
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
  const items = await withClient(
    (client) => client.listStatuses({ limit }),
    plaudCommandClientOptions('status'),
  );
  printJson({ count: items.length, items });
}

async function pending(limit) {
  const files = await withClient(
    (client) => client.listPendingFiles({ limit }),
    plaudCommandClientOptions('pending'),
  );
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
      checks.notesAudit = record.notesQuality ? 'passed' : 'legacy-unverified';
    }
    if (record.stage === 'notes_non_project') {
      if (record.notesQuality) validateStoredNotesQuality(record);
      checks.notesAudit = record.notesQuality ? 'passed' : 'legacy-unverified';
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

const PLAUD_SYNC_CAPABILITIES = {
  schema: 'domi.plaud-sync.v1',
  commands: ['sync-pending', 'recover-pending'],
  outcomes: ['ready', 'waiting', 'retryable', 'failed'],
};
const GENERATION_STAGES = new Set([
  'uploaded', 'generation_submitting', 'generation_unknown', 'generating',
  'generation_failed', 'generation_timeout', 'download_failed', 'failed',
]);

function isTransientTranscriptRead(error) {
  return /Failed to fetch|fetch failed|PLAUD_NETWORK_TIMEOUT|timed?\s*out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|ENETUNREACH|socket hang up|ERR_CONNECTION|ERR_NETWORK|Target page, context or browser has been closed|Execution context was destroyed|HTTP 5\d\d|download failed: 5\d\d/i.test(String(error?.message || error));
}

function syncErrorCode(error, fallback) {
  if (['PLAUD_TRANSCRIPT_EMPTY', 'PLAUD_TRANSCRIPT_INVALID'].includes(error?.code)) return error.code;
  const message = String(error?.message || error);
  if (/PLAUD_AUTH_REQUIRED|PLAUD_UNAUTHORIZED|HTTP 401/.test(message)) return 'PLAUD_AUTH_REQUIRED';
  if (/PLAUD_ACCESS_DENIED|HTTP 403/.test(message)) return 'PLAUD_ACCESS_DENIED';
  if (/PLAUD_RATE_LIMITED|HTTP 429/.test(message)) return 'PLAUD_RATE_LIMITED';
  return fallback;
}

function syncFileInfo(info) {
  return Object.fromEntries(['fileId', 'fileName', 'duration', 'createdAt', 'editedAt']
    .filter(key => info[key] !== undefined).map(key => [key, info[key]]));
}

function hasKnownGenerationRejection(record) {
  return Boolean(record?.generationAttemptId && !record.generationAcceptedAt
    && record.generationRejection?.attemptId === record.generationAttemptId);
}

function maySubmitGeneration(record) {
  return !record || ((!record.stage || record.stage === 'uploaded')
    && !record.generationRequestedAt && !record.generationAcceptedAt && !record.generationAttemptId);
}

// The decision and durable pre-submit record share one cross-process state
// lock. A second sync may read this ID, but cannot submit the same generation.
function claimGeneration(info, outDir, options = {}) {
  return withStateWriteLock(() => {
    const state = loadState();
    const previous = state.records[info.fileId];
    if (!maySubmitGeneration(previous)
      && !(options.retryKnownRejection && hasKnownGenerationRejection(previous))) return null;
    const record = { ...previous, ...syncFileInfo(info), fileId: info.fileId, outputDir: outDir,
      stage: 'generation_submitting', generationAttemptId: crypto.randomUUID(), generationRejection: null, generationSubmissionError: null,
      generationRequestedAt: new Date().toISOString(), syncOutcome: 'waiting', retryable: true, error: null, errorCode: null,
      updatedAt: new Date().toISOString() };
    state.records[info.fileId] = record;
    writeStateUnlocked(state);
    return record;
  });
}

function updateSyncRecord(fileId, patch, expectedAttemptId) {
  return withStateWriteLock(() => {
    const state = loadState();
    const previous = state.records[fileId] || { fileId };
    // A transcript may have been bound or notes completed while this read was
    // in flight. Never replace that path, downgrade its stage, or erase QA.
    if (expectedAttemptId && previous.generationAttemptId !== expectedAttemptId) return previous;
    if (patch.errorCode === 'PLAUD_GENERATION_NOT_SUBMITTED' && !maySubmitGeneration(previous)) return previous;
    const protectedArtifact = (previous.stage && !GENERATION_STAGES.has(previous.stage)) || usableTranscript(previous);
    if (protectedArtifact) {
      if (!expectedAttemptId || !patch.generationAcceptedAt) return previous;
      // A fast read may have completed notes before the POST acknowledgement
      // arrives. Preserve its binding and still save that genuine receipt.
      patch = { generationAcceptedAt: patch.generationAcceptedAt };
    } else if (!expectedAttemptId && previous.stage && patch.stage !== 'transcript_ready') {
      patch = { ...patch, stage: previous.stage };
    }
    const record = { ...previous, ...patch, fileId, updatedAt: new Date().toISOString() };
    state.records[fileId] = record;
    writeStateUnlocked(state);
    return record;
  });
}

function syncResult(record, outcome, errorCode = '', error = '', extra = {}) {
  if (errorCode === 'PLAUD_GENERATION_NOT_SUBMITTED' && !maySubmitGeneration(record)) {
    outcome = record.syncOutcome || 'waiting'; errorCode = record.errorCode || 'PLAUD_TRANSCRIPT_PENDING';
    error = record.error || 'Transcript is not ready yet.';
  }
  if (usableTranscript(record)) { outcome = 'ready'; errorCode = ''; error = ''; }
  else if (record?.stage && !GENERATION_STAGES.has(record.stage)) {
    outcome = 'failed'; errorCode = 'PLAUD_TRANSCRIPT_ARTIFACT_MISSING';
    error = 'The existing workflow transcript is missing; its stage and artifact bindings were preserved.';
  }
  return { ...record, ...extra, ok: outcome === 'ready', outcome, syncOutcome: outcome,
    retryable: outcome === 'waiting' || outcome === 'retryable', errorCode,
    error: error || null };
}

function ensurePlaudSyncEnabled() {
  const configPath = String(process.env.DOMI_CONFIG_PATH || '').trim();
  if (!configPath || !fs.existsSync(configPath)) return;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.plaudConnectionMode === 'disabled') {
    throw new Error('PLAUD_DISABLED: PLAUD is disabled; no browser or transcript operation was started.');
  }
}

async function syncPending(count, outDir, timeoutSec, pollSec, options = {}) {
  ensurePlaudSyncEnabled();
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const runWithClient = options.withClientImpl || withClient;
  const now = options.now || Date.now;
  const pause = options.pause || sleep;
  const readOnly = options.readOnly === true;
  const initial = loadState();
  const local = Object.values(initial.records)
    .filter(record => record.fileId && !String(record.fileId).startsWith('local:') && GENERATION_STAGES.has(record.stage)
      && (!readOnly || (!hasKnownGenerationRejection(record)
        && !['PLAUD_GENERATION_REJECTED', 'PLAUD_GENERATION_NOT_SUBMITTED', 'PLAUD_TRANSCRIPT_INVALID',
          'PLAUD_AUTH_REQUIRED', 'PLAUD_ACCESS_DENIED'].includes(record.errorCode)))
      && (!readOnly || record.stage !== 'uploaded' || record.generationRequestedAt
        || record.generationAttemptId || record.generationAcceptedAt
        || (record.syncOutcome === 'retryable' && ['PLAUD_READ_TRANSIENT', 'PLAUD_TRANSCRIPT_EMPTY', 'PLAUD_RATE_LIMITED'].includes(record.errorCode))))
    .sort((a, b) => String(a.syncCheckedAt || '').localeCompare(String(b.syncCheckedAt || '')));
  const results = [];
  let submitted = 0;
  const result = await runWithClient(async client => {
    const candidates = new Map();
    // Recovery deliberately does not list recent files: an acknowledged or
    // uncertain request remains recoverable after falling outside that page.
    if (!readOnly) {
      const files = await client.listFiles({ limit: Math.max(count * 10, 100) });
      for (const file of files) {
        const info = safePendingFile(file);
        if (!info.fileId) continue;
        const previous = initial.records[info.fileId];
        if ((!file.is_trans && !file.is_summary) || (previous && GENERATION_STAGES.has(previous.stage))) {
          candidates.set(info.fileId, { ...info, remoteProcessing: Boolean(file.wait_pull) });
        }
      }
    }
    for (const record of local) if (!candidates.has(record.fileId)) candidates.set(record.fileId, record);
    const selected = [...candidates.values()].slice(0, count);
    const remaining = new Map(selected.map(info => [info.fileId, { info, readFailures: 0 }]));
    const deadline = now() + timeoutSec * 1000;
    do {
      for (const [fileId, entry] of [...remaining.entries()]) {
        if (now() >= deadline) break;
        ensurePlaudSyncEnabled();
        let record = loadState().records[fileId];
        if (usableTranscript(record)) {
          results.push(syncResult(record, 'ready', '', '', { reused: true, source: 'recovered' }));
          remaining.delete(fileId);
          continue;
        }
        if (record?.stage && !GENERATION_STAGES.has(record.stage)) {
          results.push(syncResult(record, 'failed', 'PLAUD_TRANSCRIPT_ARTIFACT_MISSING',
            'The existing workflow transcript is missing; its completed stage and artifacts were preserved.'));
          remaining.delete(fileId);
          continue;
        }
        try {
          // Always prefer the actual transcript, even when wait_pull/task
          // status still says processing. This also checks stale list flags
          // before the very first POST for a new recording.
          const transcript = await client.downloadTranscript(fileId, record?.outputDir || outDir,
            { timeoutMs: Math.max(1, deadline - now()) });
          record = updateSyncRecord(fileId, { ...syncFileInfo(entry.info), stage: 'transcript_ready',
            transcriptPath: transcript.mdPath, transcriptRawPath: transcript.rawPath,
            outputDir: record?.outputDir || outDir, fileName: transcript.fileName || entry.info.fileName,
            syncCheckedAt: new Date().toISOString(), syncOutcome: 'ready', retryable: false, error: null, errorCode: null });
          results.push(syncResult(record, 'ready', '', '', { reused: !entry.submitted, source: entry.submitted ? 'generated' : 'recovered' }));
          remaining.delete(fileId);
        } catch (error) {
          const message = safeErrorMessage(error);
          const notReady = error?.code === 'PLAUD_TRANSCRIPT_NOT_READY' || message.includes('Transcript not found');
          if (notReady) {
            entry.readFailures = 0;
            if (!readOnly && now() < deadline && !entry.info.remoteProcessing && !error.remoteProcessing) {
              ensurePlaudSyncEnabled();
              const claim = claimGeneration(entry.info, outDir, { retryKnownRejection: true });
              if (claim) {
                try {
                  await client.generateFile(fileId);
                  submitted += 1;
                  entry.submitted = true;
                  record = updateSyncRecord(fileId, { stage: 'generating',
                    generationAcceptedAt: new Date().toISOString(), syncOutcome: 'waiting', retryable: true, error: null, errorCode: null }, claim.generationAttemptId);
                } catch (submitError) {
                  const submitMessage = safeErrorMessage(submitError);
                  const rejected = knownGenerationRejection(submitMessage);
                  record = updateSyncRecord(fileId, { stage: rejected ? 'generation_failed' : 'generation_unknown',
                    syncOutcome: rejected ? 'failed' : 'waiting', retryable: !rejected,
                    generationRejection: rejected ? { attemptId: claim.generationAttemptId, at: new Date().toISOString(),
                      errorCode: 'PLAUD_GENERATION_REJECTED', message: submitMessage } : null,
                    generationSubmissionError: submitMessage, error: submitMessage, errorCode: rejected ? 'PLAUD_GENERATION_REJECTED' : 'PLAUD_GENERATION_UNCONFIRMED' }, claim.generationAttemptId);
                  if (rejected) {
                    results.push(syncResult(record, 'failed', 'PLAUD_GENERATION_REJECTED', submitMessage));
                    remaining.delete(fileId);
                    continue;
                  }
                }
              }
            }
            record = loadState().records[fileId] || entry.info;
            const rejected = hasKnownGenerationRejection(record);
            const notSubmitted = readOnly && maySubmitGeneration(record);
            entry.last = syncResult(record, rejected ? 'failed' : 'waiting',
              rejected ? 'PLAUD_GENERATION_REJECTED' : notSubmitted ? 'PLAUD_GENERATION_NOT_SUBMITTED' : 'PLAUD_TRANSCRIPT_PENDING',
              rejected ? record.generationRejection.message : notSubmitted
                ? 'Generation has not been submitted; use explicit sync to continue.'
                : 'Transcript is not ready yet; only this recording will be checked again.');
            if (rejected || entry.last.outcome === 'ready' || entry.last.outcome === 'failed') {
              results.push(entry.last); remaining.delete(fileId);
            } else {
              updateSyncRecord(fileId, { stage: record.stage || 'generating', syncCheckedAt: new Date().toISOString(),
                syncOutcome: entry.last.outcome, retryable: entry.last.retryable });
            }
          } else {
            entry.readFailures += 1;
            const explicitCode = syncErrorCode(error, '');
            const transient = !explicitCode && isTransientTranscriptRead(error);
            const code = explicitCode || (transient ? 'PLAUD_READ_TRANSIENT' : 'PLAUD_TRANSCRIPT_READ_FAILED');
            record = updateSyncRecord(fileId, { ...syncFileInfo(entry.info), stage: record?.stage || 'uploaded',
              syncCheckedAt: new Date().toISOString(), syncOutcome: transient || ['PLAUD_RATE_LIMITED', 'PLAUD_TRANSCRIPT_EMPTY'].includes(code) ? 'retryable' : 'failed',
              retryable: transient || ['PLAUD_RATE_LIMITED', 'PLAUD_TRANSCRIPT_EMPTY'].includes(code), error: message, errorCode: code });
            entry.last = syncResult(record, transient || ['PLAUD_RATE_LIMITED', 'PLAUD_TRANSCRIPT_EMPTY'].includes(code) ? 'retryable' : 'failed', code, message);
            // Retry only reads, with a bounded consecutive-failure budget.
            // Authentication/permission/rate limits are immediately actionable.
            if (entry.last.outcome === 'ready' || entry.last.outcome === 'failed' || !transient || entry.readFailures >= 3) {
              results.push(entry.last); remaining.delete(fileId);
            }
          }
        }
      }
      if (remaining.size && now() < deadline) await pause(Math.min(pollSec * 1000, deadline - now()));
    } while (remaining.size && now() < deadline);
    for (const [fileId, entry] of remaining) {
      const record = loadState().records[fileId] || entry.info;
      const unsubmitted = !entry.last && maySubmitGeneration(record);
      const last = entry.last || syncResult(record, 'waiting',
        unsubmitted ? 'PLAUD_GENERATION_NOT_SUBMITTED' : 'PLAUD_TRANSCRIPT_PENDING',
        unsubmitted ? 'Generation has not been submitted; use explicit sync to continue.' : 'Transcript is not ready yet.');
      const saved = updateSyncRecord(fileId, { ...syncFileInfo(entry.info), stage: record.stage || 'uploaded',
        syncCheckedAt: entry.last ? new Date().toISOString() : record.syncCheckedAt,
        syncOutcome: last.outcome, retryable: last.retryable, error: last.error, errorCode: last.errorCode });
      results.push(syncResult(saved, last.outcome, last.errorCode, last.error));
    }
    return { requested: count, found: selected.length, submitted, results };
  }, plaudCommandClientOptions(readOnly ? 'recover-pending' : 'sync-pending'));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestPath = path.join(outDir, `domi-plaud-manifest-${timestamp}-${crypto.randomUUID().slice(0, 8)}.json`);
  const manifest = { schema: PLAUD_SYNC_CAPABILITIES.schema, generatedAt: new Date().toISOString(),
    outputDir: outDir, ...result, manifestPath };
  fs.writeFileSync(manifestPath, `${JSON.stringify(sanitizeStructuredValue(manifest), null, 2)}\n`, { mode: 0o600 });
  if (!options.withClientImpl) printJson(manifest);
  return manifest;
}

async function download(fileId, outDir) {
  const existing = loadState().records[fileId];
  if (usableTranscript(existing)) { printJson({ ...existing, ok: true, reused: true }); return; }
  if (existing?.stage && !GENERATION_STAGES.has(existing.stage)) {
    throw new Error('PLAUD_TRANSCRIPT_ARTIFACT_MISSING: The existing workflow transcript is missing; its artifact bindings require repair.');
  }
  fs.mkdirSync(outDir, { recursive: true });
  const transcript = await withClient(
    (client) => client.downloadTranscript(fileId, outDir),
    plaudCommandClientOptions('download'),
  );
  const record = updateSyncRecord(fileId, {
    fileName: transcript.fileName, stage: 'transcript_ready', outputDir: outDir,
    transcriptPath: transcript.mdPath, transcriptRawPath: transcript.rawPath,
    syncOutcome: 'ready', retryable: false, error: null, errorCode: null,
  });
  const result = syncResult(record, 'ready', '', '', { source: 'recovered' });
  printJson(result);
  if (!result.ok) process.exitCode = 1;
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
  if (!record?.transcriptPath) return false;
  try { const stat = fs.statSync(record.transcriptPath); return stat.isFile() && stat.size > 0; }
  catch { return false; }
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
  }, plaudCommandClientOptions('transcribe-local'));
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

function validateNotesQuality(input, notesPath, transcriptPath) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || !path.isAbsolute(input.evidenceIndexPath || '') || !path.isAbsolute(input.qaReceiptPath || '')) {
    throw new Error('notes quality requires notesQuality.evidenceIndexPath and qaReceiptPath; complete source coverage and editorial review before marking notes');
  }
  const evidenceIndex = artifact({ role: 'evidence_index', path: input.evidenceIndexPath });
  const qaReceipt = artifact({ role: 'qa_receipt', path: input.qaReceiptPath });
  const index = JSON.parse(fs.readFileSync(evidenceIndex.path, 'utf8'));
  const qa = JSON.parse(fs.readFileSync(qaReceipt.path, 'utf8'));
  if (!transcriptPath || path.resolve(index.transcript?.path || '') !== path.resolve(transcriptPath)) {
    throw new Error('notes quality transcript must match this PLAUD queue record');
  }
  if (path.resolve(qa.notes?.path || '') !== path.resolve(notesPath)
      || path.resolve(qa.evidenceIndex?.path || '') !== evidenceIndex.path) {
    throw new Error('notes quality receipt must bind the exact notes and evidence index being marked');
  }
  evidenceCheck(index, qa, { requireCoverage: true });
  verifyArtifact(evidenceIndex);
  verifyArtifact(qaReceipt);
  const notesSha256 = sha256File(notesPath);
  if (notesSha256 !== qa.notes.sha256) throw new Error('notes changed during source coverage review');
  return { schema: 'domi.plaud-notes-quality.v1', evidenceIndex, qaReceipt,
    notesSha256, checkedAt: new Date().toISOString(),
    mechanicalChecksPassed: true, semanticReviewRequired: true };
}

function validateStoredNotesQuality(record) {
  const quality = record.notesQuality;
  if (!quality || quality.schema !== 'domi.plaud-notes-quality.v1') throw new Error('notes quality receipt missing or unsupported');
  verifyArtifact(quality.evidenceIndex);
  verifyArtifact(quality.qaReceipt);
  if (quality.notesSha256 !== sha256File(record.notesPath)) throw new Error('notes changed after source coverage review');
  return validateNotesQuality({ evidenceIndexPath: quality.evidenceIndex.path, qaReceiptPath: quality.qaReceipt.path }, record.notesPath, record.transcriptPath);
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
  if (record.notesQuality) validateStoredNotesQuality(record);
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
  if (!['notes_project', 'notes_non_project'].includes(stage) && Object.hasOwn(metadata, 'notesQuality')) {
    throw new Error('notesQuality may only be set when marking freshly audited notes');
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
    const notesQuality = validateNotesQuality(metadata.notesQuality, resolvedArtifactPath, previous.transcriptPath);
    metadata = {
      ...metadata,
      notesPath: resolvedArtifactPath,
      notesAudit: { ...audit, notesSha256: sha256File(resolvedArtifactPath) },
      notesQuality,
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
    const notesQuality = validateNotesQuality(metadata.notesQuality, resolvedArtifactPath, previous.transcriptPath);
    metadata = {
      ...metadata,
      notesPath: resolvedArtifactPath,
      notesAudit: null,
      notesQuality,
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
    } else if (candidate.storageReceipt?.backend === 'legacy_feishu_primary') {
      const receipt = candidate.storageReceipt;
      const required = ['recordId', 'documentUri', 'libraryPath'];
      const missing = required.filter((key) => !receipt[key]);
      if (missing.length > 0 ||
          !receipt.recordVerified ||
          !receipt.documentVerified ||
          !receipt.filesVerified) {
        throw new Error(`documented legacy Feishu-primary backend requires a verified storageReceipt${missing.length ? `: ${missing.join(', ')}` : ''}`);
      }
      metadata = { ...metadata, recordId: receipt.recordId };
    } else if (!candidate.storageReceipt) {
      const required = ['wikiUrl', 'wikiNodeToken', 'docToken', 'oneDrivePath'];
      const missing = required.filter((key) => !candidate[key]);
      if (missing.length > 0) {
        throw new Error(`legacy documented queue requires metadata fields: ${missing.join(', ')}`);
      }
    } else {
      throw new Error(`documented does not support storageReceipt backend: ${candidate.storageReceipt.backend || 'unset'}`);
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
  if (command === 'capabilities') { printJson(PLAUD_SYNC_CAPABILITIES); return; }
  if (command === 'sync-pending' || command === 'recover-pending') {
    const readOnly = command === 'recover-pending';
    const count = positiveInt(args[0], readOnly ? 100 : 3, 'count', 100);
    const outDir = path.resolve(args[1] || path.join(process.cwd(), 'work', 'domi', 'plaud'));
    const timeoutSec = positiveInt(args[2], readOnly ? 30 : 1800, 'timeoutSec', 7200);
    const pollSec = positiveInt(args[3], readOnly ? 3 : 15, 'pollSec', 300);
    return syncPending(count, outDir, timeoutSec, pollSec, { readOnly });
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
    PLAUD_SYNC_CAPABILITIES,
    claimGeneration,
    syncPending,
    findRecordBySource,
    fingerprintAudio,
    loadState,
    mark,
    parseTranscribeLocalArgs,
    plaudCommandClientOptions,
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
