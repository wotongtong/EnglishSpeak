/**
 * ============================================================================
 *  report.js —— 成绩报告渲染（零依赖，原生 Canvas 绘制雷达图）
 * ----------------------------------------------------------------------------
 *  读取 CORE.loadSession() 后渲染：总分环、等级徽章、五维雷达、维度条、
 *  最需改进 TOP 2、逐题明细，并提供打印/导出与再测入口。
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

  let session = null;

  function boot() {
    session = CORE.loadSession();
    const root = document.getElementById('reportRoot');
    if (!session || !session.summary) {
      renderEmpty(root);
      return;
    }
    renderReport(root);
    bindActions();
    document.addEventListener('i18n:change', () => { renderReport(root); });
  }

  function renderEmpty(root) {
    root.innerHTML = `
      <div class="q-panel" style="text-align:left;margin-top:40px">
        <p class="eyebrow">NO RESULT</p>
        <h2 class="q-prompt">${I18N.current() === 'zh' ? '还没有测评记录' : 'No result yet'}</h2>
        <p class="q-sub">${I18N.current() === 'zh' ? '完成一次测评后，这里会显示你的等级与报告。' : 'Finish a test and your level and report will appear here.'}</p>
        <a class="btn btn--primary" href="index.html">${I18N.t('nav.backHome')}</a>
      </div>`;
  }

  function renderReport(root) {
    const s = session.summary;
    const levelLabel = I18N.current() === 'zh' ? s.level.labelZh : s.level.labelEn;
    const levelDesc = I18N.current() === 'zh' ? s.level.descZh : s.level.descEn;

    // 总分环
    const ring = scoreRing(s.total);

    // 维度条
    const bars = DIM_ORDER.map((k) => {
      const v = s.dims[k];
      const dim = session.rubric.dimensions[k];
      const low = v < 60;
      return `
        <div class="bar-row">
          <div class="bar-row__head">
            <span class="bar-row__name">${I18N.t(DIM_KEY[k])}</span>
            <span class="bar-row__score">${v}<small> / 100 · ${Math.round(dim.weight * 100)}%</small></span>
          </div>
          <div class="bar-row__track"><div class="bar-row__fill" data-low="${low}" style="width:0" data-w="${v}"></div></div>
        </div>`;
    }).join('');

    // 建议
    const sameWeak = s.weak[0].value === s.weak[1].value;
    const adviceItems = s.weak.map((w) => {
      const adv = (session.rubric.advice[w.key] || {});
      return `
        <div class="advice-item">
          <div class="advice-item__head">
            <b>${I18N.t(DIM_KEY[w.key])}</b>
            <span class="chip">${w.value} / 100</span>
          </div>
          <p>${I18N.current() === 'zh' ? adv.zh : adv.en}</p>
        </div>`;
    }).join('');

    root.innerHTML = `
      <section class="report-hero">
        <div class="wrap wrap--narrow">
          <p class="eyebrow">${I18N.t('report.eyebrow')}</p>
          <div class="report-top">
            <div class="score-ring">${ring}
              <div class="score-num"><b>${s.total}</b><span>${I18N.t('report.totalLabel')}</span></div>
            </div>
            <div>
              <div class="level-badge"><b>${s.level.code}</b> ${levelLabel}</div>
              <p class="section-title" style="margin-bottom:8px">${I18N.t('report.title')}</p>
              <p class="report-criterion">${levelDesc}</p>
              <p class="report-criterion" style="margin-top:10px;font-size:0.9rem;color:var(--ink-4)">
                ${I18N.t('report.origin')} · ${I18N.t('report.listenScore')} ${s.listenTotal} · ${I18N.t('report.speakScore')} ${s.speakTotal}
              </p>
              <div class="btn-row" style="margin-top:18px">
                <a class="btn btn--primary" href="test.html?mode=${session.mode}">${I18N.t('report.again')}</a>
                <button class="btn btn--ghost" id="printBtn">${CORE.icon('doc', 16)} ${I18N.t('report.print')}</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section section--tight">
        <div class="wrap">
          <div class="report-grid">
            <div class="radar-card">
              <h3 class="card__title" style="margin-bottom:16px">${I18N.t('report.radarTitle')}</h3>
              <canvas id="radar" width="520" height="420" role="img" aria-label="${I18N.t('report.radarTitle')}"></canvas>
            </div>
            <div>
              <h3 class="card__title" style="margin-bottom:20px">${I18N.t('report.barsTitle')}</h3>
              <div class="bars">${bars}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="section section--tight">
        <div class="wrap">
          <div class="grid grid--2">
            <div>
              <h3 class="section-title" style="font-size:1.4rem;margin-bottom:20px">${I18N.t('report.adviceTitle')}</h3>
              <div class="advice-list">${adviceItems}</div>
            </div>
            <div>
              <h3 class="section-title" style="font-size:1.4rem;margin-bottom:20px">${I18N.t('report.detailTitle')}</h3>
              <div class="levels">${detailRows()}</div>
            </div>
          </div>
        </div>
      </section>`;

    // 动画：延后触发条与雷达的绘制
    requestAnimationFrame(() => {
      root.querySelectorAll('.bar-row__fill').forEach((el) => { el.style.width = el.dataset.w + '%'; });
      drawRadar(document.getElementById('radar'), s.dims);
    });
  }

  function scoreRing(total) {
    const r = 74; const c = 2 * Math.PI * r;
    const off = c * (1 - Math.min(100, total) / 100);
    return `
      <svg viewBox="0 0 168 168" width="168" height="168" aria-hidden="true">
        <circle cx="84" cy="84" r="${r}" fill="none" stroke="#ecebe5" stroke-width="10"/>
        <circle cx="84" cy="84" r="${r}" fill="none" stroke="var(--accent)" stroke-width="10"
          stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"
          transform="rotate(-90 84 84)"/>
      </svg>`;
  }

  function detailRows() {
    const rows = [];
    (session.listening || []).forEach((r, i) => {
      const ok = r.result.ratio === 1;
      rows.push(`
        <div class="level-row">
          <span class="level-row__code">L${i + 1} · ${r.item.level}</span>
          <span class="level-row__desc">${CORE.escapeHTML(shorten(r.item.question || r.item.script))}</span>
          <span class="level-row__range" style="color:${ok ? 'var(--good)' : 'var(--bad)'}">${r.result.score} / 100</span>
        </div>`);
    });
    (session.speaking || []).forEach((r, i) => {
      const dim = r.result.dims;
      rows.push(`
        <div class="level-row">
          <span class="level-row__code">S${i + 1} · ${r.item.level}</span>
          <span class="level-row__desc">${CORE.escapeHTML(shorten(r.item.prompt))}</span>
          <span class="level-row__range">${dim.pronunciation} / ${dim.fluency} / ${dim.content}</span>
        </div>`);
    });
    return rows.join('');
  }

  function shorten(s, n) {
    s = String(s || '');
    n = n || 46;
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* —— 原生 Canvas 雷达图 —— */
  function drawRadar(canvas, dims) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width; const H = canvas.height;
    if (dpr > 1) {
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.scale(dpr, dpr);
    }
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2; const cy = H / 2 + 6;
    const R = Math.min(W, H) / 2 - 58;
    const n = DIM_ORDER.length;
    const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue('--ink').trim() || '#15171b';
    const line = style.getPropertyValue('--line-strong').trim() || '#d3d2cb';
    const accent = style.getPropertyValue('--accent').trim() || '#1c6b5a';
    const accentSoft = style.getPropertyValue('--accent-soft').trim() || '#e6f0ec';

    // 网格（4 环）
    for (let ring = 1; ring <= 4; ring++) {
      const rr = (R * ring) / 4;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = cx + rr * Math.cos(angle(i));
        const y = cy + rr * Math.sin(angle(i));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = ring === 4 ? line : '#ecebe5';
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

    // 数据多边形
    const pts = DIM_ORDER.map((k, i) => {
      const v = CORE.clamp((dims[k] || 0) / 100, 0, 1);
      return [cx + R * v * Math.cos(angle(i)), cy + R * v * Math.sin(angle(i))];
    });
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = accentSoft;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 顶点
    pts.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 3.4, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
    });

    // 轴标签
    ctx.fillStyle = ink;
    ctx.font = '500 12px "Segoe UI", system-ui, sans-serif';
    DIM_ORDER.forEach((k, i) => {
      const lx = cx + (R + 26) * Math.cos(angle(i));
      const ly = cy + (R + 26) * Math.sin(angle(i));
      const label = I18N.t(DIM_KEY[k]) + ' ' + (dims[k] || 0);
      ctx.textAlign = Math.abs(Math.cos(angle(i))) < 0.3 ? 'center' : (Math.cos(angle(i)) > 0 ? 'left' : 'right');
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly);
    });
  }

  function bindActions() {
    const p = document.getElementById('printBtn');
    if (p) p.addEventListener('click', () => window.print());
  }

  document.addEventListener('DOMContentLoaded', boot);
  return { refresh: () => renderReport(document.getElementById('reportRoot')) };
})();

window.Report = Report;