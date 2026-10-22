/**
 * ============================================================================
 *  test.js —— 测评主流程编排（零依赖）
 * ----------------------------------------------------------------------------
 *  流程：加载题库 → 组装题目队列(快速/完整) → 分节作答 → 汇总评分 → 存会话 → 跳报告
 *  题型：听力(短对话/长对话/听写) 、口语(朗读/话题/情景/复述)
 * ========================================================================== */
'use strict';

const Test = (function () {
  const state = {
    bank: null,
    mode: 'quick',
    queue: [],
    idx: 0,
    records: [],
    startedAt: Date.now(),
    apiStatus: { configured: false, offline: true },
    rec: null,
    stream: null,
  };

  let els = {};

  /* —— 工具 —— */
  const qs = (k) => new URLSearchParams(location.search).get(k) || 'quick';
  const tmp = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

  /* —— 初始化 —— */
  async function init() {
    els = {
      progress: document.getElementById('progressBar'),
      counter: document.getElementById('counter'),
      modeLabel: document.getElementById('modeLabel'),
      statusLabel: document.getElementById('apiStatus'),
      stage: document.getElementById('stage'),
      btnPrev: document.getElementById('btnPrev'),
      btnNext: document.getElementById('btnNext'),
    };

    state.mode = qs('mode') === 'full' ? 'full' : 'quick';
    state.bank = await CORE.loadBank();
    buildQueue();

    // 并行检测后端状态（不阻塞答题）
    SpeechAPI.health().then((h) => {
      state.apiStatus = h;
      if (els.statusLabel) {
        els.statusLabel.textContent = h.configured ? I18N.t('status.liveShort') : I18N.t('status.mockShort');
        els.statusLabel.className = 'tag ' + (h.configured ? 'tag--accent' : '');
        els.statusLabel.title = h.configured ? I18N.t('status.live') : I18N.t('status.mock');
      }
    });

    // 先展示听力分节引导
    renderIntro('listening');
  }

  /* —— 组卷 —— */
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
    // 听力节
    q.push({ kind: 'intro', section: 'listening', textKey: 'test.partIntroListen', btnKey: 'test.goListen' });
    listenIds.forEach((id) => {
      const item = listening.questions.find((x) => x.id === id);
      if (item) q.push({ kind: 'listening', item });
    });
    // 口语节
    q.push({ kind: 'intro', section: 'speaking', textKey: 'test.partIntroSpeak', btnKey: 'test.goSpeak' });
    speakIds.forEach((id) => {
      const item = speaking.questions.find((x) => x.id === id);
      if (item) q.push({ kind: 'speaking', item });
    });

    state.queue = q;
    state.records = q.map(() => null);
  }

  function totalQuestions() {
    return state.queue.filter((s) => s.kind !== 'intro').length;
  }
  function questionNumberAt(i) {
    let n = 0;
    for (let k = 0; k <= i; k++) if (state.queue[k].kind !== 'intro') n++;
    return n;
  }

  /* —— 进度与导航 —— */
  function updateChrome() {
    const total = totalQuestions();
    const n = questionNumberAt(state.idx);
    els.counter.textContent = n + ' ' + I18N.t('common.of') + ' ' + total;
    const pct = Math.round(((n - (state.queue[state.idx].kind === 'intro' ? 1 : 0)) / total) * 100);
    els.progress.style.width = Math.max(0, Math.min(100, pct)) + '%';
    els.modeLabel.textContent = (state.mode === 'full' ? I18N.t('common.modeFull') : I18N.t('common.modeQuick'));
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

  /* —— 渲染分发 —— */
  function render() {
    const step = state.queue[state.idx];
    els.stage.innerHTML = '';
    updateChrome();
    els.btnPrev.disabled = state.idx === 0;

    if (step.kind === 'intro') return renderIntro(step.section, step);
    if (step.kind === 'listening') return renderListening(step.item);
    if (step.kind === 'speaking') return renderSpeaking(step.item);
  }

  function renderIntro(section, step) {
    const isListen = section === 'listening';
    els.stage.innerHTML = '';
    els.progress.style.width = (isListen ? 0 : 45) + '%';
    els.btnPrev.disabled = true;
    els.btnNext.disabled = true;

    const panel = tmp(`
      <div class="q-panel reveal">
        <p class="eyebrow">${isListen ? 'LISTENING' : 'SPEAKING'}</p>
        <h2 class="q-prompt">${isListen ? I18N.t('test.firstPart') : I18N.t('test.secondPart')}</h2>
        <p class="q-sub">${isListen ? I18N.t('test.partIntroListen') : I18N.t('test.partIntroSpeak')}</p>
        <div class="btn-row">
          <button class="btn btn--primary" id="introGo">
            ${isListen ? I18N.t('test.goListen') : I18N.t('test.goSpeak')}
            ${CORE.icon('arrow', 18)}
          </button>
        </div>
      </div>`);
    els.stage.appendChild(panel);
    panel.querySelector('#introGo').addEventListener('click', () => next());
  }

  /* =========================== 听力题型 =========================== */
  function renderListening(item) {
    const saved = state.records[state.idx];
    const isDictation = item.type === 'dictation';

    const tags = `
      <div class="q-tags">
        <span class="tag tag--accent">${item.level}</span>
        <span class="tag">${isDictation ? 'DICTATION' : 'LISTENING'}</span>
      </div>`;

    const audioBar = `
      <div class="audio-bar">
        <button class="play-btn" id="playBtn" aria-label="${I18N.t('common.replay')}">${CORE.icon('play', 22)}</button>
        <div class="audio-bars" id="audioBars">${'<i></i>'.repeat(24)}</div>
        <span class="audio-bar__hint" id="audioHint">${I18N.t('common.audioHint')}</span>
        <button class="btn btn--quiet btn--sm audio-bar__replay" id="replayBtn">${I18N.t('common.replay')}</button>
      </div>`;

    let body = '';
    if (isDictation) {
      const full = item.fullText || item.script;
      const blanked = full.replace(/\b([A-Za-z']+)\b/g, (m) => {
        if (item.blanks.some((b) => b.toLowerCase() === m.toLowerCase())) {
          return '<input class="blank-input" type="text" aria-label="blank" />';
        }
        return m;
      });
      body = `
        <p class="q-sub">${item.questionZh || item.question}</p>
        <div class="dictation-line">${blanked}</div>
        <div class="btn-row"><button class="btn btn--primary" id="checkDict">${I18N.t('common.submitAnswer')}</button></div>
        <div id="dictFeedback"></div>`;
    } else {
      const keys = ['A', 'B', 'C', 'D', 'E'];
      const opts = item.options.map((o, i) => `
        <button class="option" data-i="${i}">
          <span class="option__key">${keys[i] || (i + 1)}</span>
          <span>${CORE.escapeHTML(o)}</span>
        </button>`).join('');
      body = `
        <p class="q-sub">${item.questionZh || item.question}</p>
        <div class="options" id="options">${opts}</div>
        <div id="choiceFeedback"></div>`;
    }

    const panel = tmp(`<div class="q-panel reveal">${tags}${audioBar}${body}</div>`);
    els.stage.appendChild(panel);

    wireAudioBar(panel, item);

    if (isDictation) {
      const inputs = panel.querySelectorAll('.blank-input');
      // 恢复已填
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
            ${result.ratio === 1 ? I18N.t('common.correct') : I18N.t('common.wrong')}
            ${item.blanks.join(' / ')} · ${I18N.t('common.score')} ${result.score}${I18N.t('common.points')}
          </div>`;
        record(state.idx, { answer: given, result });
        els.btnNext.disabled = false;
      });
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
              ${result.correct ? I18N.t('common.correct') : (I18N.t('common.wrong') + item.options[item.answer])}
            </div>`;
          record(state.idx, { answer: i, result });
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

    els.btnNext.disabled = saved == null;
  }

  /* —— 音频播放条：TTS + 波形动画 —— */
  function wireAudioBar(panel, item) {
    const playBtn = panel.querySelector('#playBtn');
    const replayBtn = panel.querySelector('#replayBtn');
    const bars = panel.querySelector('#audioBars');
    const hint = panel.querySelector('#audioHint');
    const script = item.type === 'dictation' ? item.script : item.script;

    let animId = null;
    const barsEls = Array.from(bars.children);

    function animate(on) {
      bars.classList.toggle('is-playing', on);
      if (animId) { clearInterval(animId); animId = null; }
      if (!on) {
        barsEls.forEach((b) => { b.style.height = '30%'; });
        return;
      }
      animId = setInterval(() => {
        barsEls.forEach((b) => { b.style.height = (18 + Math.random() * 78) + '%'; });
      }, 110);
    }

    function play() {
      playBtn.innerHTML = CORE.icon('pause', 22);
      hint.textContent = I18N.t('common.listening');
      CORE.speak(script, {
        repeat: 2,
        rate: 0.9,
        onStart: () => animate(true),
        onEnd: () => { animate(false); playBtn.innerHTML = CORE.icon('play', 22); hint.textContent = I18N.t('test.played'); },
      });
    }

    playBtn.addEventListener('click', play);
    replayBtn.addEventListener('click', play);
  }

  /* =========================== 口语题型 =========================== */
  function renderSpeaking(item) {
    const saved = state.records[state.idx];
    const typeLabel = { read: 'READ ALOUD', topic: 'TOPIC', interaction: 'ROLE-PLAY', retell: 'RETELL' }[item.type] || 'SPEAKING';

    const listenBlock = (item.type === 'retell' && item.listenScript) ? `
      <div class="audio-bar">
        <button class="play-btn" id="playBtn" aria-label="${I18N.t('common.replay')}">${CORE.icon('ear', 22)}</button>
        <div class="audio-bars" id="audioBars">${'<i></i>'.repeat(24)}</div>
        <span class="audio-bar__hint" id="audioHint">${I18N.t('common.audioHint')}</span>
        <button class="btn btn--quiet btn--sm audio-bar__replay" id="replayBtn">${I18N.t('common.replay')}</button>
      </div>` : '';

    const promptSub = (item.promptZh && I18N.current() === 'zh') ? item.promptZh : '';

    const panel = tmp(`
      <div class="q-panel reveal">
        <div class="q-tags">
          <span class="tag tag--accent">${item.level}</span>
          <span class="tag">${typeLabel}</span>
          <span class="tag">${item.durationSec}s</span>
        </div>
        ${listenBlock}
        <p class="q-prompt">${CORE.escapeHTML(item.prompt)}</p>
        ${promptSub ? `<p class="q-sub">${CORE.escapeHTML(promptSub)}</p>` : ''}

        <div class="rec-box" id="recBox">
          <div class="rec-visual" id="recVisual">${'<i></i>'.repeat(28)}</div>
          <div class="rec-timer" id="recTimer">0:00</div>
          <div class="rec-hint" id="recHint">${I18N.t('test.recordHint')}</div>
          <div class="rec-controls">
            <button class="btn btn--primary" id="btnRec">
              ${CORE.icon('mic', 18)} <span id="btnRecText">${I18N.t('test.recordStart')}</span>
            </button>
            <button class="btn btn--ghost" id="btnRedo" style="display:none">${CORE.icon('reload', 16)} ${I18N.t('test.recordAgain')}</button>
          </div>
        </div>

        <div id="recResult"></div>
      </div>`);
    els.stage.appendChild(panel);

    if (item.type === 'retell' && item.listenScript) wireAudioBar(panel, { script: item.listenScript });

    const recBox = panel.querySelector('#recBox');
    const recVisual = panel.querySelector('#recVisual');
    const timer = panel.querySelector('#recTimer');
    const hint = panel.querySelector('#recHint');
    const btnRec = panel.querySelector('#btnRec');
    const btnRecText = panel.querySelector('#btnRecText');
    const btnRedo = panel.querySelector('#btnRedo');
    const resultBox = panel.querySelector('#recResult');
    const visBars = Array.from(recVisual.children);

    let recording = false;
    let attempts = 0;
    let lastResult = null;

    function setTimer(sec) {
      const m = Math.floor(sec / 60); const s = sec % 60;
      timer.textContent = m + ':' + String(s).padStart(2, '0');
      // 到达建议时长自动提示但不强制停止
    }

    async function startRec() {
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
        recording = true;
        timer.classList.add('is-rec');
        recVisual.classList.add('is-rec');
        btnRecText.textContent = I18N.t('test.recordStop');
        btnRec.classList.remove('btn--primary');
        btnRec.classList.add('btn--danger');
        hint.innerHTML = '<span class="rec-dot"></span>' + I18N.t('common.listening');
        resultBox.innerHTML = '';
        els.btnNext.disabled = true;
      } catch (e) {
        hint.textContent = '';
        resultBox.innerHTML = `<div class="notice notice--error">${I18N.t('test.micDenied')}<br><small>${CORE.escapeHTML(e.message)}</small></div>`;
      }
    }

    async function stopRec() {
      recording = false;
      timer.classList.remove('is-rec');
      recVisual.classList.remove('is-rec');
      visBars.forEach((b) => { b.style.height = '10%'; });
      const out = await Recorder.stop();
      btnRecText.textContent = I18N.t('test.recordStart');
      btnRec.classList.add('btn--primary');
      btnRec.classList.remove('btn--danger');
      btnRec.disabled = true;
      if (!out || !out.base64) {
        btnRec.disabled = false;
        return;
      }
      attempts += 1;
      btnRedo.style.display = attempts < 3 ? 'inline-flex' : 'none';
      await judge(item, out, resultBox);
    }

    btnRec.addEventListener('click', () => (recording ? stopRec() : startRec()));
    btnRedo.addEventListener('click', () => {
      btnRec.disabled = false;
      resultBox.innerHTML = '';
      startRec();
    });

    // 恢复已完成状态
    if (saved && saved.result) {
      btnRec.disabled = true;
      btnRedo.style.display = 'none';
      renderSpeakingResult(item, saved.result, saved.transcript, resultBox);
      els.btnNext.disabled = false;
    } else {
      els.btnNext.disabled = true;
    }
  }

  async function judge(item, out, resultBox) {
    resultBox.innerHTML = `<div class="judging"><span class="spinner"></span> ${I18N.t('test.judging')}</div>`;
    let transcript = '';
    let soe = {};
    let mock = false;
    try {
      const refText = (item.type === 'read' && item.referenceAnswer) ? item.referenceAnswer
        : (item.type === 'retell' && item.listenScript) ? item.listenScript
        : '';
      const evalMode = item.type === 'read' ? 1 : (item.type === 'retell' ? 2 : 3);

      const [asrRes, soeRes] = await Promise.all([
        SpeechAPI.asr(out.base64, out.format).catch((e) => ({ Result: '', error: e.message })),
        SpeechAPI.soe(out.base64, refText, { evalMode, workMode: 0, scoreCoeff: 2.0 }).catch((e) => ({ error: e.message })),
      ]);
      transcript = asrRes.Result || '';
      soe = soeRes || {};
      mock = Boolean(asrRes.Mock || soe.Mock);
    } catch (e) {
      resultBox.innerHTML = `<div class="notice notice--error">${CORE.escapeHTML(e.message)}</div>`;
      return;
    }

    const result = SCORING.evaluateSpeaking(item, { transcript, soe, durationSec: out.durationSec });
    result.mock = mock;
    record(state.idx, { result, transcript, durationSec: out.durationSec });
    renderSpeakingResult(item, result, transcript, resultBox);
    els.btnNext.disabled = false;
  }

  function renderSpeakingResult(item, result, transcript, box) {
    const dim = result.dims;
    const lines = [
      `<div class="dim"><span class="dim__name">${I18N.t('dim.fluency')}</span><span class="dim__val">${dim.fluency}</span><div class="dim__track"><div class="dim__fill" style="width:${dim.fluency}%"></div></div></div>`,
      `<div class="dim"><span class="dim__name">${I18N.t('dim.pronunciation')}</span><span class="dim__val">${dim.pronunciation}</span><div class="dim__track"><div class="dim__fill" style="width:${dim.pronunciation}%"></div></div></div>`,
      `<div class="dim"><span class="dim__name">${I18N.t('dim.grammarVocab')}</span><span class="dim__val">${dim.grammarVocab}</span><div class="dim__track"><div class="dim__fill" style="width:${dim.grammarVocab}%"></div></div></div>`,
      `<div class="dim"><span class="dim__name">${I18N.t('dim.content')}</span><span class="dim__val">${dim.content}</span><div class="dim__track"><div class="dim__fill" style="width:${dim.content}%"></div></div></div>`,
    ].join('');

    box.innerHTML = `
      <div class="transcript">
        <b>${I18N.t('test.transcriptLabel')}</b>${transcript ? CORE.escapeHTML(transcript) : I18N.t('test.noSpeech')}
      </div>
      <div class="dim-list" style="margin-top:20px">${lines}</div>
      <div class="notice notice--info" style="margin-top:18px">
        ${I18N.t('common.score')}：<b>${result.score}</b> ${I18N.t('common.points')}
        ${result.mock ? ' · ' + I18N.t('status.mockShort') : ''}
      </div>`;
  }

  function record(i, data) { state.records[i] = data; }

  /* —— 汇总并跳转 —— */
  function finish() {
    CORE.stopSpeak();
    const { rubric } = state.bank;
    const speakingRecs = [];
    const listeningRecs = [];

    state.queue.forEach((step, i) => {
      const rec = state.records[i];
      if (!step.item || !rec || !rec.result) return;
      const weight = step.item.type === 'interaction' ? 1 : 1; // 可扩展：按题型权重
      if (step.kind === 'speaking') speakingRecs.push({ item: step.item, result: rec.result, transcript: rec.transcript, weight });
      if (step.kind === 'listening') listeningRecs.push({ item: step.item, result: rec.result, weight });
    });

    const summary = SCORING.aggregate({ speaking: speakingRecs, listening: listeningRecs, rubric });

    const session = {
      mode: state.mode,
      finishedAt: new Date().toISOString(),
      durationSec: Math.round((Date.now() - state.startedAt) / 1000),
      summary,
      speaking: speakingRecs,
      listening: listeningRecs,
      rubric,
    };
    CORE.saveSession(session);
    location.href = 'report.html';
  }

  /* —— 事件绑定 —— */
  function bind() {
    els.btnNext.addEventListener('click', next);
    els.btnPrev.addEventListener('click', () => go(-1));
    document.addEventListener('i18n:change', () => render());
  }

  async function boot() {
    try {
      await init();
      bind();
    } catch (e) {
      document.getElementById('stage').innerHTML =
        `<div class="notice notice--error">加载失败：${CORE.escapeHTML(e.message)}<br>请确认通过本地服务器打开（如 python -m http.server）而非双击 file://。</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
  return { state, next, go };
})();

window.Test = Test;