/**
 * ============================================================================
 *  本地开发版签名服务 —— ASR / SOE / TTS
 * ----------------------------------------------------------------------------
 *  · 纯 Node.js 实现，零第三方依赖（内置 http / https / crypto）
 *  · 密钥从 server/.env 或系统环境变量读取，绝不返回给前端
 *  · 供本地调试使用；线上请部署 server/scf/（云函数 + 函数 URL）
 *
 *  接口：
 *    GET  /api/health
 *    POST /api/asr    { audioBase64, format, engine }
 *    POST /api/soe    { audioBase64, refText, evalMode, workMode, scoreCoeff }
 *    POST /api/tts    { text, voiceType?, speed? }
 *  也支持 /?action=xxx 形式。
 *
 *  启动：node server/sign.js  （默认端口 8787）
 * ============================================================================
 */
'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* === 读取 .env（轻量解析，无需 dotenv 依赖） === */
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
loadEnv();

const SECRET_ID = process.env.TENCENT_SECRET_ID || '';
const SECRET_KEY = process.env.TENCENT_SECRET_KEY || '';
const REGION = process.env.TENCENT_REGION || 'ap-guangzhou';
const TTS_VOICE_FEMALE = parseInt(process.env.TTS_VOICE_FEMALE || '1051', 10); // WeRose 英文女声
const TTS_VOICE_MALE = parseInt(process.env.TTS_VOICE_MALE || '1050', 10);     // WeJack 英文男声
const TTS_VOICE_DEFAULT = parseInt(process.env.TTS_VOICE_TYPE || process.env.TTS_VOICE_FEMALE || '1051', 10);
const PORT = parseInt(process.env.PORT || '8787', 10);
const CONFIGURED = Boolean(SECRET_ID && SECRET_KEY);

