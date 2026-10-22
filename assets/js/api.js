/**
 * ============================================================================
 *  api.js —— 与本地签名服务通信（零依赖）
 * ----------------------------------------------------------------------------
 *  前端永不持有腾讯云密钥，所有识别/评测请求都发往本地签名服务，
 *  由服务端完成 TC3-HMAC-SHA256 签名后转发腾讯云。
 *
 *  依赖后端接口：
 *    GET  /api/health
 *    POST /api/asr   { audioBase64, format }
 *    POST /api/soe   { audioBase64, refText, evalMode, workMode, scoreCoeff }
 * ========================================================================== */
'use strict';

const SpeechAPI = (function () {
  const BASE = CORE.API_BASE;

  async function post(path, payload) {
    let res;
    try {
      res = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new Error('无法连接签名服务，请确认已运行 node server/sign.js（地址：' + BASE + '）');
    }
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('签名服务返回了非 JSON 响应'); }
    if (!res.ok || !data.ok) throw new Error(data.error || ('服务错误 ' + res.status));
    return data.data;
  }

  /** 健康检查：返回 { configured, mock } */
  async function health() {
    try {
      const res = await fetch(BASE + '/api/health');
      if (!res.ok) throw new Error('bad');
      return await res.json();
    } catch (e) {
      return { ok: false, configured: false, mock: true, offline: true };
    }
  }

  /** 一句话识别 → { Result, AudioDuration, Mock? } */
  async function asr(audioBase64, format) {
    return post('/api/asr', { audioBase64, format: format || 'wav', engine: '16k_en' });
  }

  /** 智聆口语评测 → { PronAccuracy, PronFluency, PronCompletion, SuggestedScore, ... } */
  async function soe(audioBase64, refText, opts) {
    opts = opts || {};
    return post('/api/soe', {
      audioBase64,
      refText: refText || '',
      evalMode: opts.evalMode != null ? opts.evalMode : 1,
      workMode: opts.workMode != null ? opts.workMode : 0,
      scoreCoeff: opts.scoreCoeff != null ? opts.scoreCoeff : 2.0,
      voiceFileType: 2,
      sessionId: opts.sessionId,
    });
  }

  return { BASE, health, asr, soe };
})();

window.SpeechAPI = SpeechAPI;