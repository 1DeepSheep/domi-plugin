#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'domi-plaud-test-'));
process.env.DOMI_PLAUD_STATE_DIR = path.join(sandbox, 'state');

const scriptPath = path.join(__dirname, 'plaud.js');
const { __test } = require('./plaud.js');
const {
  PlaudClient,
  acquireManagedSessionLock,
  backgroundTabbitArgs,
  clearDevToolsActivePort,
  clearManagedSessionRestoreState,
  compactManagedPages,
  connectToDevToolsWithRetry,
  configuredBrowserKind,
  launchBackgroundTabbit,
  launchManagedBrowser,
  managedBrowserArgs,
  managedBrowserLaunchSpec,
  managedProfileDir,
  managedProfileNeedsSessionRecovery,
  managedSessionLockPath,
  mediaExecutable,
  navigatePlaudWithRetry,
  pageShowsPlaudLogin,
  releaseManagedSessionLock,
  removeManagedProfile,
  waitForDevToolsEndpoint,
  waitForPlaudAuthorization,
  withLoopbackNoProxy,
} = require('../vendor/plaud-cli/src/plaud.js');

function makeAudio(name, content = 'synthetic-audio-for-wrapper-tests') {
  const audioPath = path.join(sandbox, name);
  fs.writeFileSync(audioPath, content, { mode: 0o600 });
  return audioPath;
}

function transcriptResult(fileId, fileName, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const rawPath = path.join(outDir, `${fileName}-transcript.json`);
  const mdPath = path.join(outDir, `${fileName}-transcript.md`);
  fs.writeFileSync(rawPath, '[]', { mode: 0o600 });
  fs.writeFileSync(mdPath, '# Transcript\n', { mode: 0o600 });
  return { fileId, fileName, rawPath, mdPath };
}

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('PLAUD media tools prefer a validated domi-bundled executable', () => {
  const previous = process.env.DOMI_FFMPEG_PATH;
  const binaryPath = path.join(sandbox, 'ffmpeg');
  fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  process.env.DOMI_FFMPEG_PATH = binaryPath;
  try {
    assert.equal(mediaExecutable('ffmpeg'), binaryPath);
    const symlinkPath = path.join(sandbox, 'ffmpeg-link');
    fs.symlinkSync(binaryPath, symlinkPath);
    process.env.DOMI_FFMPEG_PATH = symlinkPath;
    assert.equal(mediaExecutable('ffmpeg'), '');
  } finally {
    if (previous == null) delete process.env.DOMI_FFMPEG_PATH;
    else process.env.DOMI_FFMPEG_PATH = previous;
  }
});

test('transcribe-local options parse in any order without consuming the audio path', () => {
  const parsed = __test.parseTranscribeLocalArgs([
    '--workflow-id', '0123456789abcdef',
    '/tmp/discussion.m4a',
    '/tmp/output',
    '1800',
    '15',
    '产品讨论',
    '--adopt-file-id', 'candidate-two',
    '--retry-upload',
    '--retry-generation',
  ]);
  assert.deepEqual(parsed, {
    positional: ['/tmp/discussion.m4a', '/tmp/output', '1800', '15', '产品讨论'],
    retryUpload: true,
    retryGeneration: true,
    workflowId: '0123456789abcdef',
    adoptFileId: 'candidate-two',
  });
  assert.equal(__test.parseTranscribeLocalArgs(['/tmp/plain.m4a']).positional[0], '/tmp/plain.m4a');
  assert.throws(
    () => __test.parseTranscribeLocalArgs(['/tmp/plain.m4a', '--workflow-id', '--retry-upload']),
    /--workflow-id requires a value/,
  );
  assert.throws(
    () => __test.parseTranscribeLocalArgs(['/tmp/plain.m4a', '--unknown']),
    /Unknown transcribe-local option/,
  );
});

test('transcribe-local uploads one exact source, generates once, and persists a reusable transcript', async () => {
  const audioPath = makeAudio('discussion-one.m4a');
  const outDir = path.join(sandbox, 'out-one');
  const calls = { list: 0, upload: 0, generate: 0, download: 0 };
  const fake = {
    async listFiles() { calls.list += 1; return []; },
    async uploadAudioFile(sourcePath, options) {
      calls.upload += 1;
      assert.equal(sourcePath, fs.realpathSync(audioPath));
      assert.match(options.fileName, /^LOCAL-产品讨论-[a-f0-9]{16}$/);
      return {
        fileId: 'plaud-file-one',
        fileName: options.fileName,
        originalBytes: fs.statSync(audioPath).size,
        uploadedBytes: 123,
        fileType: 'MP3',
        transcode: true,
        uploadId: 'secret-upload-id',
        objectName: 'secret-object-name',
        dataFile: { presignedUrl: 'https://secret.invalid/upload' },
      };
    },
    async generateFile(fileId) { calls.generate += 1; assert.equal(fileId, 'plaud-file-one'); },
    async downloadTranscript(fileId, targetDir) {
      calls.download += 1;
      return transcriptResult(fileId, 'QD-产品讨论', targetDir);
    },
  };

  const first = await __test.transcribeLocal(audioPath, outDir, 5, 1, '产品讨论', {
    withClientImpl: async (callback) => callback(fake),
  });
  assert.equal(first.ok, true);
  assert.equal(first.reused, false);
  assert.equal(first.stage, 'transcript_ready');
  assert.equal(first.fileId, 'plaud-file-one');
  assert.equal(first.workflow, 'local_transcription');
  assert.equal(first.workflowId, null);
  assert.equal(JSON.stringify(first).includes('secret-upload-id'), false);
  assert.deepEqual(calls, { list: 1, upload: 1, generate: 1, download: 1 });
  assert.equal(fs.statSync(__test.STATE_FILE).mode & 0o777, 0o600);
  assert.equal(fs.statSync(__test.STATE_DIR).mode & 0o777, 0o700);
  const stateText = fs.readFileSync(__test.STATE_FILE, 'utf8');
  assert.equal(stateText.includes('secret-upload-id'), false);
  assert.equal(stateText.includes('secret-object-name'), false);
  assert.equal(stateText.includes('secret.invalid'), false);

  const second = await __test.transcribeLocal(audioPath, path.join(sandbox, 'ignored'), 5, 1, '产品讨论', {
    withClientImpl: async () => { throw new Error('client must not open for a reusable transcript'); },
  });
  assert.equal(second.ok, true);
  assert.equal(second.reused, true);
  assert.equal(second.transcriptPath, first.transcriptPath);
});

