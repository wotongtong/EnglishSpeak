# 口语力测评 · 腾讯云云函数 SCF + 函数 URL 版签名服务

把 `server/sign.js`（本地 Node 服务）改写成 **腾讯云云函数 SCF** 版本，
并通过 **函数 URL** 暴露公网 HTTPS 入口（**无需 API 网关**）。

> 本目录就是待上传的 zip 内容：`index.js` + `package.json`（+ 本文件）。
> **零第三方依赖**，无需 `npm install`。

---

## 一、前置准备

1. 注册并实名认证腾讯云，控制台开通 **语音识别 ASR** 与 **智聆口语评测 SOE**。
   - ⚠️ **两个服务要分别开通**，只开 ASR 也能用（此时发音分按录音特征估算，其余维度正常）。
   - SOE 属于**付费产品**：开通后通常需在控制台**购买资源包**（有 9.9 元档用于开发调试）或开通后付费，否则调用会报：
     `AuthFailure.AccountUnavailable 账号未开通口语评测服务或账号已欠费隔离`。
2. 在 **CAM → 用户** 创建**子账号**（仅编程访问），附加策略：
   - `QcloudASRFullAccess`（语音识别）
   - 口语评测对应策略（若列表无此项，用自定义策略放行 `soe:*`）
3. 记录子账号的 `SecretId` / `SecretKey`。

> 错误码对照：
> - `AuthFailure.UnauthorizedOperation ... resource (*) has no permission` → 子账号缺 CAM 策略，回 CAM 补授权。
> - `AuthFailure.AccountUnavailable 账号未开通口语评测服务或账号已欠费隔离` → **服务未开通/欠费**，去智聆口语评测控制台开通并购买资源包。
> - `InvalidAction ... action=xxx is invalid` → 接口名或 **Version 写错**，见下表。

### 接口与版本速查（本项目已固化，勿改错）

| 服务 | 域名 | Action | Version |
|---|---|---|---|
| 一句话识别 | `asr.tencentcloudapi.com` | `SentenceRecognition` | `2019-06-14` |
| 智聆口语评测 | `soe.tencentcloudapi.com` | `TransmitOralProcessWithInit` | **`2018-07-24`** |

> 注意：SOE 的 Version 是 `2018-07-24`（不是 `2018-07-17`，写错会报 `InvalidAction`）。
> 另：`SoeAppId` 指的是控制台【应用管理】里新建的**业务应用 ID**（形如 `soe_100xxxxx`），
> **不是**账号 AppId；未新建时切勿传入，否则会报欠费错误。本项目仅在显式提供时才附带该参数。

### 评分依赖说明

前端对 ASR 与 SOE **独立调用、互不拖累**：

- 识别成功 + 评测失败 → 仍给出内容/流利/语法分，发音分按录音特征估算，并在页面标注提示；
- 识别失败 → 本题降级为「离线估分」并提示，可「重试」；
- 两者都成功 → 完整五维评分。

---

## 二、创建云函数并上传 zip

1. 进入 **云函数 SCF 控制台 → 函数服务 → 新建**。
2. 选择 **从头开始**，配置：
   - 函数类型：**事件函数**
   - 函数名称：`speaktest-sign`
   - 运行环境：**Nodejs18.15**（或 Nodejs16.13，代码均兼容）
   - 提交方法：**上传 zip 包** → 选择 `speaktest-scf.zip`
   - 执行方法：`index.main_handler`
3. 高级配置建议：
   - 内存：**256 MB**
   - 超时时间：**15 秒**
   - 网络：**仅公网访问**（函数需要访问腾讯云 ASR/SOE）

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

## 四、开启「函数 URL」（替代 API 网关）

函数详情页 → 左侧 **函数 URL → 新建函数 URL**：

| 配置项 | 建议值 |
|---|---|
| 别名/版本 | 选 **`$LATEST`**（改代码后即时生效；绑定固定版本则需重新发布版本并重新绑定） |
| 公网/内网访问 | **开启公网访问**（前端在浏览器里调用，必须开） |
| 授权类型 | **开放（NONE）** —— 允许匿名访问，否则浏览器请求会被 CAM 鉴权拦截 |
| CORS | 建议 **关闭**（本函数已在响应中返回 CORS 头，避免重复 `Access-Control-Allow-Origin` 导致浏览器报错） |

