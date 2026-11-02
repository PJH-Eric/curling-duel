# 冰壺對決 Ice Duel

回合制 3D 冰壺小遊戲（Vite + TypeScript + Three.js）。可單機對電腦、線上房間對戰與觀戰，平板／手機／桌機皆可操作。

**核心設計：投壺結果由固定步長、確定性的規則核心（`src/core`）計算。** 玩家出手時只送出「方向、力道、旋轉、掃冰點擊時間」，伺服器重新計算並廣播結果，其他人看回放；網路延遲只影響等待時間，不影響勝負。

## 模式
- 標準冰壺（每隊每局 8 壺、預設 4 局（可選 1～10 局））、九宮連線、冰洞挑戰、任務教學（7 關）；每隊 1～4 人（最多 4 對 4，每人投 2 壺）；介面支援繁體中文、简体中文、English
- 單機：簡單／普通／困難電腦（差別在執行誤差、搜尋深度與是否預判對手）
- 線上：公開大廳、房號、邀請連結（玩家／觀戰）、觀戰、電腦補位、斷線重連與接管、聊天室
- 1 對 1 與 2 對 2

## 本機執行
需要 Node.js 20 以上。

```bash
npm install
npm run server     # 遊戲伺服器 http://localhost:3090（健康檢查 /health）
npm run dev        # 前端 http://localhost:5173
```
Windows 可直接雙擊 `啟動遊戲.bat`。

## 指令
| 指令 | 用途 |
| --- | --- |
| `npm test` | 單元測試（規則、AI、房間、i18n） |
| `npm run verify` | 測試 + AI 對戰強度驗證 |
| `npx tsx scripts/online-check.ts ws://localhost:3090` | 對運行中的伺服器做端到端檢查 |
| `npm run build` | 型別檢查並建置到 `dist/` |

## 環境變數
| 名稱 | 位置 | 說明 |
| --- | --- | --- |
| `VITE_GAME_SERVER_URL` | 前端建置 | 啟用線上對戰時設定；GitHub 工作流程由倉庫變數 `GAME_SERVER_URL` 提供。未設定時仍可部署單機模式，線上模式會顯示「尚未設定伺服器網址」，不會偷偷連到 localhost。 |
| `PORT` | 伺服器 | 預設 3090 |
| `GAME_ALLOWED_ORIGIN` | 伺服器（選填） | 額外允許的網頁來源，逗號分隔。官方 Pages 網域 `https://pjh-eric.github.io` 已預設允許。 |

複製 `.env.example` 為 `.env` 即可本機調整。**不要把任何 token 或密鑰寫進程式碼或提交進倉庫。**

## 部署（GitHub Pages）
1. 在倉庫 Settings → Pages 將 Build and deployment 的 Source 設為「GitHub Actions」。
2. 推送到 `main` 或 `master` 後，`.github/workflows/deploy-pages.yml` 會安裝 lockfile 指定的依賴、執行專案檢查、建置並部署到 Pages。未設定 `GAME_SERVER_URL` 時會部署單機模式；線上對戰會提示伺服器尚未設定。
3. 要啟用線上對戰時，後端為 Cloudflare Worker（Workers Builds 連 GitHub 自動部署，見 `docs/cloudflare-deploy.md`）。再到 Settings → Secrets and variables → Actions → Variables 設定 `GAME_SERVER_URL` 為 Worker 的 HTTPS 網址來源（`https://curling-duel.<子網域>.workers.dev`，不含路徑）。這是公開網址，不是 secret；workflow 會驗證格式。`GA_MEASUREMENT_ID` 可選，用來覆寫預設 GA4 ID。
4. workflow 使用 GitHub 內建 `GITHUB_TOKEN`，不需要建立或貼入 PAT。部署狀態與錯誤可在倉庫 Actions 頁面查看；回滾時還原到已知可用的 commit，再推送該變更。

## Blender 素材（選用）
見 `blender/README.md`。沒有 glb 時遊戲使用程式產生的模型。

