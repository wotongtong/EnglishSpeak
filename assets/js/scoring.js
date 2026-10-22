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
  function evaluateSpeaking(item, input) {
    input = input || {};
    const soe = input.soe || {};
    const durationSec = input.durationSec || item.durationSec || 30;
    const metrics = textMetrics(input.transcript || '');
    const isReadLike = item.type === 'read' || item.type === 'retell';

    // 发音：优先采用 SOE 的 PronAccuracy
    const pronunciation = clamp(
      pick(soe.PronAccuracy, isReadLike ? 62 : 58) * 0.92 +
      pick(soe.PronCompletion, 70) * 0.08,
      5, 99
    );

    // 流利度：朗读题以 SOE 流利度为主，话题题以文本度量为主要参考
    const soeFluency = pick(soe.PronFluency, null);
    const fluency = isReadLike && soeFluency != null
      ? clamp(soeFluency * 0.7 + fluencyScore(metrics, durationSec) * 0.3, 5, 99)
      : fluencyScore(metrics, durationSec);

    // 内容
    let content;
    if (isReadLike) {
      const cover = keywordCoverage(metrics.text, item.keywords);
      content = clamp(pick(soe.PronCompletion, 70) * 0.7 + (cover == null ? 60 : cover * 100) * 0.3, 5, 99);
    } else {
      content = contentScore(metrics, item.keywords, durationSec);
    }

    // 语法与词汇
    const grammarVocab = metrics.wordCount >= 4
      ? grammarVocabScore(metrics)
      : clamp(pick(soe.PronAccuracy, 60) * 0.6 + 20, 5, 90);

    // 交际策略：仅情景题强相关；其余用连贯性代理
    let interaction;
    if (item.type === 'interaction') {
      const hasResponse = /\?|sorry|could you|i understand|let me|sorry|thanks|thank you/i.test(metrics.text);
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
      transcript: metrics.text,
    };
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
    evaluateSpeaking, evaluateListening,
    aggregate, levelOf,
  };
})();

window.SCORING = SCORING;