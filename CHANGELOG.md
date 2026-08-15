# Changelog

## [0.2.0] - 2026-08-15

可安装化（dsh.bundle）。

- 新增 bundle 形态：`index.js`（宿主半边，原生 fetch + `/api/token-cost-meter/*` 路由）、`lib/client.js`（客户端半边）、`cordis.patch.yml`（组合补丁）
- `package.json` 声明 `dsh.bundle` + `dsh.client`，版本升至 0.2.0
- README 增加「安装（dsh.bundle）」说明；动态用法（`host.js` / `client.js`）保留

## [0.1.0] - 2026-08-15

首个公开版本（动态插件形态）。

- 会话累计 token 用量显示（输入缓存命中/未命中、输出分桶）
- DeepSeek 官方价格页动态抓取与解析（现行价 + 峰谷价，按北京时间自动切换时段）
- 官方页抓取失败时自动回退内置价格快照，并在界面标注来源
- 模型识别三级回退（provenance → requestConfig → agents.options.model）与未知模型价格区间显示
- 开发过程中修复并随版本保留：
  - 修复客户端 `ctx` 作用域导致的渲染崩溃
  - 官方页抓取改用 node.exe（OpenSSL TLS），绕开 DSH 沙盒对 schannel 的限制
