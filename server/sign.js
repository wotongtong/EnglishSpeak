/**
 * ============================================================================
 *  腾讯云 语音识别(ASR) / 智聆口语评测(SOE) 签名代理服务
 * ----------------------------------------------------------------------------
 *  · 纯 Node.js 实现，零第三方依赖（使用内置 http / crypto / fetch）
 *  · 密钥从 server/.env 或系统环境变量读取，绝不返回给前端
 *  · 前端只调用本服务，由本服务完成 TC3-HMAC-SHA256 签名后转发腾讯云
 *
 *  接口：
 *    GET  /api/health          健康检查，返回是否已配置密钥
 *    POST /api/asr             一句话识别（Speech To Text）
 *    POST /api/soe             智聆口语评测（发音/流利度/完整度打分）
 *
 *  启动：node server/sign.js   （或 npm start，端口默认 8787）
 * ============================================================================
 */
'use strict';

const http = require('http');
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
const APP_ID = process.env.TENCENT_APP_ID || '';
const REGION = process.env.TENCENT_REGION || 'ap-guangzhou';
const PORT = parseInt(process.env.PORT || '8787', 10);
const CONFIGURED = Boolean(SECRET_ID && SECRET_KEY);

/* === TC3-HMAC-SHA256 签名 === */
function sha256hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
function hmac256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

function buildAuthorization({ service, host, payload, timestamp }) {
  const algorithm = 'TC3-HMAC-SHA256';
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedPayload = sha256hex(payload);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');
  const stringToSign = [
    algorithm,
    timestamp,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join('\n');
  const secretDate = hmac256('TC3' + SECRET_KEY, date);
  const secretService = hmac256(secretDate, service);
  const secretSigning = hmac256(secretService, 'tc3_request');
  const signature = crypto
    .createHmac('sha256', secretSigning)
    .update(stringToSign, 'utf8')
    .digest('hex');
  return `${algorithm} Credential=${SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/* === 调用腾讯云 API === */
async function callTencent({ service, action, version, params }) {
  const host = `${service}.tencentcloudapi.com`;
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify(params);
  const authorization = buildAuthorization({ service, host, payload, timestamp });
  const res = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': REGION,
      Authorization: authorization,
    },
    body: payload,
  });
  const data = await res.json();
  const resp = data && data.Response;
  if (resp && resp.Error) {
    throw new Error(`${resp.Error.Code}: ${resp.Error.Message} (RequestId=${resp.RequestId || 'n/a'})`);
  }
  return resp;
}

/* === 演示模式：未配置密钥时返回可用的模拟结果，保证前端流程可跑通 === */
function mockAsr(body) {
  const len = (body.audioBase64 || '').length;
  return {
    Mock: true,
    Result: '',
    AudioDuration: Math.round(len / 4000), // 粗略估算秒数
  };
}
function mockSoe(body) {
  // 依据音频体积生成"看似合理"的确定性分数，便于无密钥时演示报告页
  const seed = (body.audioBase64 || '').length % 1000;
  const base = 55 + (seed % 35); // 55 ~ 89
  return {
    Mock: true,
    PronAccuracy: Math.min(98, base + 8),
    PronFluency: Math.min(98, base + 3),
    PronCompletion: Math.min(100, base + 15),
    SuggestedScore: Math.min(98, base + 5),
    Words: [],
  };
}

/* === 业务处理 === */
async function handleAsr(body) {
  if (!CONFIGURED) return mockAsr(body);
  const params = {
    ProjectId: APP_ID ? Number(APP_ID) : 0,
    SubServiceType: 2,                                  // 2 = 一句话识别
    EngSerViceType: body.engine || '16k_en',            // 英文引擎
    SourceType: 1,                                      // 1 = 语音数据（base64）
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
    RefText: body.refText || '',
    WorkMode: body.workMode != null ? body.workMode : 0,     // 0 朗读模式
    EvalMode: body.evalMode != null ? body.evalMode : 1,     // 1 句子 / 2 段落 / 3 自由说
    ScoreCoeff: body.scoreCoeff != null ? body.scoreCoeff : 2.0,
    VoiceFileType: body.voiceFileType != null ? body.voiceFileType : 2, // 2 = wav
    VoiceEncodeType: 1,                                      // 1 = pcm
    SeqId: 1,
    IsEnd: 1,                                                // 一次性传完整段音频
    UserVoiceData: body.audioBase64,
    TextMode: 0,
  };
  if (APP_ID) params.SoeAppId = String(APP_ID);
  const resp = await callTencent({
    service: 'soe',
    action: 'TransmitOralProcessWithInit',
    version: '2018-07-17',
    params,
  });
  resp.SessionId = sessionId;
  return resp;
}

/* === 极简 HTTP 服务（含 CORS） === */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => {
      chunks += c;
      if (chunks.length > 8 * 1024 * 1024) reject(new Error('请求体过大（上限 8MB）'));
    });
    req.on('end', () => {
      try {
        resolve(chunks ? JSON.parse(chunks) : {});
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'));
      }
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    });
    return res.end();
  }

  const url = (req.url || '').split('?')[0];

  try {
    if (req.method === 'GET' && url === '/api/health') {
      return send(res, 200, { ok: true, configured: CONFIGURED, region: REGION, mock: !CONFIGURED });
    }
    if (req.method === 'POST' && url === '/api/asr') {
      const body = await readBody(req);
      if (!body.audioBase64) return send(res, 400, { ok: false, error: '缺少 audioBase64' });
      const result = await handleAsr(body);
      return send(res, 200, { ok: true, data: result });
    }
    if (req.method === 'POST' && url === '/api/soe') {
      const body = await readBody(req);
      if (!body.audioBase64) return send(res, 400, { ok: false, error: '缺少 audioBase64' });
      const result = await handleSoe(body);
      return send(res, 200, { ok: true, data: result });
    }
    return send(res, 404, { ok: false, error: '接口不存在' });
  } catch (err) {
    return send(res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, () => {
  console.log('──────────────────────────────────────────────');
  console.log(' 口语测评签名代理服务已启动');
  console.log(` 地址:   http://localhost:${PORT}`);
  console.log(` 密钥:   ${CONFIGURED ? '已配置（真实调用腾讯云）' : '未配置（当前为演示模式，返回模拟分数）'}`);
  console.log(` 地域:   ${REGION}`);
  console.log('──────────────────────────────────────────────');
});