test('stable remote title recovers a confirmed upload instead of uploading twice', async () => {
  const audioPath = makeAudio('discussion-two.m4a', 'different-synthetic-audio');
  const outDir = path.join(sandbox, 'out-two');
  const fingerprint = __test.fingerprintAudio(audioPath);
  const stableTitle = `LOCAL-恢复测试-${fingerprint.sourceAudioSha256.slice(0, 16)}`;
  let uploadCalled = false;
  const fake = {
    async listFiles() { return [{ id: 'recovered-file', filename: stableTitle }]; },
    async uploadAudioFile() { uploadCalled = true; throw new Error('must not upload'); },
    async generateFile(fileId) { assert.equal(fileId, 'recovered-file'); },
    async downloadTranscript(fileId, targetDir) {
      return transcriptResult(fileId, stableTitle, targetDir);
    },
  };
  const result = await __test.transcribeLocal(audioPath, outDir, 5, 1, '恢复测试', {
    withClientImpl: async (callback) => callback(fake),
  });
  assert.equal(result.ok, true);
  assert.equal(result.fileId, 'recovered-file');
  assert.equal(uploadCalled, false);
});

test('generation timeout recovery downloads by saved fileId without upload or regeneration', async () => {
  const audioPath = makeAudio('discussion-three.m4a', 'third-synthetic-audio');
  const fingerprint = __test.fingerprintAudio(audioPath);
  __test.updateRecord(__test.loadState(), 'saved-file', {
    ...fingerprint,
    workflow: 'local_transcription',
    stage: 'generation_timeout',
    outputDir: path.join(sandbox, 'old-out'),
  });
  const fake = {
    async listFiles() { throw new Error('must not list after a fileId was saved'); },
    async uploadAudioFile() { throw new Error('must not upload after a fileId was saved'); },
    async generateFile() { throw new Error('must not regenerate after timeout'); },
    async downloadTranscript(fileId, targetDir) {
      assert.equal(fileId, 'saved-file');
      return transcriptResult(fileId, 'saved-file', targetDir);
    },
  };
  const result = await __test.transcribeLocal(audioPath, path.join(sandbox, 'out-three'), 5, 1, '恢复', {
    withClientImpl: async (callback) => callback(fake),
  });
  assert.equal(result.ok, true);
  assert.equal(result.reused, true);
  assert.equal(result.stage, 'transcript_ready');
});

