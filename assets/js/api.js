/**
 * ============================================================================
 *  api.js —— 与签名服务通信（零依赖）
 * ----------------------------------------------------------------------------
 *  前端永不持有腾讯云密钥，所有识别/评测请求都发往服务端，由服务端完成
 *  TC3-HMAC-SHA256 签名后转发腾讯云。
 *
 *  支持三种服务端形态，自动匹配调用风格：
 *    1) 腾讯云「函数 URL」  https://xxx.ap-guangzhou.tencentscf.com
 *         → 走 ?action=asr / ?action=soe / ?action=health
 *    2) 本地/自建服务器     http://localhost:8787
 *         → 走 /api/asr 等路径
 *    3) 已显式指定路径      .../api 或 .../api/asr
 *         → 按原有路径拼接
 * ========================================================================== */
'use strict';

const SpeechAPI = (function () {
  const RAW = String(CORE.API_BASE || '').replace(/\/+$/, '');

  /**
   * 依据 BASE 形态推断接口地址。
   * @param {'asr'|'soe'|'health'} action
   */
  function endpoint(action) {
    if (/\/(asr|soe|health)$/i.test(RAW)) return RAW;                 // 已指定到具体接口
    if (/\/api$/i.test(RAW)) return RAW + '/' + action;               // 基础路径为 /api
    if (/tencentscf\.com/i.test(RAW)) return RAW + '/?action=' + action; // 腾讯云函数 URL
    return RAW + '/api/' + action;                                    // 本地服务器默认
  }

  async function request(action, options) {
    const url = endpoint(action);
    let res;
    try {
      res = await fetch(url, options);
    } catch (e) {
      throw new Error('无法连接识别服务（' + url + '）。请确认服务已部署，或在控制台执行 localStorage.setItem("speaktest.apiBase","你的地址") 后刷新。');
    }
    let data;
    try { data = await res.json(); } catch (e) { throw new Error('识别服务返回了非 JSON 响应（' + res.status + '）'); }
    if (!res.ok || !data.ok) throw new Error(data.error || ('服务错误 ' + res.status));
    return data.data;
  }

  /** 健康检查：返回 { configured, mock, offline? } */
  async function health() {
    try {
      const res = await fetch(endpoint('health'));
      if (!res.ok) throw new Error('bad');
      return await res.json();
    } catch (e) {
      return { ok: false, configured: false, mock: true, offline: true };
    }
  }

  /** 一句话识别 → { Result, AudioDuration, Mock? } */
  async function asr(audioBase64, format) {
    return request('asr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64, format: format || 'wav', engine: '16k_en' }),
    });
  }

  /** 智聆口语评测 → { PronAccuracy, PronFluency, PronCompletion, SuggestedScore, ... } */
  async function soe(audioBase64, refText, opts) {
    opts = opts || {};
    return request('soe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64,
        refText: refText || '',
        evalMode: opts.evalMode != null ? opts.evalMode : 1,
        workMode: opts.workMode != null ? opts.workMode : 0,
        scoreCoeff: opts.scoreCoeff != null ? opts.scoreCoeff : 2.0,
        voiceFileType: 2,
        sessionId: opts.sessionId,
      }),
    });
  }

  /** 语音合成（腾讯云 TTS）→ { Audio: base64, SessionId, Cached? } */
  async function tts(text, opts) {
    opts = opts || {};
    return request('tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        voiceType: opts.voiceType,
        speed: opts.speed != null ? opts.speed : 0,
      }),
    });
  }

  return { BASE: RAW, newEndpoint: endpoint, health, asr, soe, tts };
})();

window.SpeechAPI = SpeechAPI;