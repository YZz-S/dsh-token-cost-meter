/**
 * dsh-token-cost-meter — Host 半边（可安装的 dsh.bundle 插件）
 *
 * 职责：抓取并解析 DeepSeek 官方价格页（TTL 6 小时，含峰谷价表），
 * 经 /api/token-cost-meter/* 路由提供给浏览器 Client 半边；
 * 另提供会话模型查询（agents.options.model）。
 *
 * 安装版宿主进程自带 fetch，因此不再需要动态插件（host.js）的
 * shell + node.exe 抓取方案；host.js / client.js 保留供 cordis_define 动态用法。
 *
 * License: MIT
 */
export const name = 'token-cost-meter'
export const inject = ['webServer']

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

/** 解析官方价格页 HTML（导出以便冒烟测试）。 */
export function parsePricing(html) {
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

/** 按当前时间解析生效价格（导出以便冒烟测试）。 */
export function activeView(parsed, now) {
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

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export function apply(ctx) {
  const state = { parsed: null, fetchedAt: 0, source: 'fallback', diag: null }
  let lastAttempt = 0

  async function refreshPricing() {
    const now = Date.now()
    if (now - lastAttempt < 10 * 60 * 1000) return
    lastAttempt = now
    const ctl = new AbortController()
    const to = setTimeout(() => ctl.abort(), 25000)
    try {
      const r = await fetch(PRICING_URL, { signal: ctl.signal })
      const text = await r.text()
      if (r.status !== 200) {
        state.diag = { at: Date.now(), exitCode: r.status, outLen: text.length, error: '官方页 HTTP ' + r.status }
        return
      }
      const parsed = parsePricing(text)
      if (parsed) {
        state.parsed = parsed
        state.fetchedAt = Date.now()
        state.source = 'official'
        state.diag = null
      } else {
        state.diag = { at: Date.now(), exitCode: 0, outLen: text.length, error: '官方页内容解析失败（页面结构可能已变化，输出 ' + text.length + ' 字符）' }
      }
    } catch (err) {
      state.diag = { at: Date.now(), exitCode: null, outLen: 0, error: '抓取失败：' + String(err && err.message ? err.message : err).slice(0, 200) }
    } finally {
      clearTimeout(to)
    }
    if (!state.parsed) {
      state.fetchedAt = 0
      state.source = 'fallback'
    }
  }

  function pricingPayload() {
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
  }

  function sessionModel(req) {
    const u = new URL(req.url || '/', 'http://localhost')
    const id = (u.searchParams.get('sessionId') || '').trim()
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
  }

  ctx.effect(() => {
    const disposePricing = ctx.webServer.register({
      kind: 'exact',
      path: '/api/token-cost-meter/pricing',
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        const now = Date.now()
        const stale = !state.parsed || now - state.fetchedAt > 6 * 3600 * 1000
        if (stale) await refreshPricing()
        return json(res, 200, pricingPayload())
      },
    })
    const disposeModel = ctx.webServer.register({
      kind: 'exact',
      path: '/api/token-cost-meter/model',
      handler: (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        return json(res, 200, sessionModel(req))
      },
    })
    return () => {
      disposePricing()
      disposeModel()
    }
  }, 'dsh-token-cost-meter: routes')
}