test('generation response uncertainty recovers by download without submitting generation twice', async () => {
  const audioPath = makeAudio('discussion-generation-unknown.m4a', 'unknown-generation-response-audio');
  const fingerprint = __test.fingerprintAudio(audioPath);
  __test.updateRecord(__test.loadState(), 'generation-unknown-file', {
    ...fingerprint,
    workflow: 'quick_discussion',
    workflowId: '0123456789abcdef',
    stage: 'generation_unknown',
    outputDir: path.join(sandbox, 'old-generation-unknown-out'),
  });
  const fake = {
    async listFiles() { throw new Error('must not list after a fileId was saved'); },
    async uploadAudioFile() { throw new Error('must not upload after a fileId was saved'); },
    async generateFile() { throw new Error('must not submit generation after an uncertain response'); },
    async downloadTranscript(fileId, targetDir) {
      assert.equal(fileId, 'generation-unknown-file');
      return transcriptResult(fileId, 'generation-unknown-file', targetDir);
    },
  };
  const result = await __test.transcribeLocal(
    audioPath,
    path.join(sandbox, 'out-generation-unknown'),
    5,
    1,
    '生成恢复',
    {
      workflowId: '0123456789abcdef',
      withClientImpl: async (callback) => callback(fake),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.reused, true);
  assert.equal(result.stage, 'transcript_ready');
});

test('a stranded generation submission retries only with explicit authorization', async () => {
  const audioPath = makeAudio('discussion-generation-stranded.m4a', 'stranded-generation-audio');
  const fingerprint = __test.fingerprintAudio(audioPath);
  __test.updateRecord(__test.loadState(), 'generation-stranded-file', {
    ...fingerprint,
    workflow: 'local_transcription',
    workflowId: null,
    stage: 'generation_submitting',
    outputDir: path.join(sandbox, 'old-generation-stranded-out'),
  });
  let generateCalls = 0;
  const waitingFake = {
    async listFiles() { throw new Error('must not list after a fileId was saved'); },
    async uploadAudioFile() { throw new Error('must not upload after a fileId was saved'); },
    async generateFile() { generateCalls += 1; },
    async downloadTranscript() { throw new Error('Transcript not found for file generation-stranded-file'); },
  };
  let nowCalls = 0;
  const waiting = await __test.transcribeLocal(
    audioPath,
    path.join(sandbox, 'out-generation-stranded'),
    5,
    1,
    '生成卡点',
    {
      withClientImpl: async (callback) => callback(waitingFake),
      now: () => (nowCalls++ === 0 ? 0 : 6000),
      pause: async () => {},
    },
  );
  assert.equal(waiting.ok, false);
  assert.equal(waiting.stage, 'generation_timeout');
  assert.equal(generateCalls, 0);

  let retryDownloads = 0;
  const retryFake = {
    async listFiles() { throw new Error('must not list after a fileId was saved'); },
    async uploadAudioFile() { throw new Error('must not upload after a fileId was saved'); },
    async generateFile(fileId) {
      generateCalls += 1;
      assert.equal(fileId, 'generation-stranded-file');
    },
    async downloadTranscript(fileId, targetDir) {
      retryDownloads += 1;
      if (retryDownloads === 1) {
        throw new Error('Transcript not found for file generation-stranded-file');
      }
      return transcriptResult(fileId, 'generation-stranded-file', targetDir);
    },
  };
  const recovered = await __test.transcribeLocal(
    audioPath,
    path.join(sandbox, 'out-generation-stranded'),
    5,
    1,
    '生成卡点',
    {
      allowUnknownGenerationRetry: true,
      withClientImpl: async (callback) => callback(retryFake),
    },
  );
  assert.equal(recovered.ok, true);
  assert.equal(recovered.stage, 'transcript_ready');
  assert.equal(generateCalls, 1);
  assert.equal(retryDownloads, 2);
  assert.ok(recovered.generationRetryConfirmedAt);
});

test('explicit generation recovery still downloads once before any resubmission', async () => {
  const audioPath = makeAudio('discussion-generation-ready-before-retry.m4a', 'ready-before-retry-audio');
  const fingerprint = __test.fingerprintAudio(audioPath);
  __test.updateRecord(__test.loadState(), 'ready-before-retry-file', {
    ...fingerprint,
    workflow: 'local_transcription',
    workflowId: null,
    stage: 'generation_timeout',
  });
  let generateCalls = 0;
  const fake = {
    async listFiles() { throw new Error('must not list after a fileId was saved'); },
    async uploadAudioFile() { throw new Error('must not upload after a fileId was saved'); },
    async generateFile() { generateCalls += 1; },
    async downloadTranscript(fileId, targetDir) {
      return transcriptResult(fileId, 'ready-before-retry-file', targetDir);
    },
  };
  const result = await __test.transcribeLocal(
    audioPath,
    path.join(sandbox, 'out-ready-before-retry'),
    5,
    1,
    '生成已完成',
    {
      allowUnknownGenerationRetry: true,
      withClientImpl: async (callback) => callback(fake),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.stage, 'transcript_ready');
  assert.equal(generateCalls, 0);
  assert.equal(result.generationRetryConfirmedAt, undefined);
});

test('one source audio cannot be rebound to a different quick-discussion workflow', async () => {
  const audioPath = makeAudio('discussion-workflow-binding.m4a', 'workflow-binding-audio');
  const outDir = path.join(sandbox, 'out-workflow-binding');
  const workflowId = 'fedcba9876543210';
  const fake = {
    async listFiles() { return []; },
    async uploadAudioFile(_sourcePath, options) {
      return { fileId: 'workflow-bound-file', fileName: options.fileName };
    },
    async generateFile() {},
    async downloadTranscript(fileId, targetDir) {
      return transcriptResult(fileId, 'workflow-bound-file', targetDir);
    },
  };
  const first = await __test.transcribeLocal(audioPath, outDir, 5, 1, '绑定测试', {
    workflowId,
    withClientImpl: async (callback) => callback(fake),
  });
  assert.equal(first.workflowId, workflowId);

  await assert.rejects(
    __test.transcribeLocal(audioPath, outDir, 5, 1, '绑定测试', {
      workflowId: '0011223344556677',
      withClientImpl: async () => { throw new Error('client must not open for a workflow mismatch'); },
    }),
    /different quick-discussion workflowId/,
  );
});

test('PLAUD launches Tabbit as a separate non-activating headless instance', () => {
  const profileDir = path.join(sandbox, 'background-profile');
  const args = backgroundTabbitArgs(profileDir);
  assert.equal(args[0], '--headless=new');
  assert.equal(args.includes('--no-startup-window'), true);
  assert.equal(args.includes('--disable-session-crashed-bubble'), true);
  assert.equal(args.includes('--hide-crash-restore-bubble'), true);
  assert.equal(args.includes('-a'), false);
  assert.equal(args.includes('--args'), false);
  assert.equal(args.includes('--remote-debugging-address=127.0.0.1'), true);
  assert.equal(args.includes('--remote-debugging-port=0'), true);
  assert.equal(args.includes(`--user-data-dir=${profileDir}`), true);
  assert.equal(args.includes('https://web.plaud.ai'), false);
});

test('PLAUD managed browser supports a visible Chrome login with a private profile', async () => {
  const previousRoot = process.env.DOMI_PLAUD_PROFILE_ROOT;
  const profileRoot = path.join(sandbox, 'managed-browser-root');
  process.env.DOMI_PLAUD_PROFILE_ROOT = profileRoot;
  try {
    const profileDir = managedProfileDir('chrome');
    const args = managedBrowserArgs(profileDir, {
      headless: false,
      url: 'https://web.plaud.ai',
    });
    assert.equal(profileDir, path.join(profileRoot, 'chrome'));
    assert.equal(fs.statSync(profileRoot).mode & 0o777, 0o700);
    assert.equal(fs.statSync(profileDir).mode & 0o777, 0o700);
    assert.equal(args.includes('--headless=new'), false);
    assert.equal(args.includes('--remote-debugging-address=127.0.0.1'), true);
    assert.equal(args.includes(`--user-data-dir=${profileDir}`), true);
    assert.equal(args.includes('https://web.plaud.ai'), false);

    fs.writeFileSync(path.join(profileDir, 'login-state'), 'private', { mode: 0o600 });
    const client = new PlaudClient({
      browserKind: 'chrome',
      terminateBrowser: async () => {},
    });
    assert.equal(client.ownsProfileDir, false);
    await client.close();
    assert.equal(fs.existsSync(path.join(profileDir, 'login-state')), true);

    assert.equal(removeManagedProfile('chrome'), true);
    assert.equal(fs.existsSync(profileDir), false);
  } finally {
    if (previousRoot == null) delete process.env.DOMI_PLAUD_PROFILE_ROOT;
    else process.env.DOMI_PLAUD_PROFILE_ROOT = previousRoot;
  }
});

test('PLAUD compacts restored tabs before navigation and keeps only one page', async () => {
  const calls = [];
  const makePage = (name) => ({
    name,
    closed: false,
    isClosed() { return this.closed; },
    async close(options) {
      calls.push([name, options]);
      this.closed = true;
    },
  });
  const pages = Array.from({ length: 12 }, (_, index) => makePage(`page-${index}`));
  const result = await compactManagedPages({
    pages: () => pages,
    newPage: async () => {
      throw new Error('a restored page should be reused');
    },
  });
  assert.equal(result.page, pages.at(-1));
  assert.equal(result.closedPageCount, 11);
  assert.equal(calls.length, 11);
  assert.equal(pages.filter((page) => !page.closed).length, 1);
  assert.deepEqual(calls[0][1], { runBeforeUnload: false });
});

test('PLAUD removes only tab restore state while preserving the private login profile', () => {
  const profileDir = path.join(sandbox, 'session-restore-profile');
  const defaultDir = path.join(profileDir, 'Default');
  fs.mkdirSync(path.join(defaultDir, 'Sessions'), { recursive: true });
  fs.writeFileSync(path.join(defaultDir, 'Sessions', 'Tabs_1'), 'restored tabs');
  fs.writeFileSync(path.join(defaultDir, 'Cookies'), 'private login state');
  fs.writeFileSync(path.join(defaultDir, 'Preferences'), '{}');

  clearManagedSessionRestoreState(profileDir);

  assert.equal(fs.existsSync(path.join(defaultDir, 'Sessions')), false);
  assert.equal(fs.readFileSync(path.join(defaultDir, 'Cookies'), 'utf8'), 'private login state');
  assert.equal(fs.existsSync(path.join(defaultDir, 'Preferences')), true);
});

test('PLAUD clears tab restore state only after an unclean managed-browser exit', () => {
  const profileDir = path.join(sandbox, 'profile-exit-state');
  const defaultDir = path.join(profileDir, 'Default');
  fs.mkdirSync(defaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(defaultDir, 'Preferences'),
    JSON.stringify({ profile: { exit_type: 'Normal' } }),
  );
  assert.equal(managedProfileNeedsSessionRecovery(profileDir), false);
  fs.writeFileSync(
    path.join(defaultDir, 'Preferences'),
    JSON.stringify({ profile: { exit_type: 'Crashed' } }),
  );
  assert.equal(managedProfileNeedsSessionRecovery(profileDir), true);
});

test('PLAUD recognizes an explicit login page without exposing page contents', async () => {
  assert.equal(await pageShowsPlaudLogin({ evaluate: async () => true }), true);
  assert.equal(await pageShowsPlaudLogin({ evaluate: async () => false }), false);
  assert.equal(await pageShowsPlaudLogin({ evaluate: async () => { throw new Error('closed'); } }), false);
});

test('PLAUD automatically reloads an intact session before asking the user to log in', async () => {
  let clock = 0;
  let reloads = 0;
  const client = {
    authorization: null,
    browserLabel: 'Tabbit',
    headless: true,
    loginTimeoutMs: 2000,
    page: {
      isClosed: () => false,
      evaluate: async () => false,
      reload: async () => {
        reloads += 1;
        client.authorization = 'ok';
      },
    },
  };
  const connected = await waitForPlaudAuthorization(client, {
    attemptTimeoutMs: 1000,
    now: () => clock,
    pause: async (delay) => { clock += delay; },
  });
  assert.equal(connected, true);
  assert.equal(reloads, 1);
});

test('PLAUD distinguishes an explicit login page from an incomplete background probe', async () => {
  let clock = 0;
  const loginClient = {
    authorization: null,
    browserLabel: 'Tabbit',
    headless: true,
    loginTimeoutMs: 2000,
    page: {
      isClosed: () => false,
      evaluate: async () => true,
      reload: async () => {},
    },
  };
  await assert.rejects(
    waitForPlaudAuthorization(loginClient, {
      attemptTimeoutMs: 1000,
      now: () => clock,
      pause: async (delay) => { clock += delay; },
    }),
    /PLAUD_AUTH_REQUIRED/,
  );

  clock = 0;
  let reloads = 0;
  const probeClient = {
    ...loginClient,
    page: {
      isClosed: () => false,
      evaluate: async () => false,
      reload: async () => { reloads += 1; },
    },
  };
  await assert.rejects(
    waitForPlaudAuthorization(probeClient, {
      attemptTimeoutMs: 1000,
      now: () => clock,
      pause: async (delay) => { clock += delay; },
    }),
    /PLAUD_SESSION_PROBE_INCOMPLETE/,
  );
  assert.equal(reloads, 1);
});

test('PLAUD browser selection comes only from the local config', () => {
  const previousConfig = process.env.DOMI_CONFIG_PATH;
  const configPath = path.join(sandbox, 'browser-config.json');
  fs.writeFileSync(configPath, JSON.stringify({ plaudBrowser: 'tabbit' }), { mode: 0o600 });
  process.env.DOMI_CONFIG_PATH = configPath;
  try {
    assert.equal(configuredBrowserKind(), 'tabbit');
    assert.equal(configuredBrowserKind('chrome'), 'chrome');
  } finally {
    if (previousConfig == null) delete process.env.DOMI_CONFIG_PATH;
    else process.env.DOMI_CONFIG_PATH = previousConfig;
  }
});

test('PLAUD starts background Tabbit through its exact executable without activating an app bundle', async () => {
  const profileDir = path.join(sandbox, 'direct-background-profile');
  const child = new EventEmitter();
  child.pid = 4242;
  child.stderr = new EventEmitter();
  const calls = [];
  let orphanCleanupFinished = false;
  const context = {};
  const browser = { contexts: () => [context] };

  const launched = await launchBackgroundTabbit(profileDir, {
    browserExecutable: '/Applications/Tabbit.app/Contents/MacOS/Tabbit',
    platform: 'darwin',
    spawnProcess: (command, args, options) => {
      assert.equal(orphanCleanupFinished, true);
      calls.push({ command, args, options });
      return child;
    },
    waitForDevToolsEndpoint: async () => 'ws://127.0.0.1:49231/devtools/browser/test',
    connectOverCDP: async () => browser,
    terminateBrowser: async () => {
      orphanCleanupFinished = true;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/Applications/Tabbit.app/Contents/MacOS/Tabbit');
  assert.equal(calls[0].command === '/usr/bin/open', false);
  assert.equal(calls[0].args.includes('--headless=new'), true);
  assert.equal(calls[0].args.includes('--no-startup-window'), true);
  assert.equal(calls[0].args.includes('https://web.plaud.ai'), false);
  assert.equal(calls[0].options.detached, false);
  assert.equal(launched.browser, browser);
  assert.equal(launched.context, context);
  assert.equal(launched.process, child);
});

test('PLAUD API requests abort independently instead of waiting for the parent timeout', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  try {
    const client = Object.create(PlaudClient.prototype);
    client.apiBase = 'https://api.invalid';
    client.headers = {};
    client.apiTimeoutMs = 5;
    client.page = {
      evaluate: async (callback, payload) => callback(payload),
    };
    await assert.rejects(client.api('/file/simple/web'), /PLAUD 接口读取超时（1 秒）/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('PLAUD retries the private DevTools endpoint until the browser socket is ready', async () => {
  let attempts = 0;
  const browser = { contexts: () => [{}] };
  const result = await connectToDevToolsWithRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('WebSocket error: connect ECONNREFUSED 127.0.0.1');
    return browser;
  }, 'ws://127.0.0.1:49231/devtools/browser/test', {
    timeoutMs: 1000,
    pause: async () => {},
  });
  assert.equal(result, browser);
  assert.equal(attempts, 3);
});

test('PLAUD retries transient site navigation without reopening a visible browser', async () => {
  let attempts = 0;
  const pauses = [];
  await navigatePlaudWithRetry({
    isClosed: () => false,
    goto: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('page.goto: net::ERR_CONNECTION_CLOSED');
    },
  }, 'https://web.plaud.ai', {
    pause: async (delay) => pauses.push(delay),
  });
  assert.equal(attempts, 3);
  assert.deepEqual(pauses, [400, 800]);
});

test('PLAUD client initialization retries only transient pre-operation failures', async () => {
  let created = 0;
  let closed = 0;
  const result = await __test.withClient(async (client) => client.value, {
    initializationPause: async () => {},
    clientFactory: () => {
      created += 1;
      const current = created;
      return {
        value: `client-${current}`,
        async init() {
          if (current < 2) throw new Error('connectOverCDP: ECONNREFUSED');
          return this;
        },
        async close() {
          closed += 1;
        },
      };
    },
  });
  assert.equal(result, 'client-2');
  assert.equal(created, 2);
  assert.equal(closed, 2);
});

test('PLAUD keeps visible login launches direct and user-activated', () => {
  const spec = {
    kind: 'tabbit',
    label: 'Tabbit',
    executable: '/Applications/Tabbit.app/Contents/MacOS/Tabbit',
  };
  const browserArgs = ['--user-data-dir=/tmp/profile', 'https://web.plaud.ai'];
  const launch = managedBrowserLaunchSpec(spec, browserArgs, {
    headless: false,
    platform: 'darwin',
  });
  assert.equal(launch.command, spec.executable);
  assert.deepEqual(launch.args, browserArgs);
  assert.equal(launch.launcherOnly, false);
});

test('PLAUD serializes access to one managed browser profile across processes', async () => {
  const profileDir = path.join(sandbox, 'locked-browser-profile');
  const first = await acquireManagedSessionLock(profileDir, { timeoutMs: 10 });
  assert.equal(fs.existsSync(managedSessionLockPath(profileDir)), true);
  assert.equal(fs.statSync(managedSessionLockPath(profileDir)).mode & 0o777, 0o600);
  await assert.rejects(
    acquireManagedSessionLock(profileDir, { timeoutMs: 10, retryMs: 5 }),
    /正在被另一个任务使用/,
  );
  assert.equal(releaseManagedSessionLock({
    ...first,
    token: 'not-the-owner',
  }), false);
  assert.equal(releaseManagedSessionLock(first), true);
  assert.equal(fs.existsSync(managedSessionLockPath(profileDir)), false);

  fs.writeFileSync(
    managedSessionLockPath(profileDir),
    `${JSON.stringify({ pid: 99999999, token: 'stale' })}\n`,
    { mode: 0o600 },
  );
  const recovered = await acquireManagedSessionLock(profileDir, { timeoutMs: 10 });
  assert.notEqual(recovered.token, 'stale');
  assert.equal(releaseManagedSessionLock(recovered), true);
});

test('PLAUD reads the private DevTools endpoint created by background Tabbit', async () => {
  const profileDir = path.join(sandbox, 'devtools-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, 'DevToolsActivePort'),
    '49231\n/devtools/browser/11111111-2222-3333-4444-555555555555\n',
  );
  const endpoint = await waitForDevToolsEndpoint(profileDir, 100);
  assert.equal(
    endpoint,
    'ws://127.0.0.1:49231/devtools/browser/11111111-2222-3333-4444-555555555555',
  );
});

test('PLAUD ignores a stale DevTools endpoint and waits for the newly launched browser', async () => {
  const profileDir = path.join(sandbox, 'stale-devtools-profile');
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    portFile,
    '64305\n/devtools/browser/4d90c55d-518b-428d-9491-e71270627503\n',
  );
  const child = new EventEmitter();
  child.pid = 4243;
  child.stderr = new EventEmitter();
  const context = {};
  const browser = { contexts: () => [context] };
  const launched = await launchManagedBrowser(profileDir, {
    browserKind: 'chrome',
    browserExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    spawnProcess: () => {
      assert.equal(fs.existsSync(portFile), false);
      setTimeout(() => {
        fs.writeFileSync(
          portFile,
          '51244\n/devtools/browser/11111111-2222-3333-4444-555555555555\n',
        );
      }, 10);
      return child;
    },
    connectOverCDP: async (endpoint) => {
      assert.equal(
        endpoint,
        'ws://127.0.0.1:51244/devtools/browser/11111111-2222-3333-4444-555555555555',
      );
      return browser;
    },
    terminateBrowser: async () => {},
  });
  assert.equal(launched.context, context);
  assert.equal(clearDevToolsActivePort(profileDir), true);
});

test('PLAUD bypasses proxies for its local browser connection and restores the environment', async () => {
  const originalUpper = process.env.NO_PROXY;
  const originalLower = process.env.no_proxy;
  process.env.NO_PROXY = 'example.com';
  delete process.env.no_proxy;
  try {
    await withLoopbackNoProxy(async () => {
      assert.equal(process.env.NO_PROXY, 'example.com,localhost,127.0.0.1');
      assert.equal(process.env.no_proxy, 'localhost,127.0.0.1');
    });
    assert.equal(process.env.NO_PROXY, 'example.com');
    assert.equal(process.env.no_proxy, undefined);
  } finally {
    if (originalUpper == null) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = originalUpper;
    if (originalLower == null) delete process.env.no_proxy;
    else process.env.no_proxy = originalLower;
  }
});

test('an explicitly temporary managed profile and background browser are removed when the client closes', async () => {
  const profileDir = path.join(sandbox, 'owned-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'Cookies'), 'sensitive-test-placeholder');
  const calls = [];
  const client = new PlaudClient({
    profileDirFactory: () => profileDir,
    terminateBrowser: async (targetProfileDir) => calls.push(['terminate', targetProfileDir]),
  });
  client.browser = {
    newBrowserCDPSession: async () => ({
      send: async (method) => calls.push(['cdp', method]),
    }),
  };
  await client.close();
  assert.deepEqual(calls, [
    ['cdp', 'Browser.close'],
    ['terminate', profileDir],
  ]);
  assert.equal(fs.existsSync(profileDir), false);
});

test('downloaded transcripts and an existing output directory are private', async () => {
  const outputDir = path.join(sandbox, 'wide-transcript-output');
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o777 });
  fs.chmodSync(outputDir, 0o777);
  const client = Object.create(PlaudClient.prototype);
  client.getFileDetail = async () => ({
    file_name: 'Private Discussion',
    content_list: [{ data_type: 'transaction', data_link: 'https://signed.invalid/transcript' }],
  });
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    text: async () => '[]',
  });
  try {
    const result = await client.downloadTranscript('private-file', outputDir);
    assert.equal(fs.statSync(outputDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(result.rawPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(result.mdPath).mode & 0o777, 0o600);
  } finally {
    global.fetch = originalFetch;
  }
});

test('vendor API failures do not include raw response bodies', async () => {
  const client = Object.create(PlaudClient.prototype);
  client.api = async () => ({
    status: 500,
    body: {
      status: 991,
      upload_id: 'secret-upload-id',
      part_urls: ['https://signed.invalid/private-part'],
    },
  });
  await assert.rejects(
    client.getUploadPresignedUrl({ filesize: 123, fileType: 'MP3' }),
    (error) => {
      assert.match(error.message, /HTTP 500; API status 991/);
      assert.equal(error.message.includes('secret-upload-id'), false);
      assert.equal(error.message.includes('signed.invalid'), false);
      return true;
    },
  );
});

test('error redaction removes full unquoted credential headers and JSON-escaped URLs', () => {
  const authorization = __test.safeErrorMessage(new Error('Authorization: Bearer TOPSECRET'));
  assert.equal(authorization.includes('TOPSECRET'), false);
  assert.equal(authorization, '[REDACTED_CREDENTIAL]');

  const cookie = __test.safeErrorMessage(new Error('Cookie: sid=ONE; refresh=TWO'));
  assert.equal(cookie.includes('ONE'), false);
  assert.equal(cookie.includes('TWO'), false);
  assert.equal(cookie, '[REDACTED_CREDENTIAL]');

  const escapedUrl = String.raw`request failed https:\/\/signed.invalid\/part?X-Amz-Signature=URLSECRET`;
  const redactedUrl = __test.safeErrorMessage(new Error(escapedUrl));
  assert.equal(redactedUrl.includes('signed.invalid'), false);
  assert.equal(redactedUrl.includes('URLSECRET'), false);
  assert.match(redactedUrl, /REDACTED_URL/);
});

test('PLAUD turns a refused local DevTools WebSocket into an actionable message', () => {
  const message = __test.safeErrorMessage(new Error(
    'browserType.connectOverCDP: WebSocket error: connect ECONNREFUSED 127.0.0.1:64305',
  ));
  assert.equal(
    message,
    'PLAUD 专用浏览器未能建立本机连接。请重新同步；domi 会清理旧连接后自动重试。',
  );
  assert.equal(message.includes('64305'), false);
});

test('upload confirmation uncertainty does not automatically upload a duplicate', async () => {
  const audioPath = makeAudio('discussion-uncertain.m4a', 'uncertain-confirm-audio');
  const outDir = path.join(sandbox, 'out-uncertain');
  const firstFake = {
    async listFiles() { return []; },
    async uploadAudioFile(_sourcePath, options) {
      options.onProgress({ stage: 'confirm' });
      const persisted = __test.findRecordBySource(
        __test.loadState(),
        __test.fingerprintAudio(audioPath),
      );
      assert.equal(persisted.stage, 'upload_unknown');
      assert.equal(persisted.uploadPhase, 'confirm');
      throw new Error('synthetic response loss after confirm');
    },
  };
  await assert.rejects(
    __test.transcribeLocal(audioPath, outDir, 5, 1, '不确定上传', {
      withClientImpl: async (callback) => callback(firstFake),
    }),
    /synthetic response loss/,
  );
  let record = __test.findRecordBySource(__test.loadState(), __test.fingerprintAudio(audioPath));
  assert.equal(record.stage, 'upload_unknown');

  let duplicateUpload = false;
  const invisibleFake = {
    async listFiles() { return []; },
    async uploadAudioFile() { duplicateUpload = true; throw new Error('must not upload'); },
  };
  const waiting = await __test.transcribeLocal(audioPath, outDir, 5, 1, '不确定上传', {
    withClientImpl: async (callback) => callback(invisibleFake),
    uploadRecoveryAttempts: 2,
    uploadRecoveryPollMs: 1,
    pause: async () => {},
  });
  assert.equal(waiting.ok, false);
  assert.equal(waiting.stage, 'upload_unknown');
  assert.equal(duplicateUpload, false);

  const stableTitle = record.uploadTitle;
  const recoveredFake = {
    async listFiles() { return [{ id: 'eventually-visible', filename: stableTitle }]; },
    async uploadAudioFile() { duplicateUpload = true; throw new Error('must not upload'); },
    async generateFile() {},
    async downloadTranscript(fileId, targetDir) {
      return transcriptResult(fileId, stableTitle, targetDir);
    },
  };
  const recovered = await __test.transcribeLocal(audioPath, outDir, 5, 1, '不确定上传', {
    withClientImpl: async (callback) => callback(recoveredFake),
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.fileId, 'eventually-visible');
  assert.equal(duplicateUpload, false);
});

test('sensitive upstream error details are redacted before state persistence', async () => {
  const audioPath = makeAudio('discussion-sensitive-error.m4a', 'sensitive-error-audio');
  const fake = {
    async listFiles() { return []; },
    async uploadAudioFile() {
      throw new Error('upload failed upload_id=secret-id object_name=secret-object https://signed.invalid/part?token=secret');
    },
  };
  await assert.rejects(
    __test.transcribeLocal(audioPath, path.join(sandbox, 'out-sensitive-error'), 5, 1, '敏感错误', {
      withClientImpl: async (callback) => callback(fake),
    }),
    (error) => {
      assert.equal(error.message.includes('secret-id'), false);
      assert.equal(error.message.includes('secret-object'), false);
      assert.equal(error.message.includes('signed.invalid'), false);
      assert.match(error.message, /REDACTED/);
      return true;
    },
  );
  const stateText = fs.readFileSync(__test.STATE_FILE, 'utf8');
  assert.equal(stateText.includes('secret-id'), false);
  assert.equal(stateText.includes('secret-object'), false);
  assert.equal(stateText.includes('signed.invalid'), false);
});

test('state serialization strips legacy structured upload secrets but preserves workflow tokens', () => {
  __test.updateRecord(__test.loadState(), 'legacy-secret-record', {
    stage: 'upload_failed',
    uploadId: 'legacy-secret-upload-id',
    object_name: 'legacy-secret-object',
    dataFile: { part_urls: ['https://signed.invalid/legacy'] },
    docToken: 'legitimate-doc-token',
  });
  const persisted = __test.loadState().records['legacy-secret-record'];
  assert.equal(Object.hasOwn(persisted, 'uploadId'), false);
  assert.equal(Object.hasOwn(persisted, 'object_name'), false);
  assert.equal(Object.hasOwn(persisted, 'dataFile'), false);
  assert.equal(persisted.docToken, 'legitimate-doc-token');
});

test('an ambiguous stable title can recover only through an explicitly adopted matching fileId', async () => {
  const audioPath = makeAudio('discussion-ambiguous.m4a', 'ambiguous-upload-audio');
  const fingerprint = __test.fingerprintAudio(audioPath);
  const uploadTitle = `LOCAL-歧义恢复-${fingerprint.sourceAudioSha256.slice(0, 16)}`;
  const localId = `local:${fingerprint.sourceAudioSha256.slice(0, 32)}`;
  __test.updateRecord(__test.loadState(), localId, {
    ...fingerprint,
    workflow: 'local_transcription',
    workflowId: null,
    stage: 'upload_recovery_ambiguous',
    uploadTitle,
  });
  let uploadCalled = false;
  let generatedFileId = null;
  const fake = {
    async listFiles() {
      return [
        { id: 'candidate-one', filename: uploadTitle },
        { id: 'candidate-two', filename: uploadTitle },
      ];
    },
    async uploadAudioFile() { uploadCalled = true; throw new Error('must not upload'); },
    async generateFile(fileId) { generatedFileId = fileId; },
    async downloadTranscript(fileId, targetDir) {
      return transcriptResult(fileId, uploadTitle, targetDir);
    },
  };
  await assert.rejects(
    __test.transcribeLocal(audioPath, path.join(sandbox, 'out-ambiguous'), 5, 1, '歧义恢复', {
      withClientImpl: async (callback) => callback(fake),
    }),
    /choose one with --adopt-file-id/,
  );
  let record = __test.findRecordBySource(__test.loadState(), fingerprint);
  assert.equal(record.stage, 'upload_recovery_ambiguous');
  assert.deepEqual(record.uploadCandidateFileIds.sort(), ['candidate-one', 'candidate-two']);

  const recovered = await __test.transcribeLocal(
    audioPath,
    path.join(sandbox, 'out-ambiguous'),
    5,
    1,
    '歧义恢复',
    {
      adoptFileId: 'candidate-two',
      withClientImpl: async (callback) => callback(fake),
    },
  );
  assert.equal(recovered.ok, true);
  assert.equal(recovered.fileId, 'candidate-two');
  assert.equal(generatedFileId, 'candidate-two');
  assert.equal(uploadCalled, false);
});

test('concurrent state updates for different audio files merge without losing queue records', async () => {
  const code = [
    "const {__test}=require(process.argv[1]);",
    "const id=process.argv[2];",
    "__test.updateRecord(__test.loadState(),id,{stage:'uploading',sourceAudioSha256:id.padEnd(64,'0'),sourceAudioBytes:10});",
  ].join('');
  const ids = Array.from({ length: 8 }, (_, index) => `parallel-${index}`);
  await Promise.all(ids.map((id) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code, scriptPath, id], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (status) => status === 0 ? resolve() : reject(new Error(stderr || `exit ${status}`)));
  })));
  const state = __test.loadState();
  for (const id of ids) assert.equal(state.records[id].stage, 'uploading');
});

