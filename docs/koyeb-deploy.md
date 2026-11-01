# 部署後端到 Koyeb

本文件說明如何把冰壺對決（Ice Duel）的線上對戰伺服器從 Render 搬到 Koyeb。前端仍部署在 GitHub Pages，不需要改動。

伺服器程式位於 `server/index.ts`，是 Node.js + WebSocket 服務，沒有額外的建置步驟。`koyeb.yaml` 記錄了建議的設定，與 `render.yaml` 內容對應。

## 事前準備

1. 確認要部署的程式已 commit 並 push 到 GitHub（Koyeb 從 repo 建置）。目前 remote 為 `https://github.com/PJH-Eric/curling-duel.git`，部署前請確認分支與內容正確。
2. 有 Koyeb 帳號，並已連結 GitHub 授權（能存取上述 repo）。
3. 本機可以先執行 `npm ci && npx tsx server/index.ts`，確認伺服器可啟動，並看到 `server listening on :3090`。

## 在 Koyeb 建立服務

1. 進入 Koyeb 後台，選擇 **Create Web Service**，來源選 **GitHub**，選取 repo 與分支（`main`）。
2. Builder 選 **Buildpack**，Build command 填 `npm ci`。
3. Run command 填 `npx tsx server/index.ts`。
4. Runtime 選 Node.js 20，若後台有版本選項請選 20。
5. Port 填 `8000`，協定為 HTTP。
6. Health check 路徑填 `/health`。
7. 環境變數新增：
   - `PORT` = `8000`
   - `NODE_VERSION` = `20`
8. Instance 選免費方案（Free），Region 選亞洲最近的區域（例如新加坡）。
9. 按下 Deploy，等待建置完成。

部署完成後，Koyeb 會給一組 `https://<服務名稱>-<組織>.koyeb.app` 的網址，記下它。

## 更新前端的伺服器網址

1. 到 GitHub repo 的 **Settings → Secrets and variables → Actions → Variables**。
2. 新增或修改 `GAME_SERVER_URL`，值為 Koyeb 的網址，例如 `https://ice-duel-xxxx.koyeb.app`。必須是 `https://`，不含路徑、結尾斜線、帳密或查詢參數。
3. 到 **Actions** 頁面，手動執行 **Deploy Ice Duel to GitHub Pages**（workflow_dispatch），或推送一次 commit 觸發部署。

注意：`GAME_SERVER_URL` 是建置時注入的，修改後必須重新部署 Pages 才會生效。

## 驗證

1. 開啟 `https://<koyeb 網址>/health`，應回傳 `{"ok":true,"rooms":0}`。
2. 開啟 GitHub Pages 上的遊戲，進入線上模式，確認可以建立房間並取得邀請連結。
3. 用另一台裝置（或無痕視窗）透過邀請連結加入，確認雙方都能看到對方。
4. 重新整理一方頁面，確認可以重新連線。

若 `/health` 無法連線，先看 Koyeb 的 Build 與 Runtime 日誌。伺服器預設允許官方 Pages 網域 `https://pjh-eric.github.io`，不必設定 `GAME_ALLOWED_ORIGIN`；若使用其他前端網域，再將它加入該變數。若線上模式連不上，也請確認 `GAME_SERVER_URL` 已指向目前的 Koyeb 網址並重新部署 Pages。

## 注意事項

- Koyeb 免費方案的實例數量、休眠與冷啟動規則可能變動，請以 Koyeb 官方頁面為準。若服務會休眠，第一次連線會較慢。
- Render 上的服務在遷移完成前可以先保留，確認 Koyeb 穩定後再停用，避免中斷。
- 伺服器的房間資料存在記憶體中，服務重啟或重新部署後房間會消失，這與 Render 時相同。
- 本文件與 `koyeb.yaml` 中的 repo 名稱為 `curling-duel`。如果實際部署的 repo 不同，請同步修改兩處。
