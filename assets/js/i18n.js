/**
 * ============================================================================
 *  i18n.js —— 中英双语国际化（零依赖）
 * ----------------------------------------------------------------------------
 *  用法：
 *    · 元素标注 data-i18n="key"          → 替换 textContent
 *    · 元素标注 data-i18n-html="key"     → 替换 innerHTML（含标记时）
 *    · 元素标注 data-i18n-attr="placeholder:key" → 替换属性
 *    · I18N.t(key) 取当前语言字符串
 *    · I18N.set('zh'|'en') 切换并广播 'i18n:change'
 *  默认语言：中文（zh），选择保存在 localStorage。
 * ========================================================================== */
'use strict';

const I18N = (function () {
  const DICT = {
    zh: {
      'brand.name': '口语力测评',
      'brand.sub': 'SPEAK ASSESS',
      'nav.home': '首页',
      'nav.how': '测评方式',
      'nav.levels': '等级标准',
      'nav.start': '开始测评',
      'nav.restart': '重新开始',
      'nav.quit': '退出测试',
      'nav.backHome': '返回首页',

      /* Hero */
      'hero.eyebrow': 'CEFR 对齐 · 真实沟通能力测评',
      'hero.titleHtml': '你能否和外国人 <em>流畅沟通</em>？',
      'hero.lead': '我们用一套对齐 CEFR 的维度体系，考察你真实的英语口语与听力水平——不只测分数，更告诉你差在哪、怎么补。',
      'hero.ctaQuick': '快速版（约 10 分钟）',
      'hero.ctaFull': '完整版（约 25 分钟）',
      'hero.stat1': '考察维度',
      'hero.stat2': '评估等级',
      'hero.stat3': '全题型',
      'hero.panelTitle': '能力维度雷达',
      'hero.panelNote': '示例：一位 B2 学习者',

      /* 维度（首页） */
      'dim.fluency': '流利度',
      'dim.pronunciation': '发音清晰度',
      'dim.grammarVocab': '语法与词汇',
      'dim.content': '内容相关性',
      'dim.interaction': '交际策略',

      /* 测评方式 */
      'how.eyebrow': 'HOW IT WORKS',
      'how.title': '三步得到一份可执行的报告',
      'how.lead': '测试全程在浏览器完成，语音经腾讯云语音识别与智聆口语评测打分，无需安装任何软件。',
      'how.s1t': '听力测试',
      'how.s1d': '短对话、长对话与听写填空，考察你的辨音与理解反应。',
      'how.s2t': '口语测试',
      'how.s2d': '朗读、话题独白、情景问答与听后复述，覆盖发音到交际策略。',
      'how.s3t': '生成报告',
      'how.s3d': '给出总分、等级徽章、五维雷达图，以及你最该改进的 TOP 2 项建议。',
      'how.speaking': '口语',
      'how.listening': '听力',
      'how.report': '报告',

      /* 等级标准 */
      'levels.eyebrow': 'LEVEL STANDARD',
      'levels.title': '等级划分（对齐 CEFR）',
      'levels.lead': '核心标准只有一个：能否与外国人流畅沟通。分数区间对应下列等级。',
      'levels.total': '综合得分',

      /* 设备 / 开始 */
      'start.eyebrow': 'BEFORE YOU START',
      'start.title': '开始前请确认',
      'start.check1': '使用 Chrome / Edge / Safari 最新版本浏览器',
      'start.check2': '允许本站使用麦克风（用于录音评测）',
      'start.check3': '在安静环境、佩戴耳机效果更佳',
      'start.micOk': '麦克风已就绪',
      'start.micFail': '未检测到麦克风权限，请允许后重试',
      'start.testMic': '检测麦克风',

      /* 通用 */
      'common.next': '下一题',
      'common.prev': '上一题',
      'common.submitAnswer': '提交答案',
      'common.finish': '完成并查看报告',
      'common.skip': '跳过',
      'common.replay': '重播',
      'common.listening': '听力中…',
      'common.correct': '回答正确',
      'common.wrong': '回答有误，正确答案：',
      'common.zhHint': '中文提示',
      'common.audioHint': '点击播放听取音频（自动朗读两遍）',
      'common.score': '得分',
      'common.points': '分',
      'common.of': '/',
      'common.mode': '模式',
      'common.modeQuick': '快速版',
      'common.modeFull': '完整版',
      'common.question': '第',
      'common.questionUnit': '题',
      'common.totalUnit': '题',

      /* 测试页 */
      'test.judging': '正在识别并评分…',
      'test.recordHint': '点击开始录音，尽量自然连贯地作答',
      'test.recordStart': '开始录音',
      'test.recordStop': '停止录音',
      'test.recordAgain': '重录',
      'test.readyToPlay': '播放题目音频',
      'test.played': '已完成播放',
      'test.transcriptLabel': '识别文本：',
      'test.noSpeech': '未识别到有效语音，请重录',
      'test.micDenied': '麦克风权限被拒绝，无法录音',
      'test.firstPart': '听力部分',
      'test.secondPart': '口语部分',
      'test.partIntroListen': '接下来是听力测试，请仔细听音频后作答。',
      'test.partIntroSpeak': '接下来是口语测试，请对着麦克风自然作答。',
      'test.goListen': '进入听力部分',
      'test.goSpeak': '进入口语部分',

      /* 报告页 */
      'report.eyebrow': 'YOUR RESULT',
      'report.title': '测评报告',
      'report.totalLabel': '综合得分',
      'report.origin': '核心标准：能否与外国人流畅沟通',
      'report.radarTitle': '五维雷达图',
      'report.barsTitle': '各维度得分',
      'report.adviceTitle': '最需改进 TOP 2',
      'report.detailTitle': '逐题明细',
      'report.listenScore': '听力得分',
      'report.speakScore': '口语得分',
      'report.print': '打印 / 导出 PDF',
      'report.again': '再测一次',
      'report.level': '当前等级',
      'report.goodJob': '表现均衡，保持输出频率即可稳定提升。',
      'report.weakNone': '各维度均较为均衡，继续保持。',

      /* 状态 */
      'status.mock': '演示模式：未配置腾讯云密钥，当前为模拟评分',
      'status.live': '已接入腾讯云语音识别与口语评测',
      'status.mockShort': '演示模式',
      'status.liveShort': '在线评分'
    },

    en: {
      'brand.name': 'SpeakAssess',
      'brand.sub': 'SPEAK ASSESS',
      'nav.home': 'Home',
      'nav.how': 'How it works',
      'nav.levels': 'Levels',
      'nav.start': 'Start test',
      'nav.restart': 'Restart',
      'nav.quit': 'Quit test',
      'nav.backHome': 'Back home',

      'hero.eyebrow': 'CEFR ALIGNED · REAL COMMUNICATION',
      'hero.titleHtml': 'Can you hold a <em>fluent</em> conversation in English?',
      'hero.lead': 'A CEFR-aligned framework that measures your real speaking and listening ability — not just a score, but where you fall short and how to fix it.',
      'hero.ctaQuick': 'Quick test (~10 min)',
      'hero.ctaFull': 'Full test (~25 min)',
      'hero.stat1': 'Dimensions',
      'hero.stat2': 'Levels',
      'hero.stat3': 'Task types',
      'hero.panelTitle': 'Competency radar',
      'hero.panelNote': 'Example: a B2 learner',

      'dim.fluency': 'Fluency',
      'dim.pronunciation': 'Pronunciation',
      'dim.grammarVocab': 'Grammar & Vocabulary',
      'dim.content': 'Content',
      'dim.interaction': 'Interaction',

      'how.eyebrow': 'HOW IT WORKS',
      'how.title': 'Three steps to an actionable report',
      'how.lead': 'Everything runs in your browser. Speech is scored via Tencent Cloud ASR and Smart Oral Evaluation — no installation required.',
      'how.s1t': 'Listening',
      'how.s1d': 'Short and long dialogues plus dictation, testing perception and comprehension under time.',
      'how.s2t': 'Speaking',
      'how.s2d': 'Read-aloud, topic monologue, role-play and retelling — from pronunciation to interaction.',
      'how.s3t': 'Report',
      'how.s3d': 'Total score, level badge, five-axis radar and the top two things to improve, with drills.',
      'how.speaking': 'Speaking',
      'how.listening': 'Listening',
      'how.report': 'Report',

      'levels.eyebrow': 'LEVEL STANDARD',
      'levels.title': 'Level bands (aligned to CEFR)',
      'levels.lead': 'One core criterion: can you communicate fluently with foreign speakers. Score bands map to these levels.',
      'levels.total': 'Overall score',

      'start.eyebrow': 'BEFORE YOU START',
      'start.title': 'Please confirm before starting',
      'start.check1': 'Use a recent Chrome / Edge / Safari browser',
      'start.check2': 'Allow microphone access (needed for scoring)',
      'start.check3': 'A quiet room and headphones give the best result',
      'start.micOk': 'Microphone is ready',
      'start.micFail': 'No microphone permission detected — please allow and retry',
      'start.testMic': 'Check microphone',

      'common.next': 'Next',
      'common.prev': 'Previous',
      'common.submitAnswer': 'Submit answer',
      'common.finish': 'Finish and view report',
      'common.skip': 'Skip',
      'common.replay': 'Replay',
      'common.listening': 'Listening…',
      'common.correct': 'Correct',
      'common.wrong': 'Incorrect. Correct answer: ',
      'common.zhHint': 'Chinese hint',
      'common.audioHint': 'Tap play to hear the audio (spoken twice automatically)',
      'common.score': 'Score',
      'common.points': 'pts',
      'common.of': '/',
      'common.mode': 'Mode',
      'common.modeQuick': 'Quick',
      'common.modeFull': 'Full',
      'common.question': 'Q',
      'common.questionUnit': '',
      'common.totalUnit': '',

      'test.judging': 'Recognising and scoring…',
      'test.recordHint': 'Tap to start recording and answer as naturally as you can',
      'test.recordStart': 'Start recording',
      'test.recordStop': 'Stop recording',
      'test.recordAgain': 'Record again',
      'test.readyToPlay': 'Play the audio',
      'test.played': 'Playback finished',
      'test.transcriptLabel': 'Transcript: ',
      'test.noSpeech': 'No speech detected — please record again',
      'test.micDenied': 'Microphone permission denied — cannot record',
      'test.firstPart': 'Listening section',
      'test.secondPart': 'Speaking section',
      'test.partIntroListen': 'The listening section is next. Listen carefully, then answer.',
      'test.partIntroSpeak': 'The speaking section is next. Answer naturally into the microphone.',
      'test.goListen': 'Go to listening section',
      'test.goSpeak': 'Go to speaking section',

      'report.eyebrow': 'YOUR RESULT',
      'report.title': 'Assessment report',
      'report.totalLabel': 'Overall score',
      'report.origin': 'Core criterion: can you communicate fluently with foreign speakers',
      'report.radarTitle': 'Five-axis radar',
      'report.barsTitle': 'Scores by dimension',
      'report.adviceTitle': 'Top 2 to improve',
      'report.detailTitle': 'Item-by-item detail',
      'report.listenScore': 'Listening',
      'report.speakScore': 'Speaking',
      'report.print': 'Print / Export PDF',
      'report.again': 'Take it again',
      'report.level': 'Current level',
      'report.goodJob': 'Balanced profile — keep up regular output to improve steadily.',
      'report.weakNone': 'All dimensions are fairly balanced. Keep going.',

      'status.mock': 'Demo mode: no Tencent Cloud keys configured, scores are simulated',
      'status.live': 'Connected to Tencent Cloud ASR and Smart Oral Evaluation',
      'status.mockShort': 'Demo',
      'status.liveShort': 'Live'
    }
  };

  let lang = localStorage.getItem('speaktest.lang') || 'zh';

  function t(key) {
    const table = DICT[lang] || DICT.zh;
    return (table[key] != null ? table[key] : (DICT.zh[key] != null ? DICT.zh[key] : key));
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      // 格式： placeholder:key  （可空格分隔多个）
      el.getAttribute('data-i18n-attr').split(/\s+/).forEach((pair) => {
        const [attr, key] = pair.split(':');
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('.lang-switch button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    });
  }

  function set(next) {
    lang = next === 'en' ? 'en' : 'zh';
    localStorage.setItem('speaktest.lang', lang);
    apply(document);
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang } }));
  }

  function current() { return lang; }

  // 暴露到 window，方便 HTML 内联事件与其它模块调用
  const api = { t, apply, set, current, dict: DICT };
  window.I18N = api;
  return api;
})();

document.addEventListener('DOMContentLoaded', () => {
  I18N.apply(document);
  document.querySelectorAll('.lang-switch button').forEach((b) => {
    b.addEventListener('click', () => I18N.set(b.dataset.lang));
  });
});