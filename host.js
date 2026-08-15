/**
 * dsh-token-cost-meter — Host 半部分（DSH 动态 Cordis 插件）
 *
 * 使用方法（方式一，动态插件）：
 *   在 DSH Web 会话中调用 cordis_define，将本文件全文作为 code.host
 *   （配合 client.js 作为 code.client），然后 cordis_run 并在 Run 卡片批准。
 *   详见本目录 README.md。
 *
 * 职责：
 *   - pricing RPC：抓取并解析 DeepSeek 官方价格页（TTL 6 小时），返回当前
 *     有效价格；抓取失败时回退内置快照并附带诊断信息。
 *   - model RPC：返回会话模型（agents.options.model）。
 *
 * 抓取通道：动态插件沙盒禁用 fetch/require，Web 部署不挂载 ctx.web 的
 * fetch provider；Windows 沙盒执行器又会破坏 schannel TLS。因此经 ctx.shell
 * 调用 node.exe（OpenSSL TLS）抓取唯一的硬编码官方 URL，无外部输入拼接。
 *
 * License: MIT
 */
const PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'

// 内置价格快照（官方价格页抓取失败时的兜底；2026-08-15 抓取，可能滞后于官方调价）。
const FALLBACK_PRICING = {
  models: {
    'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 },
    'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3, output: 6 }
  },
  peak: {
    effectiveAt: Date.UTC(2026, 7, 16, 16, 0, 0),
    windows: [[9 * 60, 12 * 60], [14 * 60, 18 * 60]],
    models: {
      'deepseek-v4-flash': {
        off: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
        peak: { cacheHit: 0.1, cacheMiss: 3.0, output: 9.0 }
      },
      'deepseek-v4-pro': {
        off: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
        peak: { cacheHit: 0.3, cacheMiss: 9.0, output: 27.0 }
      }
    }
  }
}

let state = { parsed: null, fetchedAt: 0, source: 'fallback', diag: null }
let lastAttempt = 0

