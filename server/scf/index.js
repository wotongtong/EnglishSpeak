/**
 * ============================================================================
 *  腾讯云云函数 SCF 版 —— 语音识别(ASR) / 智聆口语评测(SOE) / 语音合成(TTS)
 * ----------------------------------------------------------------------------
 *  入口：index.main_handler
 *  运行时：Node.js 16 / 18 均可（仅使用内置模块，不依赖第三方包）
 *  密钥：全部从「函数配置 → 环境变量」读取，绝不硬编码在代码里
 *
 *  调用方式（函数 URL）：
 *    GET  /?action=health
 *    POST /?action=asr     { audioBase64, format, engine }
 *    POST /?action=soe     { audioBase64, refText, evalMode, workMode, scoreCoeff }
 *    POST /?action=tts     { text, voiceType?, speed? }        → 返回 base64 音频
 *  也支持 /api/asr、/api/soe、/api/tts、/api/health 路径写法。
 *
 *  环境变量：
 *    TENCENT_SECRET_ID   子账号 SecretId（必填）
 *    TENCENT_SECRET_KEY  子账号 SecretKey（必填）
 *    TENCENT_APP_ID      账号 AppId（可空）
 *    TENCENT_REGION      地域，默认 ap-guangzhou
 *    TTS_VOICE_TYPE      英文音色 ID，默认 101001（英文女声）
 * ============================================================================
 */
'use strict';

const crypto = require('crypto');
const https = require('https');

/* === 配置（从环境变量读取） === */
const SECRET_ID = process.env.TENCENT_SECRET_ID || '';
const SECRET_KEY = process.env.TENCENT_SECRET_KEY || '';
const APP_ID = process.env.TENCENT_APP_ID || '';
const REGION = process.env.TENCENT_REGION || 'ap-guangzhou';
const TTS_VOICE = parseInt(process.env.TTS_VOICE_TYPE || '101001', 10);
const CONFIGURED = Boolean(SECRET_ID && SECRET_KEY);

const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

/* === 统一响应（API 网关 / 函数 URL 集成响应格式） === */
function reply(statusCode, obj) {
  return {
    isBase64Encoded: false,
    statusCode: statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(obj),
  };
}

