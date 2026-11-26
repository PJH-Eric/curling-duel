# 後端部署：Cloudflare Worker

線上後端使用 Cloudflare Worker 與 Durable Objects。瀏覽器依房號選擇 WebSocket 路由，沿用原有訊息格式。

## 架構

- `worker/index.ts`：Worker 入口。檢查來源，提供 `/health` 與房號預留，然後把 WebSocket 交給版本化的大廳或房間 `GameHub`。取得 stub 時指定 `locationHint: 'apac'`。
- `worker/room-directory.ts`：大廳 DO 分配房號並保存房間列表摘要。每個房間 DO 持有自己的連線、對局狀態與計時器，規則沿用 `server/rooms.ts`。
- `server/session.ts`：Node 與 Worker 共用的訊息路由；`server/index.ts` 仍保留給本機／區域網路（`啟動遊戲.bat`）。
- `wrangler.toml`：Worker 名稱必須與 Cloudflare 後台一致（`curling-duel`）。

## 自動部署（Workers Builds）

1. Cloudflare 後台 → Workers & Pages → `curling-duel` → Settings → Builds，連結 GitHub repo、分支 `main`。
2. Build command 留空（Worker 由 wrangler 自行打包）；Deploy command 為 `npx wrangler deploy`。
3. commit 並 push `wrangler.toml`、`worker/` 等檔案後，之後每次 push 到 `main` 都會自動部署。

## 前端連線

部署成功後取得網址 `https://curling-duel.<帳號子網域>.workers.dev`，到 GitHub repo → Settings → Secrets and variables → Actions → Variables，把 `GAME_SERVER_URL` 改成該網址（僅 origin，不含路徑），再重新執行 Pages 部署。用戶端會自動把 `https` 換成 `wss`。

首次切換房間 DO 時，前端可先發布。新版前端會探測 Worker 是否已支援按房號分流。新版 Worker 上線後，已開著舊前端的玩家需要重新整理並開新房。

## 本機測試

```
npm run worker:dev     # 在 localhost:3090 跑真正的 Workers 執行環境
npm run worker:check   # 另開視窗，端到端檢查
```

## 延遲驗收

從台灣與香港發送 `/health` 並建立新房。用瀏覽器開發者工具查看大廳和房間 WebSocket 的 101 回應。`x-edge-colo` 預期為 `TPE` 或 `HKG`，`x-do-rtt-ms` 的目標為低於 20 ms。房間內用現有 `ping`／`pong` 驗證玩家到房間的 RTT 低於 80 ms。用 Workers Logs 的 `durable_object_created` 事件比對版本、DO ID 與用途。

## 額外前端網域

官方 Pages 網域已固定放行；其他網域請在 `wrangler.toml` 的 `GAME_ALLOWED_ORIGIN` 填入（逗號分隔）。

## 注意

- 免費方案的 Durable Object 需 SQLite 後端，已在 `wrangler.toml` 的 migrations 設定。
- 大廳最多管理 200 間房。調整 `DO_VERSION` 會使新連線使用一組新的 DO，原房間需重新建立。
- `render.yaml`、`koyeb.yaml`、`docs/koyeb-deploy.md` 已不再使用，確認 Worker 穩定後可刪除。