创建完成后得到公网地址，形如：

```
https://12345678-xxxxxxxx.ap-guangzhou.tencentscf.com
```

> ⚠️ 该地址**不要带结尾斜杠、不要附带路径**。前端会自行拼接 `?action=...`。

---

## 五、让前端指向函数 URL

在页面 `<head>` 中、**在其它脚本之前**加入：

```html
<script>window.SPEAKTEST_API_BASE = 'https://12345678-xxxxxxxx.ap-guangzhou.tencentscf.com';</script>
```

或临时验证时在浏览器控制台执行：

```js
localStorage.setItem('speaktest.apiBase', 'https://12345678-xxxxxxxx.ap-guangzhou.tencentscf.com');
location.reload();
```

前台会自动识别这是 `tencentscf.com` 域名，改用 `?action=` 方式调用：

| 功能 | 实际请求 |
|---|---|
| 语音识别 | `POST https://<函数URL>/?action=asr` |
| 口语评测 | `POST https://<函数URL>/?action=soe` |
| 健康检查 | `GET  https://<函数URL>/?action=health` |

> 若你更希望保持 `/api/asr` 这种路径写法，也可把 `SPEAKTEST_API_BASE` 设为
> `https://<函数URL>/api`，前端会自动拼接 `/api/asr` 等（前提是函数 URL 会透传路径）。

刷新后首页页脚会显示 **「已接入腾讯云语音识别与口语评测」**，答题页右上角标签变为 **「在线评分」**。

---

## 六、验证

```bash
# 健康检查（应返回 configured: true, mock: false）
curl "https://<函数URL>/?action=health"

# 语音识别（把 <BASE64_WAV> 换成一段 16k 单声道 wav 的 base64）
curl -X POST "https://<函数URL>/?action=asr" \
     -H "Content-Type: application/json" \
     -d "{\"audioBase64\":\"<BASE64_WAV>\",\"format\":\"wav\"}"
```

云函数控制台 → **日志** 中能看到每次调用的输出与错误。

---

## 七、函数 URL 的事件结构（与 API 网关的差异）

函数 URL 兼容 API 网关协议，但**去掉了以下字段**：

- `isBase64Encoded`
- `pathParameters`
- `queryStringParameters`
- `requestContext`

实际传入函数的 `event` 形如：

```json
{
  "httpMethod": "POST",
  "path": "/",
  "headers": { "content-type": "application/json" },
  "queryString": { "action": "asr" },
  "body": "{\"audioBase64\":\"...\",\"format\":\"wav\"}"
}
```

`index.js` 已同时兼容 `queryString` 与 `queryStringParameters`、`path` 与 `rawPath`，
并按「路径 → 查询参数 → body.action」的顺序判定 `asr / soe / health`，因此无需改动即可工作。

响应为标准负载：

```json
{ "isBase64Encoded": false, "statusCode": 200, "headers": { }, "body": "{\"ok\":true,...}" }
```

---

## 八、接口约定（与前端一致）

### `POST /?action=asr`
请求：`{ "audioBase64": "...", "format": "wav", "engine": "16k_en" }`
响应：`{ "ok": true, "data": { "Result": "识别文本", "AudioDuration": 3 } }`

### `POST /?action=soe`
请求：`{ "audioBase64": "...", "refText": "参考文本", "evalMode": 1, "workMode": 0, "scoreCoeff": 2.0 }`
响应：`{ "ok": true, "data": { "PronAccuracy": 88, "PronFluency": 90, "PronCompletion": 95, "SuggestedScore": 90 } }`

### `GET /?action=health`
响应：`{ "ok": true, "configured": true, "region": "ap-guangzhou", "mock": false }`

> 未配置密钥时自动进入 **演示模式**（返回 `Mock: true` 的模拟数据），前端流程不受影响。

---

## 九、请求体大小与录音时长

- 函数 URL / 请求体的可承载大小有限，音频体积随录制时长线性增长
  （16 kHz 单声道 16 bit ≈ 32 KB/秒，Base64 后约为 1.33 倍）。
