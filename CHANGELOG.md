# Changelog

## [0.1.0] - 2026-08-15

首个公开版本。

- 会话累计 token 用量显示（输入缓存命中/未命中、输出分桶）
- DeepSeek 官方价格页动态抓取与解析（现行价 + 峰谷价，按北京时间自动切换时段）
- 官方页抓取失败时自动回退内置价格快照，并在界面标注来源
- 模型识别三级回退（provenance → requestConfig → agents.options.model）与未知模型价格区间显示
- 开发过程中修复并随版本保留：
  - 修复客户端 `ctx` 作用域导致的渲染崩溃
  - 官方页抓取改用 node.exe（OpenSSL TLS），绕开 DSH 沙盒对 schannel 的限制
