const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { chromium } = require('playwright');

const TABBIT_EXECUTABLE = '/Applications/Tabbit.app/Contents/MacOS/Tabbit';
const TABBIT_USER_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'Tabbit');
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1'];
const API_BASE = 'https://api-apne1.plaud.ai';
const STATE_DIR = path.join(os.homedir(), '.plaud-cli');
const STATE_FILE = path.join(STATE_DIR, 'generated-history.json');
const CAPTURED_HEADER_KEYS = [
  'x-device-id',
  'x-pld-tag',
  'x-pld-user',
  'timezone',
  'app-language',
  'app-platform',
  'edit-from',
];
const API_HOST_RE = /^api(?:[-.][a-z0-9-]+)?\.plaud\.ai$/i;
const DIRECT_OPUS_EXTS = new Set(['.asr', '.opus']);
const TRANSCODABLE_EXTS = new Set([
  '.aac',
  '.amr',
  '.avi',
  '.f4v',
  '.flac',
  '.m2ts',
  '.m4a',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.ogg',
  '.ts',
  '.wav',
  '.webm',
  '.wma',
  '.wmv',
  '.3gp',
]);
const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 3;

function ensureTabbitExists() {
  if (!fs.existsSync(TABBIT_EXECUTABLE)) {
    throw new Error(`Tabbit executable not found: ${TABBIT_EXECUTABLE}`);
  }
  if (!fs.existsSync(TABBIT_USER_DATA)) {
    throw new Error(`Tabbit user data not found: ${TABBIT_USER_DATA}`);
  }
}

function copyIfExists(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.cpSync(src, dst, { recursive: true, force: true });
  } else {
    fs.copyFileSync(src, dst);
  }
}

function prepareRuntimeProfile(options = {}) {
  const ensureAvailable = options.ensureTabbitExists || ensureTabbitExists;
  const sourceDir = options.userDataDir || TABBIT_USER_DATA;
  const createRuntimeDir = options.profileDirFactory || (() =>
    fs.mkdtempSync(path.join(os.tmpdir(), 'plaud-cli-tabbit-min-')));
  const copy = options.copyIfExists || copyIfExists;
  ensureAvailable();
  const runtimeDir = createRuntimeDir();
  try {
    fs.mkdirSync(path.join(runtimeDir, 'Default', 'IndexedDB'), { recursive: true });

    for (const name of ['Local State', 'Last Version', 'Variations', 'First Run']) {
      copy(path.join(sourceDir, name), path.join(runtimeDir, name));
    }

    for (const name of [
      'Preferences',
      'Secure Preferences',
      'Cookies',
      'Cookies-journal',
      'Network Persistent State',
      'Session Storage',
      'Local Storage',
      'WebStorage',
    ]) {
      copy(path.join(sourceDir, 'Default', name), path.join(runtimeDir, 'Default', name));
    }

    copy(
      path.join(sourceDir, 'Default', 'IndexedDB', 'https_web.plaud.ai_0.indexeddb.leveldb'),
      path.join(runtimeDir, 'Default', 'IndexedDB', 'https_web.plaud.ai_0.indexeddb.leveldb')
    );

    return runtimeDir;
  } catch (error) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    throw error;
  }
}

function safeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

function fmtMs(ms) {
  if (ms == null) return '';
  const total = Math.floor(Number(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v, i) => (i === 0 ? String(v) : String(v).padStart(2, '0'))).join(':');
}

function renderTranscript(items, title) {
  const lines = ['# ' + title, ''];
  for (const item of items) {
    const speaker = item.speaker || item.speaker_name || item.role || item.channel || 'Speaker';
    const content = (item.content || item.text || item.transcript || '').trim();
    if (!content) continue;
    lines.push('## ' + speaker);
    lines.push('');
    lines.push('[' + fmtMs(item.start_time) + ' - ' + fmtMs(item.end_time) + '] ' + content);
    lines.push('');
  }
  return lines.join('\n');
}

