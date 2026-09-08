#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'domi-plaud-test-'));
process.env.DOMI_PLAUD_STATE_DIR = path.join(sandbox, 'state');
process.env.DOMI_CONFIG_PATH = path.join(sandbox, 'sync-test-config.json');
fs.writeFileSync(process.env.DOMI_CONFIG_PATH, JSON.stringify({ plaudConnectionMode: 'enabled' }));

const scriptPath = path.join(__dirname, 'plaud.js');
const { __test } = require('./plaud.js');
const {
  BROWSER_CLOSE_BUDGET_MS,
  BROWSER_GRACEFUL_EXIT_BUDGET_MS,
  BROWSER_TERM_EXIT_BUDGET_MS,
  PlaudClient,
  SIGNAL_SHUTDOWN_BUDGET_MS,
  acquireManagedSessionLock,
  backgroundTabbitArgs,
  clearDevToolsActivePort,
  clearManagedShutdownMarker,
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
  managedShutdownMarkerPath,
  mediaExecutable,
  navigatePlaudWithRetry,
  pageShowsPlaudLogin,
  releaseManagedSessionLock,
  removeManagedProfile,
  waitForDevToolsEndpoint,
  waitForPriorManagedShutdown,
  waitForPlaudAuthorization,
  writeManagedShutdownMarker,
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

function makeNotesQuality(fileId, notesPath) {
  const { artifact } = require('../../../scripts/domi-workflow.cjs');
  const { prepareNotesCoverage } = require('../../../scripts/notes-coverage.cjs');
  const transcriptPath = path.join(sandbox, `${fileId}-source.txt`);
  fs.writeFileSync(transcriptPath, '团队有三人。\n产品已开始付费试点。\n');
  fs.writeFileSync(notesPath, '#### 交流纪要\n#### 一、团队背景\n- 团队有三人，产品已开始付费试点。\n');
  const source = artifact({ sourceId: 'current', role: 'current_transcript', path: transcriptPath });
  const index = { schema: 'asr.evidence-index.v1', workflowRunId: fileId, mode: 'A', notesScope: 'current_session',
    transcript: source, sources: [source], claims: [{ claimId: 'c1', category: 'product', subject: '示例公司',
      statement: '团队有三人，产品已开始付费试点。', status: 'company_attributed',
      sourceRefs: [{ sourceId: 'current', lines: [1, 3] }],
      notesRefs: [{ lines: [3, 3], quote: '团队有三人，产品已开始付费试点。' }] }], unresolved: [] };
  const coverage = prepareNotesCoverage({ workflowRunId: fileId, sources: index.sources });
  for (const source of coverage.sources) for (const segment of source.segments) {
    segment.review = { status: 'reviewed', reviewer: 'model', claimIds: ['c1'], exclusions: [] };
  }
  const coveragePath = path.join(sandbox, `${fileId}-coverage.json`);
  fs.writeFileSync(coveragePath, JSON.stringify(coverage));
  index.coverage = artifact({ role: 'source_coverage', path: coveragePath });
  const evidenceIndexPath = path.join(sandbox, `${fileId}-evidence.json`);
  fs.writeFileSync(evidenceIndexPath, JSON.stringify(index));
  const qa = { schema: 'asr.qa-receipt.v1', workflowRunId: fileId, mode: 'A', reviewer: 'model',
    notes: artifact({ role: 'notes', path: notesPath }), evidenceIndex: artifact({ path: evidenceIndexPath }),
    checks: { transcript_traceability: 'passed', entity_verification: 'passed', number_audit: 'passed',
      completeness: 'passed', attribution: 'passed', markdown_rendering: 'passed', editorial: 'passed',
      source_manifest: 'passed', education: 'not_applicable', career_model_work: 'not_applicable',
      material_verification: 'not_applicable', pending_items: 'not_applicable' }, overall: 'passed', materialConflicts: [] };
  const qaReceiptPath = path.join(sandbox, `${fileId}-qa.json`);
  fs.writeFileSync(qaReceiptPath, JSON.stringify(qa));
  return { transcriptPath, coveragePath, evidenceIndexPath, qaReceiptPath };
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

test('only an explicit login command may create a visible PLAUD window', () => {
  for (const command of [
    'connection',
    'status',
    'pending',
    'sync-pending',
    'transcribe-local',
    'download',
  ]) {
    assert.equal(__test.plaudCommandClientOptions(command).headless, true, command);
  }
  assert.equal(__test.plaudCommandClientOptions('login').headless, false);
  assert.equal(
    __test.plaudCommandClientOptions('connection', { headless: false }).headless,
    true,
  );
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

test('PLAUD also closes tabs restored after the initial CDP page snapshot', async () => {
  let clock = 0;
  const pages = [];
  const makePage = (name) => ({
    name,
    closed: false,
    isClosed() { return this.closed; },
    async close() { this.closed = true; },
  });
  pages.push(makePage('primary'));
  const latePages = Array.from({ length: 21 }, (_, index) => makePage(`late-${index}`));
  let restored = false;
  const result = await compactManagedPages({
    pages: () => pages,
    newPage: async () => {
      const created = makePage('new');
      pages.push(created);
      return created;
    },
  }, {
    now: () => clock,
    pollMs: 100,
    timeoutMs: 1000,
    quietPasses: 3,
    pause: async (delay) => {
      clock += delay;
      if (!restored) {
        restored = true;
        pages.push(...latePages);
      }
    },
  });
  assert.equal(result.page.name, 'primary');
  assert.equal(result.closedPageCount, 21);
  assert.equal(pages.filter((page) => !page.closed).length, 1);
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

test('PLAUD still detects unclean profile state for diagnostics', () => {
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

test('PLAUD lets an eight-second cold session finish within the full authorization budget', async () => {
  let clock = 0;
  let navigationStartedAt = 0;
  let reloads = 0;
  const client = {
    authorization: null,
    browserLabel: 'Tabbit',
    headless: true,
    loginTimeoutMs: 12000,
    page: {
      isClosed: () => false,
      evaluate: async () => false,
      reload: async () => {
        reloads += 1;
        navigationStartedAt = clock;
      },
    },
  };
  const connected = await waitForPlaudAuthorization(client, {
    now: () => clock,
    pause: async (delay) => {
      clock += delay;
      if (clock - navigationStartedAt >= 8000) client.authorization = 'fixture';
    },
  });
  assert.equal(connected, true);
  assert.equal(clock, 8000);
  assert.equal(reloads, 0);
});

test('PLAUD bounds an explicitly shorter probe and its reload by one total deadline', async () => {
  let clock = 0;
  const reloadTimeouts = [];
  const client = {
    authorization: null,
    browserLabel: 'Tabbit',
    headless: true,
    loginTimeoutMs: 2000,
    page: {
      isClosed: () => false,
      evaluate: async () => false,
      reload: async ({ timeout }) => {
        reloadTimeouts.push(timeout);
        clock += 1000;
      },
    },
  };
  await assert.rejects(waitForPlaudAuthorization(client, {
    attemptTimeoutMs: 1000,
    now: () => clock,
    pause: async (delay) => { clock += delay; },
  }), /PLAUD_SESSION_PROBE_INCOMPLETE/);
  assert.equal(clock, 2000);
  assert.deepEqual(reloadTimeouts, [1000]);
});

test('PLAUD preserves the longer visible-login budget without a background reload', async () => {
  let clock = 0;
  const client = {
    authorization: null,
    browserLabel: 'Chrome',
    headless: false,
    loginTimeoutMs: 10 * 60 * 1000,
    page: {
      isClosed: () => false,
      evaluate: async () => false,
      reload: async () => { throw new Error('visible login must not be reloaded'); },
    },
  };
  assert.equal(await waitForPlaudAuthorization(client, {
    now: () => clock,
    pause: async (delay) => {
      clock += delay;
      if (clock >= 16000) client.authorization = 'fixture';
    },
  }), true);
  assert.equal(clock, 16000);
});

test('PLAUD can reload within an explicitly shortened probe without asking the user to log in', async () => {
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

test('PLAUD never guesses a different browser when local configuration is missing', () => {
  const previousConfig = process.env.DOMI_CONFIG_PATH;
  const previousRoot = process.env.DOMI_PLAUD_PROFILE_ROOT;
  const previousBrowser = process.env.DOMI_PLAUD_BROWSER;
  const profileRoot = path.join(sandbox, 'strict-browser-selection');
  process.env.DOMI_CONFIG_PATH = path.join(sandbox, 'missing-browser-config.json');
  process.env.DOMI_PLAUD_PROFILE_ROOT = profileRoot;
  delete process.env.DOMI_PLAUD_BROWSER;
  try {
    assert.throws(() => configuredBrowserKind(), /PLAUD_BROWSER_CONFIG_REQUIRED/);

    fs.mkdirSync(path.join(profileRoot, 'tabbit'), { recursive: true });
    assert.equal(configuredBrowserKind(), 'tabbit');

    fs.mkdirSync(path.join(profileRoot, 'chrome'), { recursive: true });
    assert.throws(() => configuredBrowserKind(), /PLAUD_BROWSER_CONFIG_REQUIRED/);

    fs.writeFileSync(
      process.env.DOMI_CONFIG_PATH,
      JSON.stringify({ plaudBrowser: 'safari' }),
      { mode: 0o600 },
    );
    assert.throws(() => configuredBrowserKind(), /PLAUD_BROWSER_CONFIG_REQUIRED/);
  } finally {
    if (previousConfig == null) delete process.env.DOMI_CONFIG_PATH;
    else process.env.DOMI_CONFIG_PATH = previousConfig;
    if (previousRoot == null) delete process.env.DOMI_PLAUD_PROFILE_ROOT;
    else process.env.DOMI_PLAUD_PROFILE_ROOT = previousRoot;
    if (previousBrowser == null) delete process.env.DOMI_PLAUD_BROWSER;
    else process.env.DOMI_PLAUD_BROWSER = previousBrowser;
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
    await assert.rejects(client.api('/file/simple/web'), /PLAUD_NETWORK_TIMEOUT: PLAUD 接口读取超时（1 秒）/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('PLAUD silently refreshes the same profile and retries one read after HTTP 401', async () => {
  const client = Object.create(PlaudClient.prototype);
  client.browserLabel = 'Tabbit';
  client.headless = true;
  client.loginTimeoutMs = 12000;
  client.authorization = 'old';
  client.headers = { authorization: 'old' };
  let reloads = 0;
  client.page = {
    isClosed: () => false,
    evaluate: async () => false,
    reload: async () => {
      reloads += 1;
      client.authorization = 'new';
      client.headers.authorization = 'new';
    },
    waitForTimeout: async () => {},
  };
  const responses = [
    { status: 401, body: {} },
    { status: 200, body: { status: 0, data: [] } },
  ];
  let requests = 0;
  client.apiOnce = async () => responses[requests++];

  const result = await client.api('/file/simple/web');
  assert.equal(result.status, 200);
  assert.equal(requests, 2);
  assert.equal(reloads, 1);
});

test('PLAUD asks for login only after a read remains unauthorized after silent refresh', async () => {
  const client = Object.create(PlaudClient.prototype);
  client.browserLabel = 'Google Chrome';
  client.headless = true;
  client.loginTimeoutMs = 12000;
  client.authorization = 'old';
  client.headers = { authorization: 'old' };
  client.page = {
    isClosed: () => false,
    evaluate: async () => false,
    reload: async () => {
      client.authorization = 'new';
      client.headers.authorization = 'new';
    },
    waitForTimeout: async () => {},
  };
  let requests = 0;
  client.apiOnce = async () => {
    requests += 1;
    return { status: 401, body: {} };
  };
  await assert.rejects(client.api('/file/simple/web'), /PLAUD_AUTH_REQUIRED/);
  assert.equal(requests, 2);
});

test('PLAUD never replays a write after HTTP 401', async () => {
  const client = Object.create(PlaudClient.prototype);
  client.browserLabel = 'Tabbit';
  client.page = { evaluate: async () => false };
  let requests = 0;
  client.apiOnce = async () => {
    requests += 1;
    return { status: 401, body: {} };
  };
  await assert.rejects(
    client.api('/ai/transsumm/example', { method: 'POST', data: { safe: true } }),
    /PLAUD_UNAUTHORIZED/,
  );
  assert.equal(requests, 1);
});

test('PLAUD distinguishes access denial and rate limiting from login expiry', async () => {
  const makeClient = (status) => {
    const client = Object.create(PlaudClient.prototype);
    client.browserLabel = 'Tabbit';
    client.page = { evaluate: async () => false };
    client.apiOnce = async () => ({ status, body: {} });
    return client;
  };
  await assert.rejects(makeClient(403).api('/file/simple/web'), /PLAUD_ACCESS_DENIED/);
  await assert.rejects(makeClient(429).api('/file/simple/web'), /PLAUD_RATE_LIMITED/);
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

test('PLAUD treats a detached background page as a retryable pre-operation failure', () => {
  assert.equal(
    __test.isTransientClientInitializationError(
      new Error('page.reload: Protocol error (Page.reload): Not attached to an active page'),
    ),
    true,
  );
  assert.equal(
    __test.isTransientClientInitializationError(
      new Error('PLAUD_AUTH_REQUIRED: account sign-in is required'),
    ),
    false,
  );
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

test('PLAUD shutdown budget exceeds every graceful browser-close phase', () => {
  const closePhasesMs = BROWSER_CLOSE_BUDGET_MS
    + BROWSER_GRACEFUL_EXIT_BUDGET_MS
    + BROWSER_TERM_EXIT_BUDGET_MS;
  assert.equal(
    SIGNAL_SHUTDOWN_BUDGET_MS > closePhasesMs,
    true,
  );

  const profileDir = path.join(sandbox, 'shutdown-budget-profile');
  const startedAt = 1000;
  const markerPath = writeManagedShutdownMarker(profileDir, { now: () => startedAt });
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.equal(marker.safeUntil - startedAt >= closePhasesMs, true);
  assert.equal(marker.safeUntil - startedAt >= 30000, true);
  assert.equal(clearManagedShutdownMarker(profileDir), true);
});

test('PLAUD waits for a prior exact-profile shutdown to flush before orphan cleanup', async () => {
  const profileDir = path.join(sandbox, 'shutdown-marker-profile');
  let clock = 0;
  writeManagedShutdownMarker(profileDir, { now: () => clock, safeForMs: 1000 });
  const markerPath = managedShutdownMarkerPath(profileDir);
  assert.equal(fs.statSync(markerPath).mode & 0o777, 0o600);
  const markerText = fs.readFileSync(markerPath, 'utf8');
  assert.equal(/authorization|cookie|token/i.test(markerText), false);

  let checks = 0;
  const stillRunning = await waitForPriorManagedShutdown(profileDir, '/Applications/Tabbit', {
    now: () => clock,
    pause: async (delay) => { clock += delay; },
    listPids: () => {
      checks += 1;
      return clock < 400 ? [4242] : [];
    },
  });
  assert.equal(stillRunning, false);
  assert.equal(checks >= 4, true);
  assert.equal(fs.existsSync(markerPath), false);
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
  const defaultDir = path.join(profileDir, 'Default');
  fs.mkdirSync(path.join(defaultDir, 'Sessions'), { recursive: true });
  fs.writeFileSync(path.join(defaultDir, 'Sessions', 'Tabs_1'), 'restored tabs');
  fs.writeFileSync(path.join(defaultDir, 'Preferences'), JSON.stringify({ profile: { exit_type: 'Normal' } }));
  fs.writeFileSync(path.join(defaultDir, 'Cookies'), 'private login state');
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
      assert.equal(fs.existsSync(path.join(defaultDir, 'Sessions')), false);
      assert.equal(fs.readFileSync(path.join(defaultDir, 'Cookies'), 'utf8'), 'private login state');
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
    browserKind: 'chrome',
    profileDirFactory: () => profileDir,
    terminateBrowser: async (targetProfileDir) => calls.push(['terminate', targetProfileDir]),
  });
  client.browser = {
    newBrowserCDPSession: async () => ({
      send: async (method) => calls.push(['cdp', method]),
    }),
  };
  const firstClose = client.close();
  const secondClose = client.close();
  assert.equal(firstClose, secondClose);
  await firstClose;
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
    text: async () => '[{"content":"完整的合成转写正文。"}]',
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

test('new notes require real source coverage and stale body references cannot be attested away', () => {
  const { artifact } = require('../../../scripts/domi-workflow.cjs');
  const fileId = 'coverage-gate';
  const notesPath = path.join(sandbox, `${fileId}-notes.md`);
  const quality = makeNotesQuality(fileId, notesPath);
  __test.updateRecord(__test.loadState(), fileId, { stage: 'context_ready', transcriptPath: quality.transcriptPath });
  const before = fs.readFileSync(path.join(process.env.DOMI_PLAUD_STATE_DIR, 'plaud-workflow.json'));
  const mark = (metadata) => spawnSync(process.execPath, [scriptPath, 'mark', fileId, 'notes_non_project', notesPath, JSON.stringify(metadata)], {
    encoding: 'utf8', env: process.env,
  });
  const missing = mark({});
  assert.equal(missing.status, 1);
  assert.match(missing.stderr + missing.stdout, /notesQuality/);
  assert.deepEqual(fs.readFileSync(path.join(process.env.DOMI_PLAUD_STATE_DIR, 'plaud-workflow.json')), before);

  const originalIndex = fs.readFileSync(quality.evidenceIndexPath);
  const originalQa = fs.readFileSync(quality.qaReceiptPath);
  const index = JSON.parse(originalIndex);
  index.claims[0].notesRefs[0].quote = '正文根本没有这个事实';
  fs.writeFileSync(quality.evidenceIndexPath, JSON.stringify(index));
  const qa = JSON.parse(originalQa);
  qa.evidenceIndex = artifact({ path: quality.evidenceIndexPath });
  fs.writeFileSync(quality.qaReceiptPath, JSON.stringify(qa));
  const fake = mark({ notesQuality: quality });
  assert.equal(fake.status, 1);
  assert.match(fake.stderr + fake.stdout, /quote|摘录|notesRef/i);
  assert.deepEqual(fs.readFileSync(path.join(process.env.DOMI_PLAUD_STATE_DIR, 'plaud-workflow.json')), before);
  fs.writeFileSync(quality.evidenceIndexPath, originalIndex);
  fs.writeFileSync(quality.qaReceiptPath, originalQa);

  const accepted = mark({ notesQuality: quality });
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  const verify = () => spawnSync(process.execPath, [scriptPath, 'verify', fileId], { encoding: 'utf8', env: process.env });
  const valid = verify();
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  assert.equal(JSON.parse(valid.stdout).checks.notesAudit, 'passed');
  fs.appendFileSync(quality.coveragePath, ' ');
  assert.equal(verify().status, 1);

  const legacyId = 'legacy-non-project-coverage';
  __test.updateRecord(__test.loadState(), legacyId, { stage: 'notes_non_project', notesPath });
  const legacy = spawnSync(process.execPath, [scriptPath, 'verify', legacyId], { encoding: 'utf8', env: process.env });
  assert.equal(legacy.status, 0);
  assert.equal(JSON.parse(legacy.stdout).checks.notesAudit, 'legacy-unverified');
});

test('documented accepts verified receipts for both locked repository backends', () => {
  const notesAudit = {
    status: 'passed',
    evidenceLedgerComplete: true,
    degreeIsolation: true,
    claimConsistency: true,
    careerLedgerComplete: true,
    modelWorkLedgerComplete: true,
    attributionConsistency: true,
    educationClaimCount: 1,
    careerClaimCount: 1,
    modelWorkClaimCount: 1,
    unresolvedDefinitiveEducationClaims: 0,
    unresolvedDefinitiveCareerClaims: 0,
    unresolvedDefinitiveModelWorkClaims: 0,
  };
  const reviewMetadata = {
    score: 8,
    rating: 'A',
    reviewAudit: {
      status: 'passed',
      educationConsistency: true,
      careerModelConsistency: true,
    },
  };

  function prepareReviewed(fileId) {
    const state = __test.loadState();
    const notesPath = path.join(sandbox, `${fileId}-notes.md`);
    const reviewPath = path.join(sandbox, `${fileId}-review.md`);
    const notesQuality = makeNotesQuality(fileId, notesPath);
    __test.updateRecord(state, fileId, { stage: 'context_ready', transcriptPath: notesQuality.transcriptPath });
    fs.writeFileSync(reviewPath, '# Review\n', { mode: 0o600 });
    const notesMarked = spawnSync(process.execPath, [
      scriptPath, 'mark', fileId, 'notes_project', notesPath,
      JSON.stringify({ notesAudit, notesQuality }),
    ], { encoding: 'utf8', env: process.env });
    assert.equal(notesMarked.status, 0, notesMarked.stderr || notesMarked.stdout);
    const reviewed = spawnSync(process.execPath, [
      scriptPath, 'mark', fileId, 'reviewed', reviewPath,
      JSON.stringify(reviewMetadata),
    ], { encoding: 'utf8', env: process.env });
    assert.equal(reviewed.status, 0, reviewed.stderr || reviewed.stdout);
  }

  prepareReviewed('local-documented');
  const local = spawnSync(process.execPath, [
    scriptPath, 'mark', 'local-documented', 'documented', '-',
    JSON.stringify({
      storageReceipt: {
        backend: 'local',
        projectId: 'prj_local',
        documentUri: 'file:///tmp/project.md',
        libraryPath: '/tmp/project',
        recordVerified: true,
        documentVerified: true,
        filesVerified: true,
      },
    }),
  ], { encoding: 'utf8', env: process.env });
  assert.equal(local.status, 0, local.stderr || local.stdout);
  assert.equal(JSON.parse(local.stdout).record.projectId, 'prj_local');

  prepareReviewed('legacy-documented');
  const legacy = spawnSync(process.execPath, [
    scriptPath, 'mark', 'legacy-documented', 'documented', '-',
    JSON.stringify({
      storageReceipt: {
        backend: 'legacy_feishu_primary',
        recordId: 'rec_legacy',
        documentUri: 'https://example.invalid/wiki/project',
        libraryPath: '/tmp/legacy-project',
        recordVerified: true,
        documentVerified: true,
        filesVerified: true,
      },
    }),
  ], { encoding: 'utf8', env: process.env });
  assert.equal(legacy.status, 0, legacy.stderr || legacy.stdout);
  assert.equal(JSON.parse(legacy.stdout).record.recordId, 'rec_legacy');

  prepareReviewed('unsupported-documented');
  const unsupported = spawnSync(process.execPath, [
    scriptPath, 'mark', 'unsupported-documented', 'documented', '-',
    JSON.stringify({ storageReceipt: { backend: 'unexpected' } }),
  ], { encoding: 'utf8', env: process.env });
  assert.equal(unsupported.status, 1);
  assert.match(JSON.parse(unsupported.stdout).error, /does not support storageReceipt backend/);
});

function resetSyncRecords(records = {}) {
  fs.mkdirSync(__test.STATE_DIR, { recursive: true });
  fs.writeFileSync(__test.STATE_FILE, JSON.stringify({ version: 1, records }), { mode: 0o600 });
}

function pendingTranscript(processing = false) {
  const error = new Error('Transcript not found for synthetic recording');
  error.code = 'PLAUD_TRANSCRIPT_NOT_READY';
  error.remoteProcessing = processing;
  return error;
}

function runSync(fake, options = {}) {
  let clock = 0;
  return __test.syncPending(options.count || 100, path.join(sandbox, 'sync-output'),
    options.timeoutSec || 5, options.pollSec || 1, {
      now: () => clock, pause: async ms => { clock += ms; },
      withClientImpl: async callback => callback(fake), ...options,
    });
}

test('sync records a durable claim before POST, retries transient reads, and reuses the exact artifact', async () => {
  resetSyncRecords();
  let generated = 0, reads = 0;
  const fake = {
    listFiles: async () => [{ id: 'sync-fresh', filename: 'Same title' }],
    generateFile: async id => {
      generated++;
      const record = __test.loadState().records[id];
      assert.equal(record.stage, 'generation_submitting');
      assert.ok(record.generationAttemptId && record.generationRequestedAt);
      assert.equal(record.generationAcceptedAt, undefined);
    },
    downloadTranscript: async (id, dir) => {
      reads++;
      if (!generated) throw pendingTranscript();
      if (reads < 4) throw new Error('page.evaluate: TypeError: Failed to fetch');
      return transcriptResult(id, id, dir);
    },
  };
  const first = await runSync(fake);
  assert.equal(first.results[0].outcome, 'ready');
  assert.equal(first.results[0].source, 'generated');
  assert.equal(first.submitted, 1);
  assert.equal(generated, 1);
  const record = __test.loadState().records['sync-fresh'];
  assert.ok(record.generationAcceptedAt);
  assert.equal(record.syncOutcome, 'ready');
  assert.equal(record.error, null);
  const again = await runSync(fake);
  assert.equal(generated, 1);
  assert.equal(reads, 4);
  assert.equal(again.results[0].transcriptPath, record.transcriptPath);
});

test('a lost POST response recovers by exact ID without a second POST or a fabricated receipt', async () => {
  resetSyncRecords();
  let posts = 0;
  const result = await runSync({
    listFiles: async () => [{ id: 'sync-ambiguous', filename: 'Ambiguous' }],
    generateFile: async () => { posts++; throw new Error('page.evaluate: TypeError: Failed to fetch'); },
    downloadTranscript: async (id, dir) => {
      if (!posts) throw pendingTranscript();
      return transcriptResult(id, id, dir);
    },
  });
  assert.equal(posts, 1);
  assert.equal(result.submitted, 0);
  assert.equal(result.results[0].outcome, 'ready');
  assert.equal(result.results[0].source, 'recovered');
  assert.equal(result.results[0].generationAcceptedAt, undefined);
  assert.ok(result.results[0].generationAttemptId);
});

test('legacy ambiguous stages remain read-only across repeated ordinary sync and exact-ID recovery', async () => {
  const stages = ['generation_failed', 'generation_timeout', 'generation_unknown', 'generation_submitting', 'failed'];
  resetSyncRecords(Object.fromEntries(stages.map((stage, i) => [`legacy-${i}`, { fileId: `legacy-${i}`, stage, error: 'Failed to fetch' }])));
  let posts = 0, reads = 0;
  const fake = { listFiles: async () => stages.map((_, i) => ({ id: `legacy-${i}` })),
    generateFile: async () => { posts++; }, downloadTranscript: async () => { reads++; throw pendingTranscript(); } };
  for (const readOnly of [false, false, true]) {
    const result = await runSync(fake, { readOnly, timeoutSec: 1 });
    assert.equal(result.results.length, stages.length);
    assert.ok(result.results.every(item => item.outcome === 'waiting' && item.retryable));
  }
  assert.equal(posts, 0);
  assert.equal(reads, stages.length * 3);
  assert.deepEqual(Object.values(__test.loadState().records).map(item => item.stage), stages);
});

test('exact-ID recovery works beyond the remote page and downloads ready text despite processing flags', async () => {
  resetSyncRecords({ 'off-page': { fileId: 'off-page', stage: 'generating', generationAcceptedAt: 'accepted' } });
  const result = await runSync({
    listFiles: async () => { throw new Error('recovery must not list'); },
    generateFile: async () => { throw new Error('recovery must not POST'); },
    downloadTranscript: async (id, dir) => transcriptResult(id, id, dir),
  }, { readOnly: true });
  assert.equal(result.results[0].outcome, 'ready');
  assert.equal(result.results[0].generationAcceptedAt, 'accepted');
  resetSyncRecords({ 'processing-ready': { fileId: 'processing-ready', stage: 'generating' } });
  const ready = await runSync({ listFiles: async () => [{ id: 'processing-ready', is_trans: true, wait_pull: 1 }],
    generateFile: async () => { throw new Error('must prefer transcript over processing'); },
    downloadTranscript: async (id, dir) => transcriptResult(id, id, dir) });
  assert.equal(ready.results[0].outcome, 'ready');
});

test('transient read retries stop at three attempts while permission and programming failures stop immediately', async () => {
  for (const [message, expectedReads, outcome, code] of [
    ['page.evaluate: TypeError: Failed to fetch', 3, 'retryable', 'PLAUD_READ_TRANSIENT'],
    ['PLAUD_ACCESS_DENIED: page.evaluate Failed to fetch HTTP 403', 1, 'failed', 'PLAUD_ACCESS_DENIED'],
    ['page.evaluate: TypeError: cannot read property missing', 1, 'failed', 'PLAUD_TRANSCRIPT_READ_FAILED'],
  ]) {
    resetSyncRecords({ bounded: { fileId: 'bounded', stage: 'generating', generationAcceptedAt: 'accepted' } });
    let reads = 0;
    const result = await runSync({ downloadTranscript: async () => { reads++; throw new Error(message); } }, { readOnly: true });
    assert.equal(reads, expectedReads);
    assert.equal(result.results[0].outcome, outcome);
    assert.equal(result.results[0].errorCode, code);
    assert.equal(__test.loadState().records.bounded.generationAcceptedAt, 'accepted');
  }
});

test('the total recovery budget is checked between files and unchecked IDs remain ahead next time', async () => {
  resetSyncRecords(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`budget-${i}`, { fileId: `budget-${i}`, stage: 'generating' }])));
  let clock = 0; const seen = [];
  await runSync({ downloadTranscript: async id => { seen.push(id); clock += 600; throw pendingTranscript(); } },
    { readOnly: true, timeoutSec: 1, now: () => clock, pause: async ms => { clock += ms; } });
  assert.equal(seen.length, 2);
  clock = 0;
  await runSync({ downloadTranscript: async id => { seen.push(id); clock += 1000; throw pendingTranscript(); } },
    { readOnly: true, timeoutSec: 1, now: () => clock, pause: async ms => { clock += ms; } });
  assert.equal(seen[2], 'budget-2');
});

test('concurrent workflow advancement wins over a delayed recovery and a missing bound transcript is never ready', async () => {
  resetSyncRecords({ advanced: { fileId: 'advanced', stage: 'generating' } });
  const bound = path.join(sandbox, 'must-not-replace.md');
  const result = await runSync({ downloadTranscript: async (id, dir) => {
    __test.updateRecord(__test.loadState(), id, { stage: 'notes_project', transcriptPath: bound, notesQuality: { immutable: true } });
    return transcriptResult(id, 'unbound-new-copy', dir);
  } }, { readOnly: true });
  assert.equal(result.results[0].outcome, 'failed');
  assert.equal(result.results[0].errorCode, 'PLAUD_TRANSCRIPT_ARTIFACT_MISSING');
  const record = __test.loadState().records.advanced;
  assert.equal(record.stage, 'notes_project');
  assert.equal(record.transcriptPath, bound);
  assert.deepEqual(record.notesQuality, { immutable: true });
  fs.writeFileSync(bound, 'Previously verified transcript');
  const next = await runSync({ listFiles: async () => [{ id: 'advanced' }],
    downloadTranscript: async () => { throw new Error('bound transcript must be reused'); } });
  assert.equal(next.results[0].outcome, 'ready');
  assert.equal(fs.readFileSync(bound, 'utf8'), 'Previously verified transcript');
});

test('a process exiting after possible acceptance leaves a durable claim and the next process only reads', async () => {
  resetSyncRecords();
  const code = `const fs=require('node:fs');const {__test}=require(${JSON.stringify(scriptPath)});__test.syncPending(1,${JSON.stringify(path.join(sandbox, 'crash-out'))},5,1,{withClientImpl:async fn=>fn({listFiles:async()=>[{id:'crash-id'}],downloadTranscript:async()=>{throw new Error('Transcript not found')},generateFile:async()=>process.exit(0)})}).catch(e=>{console.error(e);process.exit(1)});`;
  const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: process.env, timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  const record = __test.loadState().records['crash-id'];
  assert.equal(record.stage, 'generation_submitting');
  assert.ok(record.generationAttemptId);
  const recovered = await runSync({ downloadTranscript: async (id, dir) => transcriptResult(id, id, dir),
    generateFile: async () => { throw new Error('must not resubmit after process death'); } }, { readOnly: true });
  assert.equal(recovered.results[0].outcome, 'ready');
  assert.equal(recovered.results[0].generationAttemptId, record.generationAttemptId);
});

test('six real processes race one atomic claim and exactly one is allowed to POST', async () => {
  resetSyncRecords();
  const barrier = path.join(sandbox, 'claim-start');
  const postLog = path.join(sandbox, 'claim-posts');
  const code = `const fs=require('node:fs');const{__test}=require(${JSON.stringify(scriptPath)});(async()=>{while(!fs.existsSync(${JSON.stringify(barrier)}))await new Promise(r=>setTimeout(r,5));const claim=__test.claimGeneration({fileId:'race-id'},${JSON.stringify(sandbox)});if(claim)fs.appendFileSync(${JSON.stringify(postLog)},claim.generationAttemptId+'\\n');process.stdout.write(JSON.stringify({claimed:Boolean(claim)}));})().catch(e=>{console.error(e);process.exitCode=1});`;
  const children = Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { env: process.env });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr }));
  }));
  fs.writeFileSync(barrier, 'go');
  const outcomes = await Promise.all(children);
  assert.ok(outcomes.every(item => item.code === 0), JSON.stringify(outcomes));
  assert.equal(outcomes.filter(item => JSON.parse(item.stdout).claimed).length, 1);
  const posts = fs.readFileSync(postLog, 'utf8').trim().split('\n');
  assert.equal(posts.length, 1);
  assert.equal(posts[0], __test.loadState().records['race-id'].generationAttemptId);
});

test('a failed pre-submit state write never reaches generateFile', async () => {
  resetSyncRecords();
  const original = fs.renameSync; let posts = 0;
  fs.renameSync = (...args) => {
    if (args[1] === __test.STATE_FILE) throw new Error('Synthetic durable state write failure');
    return original(...args);
  };
  try {
    await assert.rejects(runSync({ listFiles: async () => [{ id: 'disk-full' }],
      downloadTranscript: async () => { throw pendingTranscript(); }, generateFile: async () => { posts++; } }), /durable state/);
    assert.equal(posts, 0);
  } finally { fs.renameSync = original; }
});

test('transcript body timeout aborts a stalled download and immutable paths prevent same-title overwrite', async () => {
  const client = Object.create(PlaudClient.prototype);
  client.apiTimeoutMs = 15000;
  client.getFileDetail = async () => ({ file_name: 'Same title', wait_pull: 1,
    content_list: [{ data_type: 'transaction', data_link: 'https://synthetic.invalid/transcript' }] });
  const original = global.fetch; let signal;
  try {
    global.fetch = async (_url, options) => { signal = options.signal; return { ok: true, text: () => new Promise(() => {}) }; };
    await assert.rejects(client.downloadTranscript('timeout-body', sandbox, { timeoutMs: 20 }), /PLAUD_NETWORK_TIMEOUT/);
    assert.equal(signal.aborted, true);
    global.fetch = async () => ({ ok: true, text: async () => '[{"content":"完整的合成转写正文。"}]' });
    const first = await client.downloadTranscript('same-one', sandbox);
    const second = await client.downloadTranscript('same-two', sandbox);
    const repeated = await client.downloadTranscript('same-one', sandbox);
    assert.equal(new Set([first.mdPath, second.mdPath, repeated.mdPath]).size, 3);
    assert.equal(fs.readFileSync(first.rawPath, 'utf8'), '[{"content":"完整的合成转写正文。"}]');
  } finally { global.fetch = original; }
});

test('only a new explicit sync retries a proven rejected attempt, never background recovery or ambiguous legacy state', async () => {
  resetSyncRecords();
  let posts = 0, accepted = false;
  const fake = { listFiles: async () => [{ id: 'proven-rejected' }],
    downloadTranscript: async (id, dir) => {
      if (!accepted) throw pendingTranscript();
      return transcriptResult(id, id, dir);
    },
    generateFile: async () => {
      posts++;
      if (posts === 1) throw new Error('Generate file failed: HTTP 200; API status QUOTA');
      accepted = true;
    } };
  const failed = await runSync(fake);
  assert.equal(failed.results[0].outcome, 'failed');
  assert.equal(posts, 1);
  const oldAttempt = failed.results[0].generationAttemptId;
  assert.equal(failed.results[0].generationRejection.attemptId, oldAttempt);
  const background = await runSync(fake, { readOnly: true });
  assert.equal(background.found, 0);
  assert.equal(posts, 1);
  const retried = await runSync(fake);
  assert.equal(retried.results[0].outcome, 'ready');
  assert.equal(posts, 2);
  assert.notEqual(retried.results[0].generationAttemptId, oldAttempt);
  assert.equal(retried.results[0].generationRejection, null);
});

test('a late genuine submission receipt survives concurrent notes advancement without changing its binding', async () => {
  resetSyncRecords();
  const bound = transcriptResult('late-receipt', 'late-bound', sandbox);
  let sent = false;
  const result = await runSync({ listFiles: async () => [{ id: 'late-receipt' }],
    downloadTranscript: async () => { if (!sent) throw pendingTranscript(); return bound; },
    generateFile: async id => {
      sent = true;
      __test.updateRecord(__test.loadState(), id, { stage: 'managed', transcriptPath: bound.mdPath, notesQuality: { preserved: true } });
    } });
  const record = __test.loadState().records['late-receipt'];
  assert.equal(record.stage, 'managed');
  assert.equal(record.transcriptPath, bound.mdPath);
  assert.deepEqual(record.notesQuality, { preserved: true });
  assert.ok(record.generationAcceptedAt);
  assert.equal(result.results[0].outcome, 'ready');
});

test('disabled PLAUD configuration blocks recovery before a client or output directory is created', async () => {
  resetSyncRecords({ disabled: { fileId: 'disabled', stage: 'generating' } });
  const config = process.env.DOMI_CONFIG_PATH;
  const before = fs.readFileSync(__test.STATE_FILE, 'utf8');
  fs.writeFileSync(config, JSON.stringify({ plaudConnectionMode: 'disabled' }));
  const output = path.join(sandbox, 'disabled-output');
  try {
    await assert.rejects(__test.syncPending(1, output, 1, 1, { readOnly: true,
      withClientImpl: async () => { throw new Error('client must not initialize'); } }), /PLAUD_DISABLED/);
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.readFileSync(__test.STATE_FILE, 'utf8'), before);
  } finally { fs.writeFileSync(config, JSON.stringify({ plaudConnectionMode: 'enabled' })); }
});

test('long Chinese and emoji transcript titles fit UTF-8 filename limits without altering the transcript', async () => {
  const client = Object.create(PlaudClient.prototype);
  const title = '完整中文标题😀🧑🏽‍💻'.repeat(30);
  const content = '保留中文、emoji 😀 和所有原文。';
  client.getFileDetail = async () => ({ file_name: title,
    content_list: [{ data_type: 'transaction', data_link: 'https://synthetic.invalid/body' }] });
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => JSON.stringify([{ content }]) });
  try {
    const result = await client.downloadTranscript('long-id-'.repeat(15), sandbox);
    for (const file of [result.mdPath, result.rawPath]) {
      assert.ok(Buffer.byteLength(path.basename(file), 'utf8') <= 240);
      assert.equal(path.basename(file).includes('\uFFFD'), false);
    }
    const text = fs.readFileSync(result.mdPath, 'utf8');
    assert.ok(text.includes(title));
    assert.ok(text.includes(content));
  } finally { global.fetch = original; }
});

test('empty, malformed and truncated transcripts never create artifacts or report ready', async () => {
  const client = Object.create(PlaudClient.prototype);
  client.getFileDetail = async () => ({ file_name: 'Unready', wait_pull: 1,
    content_list: [{ data_type: 'transaction', data_link: 'https://synthetic.invalid/body' }] });
  const original = global.fetch;
  try {
    for (const [text, expectedCode] of [
      ['[]', 'PLAUD_TRANSCRIPT_EMPTY'], ['[{"content":"  "}]', 'PLAUD_TRANSCRIPT_EMPTY'],
      ['[{"content":', 'PLAUD_TRANSCRIPT_INVALID'], ['{"text":"wrong shape"}', 'PLAUD_TRANSCRIPT_INVALID'],
    ]) {
      const out = path.join(sandbox, `invalid-${crypto.randomUUID()}`);
      global.fetch = async () => ({ ok: true, text: async () => text });
      await assert.rejects(client.downloadTranscript('invalid-id', out), error => error.code === expectedCode);
      assert.equal(fs.existsSync(out), false);
    }
  } finally { global.fetch = original; }
});

test('an unvisited new candidate stays unsubmitted and a later explicit sync can generate it', async () => {
  resetSyncRecords();
  let clock = 0, posts = 0;
  const remote = [{ id: 'slow-ready' }, { id: 'not-visited' }];
  const first = await runSync({ listFiles: async () => remote,
    downloadTranscript: async (id, dir) => { clock += 1000; return transcriptResult(id, id, dir); },
    generateFile: async () => { throw new Error('first batch must not generate'); } },
  { timeoutSec: 1, now: () => clock, pause: async ms => { clock += ms; } });
  const waiting = first.results.find(item => item.fileId === 'not-visited');
  assert.equal(waiting.stage, 'uploaded');
  assert.equal(waiting.errorCode, 'PLAUD_GENERATION_NOT_SUBMITTED');
  assert.equal(waiting.generationAttemptId, undefined);
  const background = await runSync({ downloadTranscript: async () => { throw new Error('unsubmitted records must not enter recovery'); } }, { readOnly: true });
  assert.equal(background.found, 0);
  const explicit = await runSync({ listFiles: async () => [{ id: 'not-visited' }],
    downloadTranscript: async (id, dir) => { if (!posts) throw pendingTranscript(); return transcriptResult(id, id, dir); },
    generateFile: async () => { posts++; } });
  assert.equal(posts, 1);
  assert.equal(explicit.results[0].outcome, 'ready');
});

test('explicit HTTP authentication, access and rate rejection are retryable only by a later explicit submission', async () => {
  for (const prefix of ['PLAUD_AUTH_REQUIRED', 'PLAUD_UNAUTHORIZED', 'PLAUD_ACCESS_DENIED', 'PLAUD_RATE_LIMITED']) {
    resetSyncRecords();
    let posts = 0;
    const result = await runSync({ listFiles: async () => [{ id: 'known-http-rejection' }],
      downloadTranscript: async () => { throw pendingTranscript(); },
      generateFile: async () => { posts++; throw new Error(`${prefix}: synthetic rejection`); } });
    assert.equal(result.results[0].outcome, 'failed');
    assert.equal(result.results[0].generationRejection.attemptId, result.results[0].generationAttemptId);
    assert.equal(posts, 1);
  }
});

test('first-read failures recover read-only, but an exact not-ready answer becomes explicitly unsubmitted', async () => {
  resetSyncRecords({ 'first-read': { fileId: 'first-read', stage: 'uploaded', syncOutcome: 'retryable', errorCode: 'PLAUD_READ_TRANSIENT' } });
  const result = await runSync({ downloadTranscript: async () => { throw pendingTranscript(); },
    generateFile: async () => { throw new Error('background must not submit'); } }, { readOnly: true, timeoutSec: 1 });
  assert.equal(result.results[0].stage, 'uploaded');
  assert.equal(result.results[0].errorCode, 'PLAUD_GENERATION_NOT_SUBMITTED');
  const again = await runSync({ downloadTranscript: async () => { throw new Error('do not poll definitely unsubmitted'); } }, { readOnly: true });
  assert.equal(again.found, 0);
});

test('the download budget includes a stalled detail read or silent authorization refresh', async () => {
  const client = Object.create(PlaudClient.prototype);
  client.apiTimeoutMs = 15000;
  client.getFileDetail = async () => new Promise(() => {});
  await assert.rejects(client.downloadTranscript('detail-timeout', sandbox, { timeoutMs: 20 }), /PLAUD_NETWORK_TIMEOUT/);
});


test('legacy failed records recover by precise ID and retained notes artifacts never trigger generation', async () => {
  const bound = transcriptResult('notes-failed', 'failed-bound-transcript', sandbox);
  resetSyncRecords({
    'generic-failed': { fileId: 'generic-failed', stage: 'failed', error: 'legacy ambiguous error' },
    'notes-failed': { fileId: 'notes-failed', stage: 'failed', transcriptPath: bound.mdPath, notesPath: '/synthetic/notes.md' },
  });
  const read = [];
  const result = await runSync({
    generateFile: async () => { throw new Error('legacy failed must never resubmit'); },
    downloadTranscript: async (id, dir) => { read.push(id); return transcriptResult(id, id, dir); },
  }, { readOnly: true });
  assert.deepEqual(read, ['generic-failed']);
  assert.ok(result.results.every(item => item.outcome === 'ready'));
  assert.equal(__test.loadState().records['notes-failed'].stage, 'failed');
  assert.equal(__test.loadState().records['notes-failed'].transcriptPath, bound.mdPath);
});


test('blocked recovery records cannot consume the count ahead of an eligible precise ID', async () => {
  resetSyncRecords({ ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`blocked-${i}`,
    { fileId: `blocked-${i}`, stage: 'generating', errorCode: 'PLAUD_AUTH_REQUIRED' }])),
    eligible: { fileId: 'eligible', stage: 'generation_unknown' } });
  const reads = [];
  const result = await runSync({ downloadTranscript: async (id, dir) => { reads.push(id); return transcriptResult(id, id, dir); } },
    { readOnly: true, count: 1 });
  assert.deepEqual(reads, ['eligible']);
  assert.equal(result.results[0].outcome, 'ready');
});
