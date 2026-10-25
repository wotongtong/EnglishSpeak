/**
 * ============================================================================
 *  scoring.js —— 评分引擎（零依赖）
 * ----------------------------------------------------------------------------
 *  设计原则：以「能否与外国人流畅沟通」为核心，所有分数归一到 0–100，
 *  再按 rubric 权重合成总分并映射 CEFR 等级。
 *
 *  单题评分来源：
 *    · 朗读 / 复述 → 腾讯云 SOE（发音/流利度/完整度） + 参考文本关键词覆盖
 *    · 话题 / 情景 → 腾讯云 ASR 转写文本度量 + SOE（自由说）发音分
 *
 *  维度：fluency 流利度 / pronunciation 发音 / grammarVocab 语法词汇
 *        content 内容 / interaction 交际策略
 * ========================================================================== */
'use strict';

const SCORING = (function () {
  const FILLERS = ['um', 'uh', 'er', 'ah', 'hmm', 'like', 'you know', 'i mean', '呃', '嗯', '那个'];
  const CONNECTORS = ['because', 'however', 'although', 'though', 'so', 'but', 'therefore',
    'for example', 'in addition', 'on the other hand', 'which', 'while', 'if', 'when',
    'since', 'as a result', 'in other words', 'that is why', 'moreover', 'besides'];

  /* —— 文本度量 —— */
  function textMetrics(text) {
    const raw = (text || '').trim();
    const lower = ' ' + raw.toLowerCase() + ' ';
    const words = lower.match(/[a-z']+/g) || [];
    const sentences = raw.split(/[.!?。！？]+/).map((s) => s.trim()).filter(Boolean);
    const unique = new Set(words);
    const ttr = words.length ? unique.size / words.length : 0;

    let fillerCount = 0;
    FILLERS.forEach((f) => {
      const re = new RegExp('\\b' + f.replace(/\s+/g, '\\s+') + '\\b', 'g');
      const m = lower.match(re);
      if (m) fillerCount += m.length;
    });

    let connectorCount = 0;
    CONNECTORS.forEach((c) => {
      const re = new RegExp('\\b' + c.replace(/\s+/g, '\\s+') + '\\b', 'g');
      const m = lower.match(re);
      if (m) connectorCount += m.length;
    });

    const avgSentenceLen = sentences.length ? words.length / sentences.length : words.length;

    return {
      text: raw,
      lower,
      wordCount: words.length,
      uniqueCount: unique.size,
      ttr,
      sentenceCount: sentences.length,
      avgSentenceLen,
      fillerCount,
      connectorCount,
    };
  }

  /* —— 关键词覆盖：返回 0–1 —— */
  function keywordCoverage(text, keywords) {
    if (!keywords || !keywords.length) return null;
    const lower = ' ' + (text || '').toLowerCase() + ' ';
    let hit = 0;
    keywords.forEach((k) => {
      const parts = String(k).toLowerCase().split(/\s+/);
      // 多词短语按整体匹配优先，否则按任一词命中算部分覆盖
      if (lower.includes(' ' + k.toLowerCase() + ' ')) hit += 1;
      else if (parts.some((p) => p.length > 2 && lower.includes(p))) hit += 0.5;
    });
    return Math.min(1, hit / keywords.length);
  }

  /* —— 数字工具 —— */
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const pick = (v, fallback) => (typeof v === 'number' && !isNaN(v) ? v : fallback);

  /**
   * 计算「有效发言时长」下的流利度分：
   * 目标语速约 1.8 词/秒；低于 0.8 词/秒视为明显卡顿。
   */
  function fluencyScore(metrics, durationSec) {
    const dur = Math.max(1, durationSec || 1);
    const wps = metrics.wordCount / dur;            // words per second
    const rateIdeal = 1.6;
    let rateScore = 100 - Math.abs(wps - rateIdeal) * 42;   // 偏离理想语速扣分
    const fillerPenalty = (metrics.fillerCount / Math.max(1, metrics.wordCount)) * 220;
    const repeatPenalty = metrics.wordCount ? (1 - metrics.ttr) * 22 : 12;
    return clamp(rateScore - fillerPenalty - repeatPenalty, 5, 98);
  }

  /** 语法与词汇：句法复杂度 + 连接词使用 + 词汇多样性 */
  function grammarVocabScore(metrics) {
    const lenScore = clamp((metrics.avgSentenceLen - 5) * 7, 0, 60);   // 长句结构得分
    const connScore = clamp(metrics.connectorCount * 9, 0, 25);        // 连接手段
    const ttrScore = clamp((metrics.ttr - 0.35) * 55, 0, 15);          // 词汇丰富度
    return clamp(lenScore + connScore + ttrScore + 18, 5, 98);
  }

  /** 内容：关键词覆盖 + 长度充分度 */
  function contentScore(metrics, keywords, durationSec) {
    const cover = keywordCoverage(metrics.text, keywords);
    const coverScore = cover == null ? 55 : cover * 100;
    const needWords = (durationSec || 30) * 1.2;
    const lengthScore = clamp((metrics.wordCount / Math.max(6, needWords)) * 100, 20, 100);
    return clamp(coverScore * 0.62 + lengthScore * 0.38, 5, 98);
  }

  /**
   * 单题评分
   * @param {object} item     题目对象
   * @param {object} input    { transcript, soe, durationSec }
   * @returns {object}        { dims, score, metrics, mock }
   */
  /** SOE 字段取值：PronAccuracy 为 0–100；PronFluency / PronCompletion 为 0–1；-1 表示无意义 */
  function soeField(v) {
    if (typeof v !== 'number' || isNaN(v) || v < 0) return null;
    return v;
  }

  function evaluateSpeaking(item, input) {
    input = input || {};
    const soe = input.soe || {};
    const durationSec = input.durationSec || item.durationSec || 30;
    const metrics = textMetrics(input.transcript || '');
    const isReadLike = item.type === 'read' || item.type === 'retell';

    const accuracy = soeField(soe.PronAccuracy);                       // 0–100
    const fluency01 = soeField(soe.PronFluency);                       // 0–1
    const completion01 = soeField(soe.PronCompletion);                 // 0–1
    const fluencyPct = fluency01 == null ? null : fluency01 * 100;
    const completionPct = completion01 == null ? null : completion01 * 100;
    const soeMissing = accuracy == null && fluencyPct == null && completionPct == null;

    // 发音：优先采用 SOE 的 PronAccuracy；缺失（未开通口语评测等）时用中性值，并在报告中标注
    const pronunciation = accuracy != null
      ? clamp(accuracy * 0.92 + (completionPct == null ? 70 : completionPct) * 0.08, 5, 99)
      : 60;

    // 流利度：朗读/复述以 SOE 流利度为主，话题/情景以文本度量为主要参考
    const textFluency = fluencyScore(metrics, durationSec);
    const fluency = (isReadLike && fluencyPct != null)
      ? clamp(fluencyPct * 0.7 + textFluency * 0.3, 5, 99)
      : textFluency;

    // 内容
    let content;
    if (isReadLike) {
      const cover = keywordCoverage(metrics.text, item.keywords);
      content = clamp((completionPct == null ? 70 : completionPct) * 0.7 + (cover == null ? 60 : cover * 100) * 0.3, 5, 99);
    } else {
      content = contentScore(metrics, item.keywords, durationSec);
    }

    // 语法与词汇
    const grammarVocab = metrics.wordCount >= 4
      ? grammarVocabScore(metrics)
      : clamp((accuracy == null ? 60 : accuracy) * 0.6 + 20, 5, 90);

    // 交际策略：情景题强相关；其余用连贯性代理
    let interaction;
    if (item.type === 'interaction') {
      const hasResponse = /\?|sorry|could you|i understand|let me|thanks|thank you/i.test(metrics.text);
      interaction = clamp(content * 0.5 + fluency * 0.3 + (hasResponse ? 18 : 8), 5, 98);
    } else {
      interaction = clamp(fluency * 0.5 + content * 0.5, 5, 95);
    }

    const dims = { fluency, pronunciation, grammarVocab, content, interaction };

    // 单题分数：朗读/复述更看重发音，话题更看重内容与流利
    const w = isReadLike
      ? { fluency: 0.2, pronunciation: 0.4, grammarVocab: 0.15, content: 0.2, interaction: 0.05 }
      : { fluency: 0.25, pronunciation: 0.2, grammarVocab: 0.2, content: 0.25, interaction: 0.1 };

    const score = Object.keys(w).reduce((sum, k) => sum + dims[k] * w[k], 0);

    return {
      dims: mapRound(dims),
      score: Math.round(score),
      metrics,
      mock: Boolean(soe.Mock),
      soeMissing,
      transcript: metrics.text,
    };
  }

  /**
   * 离线估分：当识别服务不可用（未配置密钥 / CAM 无权限 / 网络异常）时，
   * 依据作答时长与声学活跃度给出估计分，避免测评中断。
   * 因无法判断内容与语法，分数上限受限，并在报告中明确标注为估算。
   */
  function estimateOffline(item, input) {
    input = input || {};
    const dur = Math.max(1, input.durationSec || item.durationSec || 30);
    const activeRatio = typeof input.activeRatio === 'number' ? input.activeRatio : 0.6;
    const avgLevel = typeof input.avgLevel === 'number' ? input.avgLevel : 0.2;
    const isReadLike = item.type === 'read' || item.type === 'retell';

    const target = item.durationSec || 30;
    const effective = dur * activeRatio;                 // 有效发声时长
    const effort = clamp(effective / (target * 0.7), 0, 1);

    const fluency = clamp(38 + effort * 44 + avgLevel * 12, 20, 80);
    const pronunciation = clamp(50 + avgLevel * 22, 30, 68);
    const grammarVocab = clamp(46 + effort * 22, 30, 68);
    const content = clamp(42 + effort * 26, 25, 70);
    const interaction = clamp(fluency * 0.5 + content * 0.5, 25, 75);

    const dims = mapRound({ fluency, pronunciation, grammarVocab, content, interaction });
    const w = isReadLike
      ? { fluency: 0.2, pronunciation: 0.4, grammarVocab: 0.15, content: 0.2, interaction: 0.05 }
      : { fluency: 0.25, pronunciation: 0.2, grammarVocab: 0.2, content: 0.25, interaction: 0.1 };
    const score = Math.round(Object.keys(w).reduce((s, k) => s + dims[k] * w[k], 0));

    return { dims, score, offline: true, transcript: '', metrics: textMetrics('') };
  }

  function mapRound(obj) {
    const out = {};
    Object.keys(obj).forEach((k) => { out[k] = Math.round(obj[k]); });
    return out;
  }

  /** 听力题评分：正确答案得分，否则 0（听力难度权重体现在题型） */
  function evaluateListening(item, userAnswer) {
    if (item.type === 'dictation') {
      const blanks = item.blanks || [];
      const given = userAnswer || [];
      let correct = 0;
      blanks.forEach((b, i) => {
        const u = String(given[i] || '').trim().toLowerCase();
        if (u && u === b.toLowerCase()) correct += 1;
      });
      const ratio = blanks.length ? correct / blanks.length : 0;
      return { type: 'dictation', correct, total: blanks.length, ratio, score: Math.round(ratio * 100) };
    }
    const ok = Number(userAnswer) === Number(item.answer);
    return { type: item.type, correct: ok ? 1 : 0, total: 1, ratio: ok ? 1 : 0, score: ok ? 100 : 0 };
  }

  /** 等级映射 */
  function levelOf(score, rubric) {
    const levels = rubric.levels;
    for (let i = 0; i < levels.length; i++) {
      if (score >= levels[i].min && score < levels[i].max) return levels[i];
    }
    return levels[levels.length - 1];
  }

  /**
   * 汇总：把逐题记录合成为维度分、总分与等级
   * @param {object} args { speaking:[{item,result,weight}], listening:[{item,result,weight}], rubric }
   */
  function aggregate(args) {
    const rubric = args.rubric;
    const dimKeys = ['fluency', 'pronunciation', 'grammarVocab', 'content', 'interaction'];

    // 口语维度加权平均
    const dimSum = {}; const dimW = {};
    dimKeys.forEach((k) => { dimSum[k] = 0; dimW[k] = 0; });
    let speakScoreSum = 0; let speakW = 0;

    (args.speaking || []).forEach((rec) => {
      const w = rec.weight || 1;
      if (rec.result && rec.result.dims) {
        dimKeys.forEach((k) => { dimSum[k] += rec.result.dims[k] * w; dimW[k] += w; });
      }
      speakScoreSum += (rec.result ? rec.result.score : 0) * w; speakW += w;
    });

    const dims = {};
    dimKeys.forEach((k) => { dims[k] = dimW[k] ? Math.round(dimSum[k] / dimW[k]) : 0; });

    // 口语总分（维度加权）
    const speakTotal = Object.keys(rubric.dimensions).reduce(
      (sum, k) => sum + dims[k] * rubric.dimensions[k].weight, 0
    );

    // 听力总分
    let listenSum = 0; let listenW = 0;
    (args.listening || []).forEach((rec) => {
      const w = rec.weight || 1;
      listenSum += (rec.result ? rec.result.score : 0) * w; listenW += w;
    });
    const listenTotal = listenW ? listenSum / listenW : 0;

    // 综合：口语 75% + 听力 25%（以沟通能力为核心，口语权重更高）
    const hasListening = (args.listening || []).length > 0;
    const overall = hasListening
      ? clamp(speakTotal * 0.75 + listenTotal * 0.25, 0, 100)
      : speakTotal;

    const total = Math.round(overall);
    const level = levelOf(total, rubric);

    // 找出最弱两项（仅口语维度参与建议）
    const ranked = dimKeys
      .map((k) => ({ key: k, value: dims[k] }))
      .sort((a, b) => a.value - b.value);
    const weak = ranked.slice(0, 2);

    return {
      dims,
      speakTotal: Math.round(speakTotal),
      listenTotal: Math.round(listenTotal),
      total,
      level,
      weak,
      hasListening,
    };
  }

  return {
    FILLERS, CONNECTORS,
    textMetrics, keywordCoverage,
    evaluateSpeaking, evaluateListening, estimateOffline,
    aggregate, levelOf,
  };
})();

window.SCORING = SCORING;