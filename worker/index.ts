/**
 * Cloudflare Worker 入口 + Durable Object。
 *
 * - Worker：只負責來源檢查、/health、把 WebSocket 升級請求轉給唯一的 GameHub。
 * - GameHub（Durable Object，單例）：持有全部房間與計時器，行為與原本的 Node 伺服器相同。
 *   所有連線進同一個物件，所以公開房間列表、房號查詢、邀請連結都不需要額外儲存。
 *   房間資料存在記憶體：重新部署或物件被回收時房間會消失（與原本 Render／Koyeb 重啟時相同）。
 */
import { DurableObject } from 'cloudflare:workers'
import type { ServerMsg } from '../server/protocol'
import { RoomHub } from '../server/rooms'
import { Gateway, makeOriginCheck } from '../server/session'

export interface Env {
  HUB: DurableObjectNamespace<GameHub>
  /** 額外允許的前端來源（逗號分隔）；官方 Pages 網域固定放行 */
  GAME_ALLOWED_ORIGIN?: string
  /** 設為 1 時放行 localhost／區域網路來源（只給 wrangler dev 本機測試用） */
  ALLOW_PRIVATE_ORIGINS?: string
}

const json = (body: unknown, cors: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } })

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const origin = req.headers.get('Origin')
    const originOk = makeOriginCheck(env.GAME_ALLOWED_ORIGIN, env.ALLOW_PRIVATE_ORIGINS === '1')
    const cors: Record<string, string> = origin && originOk(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}
    // 單例 Durable Object；locationHint 只在第一次建立時生效，讓它落在亞太區（台灣玩家延遲較低）
    const stub = env.HUB.get(env.HUB.idFromName('main'), { locationHint: 'apac' })

    if (url.pathname === '/health') {
      try {
        const r = (await (await stub.fetch('https://hub/health')).json()) as { rooms: number }
        return json({ ok: true, rooms: r.rooms }, cors)
      } catch {
        return json({ ok: true, rooms: null }, cors)
      }
    }

    if (req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (!originOk(origin)) return new Response('Forbidden origin', { status: 403 })
      return stub.fetch(req)
    }

    return new Response(null, { status: 404, headers: cors })
  },
} satisfies ExportedHandler<Env>

export class GameHub extends DurableObject<Env> {
  private hub = new RoomHub()
  private gateway = new Gateway(this.hub)

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/health') return Response.json({ ok: true, rooms: this.hub.rooms.size })
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 })

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    // 刻意不用 Hibernation API：房間計時器（電腦出手、回合限時、斷線接管）要靠物件常駐記憶體
    server.accept()
    const s = this.gateway.open({
      send: (m: ServerMsg) => {
        try {
          server.send(JSON.stringify(m))
        } catch {
          /* 連線已關閉 */
        }
      },
      close: () => {
        try {
          server.close(1000, 'closed')
        } catch {
          /* 已關閉 */
        }
      },
    })
    server.addEventListener('message', (e: MessageEvent) => {
      if (typeof e.data === 'string') this.gateway.message(s, e.data)
    })
    const gone = () => this.gateway.close(s)
    server.addEventListener('close', gone)
    server.addEventListener('error', gone)
    return new Response(null, { status: 101, webSocket: client })
  }
}
