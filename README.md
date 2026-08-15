# dsh-token-cost-meter

DeepSeek Harness（DSH）插件：在 Web GUI 输入框下方的统计行中实时显示**当前会话累计 token 消耗**与**估算费用（人民币）**，价格从 DeepSeek 官方价格页动态获取。

支持两种形态：**可安装的 dsh.bundle 包**（推荐，随 DSH 启动常驻）与**动态 cordis_define 用法**（临时运行）。

## 效果

输入框下方（自带 stats 行右侧）新增一行读数：

```
费用 ¥0.13 · 43.2K tokens
```

鼠标悬停显示明细：计价模型、输入（缓存未命中/命中分桶）、输出、计价模式（现行价 / 高峰时段价 / 空闲时段价）、价格来源与抓取时间。

## 功能特性

- **真实用量**：读取会话投影 `tokenUsage`（服务商上报的累计用量：未命中输入 / 缓存命中 / 输出，与 DSH 自带统计行同源）
- **官方动态价格**：Host 端每 6 小时抓取并解析 DeepSeek 官方价格页（含峰谷价表，按北京时间自动切换时段）
- **优雅降级**：官方页抓取失败时自动改用内置价格快照，金额前加 `≈` 并在悬停提示中标注原因
- **模型识别三级回退**：最近请求 `provenance` → `requestConfig` → Host `agents.options.model`；全部失败时显示按各模型分别计算的价格区间
- **零数据外传**：唯一出站请求为官方公开价格页；token 用量仅本地展示，不上传、不落盘

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `index.js` | 安装版 Host 半边：抓取/解析官方价格页，`/api/token-cost-meter/*` 路由（`pricing` / `model`） |
| `lib/client.js` | 安装版 Client 半边：输入框下方 UI、费用计算 |
| `cordis.patch.yml` | bundle 补丁：向 DSH 组合插入本插件行 |
| `host.js` | 动态版 Host 半边（`cordis_define` 的 `code.host`），与安装版功能等价 |
| `client.js` | 动态版 Client 半边（`code.client`） |
| `README.md` / `SECURITY.md` / `CHANGELOG.md` / `LICENSE` | 文档与许可 |

## 安装（dsh.bundle）

本仓库同时是可安装的 dsh 插件包（`package.json` 声明 `dsh.bundle` + `dsh.client`）：

```sh
dsh plugin --profile web add github:YZz-S/dsh-token-cost-meter
```

安装后重启 DSH，输入框下方的费用读数自动生效。
动态用法（`cordis_define` 加载 `host.js` / `client.js`）仍保留，两种方式二选一。

## 使用方法

### 方式一：动态 Cordis 插件（临时运行）

1. 打开 DSH Web，进入会话；
2. 让助手调用 `cordis_define`，将 `host.js` 全文作为 `code.host`、`client.js` 全文作为 `code.client` 提交；
3. `cordis_run` 运行返回的 `pluginId` / `packageId`；
4. 在 Run 卡片上批准（建议勾选双 ✓，后续版本更新免审批）；
5. 刷新页面，输入框下方出现费用读数。

> 动态插件的生命周期与当前 DSH 进程相同：重启 DSH 后需重新 define + run。

### 方式二：正式插件（常驻）

即上方「安装（dsh.bundle）」一节，`dsh plugin add` 后随 DSH 启动自动加载。

## 工作原理

```
┌─────────────────────────── Client（浏览器） ───────────────────────────┐
│ conversation.composer.dock（输入框下方统计行）                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ CostLine 组件                                                      │ │
│  │  · useProjection('tokenUsage') ← 会话累计真实用量（实时更新）      │ │
│  │  · GET /api/token-cost-meter/pricing ← 官方价格（TTL 6h + 快照兜底）│ │
│  │  · GET /api/token-cost-meter/model   ← 会话模型（Host 侧来源）     │ │
│  │  费用 = 未命中输入×未命中价 + 缓存命中×命中价 + 输出×输出价          │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                              │ fetch（同源 HTTP）
┌───────────────────────── Host（DSH Node 进程） ─────────────────────────┐
│ webServer 路由: pricing（原生 fetch 抓官方页 → 解析两套价表）            │
│                model（agents.get(sessionId).options.model）             │
└─────────────────────────────────────────────────────────────────────────┘
```

## 计费口径

```
费用（人民币）= 缓存未命中输入 × 未命中价 + 缓存命中 × 命中价 + 输出 × 输出价
```

- 价格单位：人民币 / 百万 tokens，取自官方价格页；2026-08-17 起按官方公告的峰谷价表自动切换（北京时间 9:00–12:00、14:00–18:00 为高峰时段，其余为空闲时段）。
- 缓存写入按未命中价计（与 DeepSeek 计费规则一致）。

## 平台要求

- DSH（Web 模式，支持动态 Cordis 插件；已在 DSH 0.1.0-rc.6 + Node.js v22 + Windows 验证）
- 安装版无额外依赖：宿主进程自带 `fetch`（Node ≥ 18）
- 动态版（`host.js`）的价格抓取命令为 PowerShell 语法，Windows 开箱即用；Linux/macOS 需替换 `host.js` 中 `NODE_FETCH` 为对应 shell 语法

## 为什么动态版用 node.exe 抓取价格页

DSH 动态插件沙盒禁用了 `fetch` / `require`，且 Web 部署默认不挂载 `ctx.web` 的 fetch provider（防 SSRF）；同时 Windows 沙盒执行器会破坏 curl / PowerShell 的 schannel TLS 凭据。因此动态版经 `ctx.shell` 调用 `node.exe`（OpenSSL TLS，不受 schannel 影响）抓取唯一的硬编码官方 URL，命令字符串无任何外部输入拼接，无命令注入面。安装版宿主进程自带原生 fetch，不受此限制。

## 已知限制

- 费用为估算值，非官方账单；实际以 DeepSeek 平台扣费为准
- 内置价格快照（2026-08-15 抓取）可能滞后于官方调价，仅供动态抓取失败时兜底
- 动态插件为会话级：DSH 进程重启后需重新安装（见「方式二」）

## 许可

[MIT](LICENSE)
