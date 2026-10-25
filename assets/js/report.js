/**
 * ============================================================================
 *  report.js —— 成绩报告渲染（零依赖，原生 Canvas 绘制雷达图）
 * ----------------------------------------------------------------------------
 *  渲染：总分环、等级徽章、五维雷达（响应式）、维度条、最需改进 TOP 2、
 *        逐题明细（含听力原文 / 你的作答 / 参考答案），并提供打印与清除数据。
 * ========================================================================== */
'use strict';

const Report = (function () {
  const DIM_ORDER = ['fluency', 'pronunciation', 'grammarVocab', 'content', 'interaction'];
  const DIM_KEY = {
    fluency: 'dim.fluency',
    pronunciation: 'dim.pronunciation',
    grammarVocab: 'dim.grammarVocab',
    content: 'dim.content',
    interaction: 'dim.interaction',
  };
  const T = (k) => I18N.t(k);
  const zh = () => I18N.current() === 'zh';

  let session = null;
  let radarResizeBound = false;

  function boot() {
    session = CORE.loadSession();
    const root = document.getElementById('reportRoot');
    if (!session || !session.summary) { renderEmpty(root); return; }
    renderReport(root);
    document.addEventListener('i18n:change', () => renderReport(root));
  }

  function renderEmpty(root) {
    root.innerHTML = `
      <div class="wrap" style="padding:60px 0 80px">
        <div class="q-panel" style="max-width:720px">
          <p class="eyebrow">NO RESULT</p>
          <h2 class="q-prompt">${zh() ? '还没有测评记录' : 'No result yet'}</h2>
          <p class="q-sub">${zh() ? '完成一次测评后，这里会显示你的等级与完整报告。' : 'Finish a test and your level and full report will appear here.'}</p>
          <div class="btn-row">
            <a class="btn btn--primary" href="test.html?mode=quick">${T('common.modeQuick')}</a>
            <a class="btn btn--ghost" href="test.html?mode=full">${T('common.modeFull')}</a>
          </div>
        </div>
      </div>`;
  }

  function renderReport(root) {
    const s = session.summary;
    const levelLabel = zh() ? s.level.labelZh : s.level.labelEn;
    const levelDesc = zh() ? s.level.descZh : s.level.descEn;

    const bars = DIM_ORDER.map((k) => {
      const v = s.dims[k];
      const dim = session.rubric.dimensions[k];
      return `
        <div class="bar-row">
          <div class="bar-row__head">
            <span class="bar-row__name">${T(DIM_KEY[k])}</span>
            <span class="bar-row__score">${v}<small> / 100 · ${Math.round(dim.weight * 100)}%</small></span>
          </div>
          <div class="bar-row__track"><div class="bar-row__fill" data-low="${v < 60}" style="width:0" data-w="${v}"></div></div>
        </div>`;
    }).join('');

    const adviceItems = s.weak.map((w) => {
      const adv = session.rubric.advice[w.key] || {};
      return `
        <div class="advice-item">
          <div class="advice-item__head">
            <b>${T(DIM_KEY[w.key])}</b>
            <span class="chip">${w.value} / 100</span>
          </div>
          <p>${zh() ? adv.zh : adv.en}</p>
        </div>`;
    }).join('');

    const soeMissing = (session.speaking || []).some((r) => r.result && r.result.soeMissing);
    const offlineNotice = (session.usingOffline
      ? `<div class="notice notice--warn" style="margin-top:16px">${T('test.offlineNote')}</div>` : '')
      + (soeMissing ? `<div class="notice notice--warn" style="margin-top:16px">${T('note.soeMissing')}</div>` : '');

    root.innerHTML = `
      <section class="report-hero">
        <div class="wrap wrap--narrow">
          <p class="eyebrow">${T('report.eyebrow')}</p>
          <div class="report-top">
            <div class="score-ring">${scoreRing(s.total)}
              <div class="score-num"><b>${s.total}</b><span>${T('report.totalLabel')}</span></div>
            </div>
            <div>
              <div class="level-badge"><b>${s.level.code}</b> ${levelLabel}</div>
              <p class="section-title" style="margin-bottom:8px">${T('report.title')}</p>
              <p class="report-criterion">${levelDesc}</p>
              <p class="report-criterion" style="margin-top:10px;font-size:0.9rem;color:var(--ink-4)">
                ${T('report.origin')} · ${T('report.listenScore')} ${s.listenTotal} · ${T('report.speakScore')} ${s.speakTotal} · ${T('common.mode')} ${session.mode === 'full' ? T('common.modeFull') : T('common.modeQuick')}
              </p>
              ${offlineNotice}
              <div class="btn-row" style="margin-top:18px">
                <a class="btn btn--primary" href="test.html?mode=${session.mode}">${T('report.again')}</a>
                <button class="btn btn--ghost" id="printBtn">${CORE.icon('doc', 16)} ${T('report.print')}</button>
                <button class="btn btn--danger" id="clearBtn">${T('report.clear')}</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section section--tight">
        <div class="wrap">
          <div class="report-grid">
            <div class="radar-card">
              <h3 class="card__title" style="margin-bottom:16px">${T('report.radarTitle')}</h3>
              <canvas id="radar" role="img" aria-label="${T('report.radarTitle')}"></canvas>
            </div>
            <div>
              <h3 class="card__title" style="margin-bottom:20px">${T('report.barsTitle')}</h3>
              <div class="bars">${bars}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="section section--tight">
        <div class="wrap">
          <div class="grid grid--2">
            <div>
              <h3 class="section-title" style="font-size:1.4rem;margin-bottom:20px">${T('report.adviceTitle')}</h3>
              <div class="advice-list">${adviceItems}</div>
            </div>
            <div>
              <h3 class="section-title" style="font-size:1.4rem;margin-bottom:20px">${T('report.detailTitle')}</h3>
              <div class="levels">${detailRows()}</div>
            </div>
          </div>
        </div>
      </section>`;

    requestAnimationFrame(() => {
      root.querySelectorAll('.bar-row__fill').forEach((el) => { el.style.width = el.dataset.w + '%'; });
      drawRadarResponsive();
    });

    bindActions(root);
    if (!radarResizeBound) {
      radarResizeBound = true;
      let timer = null;
      window.addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(drawRadarResponsive, 160);
      });
    }
  }

  function scoreRing(total) {
    const r = 74; const c = 2 * Math.PI * r;
    const off = c * (1 - Math.min(100, total) / 100);
    return `
      <svg viewBox="0 0 168 168" width="168" height="168" aria-hidden="true">
        <circle cx="84" cy="84" r="${r}" fill="none" stroke="#ecebe5" stroke-width="10"/>
        <circle cx="84" cy="84" r="${r}" fill="none" stroke="var(--accent)" stroke-width="10"
          stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 84 84)"/>
      </svg>`;
  }

  /* —— 逐题明细（含原文 / 作答 / 参考答案） —— */
  function detailRows() {
    const rows = [];
    (session.listening || []).forEach((r, i) => {
      const ok = r.result.ratio === 1;
      const correctAnswer = r.item.type === 'dictation'
        ? (r.item.blanks || []).join(' / ')
        : (r.item.options ? r.item.options[r.item.answer] : '');
      const script = r.item.transcript || r.item.script || '';
      rows.push(`
        <div class="level-row">
          <span class="level-row__code">L${i + 1} · ${r.item.level}</span>
          <span class="level-row__desc">
            <b style="color:var(--ink)">${CORE.escapeHTML(shorten(r.item.question || script, 60))}</b><br>
            <small>${T('report.refAnswer')}：${CORE.escapeHTML(shorten(correctAnswer, 48))}</small>
          </span>
          <span class="level-row__range" style="color:${ok ? 'var(--good)' : 'var(--bad)'}">${r.result.score} / 100</span>
        </div>`);
    });
    (session.speaking || []).forEach((r, i) => {
      if (!r.result || !r.result.dims) return;
      const d = r.result.dims;
      rows.push(`
        <div class="level-row">
          <span class="level-row__code">S${i + 1} · ${r.item.level}</span>
          <span class="level-row__desc">
            <b style="color:var(--ink)">${CORE.escapeHTML(shorten(r.item.prompt, 60))}</b><br>
            <small>${T('report.dimTriplet')}：${d.pronunciation} / ${d.fluency} / ${d.content}${r.transcript ? '<br>' + T('test.yourAnswer') + CORE.escapeHTML(shorten(r.transcript, 70)) : ''}</small>
          </span>
          <span class="level-row__range">${r.result.score} / 100</span>
        </div>`);
    });
    return rows.length ? rows.join('') : `<p class="footer-note">${zh() ? '本次没有有效作答记录。' : 'No valid answers recorded.'}</p>`;
  }

  function shorten(s, n) {
    s = String(s || '');
    n = n || 46;
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* —— 响应式雷达图 —— */
  function drawRadarResponsive() {
    const canvas = document.getElementById('radar');
    if (!canvas) return;
    const host = canvas.parentElement;
    const w = Math.max(260, Math.floor(host.clientWidth));
    const h = Math.max(300, Math.min(430, Math.round(w * 0.8)));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRadar(ctx, w, h, session.summary.dims);
  }

  function drawRadar(ctx, W, H, dims) {
    ctx.clearRect(0, 0, W, H);

    const compact = W < 420;
    const cx = W / 2;
    const cy = H / 2 + 4;
    const pad = compact ? 40 : 58;
    const R = Math.max(60, Math.min(W, H) / 2 - pad);
    const n = DIM_ORDER.length;
    const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue('--ink').trim() || '#15171b';
    const accent = style.getPropertyValue('--accent').trim() || '#1c6b5a';
    const accentSoft = style.getPropertyValue('--accent-soft').trim() || '#e6f0ec';
    const ink4 = style.getPropertyValue('--ink-4').trim() || '#8b929b';

    // 网格
    for (let ring = 1; ring <= 4; ring++) {
      const rr = (R * ring) / 4;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = cx + rr * Math.cos(angle(i));
        const y = cy + rr * Math.sin(angle(i));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = ring === 4 ? '#d3d2cb' : '#ecebe5';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // 轴线
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.cos(angle(i)), cy + R * Math.sin(angle(i)));
      ctx.strokeStyle = '#ecebe5';
      ctx.stroke();
    }

    // 数据面
    const pts = DIM_ORDER.map((k, i) => {
      const v = CORE.clamp((dims[k] || 0) / 100, 0, 1);
      return [cx + R * v * Math.cos(angle(i)), cy + R * v * Math.sin(angle(i))];
    });
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = accentSoft;
    ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
    pts.forEach((p) => { ctx.beginPath(); ctx.arc(p[0], p[1], 3.4, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill(); });

    // 轴标签（含分值），字号随尺寸调整
    ctx.font = (compact ? '500 11px' : '500 12px') + ' "Manrope", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    DIM_ORDER.forEach((k, i) => {
      const lx = cx + (R + (compact ? 16 : 26)) * Math.cos(angle(i));
      const ly = cy + (R + (compact ? 16 : 26)) * Math.sin(angle(i));
      const label = T(DIM_KEY[k]);
      const val = String(dims[k] || 0);
      const cosv = Math.cos(angle(i));
      ctx.textAlign = Math.abs(cosv) < 0.3 ? 'center' : (cosv > 0 ? 'left' : 'right');
      ctx.fillStyle = ink;
      ctx.fillText(label, lx, ly - 7);
      ctx.fillStyle = ink4;
      ctx.fillText(val, lx, ly + 7);
    });
  }

  function bindActions(root) {
    const p = root.querySelector('#printBtn');
    if (p) p.addEventListener('click', () => window.print());

    const c = root.querySelector('#clearBtn');
    if (c) c.addEventListener('click', () => {
      const msg = zh() ? '确定清除本机保存的测评记录？此操作不可撤销。' : 'Clear locally stored results? This cannot be undone.';
      if (!window.confirm(msg)) return;
      CORE.clearSession();
      root.innerHTML = `<div class="wrap wrap--narrow" style="padding:70px 0 90px">
        <div class="notice notice--info">${T('report.cleared')}</div></div>`;
      setTimeout(() => { location.href = 'index.html'; }, 1200);
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
  return { drawRadarResponsive };
})();

window.Report = Report;