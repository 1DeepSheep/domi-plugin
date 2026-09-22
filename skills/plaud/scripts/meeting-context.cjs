'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HASH = /^[a-f0-9]{64}$/;
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;
const INPUT_STAGES = new Set(['transcript_ready', 'context_pending']);
const ADVANCED_STAGES = new Set(['notes_project', 'notes_non_project', 'reviewed', 'documented', 'managed', 'discussion_notes_ready', 'discussion_complete']);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(code, message) { throw Object.assign(new Error(message), { code: `PLAUD_CONTEXT_${code}` }); }
function text(value, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (required && !value.trim())) fail('INPUT_INVALID', '会议信息字段无效，请重新填写。');
  return value;
}
function objectInput(value) {
  if (typeof value === 'string') {
    if (value.length > 131072) fail('INPUT_INVALID', '会议信息超出本地提交大小限制。');
    try { value = JSON.parse(value); } catch { fail('INPUT_INVALID', '会议信息不是有效的 JSON。'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INPUT_INVALID', '会议信息必须为对象。');
  if (!HASH.test(value.accountScope || '')) fail('INPUT_INVALID', '缺少当前录音连接的本地范围标识。');
  return value;
}
function normalizedContext(value) {
  const participants = typeof value.participants === 'string' ? (value.participants.trim() ? [value.participants] : []) : value.participants || [];
  if (!Array.isArray(participants) || participants.length > 100) fail('INPUT_INVALID', '参会人字段无效。');
  return {
    contextStatus: text(value.contextStatus, 32),
    conversationType: text(value.conversationType, 1000),
    conversationPurpose: text(value.conversationPurpose, 8000),
    projectName: text(value.projectName, 1000),
    participants: participants.map(item => text(item, 2000, true)),
    userContext: text(value.userContext, 32768),
    extraContext: text(value.extraContext, 32768),
  };
}
function transcriptArtifact(record) {
  const file = record.transcriptPath;
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('TRANSCRIPT_REQUIRED', '请先取得这条录音的本地文字稿，再提交会议信息。');
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_TRANSCRIPT_BYTES) throw new Error('not a bounded regular transcript');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) throw new Error('changed transcript');
      const bytes = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!count) throw new Error('short transcript');
        offset += count;
      }
      const after = fs.fstatSync(fd);
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('changed transcript');
      return { path: path.resolve(file), sha256: digest(bytes), bytes: bytes.length };
    } finally { fs.closeSync(fd); }
  } catch { fail('TRANSCRIPT_REQUIRED', '这条录音的本地文字稿缺失或不可读取。'); }
}

