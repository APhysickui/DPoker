# DPoker · 朋友的牌局

移动端优先的中文私人德州扑克。2–9 人、无限注、免费虚拟筹码，无需注册；不包含支付、兑换、公开匹配、聊天、机器人或排行榜。

## 本地启动

需要 Node.js 22.12+（或更新的稳定版本）。

```sh
npm ci
# 或直接 npm run dev:all 同时启动前后端
npm run dev:worker
# 另一个终端
npm run dev
```

打开 http://localhost:5173/DPoker/ 。用不同浏览器或无痕窗口模拟不同玩家；同一浏览器同一房间共享座位。一个座位只能在一个页面在线，后打开的页面会替换之前的连接。

1. 输入昵称创建房间，可调整初始筹码和盲注（默认 1000、5/10）。
2. 点击“邀请朋友”复制链接。朋友输入昵称入座，各自点击“准备下一手”。
3. 至少两人准备后，房主点击“开始牌局”。每手结束展示 5 秒后自动继续；在线且准备、筹码大于零的玩家才参加下一手。
4. 每次行动 30 秒，超时可过牌时自动过牌，否则弃牌。房主离线 60 秒后移交给下一位在线且未申请离桌的玩家。
5. 中途加入的玩家等下一手；离桌和补筹码在手牌之间生效。房主面板每次补充房间的初始筹码数量。取消准备只影响下一手。

本机测试链接不能直接分享给互联网朋友。局域网联机需将 `wrangler.jsonc` 的 `ALLOWED_ORIGINS` 增加实际前端来源（如 `http://192.168.1.10:5173`），并把前端 `.env.local` 的 `VITE_API_URL` 设为 `http://192.168.1.10:8788`，后端使用 `npx wrangler dev --ip 0.0.0.0 --port 8788`。仅在可信局域网测试；正式部署使用 HTTPS。

## 测试

```sh
npm run check                 # 引擎测试、TypeScript、生产构建
npm run dev:worker            # 另一个终端启动
npm run test:integration      # 约 100 秒，含真实 30 秒超时和 60 秒房主移交
npm run test:restart          # 自动启动测试专用 Worker，验证磁盘状态恢复
```

测试覆盖：单挑/多人行动顺序、最小加注、不足额全下与累计重新开放、全下跑牌、多重边池、弃牌贡献、未跟注退回、平局分池及余数、400 手随机筹码守恒、底牌过滤、刷新恢复、九人满桌、来源限制、身份鉴权、越权动作、重复指令、中途加入/离桌/补筹码、Alarm 超时和房主移交。

浏览器测试（开发服务器与 Worker 已启动）：

```sh
python3 -m venv .venv
.venv/bin/pip install playwright
.venv/bin/playwright install chromium
.venv/bin/python scripts/browser_test.py
```

截图输出到忽略提交的 `artifacts/`。实际验收状态见 [VERIFICATION.md](VERIFICATION.md)。

## 免费部署：Cloudflare 后端

1. 注册/登录 Cloudflare，保留 Workers Free 方案。SQLite 类型 Durable Objects 支持免费方案，不需开通付费订阅。免费额度和限制以 [官方定价](https://developers.cloudflare.com/durable-objects/platform/pricing/) 为准；超额服务可能不可用。
2. `npx wrangler login`；确认 `npx wrangler whoami` 返回正确账号。
3. 部署（来源只填域名部分，**不带 `/DPoker/` 路径**）：

```sh
npx wrangler deploy --var 'ALLOWED_ORIGINS:https://aphysickui.github.io'
```

保存输出的 `https://dpoker-api.<子域>.workers.dev` 地址。首次会创建 SQLite Durable Object 类。房间全量状态通过 SQLite 后端存储的 KV 接口保存，状态和 Alarm 同事务提交。

自动部署：仓库 Secrets 设置 `CLOUDFLARE_API_TOKEN`（限定目标账号的 Workers 编辑权限）和 `CLOUDFLARE_ACCOUNT_ID`；Variables 设置 `PAGES_ORIGIN=https://aphysickui.github.io`。在 Actions 手动运行 **Deploy realtime Worker**。不要把凭证写入代码或发送到聊天。OAuth 本地登录不自动等同于配置 CI Secrets。

## GitHub Pages 前端

公开仓库目标：`APhysickui/DPoker`，网址 `https://aphysickui.github.io/DPoker/`。

1. 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
2. Settings → Secrets and variables → Actions → Variables 新建 `VITE_API_URL`，值为上述 Worker 的 HTTPS 地址，不带末尾斜杠。
3. 推送 `main` 或手动运行 **Check and publish Pages**。规则测试、构建与 Worker 集成测试通过后才发布。没有 `VITE_API_URL` 时只检查，不发布不能联机的空壳网页。
4. 邀请链接形式 `https://aphysickui.github.io/DPoker/#/room/xxxxxxxxxxxx`。使用哈希路由，直接打开与刷新不会走 Pages 不存在的路径。

正式发布后需验证：两台设备 HTTPS/WSS 联机、手机竖屏、邀请链接直接打开和刷新、Wi-Fi 与移动网络连续多手。分别测试 GitHub Pages 和 Worker 的大陆连通性；本机代理访问成功不能替代大陆直连或移动网络测试，不保证稳定访问。

## 架构与规则约定

- `shared/game.ts`：纯状态规则引擎、七选五牌型比较、边池、轮转、超时；服务端用 `crypto.getRandomValues` 无偏 Fisher–Yates 洗牌。
- `worker/index.ts`：每个房间一个 Durable Object；原生 WebSocket Hibernation API、持久化 Alarm、串行事件队列。
- HTTP `POST /api/rooms` 创建，`POST /api/rooms/:room/join` 加入。请求 JSON 包含 `name`；创建另含 `initial/small/big`。返回随机身份凭证。
- `GET /api/rooms/:room/ws` 升级连接。10 秒内首条消息必须 `{type:'auth',player,token}`；完成鉴权前不发牌局状态。后续命令含 `id`（唯一 UUID）与当前 `version`；支持 `ready/start/move/leave/topup`。
- 服务端仅信任已鉴权连接的玩家 ID；动作先验证，持久化成功再广播。最近 128 个命令编号保存为回执用于重试去重；更旧的原始命令由状态版本校验拒绝。客户端不盲重发下注，确认超时先重连同步。
- 只发送当前玩家底牌；多人摊牌时公开仍在手牌中的玩家牌，弃牌者底牌不公开。牌堆和凭证哈希不进入公开状态。凭证只在创建/加入的 HTTPS 响应和首次 WSS 鉴权传输，邀请链接不含凭证。
- 不足额全下不会单独重新开放已行动玩家的加注权；累计达到完整最小加注幅度时重新开放。每个边池独立分配，余数筹码从庄家左侧顺时针分配；无人跟注部分退回。
- 初版房间不自动过期、没有找回凭证入口；清除站点数据会失去原座位恢复能力。请保留本地凭证，使用“离开牌桌”释放座位。关闭网页只离线，不等于离桌。
- 来源白名单不是身份认证，也不能阻止非浏览器客户端伪造 Origin。身份隔离依赖随机凭证。当前有每房间连接数、消息大小和频率限制；大规模公开推广前应增加边缘创建频率限制/挑战与闲置房间清理。

只用于朋友之间的娱乐，不涉及真实金钱。
