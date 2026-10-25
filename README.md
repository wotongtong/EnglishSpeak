# 口语力测评 · 英语口语水平测评网站

以 **「能否与外国人流畅沟通」** 为核心标准的英语口语 + 听力在线测评。完成测试后给出
CEFR 对齐的等级、五维能力分与可执行的改进建议。

- 纯前端（原生 HTML/CSS/JS，零框架、零依赖）+ 一个极简 Node.js 签名服务
- 语音识别：**腾讯云 一句话识别 ASR**
- 口语评测：**腾讯云 智聆口语评测 SOE**（发音 / 流利度 / 完整度）
- 界面：**中英双语**，可一键切换
- 两种模式：**快速版（约 10 分钟）** 与 **完整版（约 25 分钟）**

---

## 目录结构

```
.
├── index.html              # 首页：介绍 / 等级表 / 麦克风自检
├── test.html               # 测评主流程（听力 → 口语）
├── report.html             # 成绩报告（总分环 / 五维雷达 / 建议）
├── assets/
│   ├── css/style.css       # 设计系统（无框架，响应式）
│   ├── js/
│   │   ├── i18n.js         # 中英双语词典与切换
│   │   ├── core.js         # 数据加载 / 会话存储 / 语音合成 / 图标
│   │   ├── recorder.js     # 麦克风采集 → 16k 单声道 WAV → Base64
│   │   ├── api.js          # 调用签名服务（ASR / SOE）
│   │   ├── scoring.js      # 评分引擎（文本度量 + 维度加权 + 等级映射）
│   │   ├── test.js         # 测评流程编排
│   │   └── report.js       # 报告渲染（原生 Canvas 雷达图）
│   └── data/
│       ├── speaking.json   # 口语题库
│       ├── listening.json  # 听力题库
│       └── rubric.json     # 评分规则 / 等级分档 / 建议
├── server/
│   ├── sign.js             # 本地版：腾讯云 TC3-HMAC-SHA256 签名代理（零依赖）
│   ├── package.json
│   ├── .env.example        # 密钥模板（复制为 .env 填写）
│   └── scf/                # 云函数 SCF 版（可直接上传腾讯云）
│       ├── index.js        # 入口 index.main_handler
│       ├── package.json
│       ├── test-local.js   # 本地伪造事件自测
│       └── README.md       # SCF 部署步骤
├── dist/
│   └── speaktest-scf.zip   # 待上传腾讯云的打包产物（已被 .gitignore 忽略）
└── .gitignore
```

---

## 一、本地运行

### 1. 启动静态站点（前端）

前端需要经 HTTP 访问（不能直接双击 `file://` 打开，否则题库 JSON 会被浏览器安全策略拦截）。

```bash
# 任选其一
python -m http.server 8080
# 或
npx serve -l 8080
```

浏览器打开：<http://localhost:8080/>

### 2. 启动签名服务（语音识别）

```bash
cd server
copy .env.example .env        # Windows
# cp .env.example .env        # macOS / Linux
# 编辑 .env 填入密钥
node sign.js
```

服务默认监听 <http://localhost:8787>，启动成功后可访问
<http://localhost:8787/api/health> 查看状态（`configured: true` 表示密钥已加载）。

> **未配置密钥时**，前端会自动进入「演示模式」，返回模拟分数，方便先体验完整流程。

---

## 二、腾讯云配置（重要）

### 1. 开通服务

1. 注册 / 登录腾讯云并完成实名认证。
2. 控制台搜索 **「语音识别 ASR」** → 开通服务。
3. 控制台搜索 **「智聆口语评测 SOE」** → 开通服务。

### 2. 创建**子账号**密钥（不要使用主账号密钥）

1. 进入 **访问管理 CAM → 用户 → 新建用户**（自定义创建，仅编程访问）。
2. 为该子用户附加策略：
   - `QcloudASRFullAccess`（语音识别）
   - `QcloudSOEFullAccess`（口语评测，若列表无此项，请附加自定义策略，允许
     `soe:*` 与 `asr:*` 相关接口）
