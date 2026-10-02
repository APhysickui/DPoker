# 验证记录

日期：2026-10-03。环境：本机 macOS，Node.js 26.8.1，Wrangler 4.146.0。

## 已执行通过

- `npm test`：37 项测试，包括 30 项规则测试（固定种子 400 手 2–9 人随机对局）和 7 项服务层测试。
- `npm run build`：严格 TypeScript 检查和 Vite 生产构建。
- `npm run test:integration`：真实 Wrangler HTTP/WebSocket 九人完整对局；容量限制、来源限制、鉴权、底牌隔离、越权拒绝、重复下注、摊牌和筹码守恒；断线重连、中途加入、补筹码、离桌、真实 30 秒 Alarm、5 秒自动续局、60 秒房主移交。
- `npm run test:restart`：手牌和连接仍存活时停止测试专用 Wrangler，重启后校验原房间身份、底牌、手数、筹码、下注和截止时间未改变；丢失连接正确标记离线。
- `scripts/browser_test.py`：两个独立浏览器身份完成真实双人对局；桌面 1440px 与手机 390px 截图；创建、邀请直达、准备/开局、刷新恢复、结算、无 JS 异常和手机横向溢出检查。使用本机已安装 Chromium 1234。
- `wrangler deploy --dry-run`：Worker 打包和 SQLite Durable Object 绑定配置检查。

截图保存在忽略提交的 `artifacts/`。原生 Hibernation 的长期休眠行为仍需线上运行观察，替身测试与本地重启测试不能证明所有 Cloudflare 平台行为。

## 本轮修复

- 本机 8787 被其他应用占用，DPoker 默认后端端口改为 8788，所有启动、代理、CI 和测试配置同步修改。
- 服务器补全 WebSocket 关闭握手，避免连接关闭后测试进程持续等待。
- 根据截图修正手机首页卡牌装饰的横向溢出，行动倒计时最大显示 30 秒。

## 发布与网络

- 已创建公开仓库 https://github.com/APhysickui/DPoker ，默认分支 main。
- Cloudflare 网页已通过 GitHub 登录；本地 Wrangler 仍需独立 OAuth 授权，正在等待完成。未开通任何付费方案。
- 后端与 GitHub Pages 尚未发布，等待 Worker 授权和后端地址配置。
- 尚未测试大陆直连、手机 Wi-Fi 或移动网络，不保证大陆稳定访问。
