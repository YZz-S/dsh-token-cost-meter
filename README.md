# dsh-token-cost-meter

[English](#english) · [中文](#中文)

> DeepSeek Harness (DSH) plugin that shows the current session's cumulative token consumption and estimated cost (CNY) in real time in the stats line below the input box, with prices fetched dynamically from the official DeepSeek pricing page.
>
> DeepSeek Harness（DSH）插件：在 Web GUI 输入框下方的统计行中实时显示当前会话累计 token 消耗与估算费用（人民币），价格从 DeepSeek 官方价格页动态获取。

Supports two forms: an **installable dsh.bundle package** (recommended, persists across DSH restarts) and the **dynamic `cordis_define` usage** (temporary run).

## English

[中文](#中文) · [← Back to DeepSeekHarnessPlugins](../README.md)

### Preview

A new stats line appears below the input box (right of the built-in stats line):

```
Cost ¥0.13 · 43.2K tokens
```

Hovering shows the breakdown: pricing model, input (cache-miss / cache-hit buckets), output, pricing mode (current / peak-hour / off-peak-hour), price source and fetch time.

### Features

- **Real usage**: reads the session projection `tokenUsage` (provider-reported cumulative usage: cache-miss input / cache-hit input / output — same source as DSH's built-in stats line)
- **Official dynamic pricing**: the Host fetches and parses the official DeepSeek pricing page every 6 hours (including peak/off-peak price tables, auto-switching by Beijing time)
- **Graceful degradation**: if the official page fetch fails, automatically falls back to the built-in price snapshot, prefixing amounts with `≈` and noting the reason in the hover tooltip
- **Three-level model detection fallback**: recent request `provenance` → `requestConfig` → Host `agents.options.model`; if all fail, displays a price range computed per model
- **Zero data egress**: the only outbound request is the official public pricing page; token usage is displayed locally only — never uploaded or persisted

### Files

| File | Description |
| --- | --- |
| `index.js` | Installed Host half: fetches/parses the official pricing page; `/api/token-cost-meter/*` routes (`pricing` / `model`) |
| `lib/client.js` | Installed Client half: UI below the input box, cost calculation |
| `cordis.patch.yml` | Bundle patch: inserts this plugin's row into the DSH composition |
| `host.js` | Dynamic Host half (`cordis_define` `code.host`), functionally equivalent to the installed form |
| `client.js` | Dynamic Client half (`code.client`) |
| `README.md` / `SECURITY.md` / `CHANGELOG.md` / `LICENSE` | Docs & license |

### Installation (dsh.bundle)

This repo is also an installable dsh plugin package (`package.json` declares `dsh.bundle` + `dsh.client`):

```sh
dsh plugin --profile web add github:YZz-S/dsh-token-cost-meter
```

After installation, restart DSH and the cost stats line below the input box takes effect automatically. The dynamic usage (`cordis_define` loading `host.js` / `client.js`) is kept; pick either one.

### Usage

#### Method 1: dynamic Cordis plugin (temporary)

1. Open DSH Web and enter a session;
2. Ask the assistant to call `cordis_define`, submitting `host.js` full text as `code.host` and `client.js` full text as `code.client`;
3. `cordis_run` the returned `pluginId` / `packageId`;
4. Approve on the Run card (double ✓ recommended to skip approval for future updates);
5. Refresh the page; the cost stats line appears below the input box.

> A dynamic plugin lives as long as the current DSH process: after a DSH restart you must define + run it again.

#### Method 2: install as a regular plugin (persistent)

That's the "Installation (dsh.bundle)" section above — after `dsh plugin add` it loads automatically at DSH startup.

### How it works

```
┌────────────────────────── Client (browser) ──────────────────────────┐
│ conversation.composer.dock (stats line below input box)               │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ CostLine component                                                │ │
│  │  · useProjection('tokenUsage') ← session cumulative real usage    │ │
│  │  · GET /api/token-cost-meter/pricing ← official prices (TTL 6h +  │ │
│  │    snapshot fallback)                                             │ │
│  │  · GET /api/token-cost-meter/model   ← session model (Host side)  │ │
│  │  cost = miss input × miss price + cache-hit × hit price +         │ │
│  │         output × output price                                     │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                              │ fetch (same-origin HTTP)
┌──────────────────────── Host (DSH Node process) ──────────────────────┐
│ webServer routes: pricing (native fetch → parse both price tables)    │
│                   model (agents.get(sessionId).options.model)         │
└───────────────────────────────────────────────────────────────────────┘
```

### Billing basis

```
Cost (CNY) = cache-miss input × miss price + cache-hit input × hit price + output × output price
```

- Price unit: CNY / million tokens, taken from the official pricing page; since 2026-08-17 auto-switches per the officially announced peak/off-peak table (Beijing time 9:00–12:00 and 14:00–18:00 are peak hours, the rest are off-peak).
- Cache writes are billed at the miss price (consistent with DeepSeek billing rules).

### Platform requirements

- DSH (Web mode, dynamic Cordis plugins supported; verified on DSH 0.1.0-rc.6 + Node.js v22 + Windows)
- Installed form has no extra dependencies: the host process has native `fetch` (Node ≥ 18)
- Dynamic form (`host.js`): the price-fetching command is PowerShell syntax and works out of the box on Windows; on Linux/macOS replace `NODE_FETCH` in `host.js` with the corresponding shell syntax

### Why the dynamic form fetches the pricing page with node.exe

The DSH dynamic plugin sandbox disables `fetch` / `require`, and the Web deployment by default does not mount the fetch provider of `ctx.web` (anti-SSRF); also, the Windows sandbox executor corrupts curl/PowerShell schannel TLS credentials. The dynamic form therefore calls `node.exe` via `ctx.shell` (OpenSSL TLS, unaffected by schannel) to fetch the single hard-coded official URL — the command string concatenates no external input, leaving no command-injection surface. The installed form uses the host process's native fetch and is not subject to this restriction.

### Known limitations

- The cost is an estimate, not an official bill; actual charges are subject to the DeepSeek platform
- The built-in price snapshot (fetched 2026-08-15) may lag official price changes; it only serves as a fallback when dynamic fetching fails
- The dynamic plugin is session-level: after a DSH process restart it must be reinstalled (see Method 2)

### License

[MIT](LICENSE)

---

## 中文

[English](#english) · [← 返回 DeepSeekHarnessPlugins](../README.md)

DeepSeek Harness（DSH）插件：在 Web GUI 输入框下方的统计行中实时显示**当前会话累计 token 消耗**与**估算费用（人民币）**，价格从 DeepSeek 官方价格页动态获取。

支持两种形态：**可安装的 dsh.bundle 包**（推荐，随 DSH 启动常驻）与**动态 cordis_define 用法**（临时运行）。

### 效果

输入框下方（自带 stats 行右侧）新增一行读数：

```
费用 ¥0.13 · 43.2K tokens
```

鼠标悬停显示明细：计价模型、输入（缓存未命中/命中分桶）、输出、计价模式（现行价 / 高峰时段价 / 空闲时段价）、价格来源与抓取时间。

### 功能特性

- **真实用量**：读取会话投影 `tokenUsage`（服务商上报的累计用量：未命中输入 / 缓存命中 / 输出，与 DSH 自带统计行同源）
- **官方动态价格**：Host 端每 6 小时抓取并解析 DeepSeek 官方价格页（含峰谷价表，按北京时间自动切换时段）
- **优雅降级**：官方页抓取失败时自动改用内置价格快照，金额前加 `≈` 并在悬停提示中标注原因
- **模型识别三级回退**：最近请求 `provenance` → `requestConfig` → Host `agents.options.model`；全部失败时显示按各模型分别计算的价格区间
- **零数据外传**：唯一出站请求为官方公开价格页；token 用量仅本地展示，不上传、不落盘

### 文件说明

| 文件 | 说明 |
| --- | --- |
| `index.js` | 安装版 Host 半边：抓取/解析官方价格页，`/api/token-cost-meter/*` 路由（`pricing` / `model`） |
| `lib/client.js` | 安装版 Client 半边：输入框下方 UI、费用计算 |
| `cordis.patch.yml` | bundle 补丁：向 DSH 组合插入本插件行 |
| `host.js` | 动态版 Host 半边（`cordis_define` 的 `code.host`），与安装版功能等价 |
| `client.js` | 动态版 Client 半边（`code.client`） |
| `README.md` / `SECURITY.md` / `CHANGELOG.md` / `LICENSE` | 文档与许可 |

### 安装（dsh.bundle）

本仓库同时是可安装的 dsh 插件包（`package.json` 声明 `dsh.bundle` + `dsh.client`）：

```sh
dsh plugin --profile web add github:YZz-S/dsh-token-cost-meter
```

安装后重启 DSH，输入框下方的费用读数自动生效。
动态用法（`cordis_define` 加载 `host.js` / `client.js`）仍保留，两种方式二选一。

### 使用方法

#### 方式一：动态 Cordis 插件（临时运行）

1. 打开 DSH Web，进入会话；
2. 让助手调用 `cordis_define`，将 `host.js` 全文作为 `code.host`、`client.js` 全文作为 `code.client` 提交；
3. `cordis_run` 运行返回的 `pluginId` / `packageId`；
4. 在 Run 卡片上批准（建议勾选双 ✓，后续版本更新免审批）；
5. 刷新页面，输入框下方出现费用读数。

> 动态插件的生命周期与当前 DSH 进程相同：重启 DSH 后需重新 define + run。

#### 方式二：正式插件（常驻）

即上方「安装（dsh.bundle）」一节，`dsh plugin add` 后随 DSH 启动自动加载。

### 工作原理

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

### 计费口径

```
费用（人民币）= 缓存未命中输入 × 未命中价 + 缓存命中 × 命中价 + 输出 × 输出价
```

- 价格单位：人民币 / 百万 tokens，取自官方价格页；2026-08-17 起按官方公告的峰谷价表自动切换（北京时间 9:00–12:00、14:00–18:00 为高峰时段，其余为空闲时段）。
- 缓存写入按未命中价计（与 DeepSeek 计费规则一致）。

### 平台要求

- DSH（Web 模式，支持动态 Cordis 插件；已在 DSH 0.1.0-rc.6 + Node.js v22 + Windows 验证）
- 安装版无额外依赖：宿主进程自带 `fetch`（Node ≥ 18）
- 动态版（`host.js`）的价格抓取命令为 PowerShell 语法，Windows 开箱即用；Linux/macOS 需替换 `host.js` 中 `NODE_FETCH` 为对应 shell 语法

### 为什么动态版用 node.exe 抓取价格页

DSH 动态插件沙盒禁用了 `fetch` / `require`，且 Web 部署默认不挂载 `ctx.web` 的 fetch provider（防 SSRF）；同时 Windows 沙盒执行器会破坏 curl / PowerShell 的 schannel TLS 凭据。因此动态版经 `ctx.shell` 调用 `node.exe`（OpenSSL TLS，不受 schannel 影响）抓取唯一的硬编码官方 URL，命令字符串无任何外部输入拼接，无命令注入面。安装版宿主进程自带原生 fetch，不受此限制。

### 已知限制

- 费用为估算值，非官方账单；实际以 DeepSeek 平台扣费为准
- 内置价格快照（2026-08-15 抓取）可能滞后于官方调价，仅供动态抓取失败时兜底
- 动态插件为会话级：DSH 进程重启后需重新安装（见「方式二」）

### 许可

[MIT](LICENSE)

---

[English](#english) · [中文](#中文)