## 音訊
音效與預設背景音樂皆為 WebAudio 即時合成，沒有外部授權素材。想換背景音樂：放一個 `public/audio/bgm.mp3`（請自行確認授權）。

## 規則摘要與簡化
- 輪流投壺，後手隊（hammer）投最後一壺；得分隊下一局失去後手。
- 前 5 壺（雙方合計，五壺規則）適用「守護區」規則（違規者的壺被移除、場面還原）。
- 壺必須越過遠端 hog 線；越過底線或側線出界。
- 平手最多加賽 2 局。
- 與正式比賽的差異：預設四局（正式為 10 局）、掃冰簡化為快速連點（或按住）；細部判例（例如近端 hog 線）以簡化版本為主。

## 專案結構
```
src/core     規則、物理、AI（前後端共用，確定性）
src/scene    Three.js 場景、模型、特效
src/screens  畫面（首頁、設定、大廳、房間、對局）
src/game     後端介面（單機／線上）、設定
server/      房間與訊息路由（Node 本機伺服器 + 共用邏輯）
worker/      Cloudflare Worker + Durable Object 入口
tests/       vitest
scripts/     AI 對戰與線上端到端檢查
blender/     Blender 腳本
```

## GA4 與 SEO

- 設定檔：`seo.config.json`（標題、說明、封面 `public/assets/images/cover.webp`、canonical 網址）。
- 部署時由 `scripts/inject-seo.mjs` 在 `dist/index.html` 注入 canonical / Open Graph / Twitter Card / JSON-LD 與 GA4 設定，並產生 `dist/sitemap.xml`；`public/robots.txt` 指向該 sitemap。流程已寫進 `.github/workflows/deploy-pages.yml`（`npm run build` 之後）。
- 衡量 ID 預設為與其他遊戲共用的 `G-PG79WZK8QY`；要改用別的，在 GitHub repo Variables 設定 `GA_MEASUREMENT_ID`。
- 僅在 `pjh-eric.github.io` 網域載入 Google tag；本機、Render 預覽不會送資料。事件：`game_start`、`game_end`、`room_create`、`room_join`，只帶玩法、難度、模式、結果、秒數，不含暱稱或房號（見 `src/analytics.ts`）。
- 本機試跑：`VITE_BASE=/curling-duel/ npm run build && npm run seo`。
- Search Console：取得驗證碼後填入 `seo.config.json` 的 `googleSiteVerification`（根網域 repo 已驗證時可留空）。

## 同一個 Wi-Fi 連線（區域網路）

執行 `啟動遊戲.bat`（或 `npm run server` + `npm run dev`）時，視窗會列出本機的區域網路 IP，例如 `http://192.168.1.23:5173`。同一個 Wi-Fi 的手機、平板、其他電腦用瀏覽器開這個網址，就能在「線上對戰」建立或加入房間一起玩。

- 沒設定 `GAME_ALLOWED_ORIGIN` 時，伺服器會放行官方 Pages 網域及私有網段（10.x、172.16–31.x、192.168.x）。設定該變數可額外允許自訂網域；設定後不再自動放行私有網段。
- 連不上時，請在 Windows 防火牆允許 Node.js 的「私人網路」連線（連接埠 3090、5173）。

## SEO 圖片

- `public/assets/images/cover.jpg`（1200×630，社群分享圖，含標題）與 `cover.webp`；`shot-standard/grid/hole.webp`（1200×675，各模式實際遊戲畫面）。
- 圖片、alt 文字與說明統一寫在 `seo.config.json`；`scripts/inject-seo.mjs` 會產生 Open Graph／Twitter 圖片標籤、JSON-LD（WebApplication＋VideoGame＋截圖）、hreflang、圖片 sitemap，並在 `#app` 內放一份搜尋引擎可讀的靜態內容（含圖片 alt），遊戲啟動後自動取代。
- `public/manifest.webmanifest` 與 `icon-192/512.png` 提供加到主畫面的圖示。