test('discussion_complete binds both notes and brief hashes and verify detects later changes', () => {
  const state = __test.loadState();
  const transcriptPath = path.join(sandbox, 'discussion-transcript.md');
  fs.writeFileSync(transcriptPath, '# Transcript\n', { mode: 0o600 });
  __test.updateRecord(state, 'discussion-file', {
    stage: 'context_ready',
    workflow: 'quick_discussion',
    workflowId: 'aabbccddeeff0011',
    discussionTopic: '审计绑定测试',
    contextStatus: 'skipped',
    transcriptPath,
  });
  const notesPath = path.join(sandbox, 'discussion-notes.md');
  const briefPath = path.join(sandbox, 'discussion-brief.md');
  fs.writeFileSync(notesPath, '# Notes\n', { mode: 0o600 });
  fs.writeFileSync(briefPath, '# Brief\n', { mode: 0o600 });
  const notesMarked = spawnSync(process.execPath, [
    scriptPath, 'mark', 'discussion-file', 'discussion_notes_ready', notesPath,
  ], { encoding: 'utf8', env: process.env });
  assert.equal(notesMarked.status, 0, notesMarked.stderr || notesMarked.stdout);
  assert.equal(JSON.parse(notesMarked.stdout).record.stage, 'discussion_notes_ready');

  const identityOverride = spawnSync(process.execPath, [
    scriptPath,
    'mark',
    'discussion-file',
    'discussion_complete',
    briefPath,
    '{"workflowId":"1122334455667788"}',
  ], { encoding: 'utf8', env: process.env });
  assert.equal(identityOverride.status, 1);
  assert.match(JSON.parse(identityOverride.stdout).error, /may not override workflow identity/);

  const marked = spawnSync(process.execPath, [
    scriptPath, 'mark', 'discussion-file', 'discussion_complete', briefPath,
  ], { encoding: 'utf8', env: process.env });
  assert.equal(marked.status, 0, marked.stderr || marked.stdout);
  const payload = JSON.parse(marked.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.record.stage, 'discussion_complete');
  assert.equal(payload.record.discussionAudit.status, 'passed');

  const verified = spawnSync(process.execPath, [scriptPath, 'verify', 'discussion-file'], {
    encoding: 'utf8', env: process.env,
  });
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);
  assert.equal(JSON.parse(verified.stdout).checks.discussionAudit, 'passed');

  __test.updateRecord(__test.loadState(), 'discussion-file', { workflowId: '1122334455667788' });
  const workflowTampered = spawnSync(process.execPath, [scriptPath, 'verify', 'discussion-file'], {
    encoding: 'utf8', env: process.env,
  });
  assert.equal(workflowTampered.status, 1);
  assert.match(JSON.parse(workflowTampered.stdout).error, /transcript or context changed/);
  __test.updateRecord(__test.loadState(), 'discussion-file', { workflowId: 'aabbccddeeff0011' });

  __test.updateRecord(__test.loadState(), 'discussion-file', { discussionTopic: '被修改的主题' });
  const topicTampered = spawnSync(process.execPath, [scriptPath, 'verify', 'discussion-file'], {
    encoding: 'utf8', env: process.env,
  });
  assert.equal(topicTampered.status, 1);
  assert.match(JSON.parse(topicTampered.stdout).error, /transcript or context changed/);
  __test.updateRecord(__test.loadState(), 'discussion-file', { discussionTopic: '审计绑定测试' });

  fs.appendFileSync(briefPath, 'changed\n');
  const tampered = spawnSync(process.execPath, [scriptPath, 'verify', 'discussion-file'], {
    encoding: 'utf8', env: process.env,
  });
  assert.equal(tampered.status, 1);
  assert.match(JSON.parse(tampered.stdout).error, /brief file changed/);
});