function collectUrls(value, urls = []) {
  if (typeof value === 'string' && /^https?:\/\//.test(value)) {
    urls.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectUrls(item, urls);
  }
  return urls;
}

function extensionFromAudioUrl(url, fallback = '.mp3') {
  if (/\.mp3(?:[?#]|$)/i.test(url)) return '.mp3';
  if (/\.m4a(?:[?#]|$)/i.test(url)) return '.m4a';
  if (/\.wav(?:[?#]|$)/i.test(url)) return '.wav';
  if (/\.opus(?:[?#]|$)/i.test(url)) return '.opus';
  return fallback;
}

function isPlaudApiUrl(url) {
  try {
    return API_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function plaudApiOrigin(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function stripKnownAudioExtension(name) {
  return String(name || '').replace(/\.(mp3|m4a|mp4|wav|ogg|webm|amr|mov|aac|flac|mkv|wma|avi|wmv|m4v|mpeg|mpg|ts|m2ts|3gp|f4v|asr|opus)$/i, '');
}

function expandHome(inputPath) {
  const value = String(inputPath || '');
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function timezoneHours() {
  return -new Date().getTimezoneOffset() / 60;
}

function serialNumber() {
  return `web_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function commandExists(cmd) {
  const result = spawnSync('sh', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim();
}

function runProcess(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], ...options });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} failed with exit code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

function backgroundTabbitArgs(profileDir) {
  return [
    '--headless=new',
    '--no-startup-window',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-session-crashed-bubble',
    '--disable-sync',
    '--hide-crash-restore-bubble',
    '--hide-scrollbars',
    '--mute-audio',
    '--noerrdialogs',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--use-mock-keychain',
    '--profile-directory=Default',
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    'about:blank',
  ];
}

function pause(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitForDevToolsEndpoint(profileDir, timeoutMs = 10000) {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [port, socketPath] = fs.readFileSync(portFile, 'utf8').trim().split(/\s+/);
      if (/^\d{2,5}$/.test(port) && /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(socketPath || '')) {
        return `ws://127.0.0.1:${port}${socketPath}`;
      }
    } catch {
      // Tabbit writes this file after its background DevTools endpoint is ready.
    }
    await pause(50);
  }
  throw new Error('Timed out while starting the background PLAUD browser session.');
}

async function withLoopbackNoProxy(callback) {
  const previous = new Map();
  for (const key of ['NO_PROXY', 'no_proxy']) {
    previous.set(key, process.env[key]);
    const entries = String(process.env[key] || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const host of LOOPBACK_HOSTS) {
      if (!entries.includes(host)) entries.push(host);
    }
    process.env[key] = entries.join(',');
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function backgroundTabbitPids(profileDir) {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  const profileArg = `--user-data-dir=${profileDir}`;
  return result.stdout
    .split('\n')
    .filter((line) => line.includes(TABBIT_EXECUTABLE) && line.includes(profileArg))
    .map((line) => Number(line.trim().match(/^\d+/)?.[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 1);
}

async function terminateBackgroundTabbit(profileDir, browserProcess = null) {
  const pids = new Set(backgroundTabbitPids(profileDir));
  if (Number.isInteger(browserProcess?.pid) && browserProcess.pid > 1) {
    pids.add(browserProcess.pid);
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The browser may already have exited after Browser.close.
    }
  }
  for (let attempt = 0; attempt < 20 && backgroundTabbitPids(profileDir).length; attempt += 1) {
    await pause(50);
  }
  for (const pid of backgroundTabbitPids(profileDir)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The browser exited while the final cleanup pass was running.
    }
  }
}

async function launchBackgroundTabbit(profileDir, options = {}) {
  const spawnProcess = options.spawnProcess || spawn;
  const waitForEndpoint = options.waitForDevToolsEndpoint || waitForDevToolsEndpoint;
  const connect = options.connectOverCDP || chromium.connectOverCDP.bind(chromium);
  const terminate = options.terminateBrowser || terminateBackgroundTabbit;
  let browser = null;
  let child = null;
  let stderr = '';

  try {
    child = spawnProcess(TABBIT_EXECUTABLE, backgroundTabbitArgs(profileDir), {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
      windowsHide: true,
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    const exitedBeforeReady = new Promise((_, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`;
        const details = stderr.trim() ? `: ${stderr.trim()}` : '';
        reject(new Error(`Background PLAUD browser stopped before it was ready (${reason})${details}`));
      });
    });
    const endpoint = await Promise.race([
      waitForEndpoint(profileDir),
      exitedBeforeReady,
    ]);
    browser = await withLoopbackNoProxy(() => connect(endpoint));
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('Background PLAUD browser did not create a usable context.');
    }
    return { browser, context, process: child };
  } catch (error) {
    if (browser) {
      try {
        const session = await browser.newBrowserCDPSession();
        await session.send('Browser.close');
      } catch {
        await browser.close().catch(() => {});
      }
    }
    await terminate(profileDir, child).catch(() => {});
    throw error;
  }
}

function probeDurationMs(filePath) {
  if (!commandExists('ffprobe')) return null;
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) return null;
  const seconds = Number(result.stdout.trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds * 1000) : null;
}

async function transcodeToMp3(inputPath, outputPath) {
  if (!commandExists('ffmpeg')) {
    throw new Error('ffmpeg not found. Install ffmpeg or upload an .mp3/.asr/.opus file directly.');
  }
  await runProcess('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-c:a',
    'libmp3lame',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-qscale:a',
    '0',
    '-ignore_unknown',
    outputPath,
  ]);
}

function unwrapPlaudData(response, label) {
  if (response.status < 200 || response.status >= 300) {
    throw plaudApiError(label, response);
  }
  const body = response.body;
  if (body && typeof body === 'object') {
    if (typeof body.status === 'number' && body.status !== 0) {
      throw plaudApiError(label, response);
    }
    return body.data || body;
  }
  return body;
}

function plaudApiError(label, response) {
  const httpStatus = Number.isInteger(response && response.status) ? response.status : 'unknown';
  const body = response && response.body;
  const rawApiStatus = body && typeof body === 'object' ? body.status : null;
  const apiStatusText = typeof rawApiStatus === 'number' || typeof rawApiStatus === 'string'
    ? String(rawApiStatus)
    : '';
  const apiStatus = /^[A-Za-z0-9_.-]{1,32}$/.test(apiStatusText) ? apiStatusText : null;
  return new Error(`${label}: HTTP ${httpStatus}${apiStatus ? `; API status ${apiStatus}` : ''}`);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { generated: {} };
  }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(STATE_DIR, 0o700);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.chmodSync(STATE_FILE, 0o600);
}

class PlaudClient {
  constructor(options = {}) {
    this.ownsProfileDir = !options.profileDir;
    this.profileDir = options.profileDir || (options.profileDirFactory || prepareRuntimeProfile)();
    this.context = null;
    this.browser = null;
    this.browserProcess = null;
    this.page = null;
    this.apiBase = options.apiBase || API_BASE;
    this.authorization = null;
    this.headers = {};
    this.launchBrowser = options.launchBrowser || launchBackgroundTabbit;
    this.terminateBrowser = options.terminateBrowser || terminateBackgroundTabbit;
  }

  async init() {
    try {
      const launched = await this.launchBrowser(this.profileDir);
      this.browser = launched.browser;
      this.context = launched.context;
      this.browserProcess = launched.process || null;
      this.page = this.context.pages()[0] || (await this.context.newPage());
      this.page.on('request', (req) => {
        if (!isPlaudApiUrl(req.url())) return;
        const origin = plaudApiOrigin(req.url());
        if (origin) this.apiBase = origin;
        const headers = req.headers();
        if (headers.authorization) {
          const pathname = new URL(req.url()).pathname;
          if (!this.authorization || pathname.startsWith('/file/') || pathname.startsWith('/ai/')) {
            this.authorization = headers.authorization;
            this.headers.authorization = headers.authorization;
          }
        }
        for (const key of CAPTURED_HEADER_KEYS) {
          if (headers[key] && !this.headers[key]) {
            this.headers[key] = headers[key];
          }
        }
      });
      await this.page.goto('https://web.plaud.ai', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await this.page.waitForTimeout(6000);
      const runtimeApiBase = await this.page.evaluate(() => {
        try {
          return window._prefetch && typeof window._prefetch.getUserApiDomain === 'function'
            ? window._prefetch.getUserApiDomain()
            : null;
        } catch {
          return null;
        }
      });
      if (runtimeApiBase) this.apiBase = runtimeApiBase;
      if (!this.authorization) {
        throw new Error('Failed to capture PLAUD authorization header from Tabbit session.');
      }
      return this;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close() {
    try {
      if (this.browser) {
        try {
          const session = await this.browser.newBrowserCDPSession();
          await session.send('Browser.close');
        } catch {
          await this.browser.close().catch(() => {});
        }
      } else if (this.context) {
        await this.context.close().catch(() => {});
      }
    } finally {
      await this.terminateBrowser(this.profileDir, this.browserProcess).catch(() => {});
      this.browser = null;
      this.browserProcess = null;
      this.context = null;
      this.page = null;
      if (this.ownsProfileDir && this.profileDir) {
        fs.rmSync(this.profileDir, { recursive: true, force: true });
      }
    }
  }

  async api(pathname, options = {}) {
    const method = options.method || 'GET';
    const data = options.data;
    const url = pathname.startsWith('http') ? pathname : `${this.apiBase}${pathname}`;
    const headers = {
      accept: 'application/json, text/plain, */*',
      ...this.headers,
      ...(options.headers || {}),
      'x-request-id': Math.random().toString(36).slice(2),
    };
    if (data) {
      headers['content-type'] = headers['content-type'] || 'application/json;charset=UTF-8';
    }
    const response = await this.page.evaluate(
      async ({ url, method, headers, data }) => {
        const res = await fetch(url, {
          method,
          headers,
          body: data ? JSON.stringify(data) : undefined,
        });
        const text = await res.text();
        let body = text;
        try {
          body = JSON.parse(text);
        } catch {}
        return { status: res.status, body };
      },
      { url, method, headers, data }
    );
    return response;
  }

  async getUploadPresignedUrl({ filesize, fileType }) {
    const res = await this.api('/file/get_upload_presigned_url', {
      method: 'POST',
      data: {
        filesize,
        file_type: fileType,
      },
    });
    const data = unwrapPlaudData(res, 'Get upload presigned URL failed');
    if (!data.upload_id || !data.object_name || !Array.isArray(data.part_urls)) {
      throw new Error('Unexpected upload presign response: required fields are missing');
    }
    return data;
  }

  async mergeMultipart({ uploadId, objectName, parts }) {
    const res = await this.api('/file/merge_multipart', {
      method: 'POST',
      data: {
        upload_id: uploadId,
        object_name: objectName,
        parts,
      },
    });
    return unwrapPlaudData(res, 'Merge multipart upload failed');
  }

  async confirmUpload(payload) {
    const res = await this.api('/file/confirm_upload', {
      method: 'POST',
      data: payload,
    });
    const data = unwrapPlaudData(res, 'Confirm upload failed');
    return data.data_file || data.data || data;
  }

  async readChunk(fileHandle, start, end) {
    const length = end - start;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await fileHandle.read(buffer, 0, length, start);
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  }

  async uploadPresignedParts(filePath, partUrls, options = {}) {
    const stat = fs.statSync(filePath);
    if (!Array.isArray(partUrls) || partUrls.length === 0) {
      throw new Error('Upload presign response did not include part URLs');
    }
    const expectedParts = Math.ceil(stat.size / UPLOAD_CHUNK_SIZE);
    if (partUrls.length !== expectedParts) {
      throw new Error(`Upload part count mismatch: expected ${expectedParts}, got ${partUrls.length}`);
    }
    const fileHandle = await fs.promises.open(filePath, 'r');
    const parts = new Array(partUrls.length);
    let nextIndex = 0;
    let uploadedBytes = 0;

    const uploadOne = async (index) => {
      const start = index * UPLOAD_CHUNK_SIZE;
      const end = Math.min(stat.size, start + UPLOAD_CHUNK_SIZE);
      const chunk = await this.readChunk(fileHandle, start, end);
      const response = await fetch(partUrls[index], {
        method: 'PUT',
        body: chunk,
      });
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        throw new Error(`Chunk ${index + 1}/${partUrls.length} upload failed: HTTP ${response.status}`);
      }
      const etag = response.headers.get('etag');
      if (!etag) {
        throw new Error(`Chunk ${index + 1}/${partUrls.length} upload did not return an ETag`);
      }
      uploadedBytes += chunk.length;
      if (options.onProgress) {
        options.onProgress({
          stage: 'upload',
          percent: Math.floor((uploadedBytes / stat.size) * 100),
          uploadedBytes,
          totalBytes: stat.size,
          part: index + 1,
          totalParts: partUrls.length,
        });
      }
      parts[index] = {
        Etag: etag.replace(/"/g, ''),
        PartNumber: index + 1,
      };
    };

    const worker = async () => {
      while (nextIndex < partUrls.length) {
        const index = nextIndex;
        nextIndex += 1;
        await uploadOne(index);
      }
    };

    try {
      const concurrency = Math.min(UPLOAD_CONCURRENCY, partUrls.length);
      await Promise.all(Array.from({ length: concurrency }, worker));
    } finally {
      await fileHandle.close();
    }

    return parts;
  }

  async prepareUploadAudio(sourcePath, options = {}) {
    const resolved = path.resolve(expandHome(sourcePath));
    if (!fs.existsSync(resolved)) {
      throw new Error(`Audio file not found: ${resolved}`);
    }
    const sourceStat = fs.statSync(resolved);
    if (!sourceStat.isFile()) {
      throw new Error(`Audio path is not a file: ${resolved}`);
    }
    if (sourceStat.size <= 0) {
      throw new Error(`Audio file is empty: ${resolved}`);
    }
    const ext = path.extname(resolved).toLowerCase();
    const fileName = safeName(stripKnownAudioExtension(options.fileName || path.basename(resolved))) || safeName(path.basename(resolved)) || 'Untitled';
    const startTime = Math.floor(sourceStat.mtimeMs || Date.now());

    if (ext === '.mp3') {
      return {
        sourcePath: resolved,
        uploadPath: resolved,
        fileName,
        fileType: 'MP3',
        startTime,
        transcode: false,
        tempPath: null,
        duration: null,
      };
    }

    if (DIRECT_OPUS_EXTS.has(ext)) {
      return {
        sourcePath: resolved,
        uploadPath: resolved,
        fileName,
        fileType: 'OPUS',
        startTime,
        transcode: false,
        tempPath: null,
        duration: probeDurationMs(resolved) || Math.floor(sourceStat.size / 80 * 20),
      };
    }

    if (!TRANSCODABLE_EXTS.has(ext)) {
      throw new Error(`Unsupported audio format: ${ext || '(no extension)'}. Supported direct formats: .mp3, .asr, .opus; transcodable formats: ${Array.from(TRANSCODABLE_EXTS).join(', ')}`);
    }

    const tempPath = path.join(os.tmpdir(), `plaud-upload-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp3`);
    if (options.onProgress) {
      options.onProgress({ stage: 'transcode', message: `Transcoding ${path.basename(resolved)} to MP3` });
    }
    await transcodeToMp3(resolved, tempPath);

    return {
      sourcePath: resolved,
      uploadPath: tempPath,
      fileName,
      fileType: 'MP3',
      startTime,
      transcode: true,
      tempPath,
      duration: null,
    };
  }

  async uploadAudioFile(sourcePath, options = {}) {
    const prepared = await this.prepareUploadAudio(sourcePath, options);
    const uploadStat = fs.statSync(prepared.uploadPath);
    const sourceStat = fs.statSync(prepared.sourcePath);
    try {
      if (options.onProgress) {
        options.onProgress({ stage: 'presign', message: 'Requesting upload URLs' });
      }
      const presigned = await this.getUploadPresignedUrl({
        filesize: uploadStat.size,
        fileType: prepared.fileType,
      });

      if (options.onProgress) {
        options.onProgress({
          stage: 'upload',
          percent: 0,
          uploadedBytes: 0,
          totalBytes: uploadStat.size,
          totalParts: presigned.part_urls.length,
        });
      }
      const parts = await this.uploadPresignedParts(prepared.uploadPath, presigned.part_urls, options);

      if (options.onProgress) {
        options.onProgress({ stage: 'merge', message: 'Merging uploaded chunks' });
      }
      await this.mergeMultipart({
        uploadId: presigned.upload_id,
        objectName: presigned.object_name,
        parts,
      });

      const payload = {
        upload_id: presigned.upload_id,
        object_name: presigned.object_name,
        scene: 101,
        is_tmp: 0,
        support_mul_summ: true,
        file_type: prepared.fileType,
        filename: prepared.fileName,
        start_time: prepared.startTime,
        session_id: Math.floor(prepared.startTime / 1000),
        serial_number: serialNumber(),
        timezone: timezoneHours(),
      };
      if (prepared.fileType === 'OPUS') {
        payload.duration = parseInt(prepared.duration, 10);
      }

      if (options.onProgress) {
        options.onProgress({ stage: 'confirm', message: 'Confirming upload' });
      }
      const dataFile = await this.confirmUpload(payload);
      return {
        fileId: dataFile.id || dataFile.file_id || null,
        fileName: dataFile.filename || dataFile.file_name || prepared.fileName,
        sourcePath: prepared.sourcePath,
        originalBytes: sourceStat.size,
        uploadedBytes: uploadStat.size,
        fileType: prepared.fileType,
        transcode: prepared.transcode,
        parts: parts.length,
        uploadId: presigned.upload_id,
        objectName: presigned.object_name,
        dataFile,
      };
    } finally {
      if (prepared.tempPath && !options.keepTemp) {
        fs.rmSync(prepared.tempPath, { force: true });
      }
    }
  }

  async listFiles({ limit = 20, skip = 0, sortBy = 'edit_time', desc = true, isTrash = 0 } = {}) {
    const query = `?skip=${skip}&limit=${limit}&is_trash=${isTrash}&sort_by=${sortBy}&is_desc=${desc ? 'true' : 'false'}`;
    const res = await this.api(`/file/simple/web${query}`);
    if (res.status !== 200 || !res.body || res.body.status !== 0) {
      throw plaudApiError('List files failed', res);
    }
    return res.body.data_file_list;
  }

  async getFileDetail(fileId) {
    const res = await this.api(`/file/detail/${fileId}`);
    if (res.status !== 200 || !res.body || res.body.status !== 0) {
      throw plaudApiError('Get file detail failed', res);
    }
    return res.body.data;
  }

  async listTags() {
    const res = await this.api('/filetag/');
    if (res.status !== 200 || !res.body || res.body.status !== 0) {
      throw plaudApiError('List tags failed', res);
    }
    return res.body.data_filetag_list || [];
  }

  async getFileTaskStatus() {
    const res = await this.api('/ai/file-task-status');
    if (res.status !== 200 || !res.body || res.body.status !== 0) {
      throw plaudApiError('Get file task status failed', res);
    }
    return (res.body.data && res.body.data.file_status_list) || [];
  }

  async generateFile(
    fileId,
    options = {
      template: 'REASONING-NOTE',
      language: 'zh-0',
      diarization: true,
      llm: 'gpt-5.5',
      timezone: 9,
      reload: false,
      templateType: 'system',
      supportMultiSummary: true,
    }
  ) {
    const payload = {
      is_reload: options.reload ? 1 : 0,
      summ_type: options.template || 'REASONING-NOTE',
      summ_type_type: options.templateType || 'system',
      info: JSON.stringify({
        language: options.language || 'zh-0',
        timezone: options.timezone ?? 9,
        diarization: options.diarization === false ? 0 : 1,
        llm: options.llm || 'gpt-5.5',
      }),
      support_mul_summ: options.supportMultiSummary !== false,
    };
    const res = await this.api(`/ai/transsumm/${fileId}`, {
      method: 'POST',
      data: payload,
    });
    if (res.status !== 200 || !res.body || res.body.status !== 0) {
      throw plaudApiError('Generate file failed', res);
    }
    const state = loadState();
    state.generated[fileId] = {
      updatedAt: new Date().toISOString(),
      template: payload.summ_type,
      templateType: payload.summ_type_type,
      language: JSON.parse(payload.info).language,
      diarization: JSON.parse(payload.info).diarization === 1,
      model: JSON.parse(payload.info).llm,
      timezone: JSON.parse(payload.info).timezone,
    };
    saveState(state);
    return { fileId, payload, apiStatus: res.body.status };
  }

  async listPendingFiles({ limit = 20, scanLimit } = {}) {
    const max = scanLimit || Math.max(limit * 10, 100);
    const files = await this.listFiles({ limit: max });
    return files.filter((file) => !file.is_trans && !file.is_summary).slice(0, limit);
  }

  summarizeStatus(detail, taskList = [], tagMap = new Map()) {
    const state = loadState();
    const recorded = state.generated[detail.file_id] || null;
    const transcriptItem = detail.content_list.find((x) => x.data_type === 'transaction');
    const summaryItem = detail.content_list.find((x) => x.data_type === 'auto_sum_note');
    const usedTemplate = summaryItem && summaryItem.extra && summaryItem.extra.used_template;
    const activeTask = taskList.find((task) => task.task_status === 0) || null;
    const isProcessing = !!activeTask || detail.wait_pull === 1 || (summaryItem && summaryItem.task_status !== 1);

    return {
      fileId: detail.file_id,
      fileName: detail.file_name,
      tags: (detail.filetag_id_list || []).map((id) => tagMap.get(id) || id),
      waitPull: detail.wait_pull,
      hasTranscript: !!transcriptItem,
      hasSummary: !!summaryItem && summaryItem.task_status === 1,
      status: isProcessing
        ? 'processing'
        : transcriptItem && summaryItem && summaryItem.task_status === 1
          ? 'generated'
          : transcriptItem
            ? 'transcribed'
            : 'new',
      template:
        (usedTemplate && (usedTemplate.template_id || usedTemplate.template_name)) ||
        (summaryItem && summaryItem.extra && summaryItem.extra.summ_type) ||
        (recorded && recorded.template) ||
        (activeTask && activeTask.sum_type) ||
        null,
      model: (recorded && recorded.model) || null,
      language: (recorded && recorded.language) || null,
      diarization: recorded ? recorded.diarization : null,
      tasks: taskList.map((task) => ({
        type: task.task_type,
        status: task.task_status,
        template: task.sum_type || null,
        templateType: task.sum_type_type || null,
      })),
    };
  }

  async listStatuses({ limit = 20, skip = 0 } = {}) {
    const [files, tags, tasks] = await Promise.all([
      this.listFiles({ limit, skip }),
      this.listTags(),
      this.getFileTaskStatus(),
    ]);
    const tagMap = new Map(tags.map((tag) => [tag.id, tag.name]));
    const tasksByFile = new Map();
    for (const task of tasks) {
      if (!tasksByFile.has(task.file_id)) tasksByFile.set(task.file_id, []);
      tasksByFile.get(task.file_id).push(task);
    }
    const details = await Promise.all(files.map((file) => this.getFileDetail(file.id)));
    return details.map((detail) => this.summarizeStatus(detail, tasksByFile.get(detail.file_id) || [], tagMap));
  }

  async generatePending({ limit = 3, options } = {}) {
    const pendingFiles = await this.listPendingFiles({ limit });
    const results = [];
    for (const file of pendingFiles) {
      results.push(await this.generateFile(file.id, options));
    }
    return {
      count: results.length,
      files: pendingFiles.map((file) => ({ id: file.id, filename: file.filename })),
      results,
    };
  }

  async downloadTranscript(fileId, outDir) {
    const detail = await this.getFileDetail(fileId);
    const transcriptMeta = detail.content_list.find((x) => x.data_type === 'transaction');
    if (!transcriptMeta) {
      throw new Error(`Transcript not found for file ${fileId}`);
    }
    const resp = await fetch(transcriptMeta.data_link);
    if (!resp.ok) {
      throw new Error(`Transcript download failed: ${resp.status} ${resp.statusText}`);
    }
    const rawText = await resp.text();
    const items = JSON.parse(rawText);

    fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(outDir, 0o700);
    const base = safeName(detail.file_name);
    const rawPath = path.join(outDir, `${base}-transcript.json`);
    const mdPath = path.join(outDir, `${base}-transcript.md`);

    fs.writeFileSync(rawPath, rawText, { mode: 0o600 });
    fs.writeFileSync(mdPath, renderTranscript(items, detail.file_name), { mode: 0o600 });
    fs.chmodSync(rawPath, 0o600);
    fs.chmodSync(mdPath, 0o600);

    return { fileId, fileName: detail.file_name, rawPath, mdPath };
  }

  async getAudioTempUrl(fileId) {
    const res = await this.api(`/file/temp-url/${fileId}`);
    if (res.status !== 200 || !res.body || res.body.status !== 0) {
      throw plaudApiError('Get audio temp URL failed', res);
    }
    const urls = collectUrls(res.body);
    const audioUrl =
      res.body.temp_url ||
      urls.find((url) => /\.mp3(?:[?#]|$)/i.test(url)) ||
      urls.find((url) => /\.(m4a|wav|opus)(?:[?#]|$)/i.test(url)) ||
      urls[0];
    if (!audioUrl) {
      throw new Error(`Audio temp URL not found for file ${fileId}`);
    }
    return audioUrl;
  }

  async downloadAudio(fileId, outDir) {
    const detail = await this.getFileDetail(fileId);
    const audioUrl = await this.getAudioTempUrl(fileId);
    const resp = await fetch(audioUrl);
    if (!resp.ok) {
      throw new Error(`Audio download failed: ${resp.status} ${resp.statusText}`);
    }
    const buffer = Buffer.from(await resp.arrayBuffer());

    fs.mkdirSync(outDir, { recursive: true });
    const base = safeName(detail.file_name || fileId);
    const ext = extensionFromAudioUrl(audioUrl);
    const audioPath = path.join(outDir, `${base}-plaud-audio${ext}`);
    fs.writeFileSync(audioPath, buffer);

    return {
      fileId,
      fileName: detail.file_name,
      duration: detail.duration,
      audioPath,
      bytes: buffer.length,
      format: ext.replace(/^\./, ''),
    };
  }

  async exportSummaryMarkdown(fileId, outDir) {
    const detail = await this.getFileDetail(fileId);
    const summaryItem = (detail.pre_download_content_list || []).find((x) => x.data_id.startsWith('auto_sum:'));
    if (!summaryItem || !summaryItem.data_content) {
      throw new Error(`Summary not found for file ${fileId}`);
    }
    const parsed = JSON.parse(summaryItem.data_content);
    fs.mkdirSync(outDir, { recursive: true });
    const base = safeName(detail.file_name);
    const summaryPath = path.join(outDir, `${base}-summary.md`);
    fs.writeFileSync(summaryPath, parsed.ai_content || '');
    return { fileId, fileName: detail.file_name, summaryPath };
  }
}

module.exports = {
  API_BASE,
  PlaudClient,
  backgroundTabbitArgs,
  fmtMs,
  launchBackgroundTabbit,
  prepareRuntimeProfile,
  renderTranscript,
  safeName,
  waitForDevToolsEndpoint,
  withLoopbackNoProxy,
};
