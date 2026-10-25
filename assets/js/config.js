/**
 * ============================================================================
 *  config.js —— 统一服务端地址配置（须在其它脚本之前加载）
 * ----------------------------------------------------------------------------
 *  只需修改下方 REMOTE_API 一个地方：
 *    · 本地开发（localhost / 127.0.0.1）→ 自动使用 LOCAL_API（node server/sign.js，端口 8787）
 *    · 线上 / GitHub Pages          → 自动使用 REMOTE_API（你的腾讯云函数 URL）
 *
 *  临时覆盖（不改代码）：
 *    浏览器控制台执行
 *      localStorage.setItem('speaktest.apiBase', '你的地址'); location.reload();
 *    恢复默认
 *      localStorage.removeItem('speaktest.apiBase'); location.reload();
 * ========================================================================== */
(function () {
  /* 👇 把腾讯云「函数 URL」填在这里（不要带结尾斜杠、不要带路径）
     形如：https://12345678-xxxxxxxx.ap-guangzhou.tencentscf.com */
  var REMOTE_API = '';

  /* 本地签名服务（node server/sign.js） */
  var LOCAL_API = 'http://localhost:8787';

  var host = location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '' || location.protocol === 'file:';

  // 控制台 / localStorage 覆盖优先
  var override = null;
  try { override = localStorage.getItem('speaktest.apiBase'); } catch (e) { override = null; }

  window.SPEAKTEST_API_BASE = override || (isLocal ? LOCAL_API : (REMOTE_API || LOCAL_API));

  if (!isLocal && !REMOTE_API && !override) {
    console.warn('[speaktest] 尚未配置 REMOTE_API（腾讯云函数 URL）：线上将无法调用识别服务，会自动退化为演示/离线模式。请在 assets/js/config.js 中填写 REMOTE_API。');
  }
})();