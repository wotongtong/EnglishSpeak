/**
 * 本地自测：伪造 API 网关事件调用云函数 main_handler，无需部署到腾讯云。
 * 运行：node server/scf/test-local.js
 * 若已在 shell 中设置 TENCENT_* 环境变量，则可直接验证真实调用。
 */
'use strict';

const handler = require('./index').main_handler;

function show(title, res) {
  console.log('\n=== ' + title + ' ===');
  console.log('statusCode:', res.statusCode);
  console.log('body:', String(res.body).slice(0, 300));
}

(async function () {
  show('GET /api/health', await handler({ httpMethod: 'GET', path: '/api/health' }, {}));

  show('POST /api/asr（演示模式，假音频）', await handler({
    httpMethod: 'POST',
    path: '/api/asr',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audioBase64: 'QUJDREVG', format: 'wav', engine: '16k_en' }),
  }, {}));

  show('POST /api/soe（演示模式，假音频）', await handler({
    httpMethod: 'POST',
    path: '/api/soe',
    body: JSON.stringify({ audioBase64: 'QUJDREVG', refText: 'Hello world', evalMode: 1 }),
  }, {}));

  show('单路径 + 查询参数：/api?action=health', await handler({
    httpMethod: 'GET', path: '/api', queryString: { action: 'health' },
  }, {}));

  show('OPTIONS 预检', await handler({ httpMethod: 'OPTIONS', path: '/api/asr' }, {}));

  show('未知路径', await handler({ httpMethod: 'GET', path: '/api/unknown' }, {}));
})();