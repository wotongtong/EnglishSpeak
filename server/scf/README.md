# 口语力测评 · 腾讯云云函数 SCF 版签名服务

把 `server/sign.js`（本地 Node 服务）改写成 **腾讯云云函数 SCF** 版本，
部署后即可让 GitHub Pages 上的静态站点获得真实的语音识别与口语评测能力。

> 本目录就是待上传的 zip 内容：`index.js` + `package.json`（+ 本文件）。
> **零第三方依赖**，无需 `npm install`。

---

## 一、前置准备（与本地版完全一致）

1. 注册并实名认证腾讯云，控制台开通 **语音识别 ASR** 与 **智聆口语评测 SOE**。
2. 在 **CAM → 用户** 创建**子账号**（仅编程访问），附加策略：
   - `QcloudASRFullAccess`
   - 口语评测对应策略（若列表无此项，用自定义策略放行 `soe:*`）
3. 记录子账号的 `SecretId` / `SecretKey`，以及账号的 `AppId`（可选）。

> 若调用报 `AuthFailure.UnauthorizedOperation ... resource (*) has no permission`，
> 表示子账号缺策略，回 CAM 补充即可。

---

## 二、创建云函数并上传 zip

1. 进入 **云函数 SCF 控制台 → 函数服务 → 新建**。
2. 选择 **从头开始**，配置：
   - 函数名称：`speaktest-sign`
   - 运行环境：**Nodejs18.15**（或 Nodejs16.13，代码均兼容）
   - 提交方法：**上传 zip 包** → 选择本压缩包 `speaktest-scf.zip`
   - 执行方法：`index.main_handler`
3. 高级配置建议：
   - 内存：**256 MB**
   - 超时时间：**15 秒**（识别 + 评测需留出余量）

---

## 三、配置环境变量（关键）

函数详情页 → **函数配置 → 编辑 → 环境变量**，新增：

| 变量名 | 必填 | 说明 |
|---|---|---|
| `TENCENT_SECRET_ID` | 是 | 子账号 SecretId |
| `TENCENT_SECRET_KEY` | 是 | 子账号 SecretKey |
| `TENCENT_APP_ID` | 否 | 账号 AppId，可留空 |
| `TENCENT_REGION` | 否 | 默认 `ap-guangzhou` |

> 密钥只存在于云函数环境变量中，**不会出现在代码或前端**。

---

## 四、创建 API 网关触发器（对外 HTTP 入口）

函数详情页 → **触发管理 → 创建触发器**：

- 触发方式：**API 网关触发**
- 请求方法：**ANY**
- **勾选「集成响应」**（很重要，否则前端拿到的是网关包装后的结构）
- 路径：见下面两种方案

### 方案 A（推荐）：三个路径

依次创建三个触发器，执行方法均为 `index.main_handler`，路径分别填：

| 方法 | 路径 | 对应功能 |
|---|---|---|
| POST | `/api/asr` | 语音识别 |
| POST | `/api/soe` | 口语评测 |
| GET | `/api/health` | 健康检查 |

创建后，访问地址形如：

```
https://service-xxxxxxxx-1234567890.gz.apigw.tencentcs.com/release/
```

前端使用的基础地址即为该 `release/` 之前的部分（即去掉末尾 `release/` 或保留均可，
前端代码会拼接 `/api/asr` 等路径，故填到 `.../release` 即可）。

### 方案 B：单路径 + 查询参数

只创建一个触发器：方法 **ANY**，路径 `/api`（或 `/`）。
调用时用查询参数区分：

```
POST https://<你的网关地址>/api?action=asr
POST https://<你的网关地址>/api?action=soe
GET  https://<你的网关地址>/api?action=health
```

> 方案 B 前端需要改造 URL，一般建议直接用方案 A。

---

## 五、让前端指向云函数

在页面 `<head>` 中、**在其它脚本之前**加入：

```html
<script>window.SPEAKTEST_API_BASE = 'https://service-xxxx.gz.apigw.tencentcs.com/release';</script>
```

或临时验证时在浏览器控制台执行：

```js
localStorage.setItem('speaktest.apiBase', 'https://service-xxxx.gz.apigw.tencentcs.com/release');
location.reload();
```

刷新后首页页脚会显示 **「已接入腾讯云语音识别与口语评测」**，答题页右上角标签变为 **「在线评分」**。

---

## 六、验证

```bash
# 健康检查（应返回 configured: true, mock: false）
curl "https://<你的网关地址>/api/health"

# 语音识别（把 <BASE64_WAV> 换成一段 16k 单声道 wav 的 base64）
curl -X POST "https://<你的网关地址>/api/asr" \
     -H "Content-Type: application/json" \
     -d "{\"audioBase64\":\"<BASE64_WAV>\",\"format\":\"wav\"}"
```

云函数控制台 → **日志** 中也能看到每次调用的输出与错误。

---

## 七、接口约定（与前端一致）

### POST /api/asr
请求：`{ "audioBase64": "...", "format": "wav", "engine": "16k_en" }`
响应：`{ "ok": true, "data": { "Result": "识别文本", "AudioDuration": 3 } }`

### POST /api/soe
请求：`{ "audioBase64": "...", "refText": "参考文本", "evalMode": 1, "workMode": 0, "scoreCoeff": 2.0 }`
响应：`{ "ok": true, "data": { "PronAccuracy": 88, "PronFluency": 90, "PronCompletion": 95, "SuggestedScore": 90 } }`

### GET /api/health
响应：`{ "ok": true, "configured": true, "region": "ap-guangzhou", "mock": false }`

> 未配置密钥时，服务自动进入 **演示模式**（返回 `Mock: true` 的模拟数据），前端流程不受影响。

---

## 八、费用与配额

| 项 | 说明 |
|---|---|
| SCF 云函数 | 每月有免费额度（调用次数 + 资源用量），个人测评用量极低 |
| API 网关 | 按调用次数计费，有免费额度 |
| ASR / SOE | 按次计费，见官网价目 |

个人场景整体成本约为**每次测评几分钱**，具体以腾讯云控制台当日价目为准。

---

## 九、常见问题

| 现象 | 排查 |
|---|---|
| 前端仍显示「演示模式」 | 检查环境变量是否配置、`/api/health` 是否返回 `configured: true` |
| 返回 404 接口不存在 | 触发器路径不对，或未勾选「集成响应」 |
| `AuthFailure.UnauthorizedOperation` | 子账号缺 `QcloudASRFullAccess` / SOE 策略 |
| `fetch failed` / 超时 | 函数超时过短（建议 15s），或地域与资源不匹配 |
| CORS 报错 | 本函数已返回 `Access-Control-Allow-Origin: *`；确认走的是 API 网关直连而非其它代理 |
| 上传 zip 后执行报错 | 确认执行方法为 `index.main_handler`，且 zip 解压后 `index.js` 位于根目录 |

---

## 十、安全提示

- 仅使用**子账号**密钥，并在 CAM 中授予最小必要权限。
- 密钥只放云函数环境变量，**不要**写进代码、前端或仓库。
- 若曾把密钥写入本地 `.env` 并担心泄露，请到 CAM 轮换密钥。