function createMeetingContextStore({ stateDir, loadState, withStateWriteLock, writeStateUnlocked, ensureEnabled }) {
  function writeArtifact(artifact, identity) {
    const bytes = `${JSON.stringify(artifact, null, 2)}\n`;
    const directory = path.join(stateDir, 'meeting-contexts');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const contextPath = path.join(directory, `${digest(JSON.stringify(identity))}.json`);
    const temporary = `${contextPath}.tmp-${crypto.randomUUID()}`;
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, contextPath);
      const directoryFd = fs.openSync(directory, 'r');
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { path: contextPath, sha256: digest(bytes), bytes: Buffer.byteLength(bytes) };
  }
  function exactRecord(fileId, accountScope, scopeRecovery = false) {
    if (typeof fileId !== 'string' || !/^[A-Za-z0-9:_-]{1,256}$/.test(fileId)) fail('INPUT_INVALID', '录音标识无效。');
    const state = loadState();
    const record = Object.hasOwn(state.records, fileId) ? state.records[fileId] : null;
    if (!record || record.fileId !== fileId) fail('RECORD_NOT_FOUND', '未找到这条录音的本地工作流。');
    if (!scopeRecovery && record.contextReceipt && record.contextReceipt.accountScope !== accountScope) fail('SCOPE_MISMATCH', '录音连接已变化，请重新打开当前录音。');
    return { state, record };
  }
  function revision(record, transcript, accountScope) {
    // A recall cache refresh or unrelated queue timestamp must not invalidate
    // a form the user is filling. Only its actual context/stage/source matters.
    return digest(JSON.stringify({ fileId: record.fileId, accountScope, stage: record.stage,
      transcript, context: normalizedContext(record), contextReceipt: record.contextReceipt || null }));
  }
  function verifyContextArtifact(record, transcript, accountScope) {
    const receipt = record.contextReceipt;
    if (!receipt) return null;
    try {
      if (receipt.schema !== 'domi.plaud-context-receipt.v1' || receipt.accountScope !== accountScope || receipt.transcriptSha256 !== transcript.sha256
        || !path.isAbsolute(receipt.path || '') || !HASH.test(receipt.sha256 || '')) throw new Error('binding');
      if (!fs.lstatSync(receipt.path).isFile()) throw new Error('file');
      const bytes = fs.readFileSync(receipt.path);
      const value = JSON.parse(bytes);
      if (digest(bytes) !== receipt.sha256 || bytes.length !== receipt.bytes || value.schema !== 'domi.plaud-context.v1'
        || value.fileId !== record.fileId || value.accountScope !== accountScope
        || value.transcript?.sha256 !== transcript.sha256 || value.sourceTurnId !== receipt.sourceTurnId
        || value.submissionId !== receipt.submissionId
        || JSON.stringify(value.scopeRecovery || null) !== JSON.stringify(receipt.scopeRecovery || null)
        || JSON.stringify(value.context) !== JSON.stringify(normalizedContext(record))) throw new Error('contents');
      return { path: receipt.path, rawAnswer: text(value.rawAnswer, 65536, true), sourceTurnId: text(value.sourceTurnId, 200, true) };
    } catch { fail('ARTIFACT_INVALID', '已保存的会议信息或文字稿绑定发生变化，请重新核验。'); }
  }
  function snapshot(record, transcript, accountScope, extra = {}) {
    const verifiedContext = verifyContextArtifact(record, transcript, accountScope);
    // Preserve the structured context projection used by revision/artifact
    // comparisons; only the response includes the verified original answer.
    const context = { ...normalizedContext(record), ...(verifiedContext ? {
      rawAnswer: verifiedContext.rawAnswer, sourceTurnId: verifiedContext.sourceTurnId
    } : {}) };
    const disposition = ADVANCED_STAGES.has(record.stage) ? 'advanced' : record.stage === 'context_ready' ? 'ready' : INPUT_STAGES.has(record.stage) ? 'needs_input' : null;
    if (!disposition) fail('STAGE_CONFLICT', '当前录音阶段尚不支持填写会议信息。');
    return { ok: true, fileId: record.fileId, accountScope, stage: record.stage, disposition,
      transcript, recordRevision: revision(record, transcript, accountScope), context, contextPath: verifiedContext?.path || null,
      ...(record.contextReceipt?.scopeRecovery ? { scopeRecoveryBinding: record.contextReceipt.scopeRecovery } : {}),
      fileName: record.fileName || '', createdAt: record.createdAt || null, duration: record.duration || null,
      recallSummary: typeof record.recallSummary === 'string' ? record.recallSummary : '',
      // Legacy recall text has no source binding. The client may generate and
      // cache a fresh hint separately without modifying this queue revision.
      recallSummaryVerified: false, ...extra };
  }
  function prepare(fileId, raw) {
    ensureEnabled();
    const input = objectInput(raw);
    const { record } = exactRecord(fileId, input.accountScope);
    return snapshot(record, transcriptArtifact(record), input.accountScope);
  }
  function submit(fileId, raw) {
    ensureEnabled();
    const input = objectInput(raw);
    const submissionId = text(input.submissionId, 200, true);
    const sourceTurnId = text(input.sourceTurnId, 200, true);
    const rawAnswer = text(input.rawAnswer, 65536, true);
    if (!HASH.test(input.expectedRecordRevision || '') || !HASH.test(input.expectedTranscriptSha256 || '')) fail('INPUT_INVALID', '缺少会议信息或文字稿版本。');
    const context = normalizedContext(input);
    if (!['provided', 'skipped'].includes(context.contextStatus)) fail('INPUT_INVALID', '请提交会议信息，或明确选择直接处理。');
    const submissionSha256 = digest(JSON.stringify({ fileId, accountScope: input.accountScope,
      transcriptSha256: input.expectedTranscriptSha256, context, rawAnswer, sourceTurnId }));
    return withStateWriteLock(() => {
      ensureEnabled();
      const { state, record } = exactRecord(fileId, input.accountScope);
      const transcript = transcriptArtifact(record);
      if (transcript.sha256 !== input.expectedTranscriptSha256) fail('TRANSCRIPT_CHANGED', '文字稿已更新，请重新打开会议信息。');
      if (ADVANCED_STAGES.has(record.stage)) fail('STAGE_CONFLICT', '这条录音已进入后续阶段，不能重新提交背景或回退。');
      if (record.contextReceipt?.submissionId === submissionId) {
        if (record.contextReceipt.submissionSha256 !== submissionSha256) fail('SUBMISSION_CONFLICT', '同一提交标识对应不同内容，请重新打开会议信息。');
        return snapshot(record, transcript, input.accountScope, { reused: true });
      }
      if (!INPUT_STAGES.has(record.stage)) fail('STAGE_CONFLICT', '会议信息已提交或录音阶段已变化，请继续原任务。');
      if (revision(record, transcript, input.accountScope) !== input.expectedRecordRevision) fail('REVISION_CONFLICT', '会议信息已被另一操作更新，请重新打开。');
      const createdAt = new Date().toISOString();
      const artifact = { schema: 'domi.plaud-context.v1', fileId, accountScope: input.accountScope,
        transcript, submissionId, sourceTurnId, rawAnswer, context, createdAt };
      const savedArtifact = writeArtifact(artifact, [input.accountScope, fileId, submissionId]);
      if (transcriptArtifact(record).sha256 !== transcript.sha256) fail('TRANSCRIPT_CHANGED', '文字稿在提交期间更新，请重新打开会议信息。');
      const next = { ...record, ...context, stage: 'context_ready', updatedAt: createdAt,
        contextReceipt: { schema: 'domi.plaud-context-receipt.v1', accountScope: input.accountScope,
          transcriptSha256: transcript.sha256, submissionId, submissionSha256, sourceTurnId,
          ...savedArtifact } };
      state.records[fileId] = next;
      writeStateUnlocked(state);
      return snapshot(next, transcript, input.accountScope, { reused: false });
    });
  }
  function rebind(fileId, raw) {
    ensureEnabled();
    const input = objectInput(raw);
    if (input.confirmed !== true || !HASH.test(input.previousAccountScope || '') || input.previousAccountScope === input.accountScope
      || !HASH.test(input.expectedTranscriptSha256 || '') || !HASH.test(input.expectedRecordRevision || '')) fail('INPUT_INVALID', '请明确确认沿用这条录音的已填信息。');
    return withStateWriteLock(() => {
      ensureEnabled();
      // A successful response can be lost. Accept an exact replay only when
      // the current receipt records this precise previous scope and revision.
      const { state, record } = exactRecord(fileId, undefined, true);
      const transcript = transcriptArtifact(record);
      if (transcript.sha256 !== input.expectedTranscriptSha256) fail('TRANSCRIPT_CHANGED', '文字稿已更新，不能沿用原来的背景确认。');
      if (['managed', 'notes_non_project', 'discussion_complete'].includes(record.stage)) fail('STAGE_CONFLICT', '这条录音已处理完成，请查看原任务结果。');
      if (!INPUT_STAGES.has(record.stage) && !ADVANCED_STAGES.has(record.stage) && record.stage !== 'context_ready') fail('STAGE_CONFLICT', '当前录音阶段不支持恢复会议信息。');
      const recovery = { previousAccountScope: input.previousAccountScope, previousRecordRevision: input.expectedRecordRevision, transcriptSha256: transcript.sha256 };
      if (record.contextReceipt?.accountScope === input.accountScope) {
        if (JSON.stringify(record.contextReceipt.scopeRecovery) !== JSON.stringify(recovery)) fail('REVISION_CONFLICT', '会议信息已被另一操作更新，请重新读取。');
        return snapshot(record, transcript, input.accountScope, { reused: true });
      }
      if (record.contextReceipt && record.contextReceipt.accountScope !== input.previousAccountScope) fail('SCOPE_MISMATCH', '原会议信息的连接范围已变化。');
      if (revision(record, transcript, input.previousAccountScope) !== input.expectedRecordRevision) fail('REVISION_CONFLICT', '会议信息已被另一操作更新，请重新读取。');
      const original = verifyContextArtifact(record, transcript, input.previousAccountScope);
      if (!original) return snapshot(record, transcript, input.accountScope, { reused: false });
      const context = normalizedContext(record);
      const receipt = record.contextReceipt;
      const artifact = { schema: 'domi.plaud-context.v1', fileId, accountScope: input.accountScope, transcript,
        submissionId: receipt.submissionId, sourceTurnId: original.sourceTurnId, rawAnswer: original.rawAnswer, context,
        createdAt: new Date().toISOString(), scopeRecovery: recovery };
      const savedArtifact = writeArtifact(artifact, [input.accountScope, fileId, receipt.submissionId, input.expectedRecordRevision]);
      if (transcriptArtifact(record).sha256 !== transcript.sha256) fail('TRANSCRIPT_CHANGED', '文字稿在确认期间更新，请重新读取。');
      const next = { ...record, contextReceipt: { ...receipt, accountScope: input.accountScope, ...savedArtifact, scopeRecovery: recovery,
        submissionSha256: digest(JSON.stringify({ fileId, accountScope: input.accountScope, transcriptSha256: transcript.sha256,
          context, rawAnswer: original.rawAnswer, sourceTurnId: original.sourceTurnId })) } };
      state.records[fileId] = next;
      writeStateUnlocked(state);
      return snapshot(next, transcript, input.accountScope, { reused: false });
    });
  }
  function guarded(operation) {
    try { return operation(); } catch (error) {
      if (/^PLAUD_CONTEXT_[A-Z_]+$/.test(error?.code || '')) throw error;
      if (/^PLAUD_DISABLED:/.test(error?.message || '')) throw Object.assign(new Error('PLAUD 已停用，未处理会议信息。'), { code: 'PLAUD_DISABLED' });
      // JSON parse and filesystem failures may include excerpts or paths. Only
      // typed, content-free errors cross the local client boundary.
      fail('STATE_UNAVAILABLE', '无法完成本地会议信息操作，请重新打开后重试。');
    }
  }
  return { prepare: (fileId, raw) => guarded(() => prepare(fileId, raw)),
    submit: (fileId, raw) => guarded(() => submit(fileId, raw)),
    rebind: (fileId, raw) => guarded(() => rebind(fileId, raw)) };
}

module.exports = { createMeetingContextStore };
