# 验证记录

日期：2026-10-03。环境：本机 macOS，Node.js 22.16.0，Wrangler 4.146.0。

## 已执行通过

- `npm test`：38 项测试，包括 30 项规则测试（固定种子 400 手 2–9 人随机对局）和 8 项服务层测试。
- `npm run build`：严格 TypeScript 检查和 Vite 生产构建。
- `npm run test:integration`：真实 Wrangler HTTP/WebSocket 九人完整对局；容量限制、来源限制、鉴权、底牌隔离、越权拒绝、重复下注、摊牌和筹码守恒；断线重连、中途加入、补筹码、离桌、真实 30 秒 Alarm、5 秒自动续局、60 秒房主移交。
- `npm run test:restart`：手牌和连接仍存活时停止测试专用 Wrangler，重启后校验原房间身份、底牌、手数、筹码、下注和截止时间未改变；丢失连接正确标记离线。
- `scripts/browser_test.py`：两个独立浏览器身份完成真实双人对局；桌面 1440px 与手机 390px 截图；创建、邀请直达、准备/开局、刷新恢复、结算、无 JS 异常和手机横向溢出检查。使用本机已安装 Chromium 1234。
- `scripts/browser_table_test.py`：9 个独立浏览器身份真实入座、准备和发牌；390px 手机满桌截图、无横向溢出与 JS 异常。
- `wrangler deploy --dry-run`：Worker 打包和 SQLite Durable Object 绑定配置检查。

截图保存在忽略提交的 `artifacts/`。原生 Hibernation 的长期休眠行为仍需线上运行观察，替身测试与本地重启测试不能证明所有 Cloudflare 平台行为。

## 本轮修复

- 本机 8787 被其他应用占用，DPoker 默认后端端口改为 8788，所有启动、代理、CI 和测试配置同步修改。
- 服务器补全 WebSocket 关闭握手，并处理保留状态码 1005，确保关闭后及时保存离线状态和释放测试连接。
- 根据截图修正手机首页卡牌装饰的横向溢出，行动倒计时最大显示 30 秒。

## 发布与网络

- 正式网页：https://aphysickui.github.io/DPoker/
- 实时后端：https://dpoker-api.dpoker.workers.dev
- 已部署 Worker 版本：`5037af0c-054c-4118-9360-bdae927b12fa`。仅允许来源 `https://aphysickui.github.io`。SQLite Durable Object 已创建，未开通付费方案。
- Pages 发布成功，规则测试、本地 Worker 集成和正式 Worker HTTPS/WSS 集成检查全部通过：https://github.com/APhysickui/DPoker/actions/runs/37086041380 。
- 独立公网运行器真实浏览器验收通过：邀请直达、刷新恢复、完整对局和 9 个独立手机浏览器身份满桌：https://github.com/APhysickui/DPoker/actions/runs/37086393764 。
- 用户切换网络后，本机通过既有代理访问前后端均返回 HTTP 200；正式网站的双浏览器完整对局、邀请、刷新、手机布局验证通过。公网响应需要比本地测试更长的等待时间，验收脚本已适配。
- 本机禁用应用层代理的 Worker 直连尝试仍在 15 秒后超时。该测量不能保证完全绕开系统级网络路由，不能作为大陆所有运营商的结论。
- 尚未拿两部实体手机分别进行 Wi-Fi/移动数据的连续多手测试，不宣称大陆直连稳定可用。保留本地可玩版本。

## 部署维护

前端自动发布已启用。正式后端当前通过已授权的本地 Wrangler 部署；独立 GitHub 后端工作流已就绪，但尚未配置长期 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID` Secrets，所以暂不能从 GitHub 手动触发后端更新。OAuth 本地登录不会自动生成仓库部署凭证；没有把本地 OAuth 令牌复制到仓库。