function parsePricing(html) {
  if (typeof html !== 'string' || html.length === 0) return null
  const text = String(html)
  const models = []
  const modelRe = /<td>\s*(deepseek-[\w.-]+)\s*<\/td>/g
  let m
  while ((m = modelRe.exec(text)) !== null) {
    const name = m[1].trim()
    if (models.indexOf(name) < 0) models.push(name)
  }
  if (models.length === 0) return null
  const hitIdx = text.indexOf('缓存命中')
  const limitIdx = hitIdx >= 0 ? text.indexOf('并发限制', hitIdx) : -1
  if (hitIdx < 0 || limitIdx < 0) return null
  const flatNums = []
  const numRe = /([0-9]+(?:\.[0-9]+)?)元/g
  let n
  const flatSeg = text.slice(hitIdx, limitIdx)
  while ((n = numRe.exec(flatSeg)) !== null) flatNums.push(parseFloat(n[1]))
  if (flatNums.length < models.length * 3) return null
  const flat = {}
  for (let i = 0; i < models.length; i++) {
    flat[models[i]] = {
      cacheHit: flatNums[i],
      cacheMiss: flatNums[models.length + i],
      output: flatNums[2 * models.length + i]
    }
  }
  let peak = null
  const offIdx = text.indexOf('空闲时段')
  const moreIdx = offIdx >= 0 ? text.indexOf('更多并发限制', offIdx) : -1
  if (offIdx >= 0 && moreIdx > offIdx) {
    const peakNums = []
    const peakSeg = text.slice(offIdx, moreIdx)
    const numRe2 = /([0-9]+(?:\.[0-9]+)?)元/g
    let n2
    while ((n2 = numRe2.exec(peakSeg)) !== null) peakNums.push(parseFloat(n2[1]))
    if (peakNums.length >= models.length * 6) {
      const peakModels = {}
      for (let i = 0; i < models.length; i++) {
        const b = i * 6
        peakModels[models[i]] = {
          off: { cacheHit: peakNums[b], cacheMiss: peakNums[b + 1], output: peakNums[b + 2] },
          peak: { cacheHit: peakNums[b + 3], cacheMiss: peakNums[b + 4], output: peakNums[b + 5] }
        }
      }
      const dateM = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
      let effectiveAt = null
      if (dateM) effectiveAt = Date.UTC(+dateM[1], +dateM[2] - 1, +dateM[3]) - 8 * 3600 * 1000
      const winM = text.match(/高峰时段为北京时间\s*([^（(]+)/)
      const windows = []
      if (winM) {
        const winRe = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g
        let w
        while ((w = winRe.exec(winM[1])) !== null) {
          windows.push([+w[1] * 60 + +w[2], +w[3] * 60 + +w[4]])
        }
      }
      peak = { effectiveAt, windows, models: peakModels }
    }
  }
  return { models: flat, peak }
}

function activeView(parsed, now) {
  const t = now || Date.now()
  const peakCfg = parsed && parsed.peak
  if (peakCfg && typeof peakCfg.effectiveAt === 'number' && t >= peakCfg.effectiveAt) {
    const bj = new Date(t + 8 * 3600 * 1000)
    const mins = bj.getUTCHours() * 60 + bj.getUTCMinutes()
    const isPeak = Array.isArray(peakCfg.windows) && peakCfg.windows.some((w) => mins >= w[0] && mins < w[1])
    const models = {}
    const entries = peakCfg.models || {}
    for (const k of Object.keys(entries)) {
      const pair = entries[k]
      if (pair) models[k] = isPeak ? pair.peak : pair.off
    }
    return { mode: isPeak ? 'peak' : 'off-peak', models }
  }
  const models = {}
  const flat = parsed && parsed.models ? parsed.models : {}
  for (const k of Object.keys(flat)) models[k] = flat[k]
  return { mode: 'flat', models }
}

// 抓取官方价格页：经 ctx.shell 调用 node.exe（OpenSSL TLS）。
const NODE_FETCH = "$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source; " +
  "if (-not $node) { $node = 'C:\\nvm4w\\nodejs\\node.exe' }; " +
  "if (-not (Test-Path $node)) { $node = Join-Path $env:ProgramFiles 'nodejs\\node.exe' }; " +
  "if (-not (Test-Path $node)) { exit 3 }; " +
  "& $node -e 'fetch(''https://api-docs.deepseek.com/zh-cn/quick_start/pricing'').then(r=>{ if(!r.ok) throw new Error(''HTTP ''+r.status); return r.text() }).then(t=>console.log(t)).catch(e=>{ console.error(String(e)); process.exit(1) })'"

async function refreshPricing(ctx) {
  const now = Date.now()
  if (now - lastAttempt < 10 * 60 * 1000) return
  lastAttempt = now
  const shell = ctx.get('shell')
  if (shell && typeof shell.resolve === 'function' && typeof shell.run === 'function') {
    try {
      const spec = shell.resolve({ command: NODE_FETCH, timeoutMs: 45000, stdoutMaxBytes: 600000 })
      const res = await shell.run(spec)
      const out = res && res.stdout && typeof res.stdout.text === 'string' ? res.stdout.text : ''
      const err = res && res.stderr && typeof res.stderr.text === 'string' ? res.stderr.text : ''
      const exitCode = res ? res.exitCode : null
      const parsed = exitCode === 0 ? parsePricing(out) : null
      if (parsed) {
        state.parsed = parsed
        state.fetchedAt = Date.now()
        state.source = 'official'
        state.diag = null
        return
      }
      state.diag = {
        at: Date.now(),
        exitCode,
        outLen: out.length,
        error: exitCode === 0
          ? '官方页内容解析失败（页面结构可能已变化，输出 ' + out.length + ' 字符）'
          : ('node 抓取退出码 ' + exitCode + (err ? '：' + String(err).slice(0, 200) : ''))
      }
    } catch (err) {
      state.diag = { at: Date.now(), exitCode: null, outLen: 0, error: 'shell 执行失败：' + String(err).slice(0, 200) }
      console.error('[token-cost] pricing fetch failed:', String(err))
    }
  } else {
    state.diag = { at: Date.now(), exitCode: null, outLen: 0, error: 'shell 服务不可用' }
  }
  if (!state.parsed) {
    state.fetchedAt = 0
    state.source = 'fallback'
  }
}

return {
  apply(ctx) {
    harness.handle('pricing', async () => {
      const now = Date.now()
      const stale = !state.parsed || now - state.fetchedAt > 6 * 3600 * 1000
      if (stale) await refreshPricing(ctx)
      const parsed = state.parsed || FALLBACK_PRICING
      const active = activeView(parsed, Date.now())
      return {
        currency: 'CNY',
        unit: 'per-1M-tokens',
        source: state.source,
        fetchedAt: state.fetchedAt || null,
        active,
        diag: state.source === 'fallback' ? state.diag : null,
        url: PRICING_URL
      }
    })
    harness.handle('model', (args) => {
      const id = args && args.sessionId ? String(args.sessionId) : ''
      let model = null
      if (id) {
        const agents = ctx.get('agents')
        if (agents && typeof agents.get === 'function') {
          const agent = agents.get(id)
          if (agent && agent.options && typeof agent.options.model === 'string' && agent.options.model) {
            model = agent.options.model
          }
        }
      }
      return { model }
    })
  }
}