/* === TC3-HMAC-SHA256 签名 === */
function sha256hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
function hmac256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}
function buildAuthorization(service, host, payload, timestamp) {
  const algorithm = 'TC3-HMAC-SHA256';
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedPayload = sha256hex(payload);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');
  const stringToSign = [algorithm, timestamp, credentialScope, sha256hex(canonicalRequest)].join('\n');
  const secretDate = hmac256('TC3' + SECRET_KEY, date);
  const secretService = hmac256(secretDate, service);
  const secretSigning = hmac256(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');
  return `${algorithm} Credential=${SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/* === 调用腾讯云 API（内置 https，避免 undici 的 TLS 抖动） === */
function httpsPost(host, headers, bodyStr, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, path: '/', method: 'POST', headers, timeout: timeoutMs || 12000 },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(data));
      }
    );
    req.on('timeout', () => req.destroy(new Error(`调用腾讯云超时（${timeoutMs || 12000}ms）`)));
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function callTencent({ service, action, version, params }) {
  const host = `${service}.tencentcloudapi.com`;
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify(params);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': REGION,
    Authorization: buildAuthorization(service, host, payload, timestamp),
  };
  const raw = await httpsPost(host, headers, payload, 15000);
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error(`腾讯云返回非 JSON：${raw.slice(0, 200)}`); }
  const resp = data && data.Response;
  if (resp && resp.Error) {
    throw new Error(`${resp.Error.Code}: ${resp.Error.Message} (RequestId=${resp.RequestId || 'n/a'})`);
  }
  return resp;
}

/* === 演示模式：未配置密钥时返回可用模拟数据 === */
function mockAsr() {
  return { Mock: true, Result: '', AudioDuration: 0 };
}
function mockSoe(body) {
  const seed = (body.audioBase64 || '').length % 1000;
  const base = 55 + (seed % 35);
  return {
    Mock: true,
    PronAccuracy: Math.min(98, base + 8),
    PronFluency: Math.min(98, base + 3) / 100,
    PronCompletion: Math.min(100, base + 15) / 100,
    SuggestedScore: Math.min(98, base + 5),
    Words: [],
  };
}
function mockTts() {
  return { Mock: true, Audio: '', SessionId: 'mock' };
}

/* === 业务处理 === */
async function handleAsr(body) {
  if (!CONFIGURED) return mockAsr();
  const params = {
    ProjectId: body.projectId ? Number(body.projectId) : 0,
    SubServiceType: 2,
    EngSerViceType: body.engine || '16k_en',
    SourceType: 1,
    VoiceFormat: body.format || 'wav',
    Data: body.audioBase64,
    DataLen: (body.audioBase64 || '').length,
    FilterDirty: 1,
    FilterModal: 1,
    FilterPunc: 0,
  };
  return callTencent({ service: 'asr', action: 'SentenceRecognition', version: '2019-06-14', params });
}

async function handleSoe(body) {
  if (!CONFIGURED) return mockSoe(body);
  const sessionId = body.sessionId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const params = {
    SessionId: sessionId,
    RefText: body.refText != null ? String(body.refText) : '',
    WorkMode: body.workMode != null ? body.workMode : 0,
    EvalMode: body.evalMode != null ? body.evalMode : 1,
    ScoreCoeff: body.scoreCoeff != null ? body.scoreCoeff : 2.0,
    ServerType: body.serverType != null ? body.serverType : 0,
    VoiceFileType: body.voiceFileType != null ? body.voiceFileType : 2,
    VoiceEncodeType: 1,
    SeqId: 1,
    IsEnd: 1,
    UserVoiceData: body.audioBase64,
    TextMode: 0,
  };
  if (body.soeAppId) params.SoeAppId = String(body.soeAppId);

  const resp = await callTencent({
    service: 'soe',
    action: 'TransmitOralProcessWithInit',
    version: '2018-07-24',
    params,
  });
  resp.SessionId = sessionId;
  return resp;
}

/* === 语音合成：单说话人 / 多说话人对白（男女声区分） === */
const TTS_SEG_CACHE = new Map();     // voice|speed|text → base64
const TTS_MERGED_CACHE = new Map();  // merged|speed|text → base64
const TTS_SEG_MAX = 60;
const TTS_MERGED_MAX = 20;
const TTS_TURN_GAP_MS = 380;

const SPEAKER_SRC = '(?:^|[\\s"“])(Woman|Man|Narrator|Interviewer|Interviewee|Customer|Agent|Doctor|Patient|Teacher|Student|Guide|Receptionist|Clerk|Waiter|Passenger|Driver|Speaker\\s*[AB12])\\s*:\\s*';

function cachePut(map, key, value, max) {
  if (map.size >= max) {
    const first = map.keys().next().value;
    map.delete(first);
  }
  map.set(key, value);
}

/** 说话人 → 音色；无法判断性别时返回 null（由调用方交替分配） */
function speakerVoice(label) {
  const s = String(label || '').toLowerCase();
  if (/^(man|male|boy|guy|mr|sir)/.test(s)) return TTS_VOICE_MALE;
  if (/^(woman|female|lady|girl|mrs|ms|miss)/.test(s)) return TTS_VOICE_FEMALE;
  return null;
}

/** 把带说话人标签的脚本切成 [{speaker, text}]；不足 2 段则视为单音色 */
function splitDialogue(text) {
  const re = new RegExp(SPEAKER_SRC, 'gi');
  const segs = [];
  let m;
  let lastIndex = 0;
  let lastLabel = null;

  while ((m = re.exec(text)) !== null) {
    if (lastLabel === null) {
      const pre = text.slice(0, m.index).trim();
      if (pre) segs.push({ speaker: 'Narrator', text: pre });
    } else {
      const chunk = text.slice(lastIndex, m.index).trim();
      if (chunk) segs.push({ speaker: lastLabel, text: chunk });
    }
    lastLabel = m[1];
    lastIndex = re.lastIndex;
  }
  if (lastLabel !== null) {
    const tail = text.slice(lastIndex).trim();
    if (tail) segs.push({ speaker: lastLabel, text: tail });
  }
  return segs.length >= 2 ? segs : null;
}

/** 取出 WAV 的 PCM 数据（按 data 块定位） */
function wavToPcm(buf) {
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') return buf.slice(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  return buf.length > 44 ? buf.slice(44) : Buffer.alloc(0);
}

/** 组装 16k / 单声道 / 16bit 的 WAV */
function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** 拼接多段音频，并在轮次之间插入停顿 */
function mergeWavs(base64List, gapMs, sampleRate) {
  const gap = Buffer.alloc(Math.round((sampleRate * gapMs) / 1000) * 2);
  const chunks = [];
  base64List.forEach((b64, i) => {
    if (!b64) return;
    if (i > 0) chunks.push(gap);
    chunks.push(wavToPcm(Buffer.from(b64, 'base64')));
  });
  return pcmToWav(Buffer.concat(chunks), sampleRate).toString('base64');
}

/** 合成单段文本（带缓存） */
async function synthSegment(voiceType, speed, text) {
  const key = `${voiceType}|${speed}|${text}`;
  if (TTS_SEG_CACHE.has(key)) return TTS_SEG_CACHE.get(key);

  const params = {
    Text: text.slice(0, 500),
    SessionId: `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ModelType: 1,
    VoiceType: voiceType,
    PrimaryLanguage: 2,
    SampleRate: 16000,
    Codec: 'wav',
    Speed: speed,
    Volume: 0,
    ProjectId: 0,
  };
  const resp = await callTencent({ service: 'tts', action: 'TextToVoice', version: '2019-08-23', params });
  const audio = (resp && resp.Audio) || '';
  if (audio) cachePut(TTS_SEG_CACHE, key, audio, TTS_SEG_MAX);
  return audio;
}

