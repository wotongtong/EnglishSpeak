/**
 * ============================================================================
 *  test.js —— 测评主流程编排（零依赖）
 * ----------------------------------------------------------------------------
 *  流程：加载题库 → 组装题目队列(快速/完整) → 分节作答 → 汇总评分 → 存会话 → 跳报告
 *  题型：听力(短对话/长对话/听写) 、口语(朗读/话题/情景/复述)
 *
 *  增强点：
 *   · 题干随界面语言切换（中/英），听力答毕自动揭示原文
 *   · 识别服务不可用时自动降级为离线估分，测评不中断，并提供"重试"
 *   · 录音支持回放、建议时长倒计时与超时自动停止、跳过本题
 *   · 进度自动保存（localStorage），误刷新可恢复
 *   · 键盘快捷键：1-4 / A-D 选择选项，← → 切换题目
 *   · 离开页面前二次确认
 * ========================================================================== */
'use strict';

const Test = (function () {
  const PROGRESS_KEY = 'speaktest.progress';
  const T = (k) => I18N.t(k);
  const tmp = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
  const param = (k, d) => new URLSearchParams(location.search).get(k) || d;
  const zh = () => I18N.current() === 'zh';

  const state = {
    bank: null, mode: 'quick', queue: [], idx: 0, records: [],
    startedAt: Date.now(), finished: false, restored: false,
    apiStatus: { configured: false }, usingOffline: false,
  };

  let els = {};

  /* ============================ 初始化 ============================ */
  async function boot() {
    els = {
      progress: document.getElementById('progressBar'),
      counter: document.getElementById('counter'),
      modeLabel: document.getElementById('modeLabel'),
      statusLabel: document.getElementById('apiStatus'),
      stage: document.getElementById('stage'),
      btnPrev: document.getElementById('btnPrev'),
      btnNext: document.getElementById('btnNext'),
    };

    // 通知条容器（插入到 stage 之前）
    els.noticeBar = document.createElement('div');
    els.noticeBar.id = 'noticeBar';
    els.stage.parentNode.insertBefore(els.noticeBar, els.stage);

    state.mode = param('mode', 'quick') === 'full' ? 'full' : 'quick';

    try {
      state.bank = await CORE.loadBank();
    } catch (e) {
      els.stage.innerHTML = `<div class="notice notice--error">${zh() ? '题库加载失败' : 'Failed to load question bank'}：${CORE.escapeHTML(e.message)}<br>
        <small>${zh() ? '请通过本地服务器打开（例如 python -m http.server 8080），不要直接双击 HTML 文件。' : 'Serve the folder over HTTP (e.g. python -m http.server 8080) instead of opening the file directly.'}</small></div>`;
      return;
    }

    buildQueue();

    // 后端状态（不阻塞答题）
    SpeechAPI.health().then((h) => {
      state.apiStatus = h;
      if (els.statusLabel) {
        els.statusLabel.textContent = h.configured ? T('status.liveShort') : T('status.mockShort');
        els.statusLabel.className = 'tag' + (h.configured ? ' tag--accent' : '');
        els.statusLabel.title = h.configured ? T('status.live') : T('status.mock');
      }
    });

    bindGlobal();
    restoreProgress();
    render();
  }

  /* ============================ 组卷 ============================ */
  function buildQueue() {
    const { rubric, speaking, listening } = state.bank;
    let listenIds, speakIds;
    if (state.mode === 'quick') {
      listenIds = rubric.quickMode.listenIds;
      speakIds = rubric.quickMode.speakIds;
    } else {
      listenIds = listening.questions.map((q) => q.id);
      speakIds = speaking.questions.map((q) => q.id);
    }

    const q = [];
    q.push({ kind: 'intro', section: 'listening' });
    listenIds.forEach((id) => {
      const item = listening.questions.find((x) => x.id === id);
      if (item) q.push({ kind: 'listening', item });
    });
    q.push({ kind: 'intro', section: 'speaking' });
    speakIds.forEach((id) => {
      const item = speaking.questions.find((x) => x.id === id);
      if (item) q.push({ kind: 'speaking', item });
    });

    state.queue = q;
    state.records = q.map(() => null);
  }

  const totalQuestions = () => state.queue.filter((s) => s.kind !== 'intro').length;
  function questionNumberAt(i) {
    let n = 0;
    for (let k = 0; k <= i; k++) if (state.queue[k] && state.queue[k].kind !== 'intro') n++;
    return n;
  }

  /* ======================== 进度保存 / 恢复 ======================== */
  function persist() {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify({
        mode: state.mode, idx: state.idx, records: state.records, at: Date.now(),
      }));
    } catch (e) { /* 忽略配额 */ }
  }
  function clearProgress() { localStorage.removeItem(PROGRESS_KEY); }

  function restoreProgress() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || saved.mode !== state.mode || !Array.isArray(saved.records)) return;
    const answered = saved.records.filter(Boolean).length;
    if (answered === 0) return;

    state.records = saved.records;
    state.idx = Math.min(saved.idx || 0, state.queue.length - 1);
    state.restored = true;

    els.noticeBar.innerHTML =
      `<div class="notice notice--info" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <span>${T('test.restored')}（${answered} ${T('common.questionUnit')}）</span>
        <button class="btn btn--quiet btn--sm" id="restartTest">${T('nav.restart')}</button>
      </div>`;
    els.noticeBar.querySelector('#restartTest').addEventListener('click', () => {
      state.records = state.queue.map(() => null);
      state.idx = 0;
      els.noticeBar.innerHTML = '';
      clearProgress();
      render();
    });
  }

  /* ============================ 导航 ============================ */
  function updateChrome() {
    const total = totalQuestions();
    const n = Math.max(1, questionNumberAt(state.idx));
    els.counter.textContent = n + ' ' + T('common.of') + ' ' + total;
    const step = state.queue[state.idx];
    const done = state.records.filter(Boolean).length;
    const pct = Math.round((done / total) * 100);
    els.progress.style.width = CORE.clamp(pct, 0, 100) + '%';
    els.modeLabel.textContent = state.mode === 'full' ? T('common.modeFull') : T('common.modeQuick');
    void step;
  }

  function go(delta) {
    const next = state.idx + delta;
    if (next < 0 || next >= state.queue.length) return;
    state.idx = next;
    render();
  }
  function next() {
    if (state.idx >= state.queue.length - 1) return finish();
    go(1);
  }

  /* ============================ 渲染 ============================ */
  function render() {
    const step = state.queue[state.idx];
    els.stage.innerHTML = '';
    updateChrome();
    els.btnPrev.disabled = state.idx === 0;
    els.btnNext.disabled = true;

    if (step.kind === 'intro') return renderIntro(step.section);
    if (step.kind === 'listening') return renderListening(step.item);
    if (step.kind === 'speaking') return renderSpeaking(step.item);
  }

  function renderIntro(section) {
    const isListen = section === 'listening';
    const rubric = state.bank.rubric;
    const modeDesc = zh()
      ? (state.mode === 'full' ? rubric.fullMode.descZh : rubric.quickMode.descZh)
      : (state.mode === 'full' ? rubric.fullMode.descEn : rubric.quickMode.descEn);

    els.btnNext.disabled = true;
    els.btnPrev.disabled = state.idx === 0;

    const panel = tmp(`
      <div class="q-panel reveal">
        <p class="eyebrow">${isListen ? 'LISTENING' : 'SPEAKING'}</p>
        <h2 class="q-prompt">${isListen ? T('test.firstPart') : T('test.secondPart')}</h2>
        <p class="q-sub">${isListen ? T('test.partIntroListen') : T('test.partIntroSpeak')}</p>
        <p class="footer-note" style="margin-bottom:22px">${CORE.escapeHTML(modeDesc)}</p>
        <div class="btn-row">
          <button class="btn btn--primary" id="introGo">
            ${isListen ? T('test.goListen') : T('test.goSpeak')} ${CORE.icon('arrow', 18)}
          </button>
        </div>
      </div>`);
    els.stage.appendChild(panel);
    panel.querySelector('#introGo').addEventListener('click', next);
  }

  /* ======================= 听力题 ======================= */
  function renderListening(item) {
    const saved = state.records[state.idx];
    const isDictation = item.type === 'dictation';
    const questionText = zh() ? (item.questionZh || item.question) : item.question;

    const tags = `
      <div class="q-tags">
        <span class="tag tag--accent">${item.level}</span>
        <span class="tag">${isDictation ? 'DICTATION' : 'LISTENING'}</span>
      </div>`;

    const noTTS = !('speechSynthesis' in window);
    const audioBar = `
      <div class="audio-bar">
        <button class="play-btn" id="playBtn" aria-label="${T('common.replay')}">${CORE.icon('play', 22)}</button>
        <div class="audio-bars" id="audioBars">${'<i></i>'.repeat(24)}</div>
        <span class="audio-bar__hint" id="audioHint">${noTTS ? T('test.noTTS') : T('common.audioHint')}</span>
        <button class="btn btn--quiet btn--sm audio-bar__replay" id="replayBtn">${T('common.replay')}</button>
      </div>
      ${noTTS ? '' : ''}
      <div class="btn-row" style="margin-bottom:22px">
        <button class="btn btn--quiet btn--sm" id="transcriptBtn">${T('common.showTranscript')}</button>
      </div>
      <div id="transcriptBox"></div>`;

    let body = '';
    if (isDictation) {
      const full = item.fullText || item.script;
      const blanked = full.replace(/\b([A-Za-z']+)\b/g, (m) =>
        item.blanks.some((b) => b.toLowerCase() === m.toLowerCase())
          ? '<input class="blank-input" type="text" aria-label="blank" autocomplete="off" autocapitalize="off" spellcheck="false" />'
          : m);
      body = `
        <p class="q-sub">${questionText}</p>
        <div class="dictation-line">${blanked}</div>
        <div class="btn-row">
          <button class="btn btn--primary" id="checkDict">${T('common.submitAnswer')}</button>
          <button class="btn btn--quiet" id="skipQ">${T('test.skipQ')}</button>
        </div>
        <div id="dictFeedback"></div>`;
    } else {
      const keys = ['A', 'B', 'C', 'D', 'E'];
      const opts = item.options.map((o, i) => `
        <button class="option" data-i="${i}">
          <span class="option__key">${keys[i] || (i + 1)}</span>
          <span>${CORE.escapeHTML(o)}</span>
        </button>`).join('');
      body = `
        <p class="q-sub">${questionText}</p>
        <div class="options" id="options">${opts}</div>
        <div class="btn-row"><button class="btn btn--quiet" id="skipQ">${T('test.skipQ')}</button></div>
        <div id="choiceFeedback"></div>`;
    }

    const panel = tmp(`<div class="q-panel reveal">${tags}${audioBar}${body}</div>`);
    els.stage.appendChild(panel);

    wireAudioBar(panel, item);
    wireTranscript(panel, item, !isDictation);

    // —— 跳过 ——
    panel.querySelector('#skipQ').addEventListener('click', () => {
      record(state.idx, { skipped: true, result: { score: 0, ratio: 0, correct: 0, total: 0, skipped: true } });
      next();
    });

    if (isDictation) {
      const inputs = panel.querySelectorAll('.blank-input');
      if (saved && saved.answer) inputs.forEach((inp, i) => { inp.value = saved.answer[i] || ''; });
      const done = panel.querySelector('#checkDict');
      done.addEventListener('click', () => {
        const given = Array.from(inputs).map((i) => i.value);
        const result = SCORING.evaluateListening(item, given);
        inputs.forEach((inp, i) => {
          inp.dataset.state = String(given[i]).trim().toLowerCase() === item.blanks[i].toLowerCase() ? 'correct' : 'wrong';
          inp.disabled = true;
        });
        done.disabled = true;
        panel.querySelector('#dictFeedback').innerHTML =
          `<div class="notice ${result.ratio === 1 ? 'notice--info' : 'notice--warn'}">
            ${result.ratio === 1 ? T('common.correct') : T('common.wrong')}
            ${item.blanks.join(' / ')} · ${T('common.score')} ${result.score}${T('common.points')}
          </div>`;
        record(state.idx, { answer: given, result });
        revealTranscript(panel);
        els.btnNext.disabled = false;
      });
      if (saved) els.btnNext.disabled = false;
    } else {
      const optWrap = panel.querySelector('#options');
      const savedIdx = saved ? saved.answer : null;
      optWrap.querySelectorAll('.option').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.i);
          const result = SCORING.evaluateListening(item, i);
          optWrap.querySelectorAll('.option').forEach((b2) => { b2.disabled = true; });
          btn.dataset.state = result.correct ? 'correct' : 'wrong';
          const correctBtn = optWrap.querySelector(`.option[data-i="${item.answer}"]`);
          if (correctBtn) correctBtn.dataset.state = 'correct';
          panel.querySelector('#choiceFeedback').innerHTML =
            `<div class="notice ${result.correct ? 'notice--info' : 'notice--error'}">
              ${result.correct ? T('common.correct') : (T('common.wrong') + CORE.escapeHTML(item.options[item.answer]))}
            </div>`;
          record(state.idx, { answer: i, result });
          revealTranscript(panel);
          els.btnNext.disabled = false;
        });
        if (savedIdx != null) {
          btn.disabled = true;
          if (Number(btn.dataset.i) === item.answer) btn.dataset.state = 'correct';
          else if (Number(btn.dataset.i) === savedIdx) btn.dataset.state = 'wrong';
        }
      });
      if (saved != null) els.btnNext.disabled = false;
    }
  }

  /* 音频播放条（TTS 朗读脚本 + 波形动画） */
  function wireAudioBar(panel, item) {
    const playBtn = panel.querySelector('#playBtn');
    const replayBtn = panel.querySelector('#replayBtn');
    const bars = panel.querySelector('#audioBars');
    const hint = panel.querySelector('#audioHint');
    if (!playBtn) return;
    const script = item.listenScript || item.script || item.fullText || '';

    let animId = null;
    const barsEls = Array.from(bars.children);
    const animate = (on) => {
      bars.classList.toggle('is-playing', on);
      if (animId) { clearInterval(animId); animId = null; }
      if (!on) { barsEls.forEach((b) => { b.style.height = '30%'; }); return; }
      animId = setInterval(() => { barsEls.forEach((b) => { b.style.height = (18 + Math.random() * 78) + '%'; }); }, 110);
    };

    const play = () => {
      if (!('speechSynthesis' in window)) { hint.textContent = T('test.noTTS'); return; }
      playBtn.innerHTML = CORE.icon('pause', 22);
      hint.textContent = T('common.listening');
      CORE.speak(script, {
        repeat: 2, rate: 0.9,
        onStart: () => animate(true),
        onEnd: () => { animate(false); playBtn.innerHTML = CORE.icon('play', 22); hint.textContent = T('test.played'); },
      });
    };
    playBtn.addEventListener('click', play);
    if (replayBtn) replayBtn.addEventListener('click', play);
  }

  /* 原文揭示 */
  function transcriptText(item) {
    return item.transcript || item.listenScript || item.script || item.fullText || '';
  }
  function wireTranscript(panel, item, autoRevealOnAnswer) {
    const btn = panel.querySelector('#transcriptBtn');
    const box = panel.querySelector('#transcriptBox');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const open = box.dataset.open === '1';
      if (open) { box.innerHTML = ''; box.dataset.open = '0'; btn.textContent = T('common.showTranscript'); }
      else {
        box.innerHTML = `<div class="transcript" style="margin-bottom:20px"><b>${T('test.listenTranscript')}</b>${CORE.escapeHTML(transcriptText(item))}</div>`;
        box.dataset.open = '1'; btn.textContent = T('common.hideTranscript');
      }
    });
    panel._revealTranscript = () => { if (box.dataset.open !== '1') btn.click(); };
    void autoRevealOnAnswer;
  }
  function revealTranscript(panel) {
    if (panel && panel._revealTranscript) panel._revealTranscript();
  }

  /* ======================= 口语题 ======================= */
  function renderSpeaking(item) {
    const saved = state.records[state.idx];
    const typeLabel = { read: 'READ ALOUD', topic: 'TOPIC', interaction: 'ROLE-PLAY', retell: 'RETELL' }[item.type] || 'SPEAKING';
    const promptSub = (item.promptZh && zh()) ? item.promptZh : '';

    const listenBlock = (item.type === 'retell' && item.listenScript) ? `
      <div class="audio-bar">
        <button class="play-btn" id="playBtn" aria-label="${T('common.replay')}">${CORE.icon('ear', 22)}</button>
        <div class="audio-bars" id="audioBars">${'<i></i>'.repeat(24)}</div>
        <span class="audio-bar__hint" id="audioHint">${'speechSynthesis' in window ? T('common.audioHint') : T('test.noTTS')}</span>
        <button class="btn btn--quiet btn--sm audio-bar__replay" id="replayBtn">${T('common.replay')}</button>
      </div>
      <div class="btn-row" style="margin-bottom:18px">
        <button class="btn btn--quiet btn--sm" id="transcriptBtn">${T('common.showTranscript')}</button>
      </div>
      <div id="transcriptBox"></div>` : '';

    const panel = tmp(`
      <div class="q-panel reveal">
        <div class="q-tags">
          <span class="tag tag--accent">${item.level}</span>
          <span class="tag">${typeLabel}</span>
          <span class="tag">${T('test.timeHint')} ${item.durationSec}s</span>
        </div>
        ${listenBlock}
        <p class="q-prompt">${CORE.escapeHTML(item.prompt)}</p>
        ${promptSub ? `<p class="q-sub">${CORE.escapeHTML(promptSub)}</p>` : ''}

        <div class="rec-box" id="recBox">
          <div class="rec-visual" id="recVisual">${'<i></i>'.repeat(28)}</div>
          <div class="rec-timer" id="recTimer">0:00</div>
          <div class="rec-hint" id="recHint">${T('test.recordHint')}</div>
          <div class="rec-controls">
            <button class="btn btn--primary" id="btnRec">
              ${CORE.icon('mic', 18)} <span id="btnRecText">${T('test.recordStart')}</span>
            </button>
            <button class="btn btn--ghost" id="btnRedo" style="display:none">${CORE.icon('reload', 16)} <span>${T('test.recordAgain')}</span></button>
            <button class="btn btn--quiet" id="skipQ">${T('test.skipQ')}</button>
          </div>
        </div>
        <div id="recResult"></div>
      </div>`);
    els.stage.appendChild(panel);

    if (item.type === 'retell' && item.listenScript) {
      wireAudioBar(panel, item);
      wireTranscript(panel, item, false);
    }

    const recVisual = panel.querySelector('#recVisual');
    const timer = panel.querySelector('#recTimer');
    const hint = panel.querySelector('#recHint');
    const btnRec = panel.querySelector('#btnRec');
    const btnRecText = panel.querySelector('#btnRecText');
    const btnRedo = panel.querySelector('#btnRedo');
    const btnSkip = panel.querySelector('#skipQ');
    const resultBox = panel.querySelector('#recResult');
    const visBars = Array.from(recVisual.children);

    let recording = false, attempts = 0, warned = false, lastOut = null;
    const cap = Math.min((item.durationSec || 30) + 10, 58);

    const setTimer = (sec) => {
      timer.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
      if (!recording) return;
      if (sec >= (item.durationSec || 30) && !warned) {
        warned = true;
        hint.innerHTML = '<span class="rec-dot"></span>' + T('test.autoStop');
        timer.classList.add('is-rec-warn');
      }
      if (sec >= cap) stopRec();
    };

    async function startRec() {
      if (!Recorder.isSupported()) {
        resultBox.innerHTML = `<div class="notice notice--error">${T('test.micDenied')}</div>`;
        return;
      }
      try {
        hint.textContent = '';
        await Recorder.start({
          onLevel: (v) => {
            const h = Math.round(14 + v * 86);
            recVisual.classList.add('is-rec');
            visBars.forEach((b, i) => {
              const jitter = 0.7 + Math.sin(Date.now() / 180 + i) * 0.3;
              b.style.height = Math.max(8, Math.min(100, h * jitter)) + '%';
            });
          },
          onTime: setTimer,
        });
        recording = true; warned = false;
        timer.classList.add('is-rec'); timer.classList.remove('is-rec-warn');
        recVisual.classList.add('is-rec');
        btnRecText.textContent = T('test.recordStop');
        btnRec.classList.remove('btn--primary'); btnRec.classList.add('btn--danger');
        hint.innerHTML = '<span class="rec-dot"></span>' + T('common.listening');
        resultBox.innerHTML = '';
        els.btnNext.disabled = true;
      } catch (e) {
        hint.textContent = '';
        resultBox.innerHTML = `<div class="notice notice--error">${T('test.micDenied')}<br><small>${CORE.escapeHTML(e.message)}</small></div>`;
      }
    }

    async function stopRec() {
      if (!recording) return;
      recording = false;
      timer.classList.remove('is-rec'); timer.classList.remove('is-rec-warn');
      recVisual.classList.remove('is-rec');
      visBars.forEach((b) => { b.style.height = '10%'; });
      const out = await Recorder.stop();
      btnRecText.textContent = T('test.recordStart');
      btnRec.classList.add('btn--primary'); btnRec.classList.remove('btn--danger');
      btnRec.disabled = true;
      if (!out || !out.base64) { btnRec.disabled = false; return; }
      lastOut = out;
      attempts += 1;
      btnRedo.style.display = attempts < 3 ? 'inline-flex' : 'none';
      await judge(item, out, resultBox, btnRec, btnRedo);
    }

    btnRec.addEventListener('click', () => (recording ? stopRec() : startRec()));
    btnRedo.addEventListener('click', () => {
      btnRec.disabled = false; btnRedo.style.display = 'none';
      resultBox.innerHTML = '';
      startRec();
    });
    btnSkip.addEventListener('click', () => {
      if (recording) stopRec();
      record(state.idx, { skipped: true, result: { dims: null, score: 0, skipped: true } });
      next();
    });

    if (saved && saved.result && !saved.skipped) {
      btnRec.disabled = true;
      btnRedo.style.display = 'none';
      renderSpeakingResult(item, saved.result, saved.transcript, resultBox, null);
      els.btnNext.disabled = false;
    } else if (saved && saved.skipped) {
      btnRec.disabled = true;
      els.btnNext.disabled = false;
      resultBox.innerHTML = `<div class="notice notice--warn">${T('test.skipped')}</div>`;
    } else {
      els.btnNext.disabled = true;
    }
  }

  async function judge(item, out, resultBox, btnRec, btnRedo) {
    resultBox.innerHTML = `<div class="judging"><span class="spinner"></span> ${T('test.judging')}</div>`;

    const offlineInput = { durationSec: out.durationSec, avgLevel: out.avgLevel, activeRatio: out.activeRatio };
    let transcript = '', soe = {}, failed = false, errMsg = '';

    const refText = (item.type === 'read' && item.referenceAnswer) ? item.referenceAnswer
      : (item.type === 'retell' && item.listenScript) ? item.listenScript : '';
    const evalMode = item.type === 'read' ? 1 : (item.type === 'retell' ? 2 : 3);

    // 录音过大（超出服务端请求体上限）时，直接走离线估分，避免整题失败
    const approxBytes = Math.round((out.base64 || '').length * 0.75);
    if (approxBytes > 4 * 1024 * 1024) {
      failed = true;
      errMsg = T('test.tooLong');
    } else {
      try {
        const [asrRes, soeRes] = await Promise.all([
          SpeechAPI.asr(out.base64, out.format),
          SpeechAPI.soe(out.base64, refText, { evalMode, workMode: 0, scoreCoeff: 2.0 }),
        ]);
        transcript = (asrRes && asrRes.Result) || '';
        soe = soeRes || {};
      } catch (e) {
        failed = true;
        errMsg = e.message;
      }
    }

    let result;
    if (failed) {
      result = SCORING.estimateOffline(item, offlineInput);
      result.mock = !state.apiStatus.configured;
      state.usingOffline = true;
    } else {
      result = SCORING.evaluateSpeaking(item, { transcript, soe, durationSec: out.durationSec });
      result.mock = Boolean((soe && soe.Mock));
    }

    record(state.idx, { result, transcript, durationSec: out.durationSec, skipped: false });
    renderSpeakingResult(item, result, transcript, resultBox, out, failed, errMsg, btnRec, btnRedo);
    els.btnNext.disabled = false;
  }

  function renderSpeakingResult(item, result, transcript, box, out, failed, errMsg, btnRec, btnRedo) {
    const dim = result.dims || {};
    const dimRow = (labelKey, val) =>
      `<div class="dim"><span class="dim__name">${T(labelKey)}</span><span class="dim__val">${val == null ? '—' : val}</span>
        <div class="dim__track"><div class="dim__fill" style="width:${val || 0}%"></div></div></div>`;

    const lines = [
      dimRow('dim.fluency', dim.fluency),
      dimRow('dim.pronunciation', dim.pronunciation),
      dimRow('dim.grammarVocab', dim.grammarVocab),
      dimRow('dim.content', dim.content),
    ].join('');

    let notice = `<div class="notice notice--info" style="margin-top:18px">
        ${T('common.score')}：<b>${result.score}</b> ${T('common.points')}${result.mock ? ' · ' + T('status.mockShort') : ''}
      </div>`;

    if (failed) {
      notice = `<div class="notice notice--warn" style="margin-top:18px">
          ${T('test.asrFailed')}<br><small>${CORE.escapeHTML(errMsg || '')}</small><br>
          <small>${T('test.offlineNote')}</small>
        </div>` + notice;
    }

    const transcriptHtml = transcript
      ? `<div class="transcript"><b>${T('test.transcriptLabel')}</b>${CORE.escapeHTML(transcript)}</div>`
      : (failed ? '' : `<div class="transcript"><b>${T('test.transcriptLabel')}</b>${T('test.noSpeech')}</div>`);

    let playback = '';
    if (out && out.objectUrl) {
      playback = `<button class="btn btn--ghost btn--sm" id="playMine">${CORE.icon('play', 15)} ${T('common.playMine')}</button>`;
    }

    let retry = '';
    if (failed && btnRec && btnRedo) {
      retry = `<button class="btn btn--ghost btn--sm" id="retryBtn">${CORE.icon('reload', 15)} ${T('test.retry')}</button>`;
    }

    box.innerHTML = `
      ${transcriptHtml}
      <div class="dim-list" style="margin-top:20px">${lines}</div>
      ${notice}
      <div class="btn-row" style="margin-top:16px">${playback}${retry}</div>`;

    // 回放
    const playMine = box.querySelector('#playMine');
    if (playMine && out && out.objectUrl) {
      let audio = null;
      playMine.addEventListener('click', () => {
        if (audio && !audio.paused) { audio.pause(); audio = null; playMine.innerHTML = CORE.icon('play', 15) + ' ' + T('common.playMine'); return; }
        audio = new Audio(out.objectUrl);
        playMine.innerHTML = CORE.icon('pause', 15) + ' ' + T('common.stopMine');
        audio.addEventListener('ended', () => { playMine.innerHTML = CORE.icon('play', 15) + ' ' + T('common.playMine'); audio = null; });
        audio.play();
      });
    }
    // 重试
    const retryBtn = box.querySelector('#retryBtn');
    if (retryBtn && btnRec && btnRedo) {
      retryBtn.addEventListener('click', () => {
        btnRec.disabled = false; btnRedo.style.display = 'none';
        box.innerHTML = '';
        state.records[state.idx] = null;
        persist();
      });
    }
  }

  function record(i, data) { state.records[i] = data; persist(); }

  /* ============================ 汇总 ============================ */
  function finish() {
    CORE.stopSpeak();
    state.finished = true;
    clearProgress();

    const { rubric } = state.bank;
    const speakingRecs = [];
    const listeningRecs = [];

    state.queue.forEach((step, i) => {
      const rec = state.records[i];
      if (!step.item || !rec) return;
      if (step.kind === 'speaking' && rec.result && rec.result.dims) {
        speakingRecs.push({ item: step.item, result: rec.result, transcript: rec.transcript, weight: 1 });
      }
      if (step.kind === 'listening' && rec.result && !rec.skipped) {
        listeningRecs.push({ item: step.item, result: rec.result, weight: 1 });
      }
    });

    const usdSession = {
      mode: state.mode,
      finishedAt: new Date().toISOString(),
      durationSec: Math.round((Date.now() - state.startedAt) / 1000),
      summary: SCORING.aggregate({ speaking: speakingRecs, listening: listeningRecs, rubric }),
      speaking: speakingRecs,
      listening: listeningRecs,
      usingOffline: state.usingOffline,
      rubric,
    };
    CORE.saveSession(usdSession);
    location.href = 'report.html';
  }

  /* ============================ 事件 ============================ */
  function bindGlobal() {
    els.btnNext.addEventListener('click', next);
    els.btnPrev.addEventListener('click', () => go(-1));

    // 语言切换：重渲染当前题（已作答结果从 records 恢复）
    document.addEventListener('i18n:change', () => render());

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      const tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.key === 'Enter' && !els.btnNext.disabled) { e.preventDefault(); next(); }
        return;
      }
      const step = state.queue[state.idx];
      if (step && step.kind === 'listening' && step.item.type !== 'dictation') {
        const map = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 };
        const i = map[e.key.toLowerCase()];
        if (i != null) {
          const btn = document.querySelector(`#options .option[data-i="${i}"]`);
          if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
          return;
        }
      }
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        if (!els.btnNext.disabled) { e.preventDefault(); next(); }
      }
      if (e.key === 'ArrowLeft') {
        if (!els.btnPrev.disabled) { e.preventDefault(); go(-1); }
      }
    });

    // 离开确认
    const brand = document.querySelector('.brand');
    if (brand) brand.addEventListener('click', (e) => {
      if (state.finished) return;
      if (window.confirm(T('test.quitConfirm'))) { state.leaving = true; }
      else e.preventDefault();
    });
    window.addEventListener('beforeunload', (e) => {
      if (state.finished || state.leaving) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
  return { state, next, go };
})();

window.Test = Test;