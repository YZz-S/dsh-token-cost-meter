/**
 * dsh-token-cost-meter — Client 半部分（DSH 动态 Cordis 插件）
 *
 * 使用方法（方式一，动态插件）：
 *   在 DSH Web 会话中调用 cordis_define，将本文件全文作为 code.client
 *   （配合 host.js 作为 code.host），然后 cordis_run 并在 Run 卡片批准。
 *   详见本目录 README.md。
 *
 * 职责：注册 conversation.composer.dock 读数条，读取会话投影 tokenUsage
 * 的真实累计用量，经 host.call('pricing' / 'model') 获取官方价格与会话
 * 模型，按“未命中输入×未命中价 + 缓存命中×命中价 + 输出×输出价”计算费用。
 *
 * License: MIT
 */
function formatTokens(n) {
  if (!(n > 0)) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(Math.round(n))
}

function formatMoney(v) {
  if (v < 0.01) return '¥' + v.toFixed(4)
  if (v < 1) return '¥' + v.toFixed(3)
  return '¥' + v.toFixed(2)
}

function pickModelKey(models, modelId) {
  if (!models || !modelId) return null
  const m = String(modelId).toLowerCase()
  const keys = Object.keys(models)
  for (let i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === m) return keys[i]
  for (let i = 0; i < keys.length; i++) {
    const kk = keys[i].toLowerCase()
    if (m.indexOf(kk) >= 0 || kk.indexOf(m) >= 0) return keys[i]
  }
  return null
}

function lastModel(nodes) {
  if (!Array.isArray(nodes)) return null
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    if (!node || node.kind !== 'assistant') continue
    if (node.provenance && typeof node.provenance.model === 'string' && node.provenance.model) return node.provenance.model
    if (node.requestConfig && typeof node.requestConfig.model === 'string' && node.requestConfig.model) return node.requestConfig.model
  }
  return null
}

function computeCost(usage, price) {
  if (!usage || !price) return null
  const miss = (usage.uncachedInputTokens || 0) + (usage.cacheWriteTokens || 0)
  const hit = usage.cacheReadTokens || 0
  const out = usage.outputTokens || 0
  const cost = (miss * (price.cacheMiss || 0) + hit * (price.cacheHit || 0) + out * (price.output || 0)) / 1e6
  return { cost, input: miss + hit, miss, hit, output: out }
}

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    styles.insert('.dsh-tkcost-line{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}.dsh-tkcost-label{color:var(--dsw-alias-label-secondary)}.dsh-tkcost-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}.dsh-tkcost-sep{opacity:.6}.dsh-tkcost-tokens{font-variant-numeric:tabular-nums}')
    function CostLine(props) {
      const useProjection = props.useProjection
      const useSession = props.useSession
      const sessionId = props.sessionId
      const usage = useProjection ? useProjection('tokenUsage') : undefined
      const nodes = useSession ? useSession((s) => s.chat.legacy.nodes) : undefined
      const [pricing, setPricing] = React.useState(null)
      const [hostModel, setHostModel] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const load = () => {
          host.call('pricing').then((p) => {
            if (alive && p) setPricing(p)
          }).catch(() => {})
          if (sessionId !== undefined) {
            host.call('model', { sessionId }).then((m) => {
              if (alive && m && typeof m.model === 'string') setHostModel(m.model)
            }).catch(() => {})
          }
        }
        load()
        const stop = ctx.interval(load, 30 * 60 * 1000)
        return () => {
          alive = false
          stop()
        }
      }, [sessionId])
      if (!usage) return null
      const total = (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) + (usage.outputTokens || 0)
      const model = lastModel(nodes) || hostModel
      const models = pricing && pricing.active ? pricing.active.models : null
      const key = pickModelKey(models, model)
      let costText = '—'
      const tipParts = []
      if (key) {
        const r = computeCost(usage, models[key])
        if (r) {
          costText = (pricing && pricing.source !== 'official' ? '≈' : '') + formatMoney(r.cost)
          tipParts.push('模型 ' + key)
          tipParts.push('输入 ' + formatTokens(r.input) + ' tokens（缓存未命中 ' + formatTokens(r.miss) + ' / 缓存命中 ' + formatTokens(r.hit) + '）')
          tipParts.push('输出 ' + formatTokens(r.output) + ' tokens')
        }
      } else if (models && usage) {
        const rows = []
        for (const k of Object.keys(models)) {
          const r = computeCost(usage, models[k])
          if (r) rows.push({ k, cost: r.cost })
        }
        if (rows.length > 0) {
          let min = rows[0].cost
          let max = rows[0].cost
          for (let i = 1; i < rows.length; i++) {
            if (rows[i].cost < min) min = rows[i].cost
            if (rows[i].cost > max) max = rows[i].cost
          }
          costText = '≈' + (min === max ? formatMoney(min) : formatMoney(min) + '–' + formatMoney(max))
          for (let i = 0; i < rows.length; i++) tipParts.push('按 ' + rows[i].k + '：' + formatMoney(rows[i].cost))
          tipParts.push('未能确定本会话模型' + (model ? '（' + model + ' 不在价格表）' : ''))
        } else if (model) {
          tipParts.push('模型 ' + model + ' 不在官方价格表中，无法计费')
        }
      }
      if (pricing) {
        const modeLabel = pricing.active.mode === 'peak' ? '高峰时段价' : pricing.active.mode === 'off-peak' ? '空闲时段价' : '现行价格'
        tipParts.push('计价：' + modeLabel + '（人民币 / 百万 tokens）')
        tipParts.push('价格来源：' + (pricing.source === 'official' ? 'DeepSeek 官方价格页（动态获取）' : '内置快照（官方页获取失败）'))
        if (pricing.fetchedAt) tipParts.push('价格抓取时间：' + new Date(pricing.fetchedAt).toLocaleString())
        if (pricing.diag && pricing.diag.error) tipParts.push('获取失败原因：' + pricing.diag.error)
      } else {
        tipParts.push('正在获取 DeepSeek 官方价格…')
      }
      return React.createElement('div', { className: 'dsh-tkcost-line', title: tipParts.join('\n') },
        React.createElement('span', { className: 'dsh-tkcost-label' }, '费用'),
        React.createElement('span', { className: 'dsh-tkcost-value' }, costText),
        React.createElement('span', { className: 'dsh-tkcost-sep' }, '·'),
        React.createElement('span', { className: 'dsh-tkcost-tokens' }, formatTokens(total) + ' tokens')
      )
    }
    slots.inject('conversation.composer.dock', () => slots.register(
      { name: 'conversation.composer.dock', id: 'token-cost', order: 1 },
      CostLine
    ))
  }
}
