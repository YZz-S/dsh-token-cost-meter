/* dsh-token-cost-meter client half: composer dock readout for session token cost.
 * Loaded through the client module loader (CJS wrapper). The loader id MUST
 * equal the package name: client-modules verifies the boot graph row id
 * (the package name) against the id registered via __ModuleLoader__.load. */
window.__ModuleLoader__.load({
  id: 'dsh-token-cost-meter',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')

    function apiGet(url) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
    }

    var API = {
      getPricing: function () { return apiGet('/api/token-cost-meter/pricing') },
      getModel: function (sessionId) { return apiGet('/api/token-cost-meter/model?sessionId=' + encodeURIComponent(sessionId === undefined ? '' : sessionId)) },
    }

    var css = [
      '.dsh-tkcost-line{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsh-tkcost-label{color:var(--dsw-alias-label-secondary)}',
      '.dsh-tkcost-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.dsh-tkcost-sep{opacity:.6}',
      '.dsh-tkcost-tokens{font-variant-numeric:tabular-nums}',
    ].join('\n')

    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin="dsh-token-cost-meter"]') === null) {
      var styleTag = document.createElement('style')
      styleTag.dataset.plugin = 'dsh-token-cost-meter'
      styleTag.textContent = css
      document.head.appendChild(styleTag)
    }

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
      var m = String(modelId).toLowerCase()
      var keys = Object.keys(models)
      for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === m) return keys[i]
      for (var j = 0; j < keys.length; j++) {
        var kk = keys[j].toLowerCase()
        if (m.indexOf(kk) >= 0 || kk.indexOf(m) >= 0) return keys[j]
      }
      return null
    }

    function lastModel(nodes) {
      if (!Array.isArray(nodes)) return null
      for (var i = nodes.length - 1; i >= 0; i--) {
        var node = nodes[i]
        if (!node || node.kind !== 'assistant') continue
        if (node.provenance && typeof node.provenance.model === 'string' && node.provenance.model) return node.provenance.model
        if (node.requestConfig && typeof node.requestConfig.model === 'string' && node.requestConfig.model) return node.requestConfig.model
      }
      return null
    }

    function computeCost(usage, price) {
      if (!usage || !price) return null
      var miss = (usage.uncachedInputTokens || 0) + (usage.cacheWriteTokens || 0)
      var hit = usage.cacheReadTokens || 0
      var out = usage.outputTokens || 0
      var cost = (miss * (price.cacheMiss || 0) + hit * (price.cacheHit || 0) + out * (price.output || 0)) / 1e6
      return { cost: cost, input: miss + hit, miss: miss, hit: hit, output: out }
    }

    function CostLine(props) {
      var useProjection = props.useProjection
      var useSession = props.useSession
      var sessionId = props.sessionId
      var usage = useProjection ? useProjection('tokenUsage') : undefined
      var nodes = useSession ? useSession(function (s) { return s.chat.legacy.nodes }) : undefined
      var pricingHook = React.useState(null)
      var pricing = pricingHook[0]
      var setPricing = pricingHook[1]
      var modelHook = React.useState(null)
      var hostModel = modelHook[0]
      var setHostModel = modelHook[1]
      React.useEffect(function () {
        var alive = true
        var load = function () {
          API.getPricing().then(function (p) { if (alive && p) setPricing(p) }).catch(function () {})
          if (sessionId !== undefined) {
            API.getModel(sessionId).then(function (m) { if (alive && m && typeof m.model === 'string') setHostModel(m.model) }).catch(function () {})
          }
        }
        load()
        var stop = setInterval(load, 30 * 60 * 1000)
        return function () {
          alive = false
          clearInterval(stop)
        }
      }, [sessionId])
      if (!usage) return null
      var total = (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) + (usage.outputTokens || 0)
      var model = lastModel(nodes) || hostModel
      var models = pricing && pricing.active ? pricing.active.models : null
      var key = pickModelKey(models, model)
      var costText = '—'
      var tipParts = []
      if (key) {
        var r = computeCost(usage, models[key])
        if (r) {
          costText = (pricing && pricing.source !== 'official' ? '≈' : '') + formatMoney(r.cost)
          tipParts.push('模型 ' + key)
          tipParts.push('输入 ' + formatTokens(r.input) + ' tokens（缓存未命中 ' + formatTokens(r.miss) + ' / 缓存命中 ' + formatTokens(r.hit) + '）')
          tipParts.push('输出 ' + formatTokens(r.output) + ' tokens')
        }
      } else if (models && usage) {
        var rows = []
        for (var k in models) {
          var rr = computeCost(usage, models[k])
          if (rr) rows.push({ k: k, cost: rr.cost })
        }
        if (rows.length > 0) {
          var min = rows[0].cost
          var max = rows[0].cost
          for (var i2 = 1; i2 < rows.length; i2++) {
            if (rows[i2].cost < min) min = rows[i2].cost
            if (rows[i2].cost > max) max = rows[i2].cost
          }
          costText = '≈' + (min === max ? formatMoney(min) : formatMoney(min) + '–' + formatMoney(max))
          for (var i3 = 0; i3 < rows.length; i3++) tipParts.push('按 ' + rows[i3].k + '：' + formatMoney(rows[i3].cost))
          tipParts.push('未能确定本会话模型' + (model ? '（' + model + ' 不在价格表）' : ''))
        } else if (model) {
          tipParts.push('模型 ' + model + ' 不在官方价格表中，无法计费')
        }
      }
      if (pricing) {
        var modeLabel = pricing.active.mode === 'peak' ? '高峰时段价' : pricing.active.mode === 'off-peak' ? '空闲时段价' : '现行价格'
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

    var inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
        { name: 'conversation.composer.dock', id: 'token-cost', order: 1, label: '会话费用' },
        CostLine,
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
