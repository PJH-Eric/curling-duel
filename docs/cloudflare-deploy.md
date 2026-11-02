# 後端部署：Cloudflare Worker

後端已從 Node（Render／Koyeb）改為 Cloudflare Worker + Durable Object，WebSocket 協定完全不變，前端不用改程式。

## 架構

- `worker/index.ts`：Worker 入口。檢查來源、提供 `/health`，並把 WebSocket 轉給唯一的 `GameHub`（Durable Object，建立在亞太區）。
- `GameHub`：持有全部房間與計時器（電腦出手、回合限時、斷線接管），邏輯沿用 `server/rooms.ts`。房間存在記憶體，重新部署後房間會消失（與原本相同）。
- `server/session.ts`：Node 與 Worker 共用的訊息路由；`server/index.ts` 仍保留給本機／區域網路（`啟動遊戲.bat`）。
- `wrangler.toml`：Worker 名稱必須與 Cloudflare 後台一致（`curling-duel`）。

## 自動部署（Workers Builds）

1. Cloudflare 後台 → Workers & Pages → `curling-duel` → Settings → Builds，連結 GitHub repo、分支 `main`。
2. Build command 留空（Worker 由 wrangler 自行打包）；Deploy command 為 `npx wrangler deploy`。
3. commit 並 push `wrangler.toml`、`worker/` 等檔案後，之後每次 push 到 `main` 都會自動部署。

## 前端連線

部署成功後取得網址 `https://curling-duel.<帳號子網域>.workers.dev`，到 GitHub repo → Settings → Secrets and variables → Actions → Variables，把 `GAME_SERVER_URL` 改成該網址（僅 origin，不含路徑），再重新執行 Pages 部署。用戶端會自動把 `https` 換成 `wss`。

## 本機測試

```
npm run worker:dev     # 在 localhost:3090 跑真正的 Workers 執行環境
npm run worker:check   # 另開視窗，端到端檢查
```

## 額外前端網域

官方 Pages 網域已固定放行；其他網域請在 `wrangler.toml` 的 `GAME_ALLOWED_ORIGIN` 填入（逗號分隔）。

## 注意

- 免費方案的 Durable Object 需 SQLite 後端，已在 `wrangler.toml` 的 migrations 設定。
- 全部連線都進同一個 Durable Object，適合目前規模（房間上限 200）。
- `render.yaml`、`koyeb.yaml`、`docs/koyeb-deploy.md` 已不再使用，確認 Worker 穩定後可刪除。
