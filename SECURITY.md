# 安全说明与开源前检查摘要

## 凭据

本插件**不读取、不存储、不发送任何密钥或凭据**。唯一出站请求为 DeepSeek 官方公开价格页，无需鉴权。

## 数据流

- 出站：仅 `GET https://api-docs.deepseek.com/zh-cn/quick_start/pricing`（硬编码、只读、无参数）
- 入站：仅同源 `GET /api/token-cost-meter/pricing` 与 `/api/token-cost-meter/model?sessionId=…`（只读查询）
- 本地：token 用量读取自 DSH 会话投影，仅渲染于当前页面，不落盘、不上传

## 攻击面评估

| 风险 | 评估 |
| --- | --- |
| 命令注入 | 无。安装版不使用 shell；动态版抓取命令为固定字符串，URL 与脚本均硬编码，无任何用户/模型输入拼接 |
| SSRF | 无。目标 URL 唯一且固定，不可由输入改变 |
| 凭据泄露 | 无。不接触任何凭据 |
| 数据外泄 | 无。不采集、不存储、不发送任何用户数据 |
| 越权 | 安装版：仅注册两个只读 GET 路由；动态版：运行于 DSH 动态插件沙盒（fetch / require / 文件系统被禁用），安装需用户在 Run 卡片批准；停止/更新/移除后所有副作用随 Fiber 清理 |

## 开源前检查清单（2026-08-15）

- [x] 密钥/凭据扫描：未发现（`sk-`、`api_key`、`token=`、私钥头等模式零命中）
- [x] 个人信息与机器路径：无用户名、无 IP、无内网地址；动态版 `C:\nvm4w\nodejs\node.exe` 为 nvm-windows 标准安装路径且仅为兜底，可按需修改
- [x] 第三方代码：全部代码为原创编写，未复制任何第三方代码
- [x] 许可：MIT，已随附 LICENSE
- [x] 免责声明：README 已声明费用为估算值、与 DeepSeek 官方无隶属关系
- [x] 兼容性：DSH 0.1.0-rc.6（web profile，2026-08）+ Node.js v22 + Windows 已验证

## 报告漏洞

请在本仓库提交 Issue（避免泄露敏感信息）。