- 前端已做双重保护：
  1. 录音**硬上限 = min(建议时长 + 10 秒, 58 秒)**，到点自动停止；
  2. 若编码后体积超过约 4 MB，本题自动降级为**离线估分**并给出提示，不会整题失败。
- 一句话识别本身也有时长上限（约 60 秒），因此精简作答对识别准确率更有利。

---

## 十、费用与配额

| 项 | 说明 |
|---|---|
| SCF 云函数 | 每月有免费额度（调用次数 + 资源用量），个人测评用量极低 |
| 函数 URL | 随函数调用计费，无额外网关费用 |
| ASR / SOE | 按次计费，见官网价目 |

个人场景整体成本约为**每次测评几分钱**，具体以腾讯云控制台当日价目为准。

---

## 十一、常见问题

| 现象 | 排查 |
|---|---|
| 前端仍显示「演示模式」 | 环境变量是否配置；`/?action=health` 是否返回 `configured: true` |
| 404 / 接口不存在 | 请求缺少 `?action=`，或 `SPEAKTEST_API_BASE` 里多带了路径 |
| 浏览器 CORS 报错 | 函数 URL 的 CORS 开关若已开启，会与本函数返回的 CORS 头重复；二选一即可 |
| 请求被 401/403 拦截 | 函数 URL 授权类型选成了 CAM，改为「开放（NONE）」 |
| `AuthFailure.UnauthorizedOperation` | 子账号缺 `QcloudASRFullAccess` / SOE 策略 |
| 超时 | 函数超时设 15 秒；确认函数网络为「仅公网访问」 |
| 改了代码不生效 | 函数 URL 绑定了固定版本；改绑 `$LATEST`，或发布新版本后重新绑定 |
| 上传 zip 后执行报错 | 确认执行方法为 `index.main_handler`，且 zip 解压后 `index.js` 位于根目录 |

---

## 十二、语音合成（TTS）—— 听力音频改由腾讯云生成

听力与复述题的音频不再依赖浏览器朗读，而是由**腾讯云语音合成**生成后交由浏览器播放。

### 接口

```
POST /?action=tts
{ "text": "Attention please...", "voiceType": 101001, "speed": 0 }
```

响应：

```json
{ "ok": true, "data": { "Audio": "<base64 wav>", "SessionId": "tts-...", "Cached": true } }
```

前端把 `Audio` 解码为 Blob 后用 `<audio>` 播放，**不经过浏览器语音合成**。

### 参数与默认值

| 参数 | 默认 | 说明 |
|---|---|---|
| `VoiceType` | `101001`（英文女声） | 可用环境变量 `TTS_VOICE_TYPE` 覆盖 |
| `PrimaryLanguage` | `2` | 固定英文 |
| `SampleRate` | `16000` | 与识别/评测保持一致 |
| `Codec` | `wav` | 浏览器可直接播放 |
| `Speed` | `0` | 范围 -2~6，0 为正常语速 |
| `Text` | — | **必填**，英文上限 500 字符 |

### 服务开通

语音合成是**独立于 ASR 的产品**，需在控制台单独开通「**语音合成 TTS**」；未开通会返回鉴权类错误。

### 费用与缓存

- TTS **按字符计费**，单条听力脚本约 100–250 字符，一次完整测评约数千字符，成本极低。
- 为避免重复计费，做了**两层缓存**：
  - **服务端**：进程内缓存最近 30 条（`voice|speed|text` 为键）；
  - **前端**：同一会话内相同文本只请求一次，重播直接复用 Blob URL。

### 降级行为

TTS 调用失败时（网络异常 / 未开通），播放条会提示失败并**自动展开听力原文**，答题流程不中断。

## 十三、安全提示

- 仅使用**子账号**密钥，并在 CAM 中授予最小必要权限。
- 密钥只放云函数环境变量，**不要**写进代码、前端或仓库。
- 函数 URL 选「开放」即公网匿名可调用，如需限制可在代码内加简单鉴权（如校验自定义 Header）。
- 若曾把密钥写入本地 `.env` 并担心泄露，请到 CAM 轮换密钥。