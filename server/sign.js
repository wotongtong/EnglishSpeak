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
const TTS_VOICE = parseInt(process.env.TTS_VOICE_TYPE || '101001', 10);
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

/* === 语音合成（带进程内缓存） === */
const TTS_CACHE = new Map();
const TTS_CACHE_MAX = 30;

async function handleTts(body) {
  const text = String(body.text || '').trim();
  if (!text) throw new Error('缺少 text');
  if (text.length > 500) throw new Error('文本过长（英文上限 500 字符）');
  if (!CONFIGURED) return mockTts();

  const voiceType = Number(body.voiceType || TTS_VOICE);
  const speed = body.speed != null ? Number(body.speed) : 0;
  const cacheKey = `${voiceType}|${speed}|${text}`;

  if (TTS_CACHE.has(cacheKey)) {
    return { Audio: TTS_CACHE.get(cacheKey), SessionId: 'cache', Cached: true };
  }

  const params = {
    Text: text,
    SessionId: body.sessionId || `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ModelType: 1,
    VoiceType: voiceType,
    PrimaryLanguage: 2,
    SampleRate: 16000,
    Codec: 'wav',
    Speed: speed,
    Volume: body.volume != null ? Number(body.volume) : 0,
    ProjectId: body.projectId ? Number(body.projectId) : 0,
  };

  const resp = await callTencent({ service: 'tts', action: 'TextToVoice', version: '2019-08-23', params });
  if (resp && resp.Audio) {
    if (TTS_CACHE.size >= TTS_CACHE_MAX) {
      const firstKey = TTS_CACHE.keys().next().value;
      TTS_CACHE.delete(firstKey);
    }
    TTS_CACHE.set(cacheKey, resp.Audio);
  }
  return resp;
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
        ok: true, configured: CONFIGURED, region: REGION, mock: !CONFIGURED, ttsVoice: TTS_VOICE,
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
  console.log(` 地域:   ${REGION}   音色: ${TTS_VOICE}`);
  console.log('──────────────────────────────────────────────');
});