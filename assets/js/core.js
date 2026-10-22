/**
 * ============================================================================
 *  core.js —— 共享工具层（零依赖）
 * ----------------------------------------------------------------------------
 *  · API 地址解析（本地签名服务）
 *  · 题库 JSON 加载与缓存
 *  · 测评会话数据读写（localStorage）
 *  · 浏览器语音合成（用于听力题朗读）
 *  · 轻量 SVG 图标集
 * ========================================================================== */
'use strict';

const CORE = (function () {
  /* API 地址：优先 window.SPEAKTEST_API_BASE，其次 localStorage，默认本地 8787 */
  const API_BASE =
    (typeof window !== 'undefined' && window.SPEAKTEST_API_BASE) ||
    localStorage.getItem('speaktest.apiBase') ||
    'http://localhost:8787';

  const cache = {};

  async function loadJSON(path) {
    if (cache[path]) return cache[path];
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`加载失败：${path} (${res.status})`);
    const data = await res.json();
    cache[path] = data;
    return data;
  }

  async function loadBank() {
    const [rubric, speaking, listening] = await Promise.all([
      loadJSON('assets/data/rubric.json'),
      loadJSON('assets/data/speaking.json'),
      loadJSON('assets/data/listening.json'),
    ]);
    return { rubric, speaking, listening };
  }

  /* —— 会话存储 —— */
  const SESSION_KEY = 'speaktest.session';

  function saveSession(session) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* 忽略配额错误 */ }
  }
  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

  /* —— 浏览器语音合成（听力题朗读）—— */
  let preferredVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    if (preferredVoice) return preferredVoice;
    const voices = window.speechSynthesis.getVoices();
    preferredVoice =
      voices.find((v) => /en-(US|GB)/i.test(v.lang) && /female|Samantha|Zira|Google|Natural/i.test(v.name)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      null;
    return preferredVoice;
  }

  function stopSpeak() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  /**
   * 朗读文本
   * @param {string} text
   * @param {object} opt { rate, repeat, onStart, onEnd, onBoundary }
   */
  function speak(text, opt) {
    opt = opt || {};
    if (!('speechSynthesis' in window)) {
      if (opt.onEnd) opt.onEnd();
      return null;
    }
    stopSpeak();
    const repeat = opt.repeat || 1;
    const rate = opt.rate || 0.92;
    let count = 0;

    function utter() {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = rate;
      u.pitch = 1;
      const v = pickVoice();
      if (v) u.voice = v;
      u.onstart = () => { if (opt.onStart) opt.onStart(); };
      u.onboundary = (e) => { if (opt.onBoundary) opt.onBoundary(e); };
      u.onend = () => {
        count += 1;
        if (count < repeat) {
          setTimeout(utter, 650);
        } else if (opt.onEnd) {
          opt.onEnd();
        }
      };
      window.speechSynthesis.speak(u);
    }
    // 部分浏览器首次 getVoices 为空，延迟触发
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => { pickVoice(); };
    }
    utter();
    return true;
  }

  /* —— 通用 DOM —— */
  function el(tag, cls, html) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function round1(n) { return Math.round(n * 10) / 10; }

  /* —— 轻量图标（线性 SVG，stroke 统一 1.7）—— */
  const ICONS = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10a7 7 0 0 1-14 0"/><path d="M12 17v4"/><path d="M8 21h8"/>',
    play: '<path d="M6 4l14 8-14 8V4z"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    ear: '<path d="M6 8a6 6 0 1 1 9 5c-1.5 1-2 2-2 4a2 2 0 1 1-4 0"/><path d="M6 12a6 6 0 0 0 .5 3"/>',
    chart: '<path d="M4 20V6"/><path d="M4 20h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-3"/>',
    spark: '<path d="M12 3v6l4-2"/><path d="M12 3v18"/><path d="M5 10l7-3 7 3"/><circle cx="12" cy="12" r="1"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    arrow: '<path d="M5 12h14"/><path d="M13 5l7 7-7 7"/>',
    reload: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>'
  };
  function icon(name, size) {
    const s = size || 20;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  return { API_BASE, loadJSON, loadBank, saveSession, loadSession, clearSession, speak, stopSpeak, el, escapeHTML, clamp, round1, icon };
})();

window.CORE = CORE;