3. 生成并保存 `SecretId` / `SecretKey`。
4. 在 **账号信息** 中获取 `AppId`。

> 若调用返回 `AuthFailure.UnauthorizedOperation ... resource (*) has no permission`，
> 即表示子账号缺少上述策略，请在 CAM 中补充授权。

### 3. 填写 `server/.env`

```ini
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
TENCENT_APP_ID=你的AppId
TENCENT_REGION=ap-guangzhou
PORT=8787
```

`.env` 已加入 `.gitignore`，**不会**被提交到仓库。

### 4. 费用说明（按量付费，以官网最新价为准）

| 服务 | 计费方式 | 参考单价 | 免费额度 |
|---|---|---|---|
| 一句话识别 ASR | 按调用次数 | 约 ¥1.2–2 / 千次 | 每月有免费额度 |
| 智聆口语评测 SOE | 按调用次数 | 约 ¥2–4 / 千次 | 每月有免费额度 |

个人测评场景每次成本约几分钱。**实际价目请以腾讯云控制台当日为准。**

---

## 三、评分体系

| 维度 | 权重 | 说明 |
|---|---|---|
| 流利度 Fluency | 25% | 语速、停顿、自我修正 |
| 发音清晰度 Pronunciation | 25% | 音素、重音、连读、语调 |
| 语法与词汇 Grammar & Vocabulary | 20% | 句法正确性、词汇丰富度 |
| 内容相关性 Content | 20% | 切题、逻辑、观点完整 |
| 交际策略 Interaction | 10% | 应答、追问、话轮衔接 |

综合分 = 口语 75% + 听力 25%；等级分档 A1 / A2 / B1 / B2 / C1 / C2（对齐 CEFR）。
详见 `assets/data/rubric.json`。

---

## 四、部署

### 前端（GitHub Pages）

1. 推送到 GitHub 仓库（见下）。
2. 仓库 **Settings → Pages → Source** 选择 `main` 分支 `/ (root)`。
3. 访问 `https://<用户名>.github.io/<仓库名>/`。

### 后端签名服务（任选其一）

- **本地/自建**：`node server/sign.js`（端口 8787，适合开发调试）
- **腾讯云云函数 SCF + 函数 URL（推荐，可配合 GitHub Pages 使用）**：
  源码在 `server/scf/`，完整步骤见 [`server/scf/README.md`](server/scf/README.md)；
  待上传的打包产物为 `dist/speaktest-scf.zip`（含 `index.js` / `package.json` / `README.md`）。
  上传后在「函数配置 → 环境变量」填入密钥，再开启**函数 URL**（开启公网、授权类型选「开放」），
  把得到的 `https://xxxx.ap-guangzhou.tencentscf.com` 写入前端 `window.SPEAKTEST_API_BASE` 即可（无需 API 网关）。
- **Vercel / 其它 Serverless**：包装为 `/api/asr`、`/api/soe` 函数

部署后修改前端 API 地址（任选其一）：
- 在页面 `<head>` 前置 `<script>window.SPEAKTEST_API_BASE = 'https://你的服务地址';</script>`
- 或在浏览器控制台执行 `localStorage.setItem('speaktest.apiBase','https://你的服务地址')`

---

## 五、上传到 GitHub

```bash
git init
git add .
git commit -m "init: 英语口语水平测评网站"
git branch -M main
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

> 推送前请确认 `.env` 未被跟踪：`git status` 中不应出现 `server/.env`。
> 认证推荐使用 **Personal Access Token** 或 **SSH Key**。

---

## 六、免责与隐私

- 密钥仅存于服务端，前端永不持有。
- 测评记录保存在浏览器 `localStorage`，不上传第三方服务器。
- 本站为测评演示工具，结果仅供参考，不构成任何官方语言能力认证。