/* ======================== TC3-HMAC-SHA256 签名 ======================== */
function sha256hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
function hmac256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}
function buildAuthorization(service, host, payload, timestamp) {
  const algorithm = 'TC3-HMAC-SHA256';
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const credentialScope = date + '/' + service + '/tc3_request';
  const hashedPayload = sha256hex(payload);
  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + host + '\n';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');
  const stringToSign = [algorithm, timestamp, credentialScope, sha256hex(canonicalRequest)].join('\n');
  const secretDate = hmac256('TC3' + SECRET_KEY, date);
  const secretService = hmac256(secretDate, service);
  const secretSigning = hmac256(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');
  return algorithm + ' Credential=' + SECRET_ID + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
}

/* ======================== HTTPS 请求（内置模块，兼容 Node 12+） ======================== */
function httpsPost(host, headers, bodyStr, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = https.request(
      { host: host, path: '/', method: 'POST', headers: headers, timeout: timeoutMs || 12000 },
      function (res) {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { data += c; });
        res.on('end', function () { resolve(data); });
      }
    );
    req.on('timeout', function () { req.destroy(new Error('调用腾讯云超时（' + (timeoutMs || 12000) + 'ms）')); });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function callTencent(service, action, version, params) {
  const host = service + '.tencentcloudapi.com';
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
  try { data = JSON.parse(raw); } catch (e) { throw new Error('腾讯云返回非 JSON：' + raw.slice(0, 200)); }
  const resp = data && data.Response;
  if (resp && resp.Error) {
    throw new Error(resp.Error.Code + ': ' + resp.Error.Message + ' (RequestId=' + (resp.RequestId || 'n/a') + ')');
  }
  return resp;
}

/* ======================== 演示模式（未配置密钥时返回模拟数据） ======================== */
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

/* ======================== 业务处理 ======================== */
async function handleAsr(body) {
  if (!CONFIGURED) return mockAsr();
  const params = {
    ProjectId: body.projectId ? Number(body.projectId) : 0,  // 「项目 ID」，不是账号 AppId
    SubServiceType: 2,                        // 2 = 一句话识别
    EngSerViceType: body.engine || '16k_en',  // 英文引擎
    SourceType: 1,                            // 1 = 语音数据（base64）
    VoiceFormat: body.format || 'wav',
    Data: body.audioBase64,
    DataLen: (body.audioBase64 || '').length,
    FilterDirty: 1,
    FilterModal: 1,
    FilterPunc: 0,
  };
  return callTencent('asr', 'SentenceRecognition', '2019-06-14', params);
}

async function handleSoe(body) {
  if (!CONFIGURED) return mockSoe(body);
  const sessionId = body.sessionId || (Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  const params = {
    SessionId: sessionId,
    // RefText 为必传参数；自由说（EvalMode=3）时传空串
    RefText: body.refText != null ? String(body.refText) : '',
    WorkMode: body.workMode != null ? body.workMode : 0,   // 0 流式分片 / 1 非流式一次性
    EvalMode: body.evalMode != null ? body.evalMode : 1,   // 0 单词 1 句子 2 段落 3 自由说
    ScoreCoeff: body.scoreCoeff != null ? body.scoreCoeff : 2.0,
    ServerType: body.serverType != null ? body.serverType : 0, // 0 英文 1 中文
    VoiceFileType: body.voiceFileType != null ? body.voiceFileType : 2, // 1 raw 2 wav 3 mp3
    VoiceEncodeType: 1,                                    // 1 = pcm
    SeqId: 1,
    IsEnd: 1,
    UserVoiceData: body.audioBase64,
    TextMode: 0,
  };
  // ⚠️ SoeAppId 是「业务应用 ID」（soe_100xxxxx），不是账号 AppId，未新建时勿传
  if (body.soeAppId) params.SoeAppId = String(body.soeAppId);

  // ⚠️ 版本必须是 2018-07-24（写成 2018-07-17 会返回 InvalidAction）
  const resp = await callTencent('soe', 'TransmitOralProcessWithInit', '2018-07-24', params);
  resp.SessionId = sessionId;
  return resp;
}

/* --- 语音合成：带进程内缓存的 TextToVoice --- */
const TTS_CACHE = new Map();
const TTS_CACHE_MAX = 30;

async function handleTts(body) {
  const text = String(body.text || '').trim();
  if (!text) throw new Error('缺少 text');
  if (text.length > 500) throw new Error('文本过长（英文上限 500 字符）');
  if (!CONFIGURED) return mockTts();

  const voiceType = Number(body.voiceType || TTS_VOICE);
  const speed = body.speed != null ? Number(body.speed) : 0;   // -2~6，0 为正常语速
  const cacheKey = voiceType + '|' + speed + '|' + text;

  if (TTS_CACHE.has(cacheKey)) {
    return { Audio: TTS_CACHE.get(cacheKey), SessionId: 'cache', Cached: true };
  }

  const params = {
    Text: text,
    SessionId: body.sessionId || ('tts-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
    ModelType: 1,
    VoiceType: voiceType,
    PrimaryLanguage: 2,          // 2 = 英文
    SampleRate: 16000,           // 与识别/评测保持一致
    Codec: 'wav',
    Speed: speed,
    Volume: body.volume != null ? Number(body.volume) : 0,
    ProjectId: body.projectId ? Number(body.projectId) : 0,
  };

  const resp = await callTencent('tts', 'TextToVoice', '2019-08-23', params);
  if (resp && resp.Audio) {
    if (TTS_CACHE.size >= TTS_CACHE_MAX) {
      const firstKey = TTS_CACHE.keys().next().value;
      TTS_CACHE.delete(firstKey);
    }
    TTS_CACHE.set(cacheKey, resp.Audio);
  }
  return resp;
}

/* ======================== 健康检查 ======================== */
function healthInfo() {
  return {
    ok: true,
    configured: CONFIGURED,
    region: REGION,
    mock: !CONFIGURED,
    runtime: process.env.TENCENTCLOUD_RUNTIME_VERSION || 'scf',
    ttsVoice: TTS_VOICE,
  };
}

/* ======================== 事件解析与路由 ======================== */
function parseEvent(event) {
  const httpMethod = (event.httpMethod || (event.requestContext && event.requestContext.httpMethod) || '').toUpperCase();
  const path = String(event.path || event.rawPath || (event.requestContext && event.requestContext.path) || '');

  let body = {};
  if (event.body != null) {
    let raw = event.body;
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    try { body = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { body = {}; }
  } else if (event.action) {
    body = event; // 直接调用：event 即业务参数
  }

  let query = event.queryString || event.queryStringParameters || {};
  if (typeof query === 'string' || typeof query !== 'object') query = {};

  return { httpMethod: httpMethod, path: path, body: body, query: query };
}

function pickAction(httpMethod, path, body, query) {
  if (/(^|\/)health$/.test(path)) return 'health';
  if (/(^|\/)asr$/.test(path)) return 'asr';
  if (/(^|\/)soe$/.test(path)) return 'soe';
  if (/(^|\/)tts$/.test(path)) return 'tts';

  const q = query && (query.action || query.type);          // 单路径模式：/api?action=asr
  if (q === 'asr' || q === 'soe' || q === 'health' || q === 'tts') return q;

  if (body && ['asr', 'soe', 'health', 'tts'].indexOf(body.action) >= 0) return body.action;
  if (body && body.audioBase64 && body.refText !== undefined) return 'soe';
  if (body && body.audioBase64) return 'asr';
  if (body && body.text && !body.audioBase64) return 'tts';
  return '';
}

exports.main_handler = async function (event, context) {
  event = event || {};
  const parsed = parseEvent(event);
  const httpMethod = parsed.httpMethod;
  const body = parsed.body;

  // CORS 预检
  if (httpMethod === 'OPTIONS') return reply(204, {});

  const action = pickAction(httpMethod, parsed.path, body, parsed.query);
  if (!action) {
    // 没有 httpMethod → 不是 HTTP 调用，多为控制台「测试」传入的裸事件：
    // 返回健康信息与收到的字段，便于自检，而不是直接报 404。
    if (!httpMethod) {
      const info = healthInfo();
      info.hint = '函数运行正常。请通过函数 URL 调用：GET /?action=health、POST /?action=asr、' +
        'POST /?action=soe、POST /?action=tts；或在控制台测试时传入 {"httpMethod":"GET","path":"/api/health"}。';
      info.receivedKeys = Object.keys(event);
      return reply(200, info);
    }
    return reply(404, {
      ok: false,
      error: '接口不存在。请使用 POST /?action=asr、POST /?action=soe、POST /?action=tts 或 GET /?action=health。',
      debug: {
        httpMethod: httpMethod,
        path: parsed.path,
        queryKeys: Object.keys(parsed.query || {}),
        bodyKeys: Object.keys(body || {}),
      },
    });
  }

  try {
    if (action === 'health') return reply(200, healthInfo());

    if (action === 'tts') {
      const data = await handleTts(body || {});
      return reply(200, { ok: true, data: data });
    }

    if (!body || !body.audioBase64) return reply(400, { ok: false, error: '缺少 audioBase64' });

    if (action === 'asr') {
      const data = await handleAsr(body);
      return reply(200, { ok: true, data: data });
    }
    if (action === 'soe') {
      const data = await handleSoe(body);
      return reply(200, { ok: true, data: data });
    }
    return reply(404, { ok: false, error: '未知 action' });
  } catch (err) {
    return reply(500, { ok: false, error: String(err && err.message ? err.message : err) });
  }
};

// 兼容部分调用方式
exports.main = exports.main_handler;