async function handleTts(body) {
  const raw = String(body.text || '').trim();
  if (!raw) throw new Error('缺少 text');
  if (!CONFIGURED) return mockTts();

  const speed = body.speed != null ? Number(body.speed) : 0;
  const mergedKey = `merged|${speed}|${raw}`;
  if (TTS_MERGED_CACHE.has(mergedKey)) {
    return { Audio: TTS_MERGED_CACHE.get(mergedKey), SessionId: 'cache', Cached: true };
  }

  const segments = splitDialogue(raw);

  // —— 单说话人 ——
  if (!segments) {
    const voiceType = Number(body.voiceType || TTS_VOICE_DEFAULT);
    const audio = await synthSegment(voiceType, speed, raw);
    return {
      Audio: audio, SessionId: 'single', Dialogue: false,
      Segments: [{ speaker: 'Narrator', voiceType: voiceType }],
    };
  }

  // —— 多说话人：按说话人分配男女声；无法判断性别时交替分配 ——
  const plan = [];
  const audios = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    let v = speakerVoice(seg.speaker);
    if (v == null) v = (i % 2 === 0) ? TTS_VOICE_FEMALE : TTS_VOICE_MALE;
    plan.push({ speaker: seg.speaker, voiceType: v });
    audios.push(await synthSegment(v, speed, seg.text));
  }

  const merged = mergeWavs(audios, TTS_TURN_GAP_MS, 16000);
  cachePut(TTS_MERGED_CACHE, mergedKey, merged, TTS_MERGED_MAX);
  return { Audio: merged, SessionId: 'merged', Dialogue: true, Segments: plan };
}

/* === 极简 HTTP 服务（含 CORS） === */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => {
      chunks += c;
      if (chunks.length > 12 * 1024 * 1024) reject(new Error('请求体过大（上限 12MB）'));
    });
    req.on('end', () => {
      try { resolve(chunks ? JSON.parse(chunks) : {}); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function resolveAction(method, url) {
  if (/(^|\/)health$/.test(url)) return 'health';
  if (/(^|\/)asr$/.test(url)) return 'asr';
  if (/(^|\/)soe$/.test(url)) return 'soe';
  if (/(^|\/)tts$/.test(url)) return 'tts';
  return '';
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const url = parsedUrl.pathname;
  const qAction = parsedUrl.searchParams.get('action');
  const action = qAction || resolveAction(req.method, url);

  try {
    if (action === 'health' || req.method === 'GET' && url === '/api/health') {
      return send(res, 200, {
        ok: true, configured: CONFIGURED, region: REGION, mock: !CONFIGURED,
        ttsVoiceFemale: TTS_VOICE_FEMALE, ttsVoiceMale: TTS_VOICE_MALE,
      });
    }

    if (!['asr', 'soe', 'tts'].includes(action)) {
      return send(res, 404, { ok: false, error: '接口不存在。可用：/api/asr、/api/soe、/api/tts、/api/health' });
    }

    const body = await readBody(req);

    if (action === 'tts') {
      const data = await handleTts(body);
      return send(res, 200, { ok: true, data });
    }

    if (!body.audioBase64) return send(res, 400, { ok: false, error: '缺少 audioBase64' });

    if (action === 'asr') return send(res, 200, { ok: true, data: await handleAsr(body) });
    if (action === 'soe') return send(res, 200, { ok: true, data: await handleSoe(body) });

    return send(res, 404, { ok: false, error: '未知 action' });
  } catch (err) {
    return send(res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, () => {
  console.log('──────────────────────────────────────────────');
  console.log(' 口语测评签名服务已启动（ASR / SOE / TTS）');
  console.log(` 地址:   http://localhost:${PORT}`);
  console.log(` 密钥:   ${CONFIGURED ? '已配置（真实调用腾讯云）' : '未配置（演示模式）'}`);
  console.log(` 地域:   ${REGION}   女声: ${TTS_VOICE_FEMALE}   男声: ${TTS_VOICE_MALE}`);
  console.log('──────────────────────────────────────────────');
});