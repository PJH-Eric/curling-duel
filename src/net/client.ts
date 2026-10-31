import type { ClientMsg, ServerMsg } from '../../server/protocol'
import { storageGet, storageSet } from '../game/settings'
import { serverWsUrl } from './config'

export type NetStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline'

function sid(): string {
  let s = storageGet('iceduel.sid')
  if (!s) {
    s = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')
    storageSet('iceduel.sid', s)
  }
  return s
}

/** WebSocket 連線：自動重連、心跳、重連後重新加入房間。 */
export class NetClient {
  private ws: WebSocket | null = null
  private handlers = new Set<(m: ServerMsg) => void>()
  private statusHandlers = new Set<(s: NetStatus, ping: number) => void>()
  status: NetStatus = 'idle'
  ping = 0
  name = 'Guest'
  roomCode: string | null = null
  private wantOpen = false
  private retry = 0
  private pingTimer: number | null = null
  private sentAt = 0
  private openWaiters: ((ok: boolean) => void)[] = []

  on(fn: (m: ServerMsg) => void): () => void {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }
  onStatus(fn: (s: NetStatus, ping: number) => void): () => void {
    this.statusHandlers.add(fn)
    return () => this.statusHandlers.delete(fn)
  }
  private setStatus(s: NetStatus): void {
    this.status = s
    this.statusHandlers.forEach((f) => f(s, this.ping))
  }

  /** 連線。免費主機睡眠時可能要等約一分鐘，所以逾時較長。 */
  connect(name: string): Promise<boolean> {
    this.name = name
    const url = serverWsUrl()
    if (!url) return Promise.resolve(false)
    if (this.status === 'online') {
      this.send({ t: 'hello', sid: sid(), name })
      return Promise.resolve(true)
    }
    this.wantOpen = true
    return new Promise((res) => {
      this.openWaiters.push(res)
      if (this.status !== 'connecting' && this.status !== 'reconnecting') this.open(url)
    })
  }

  private open(url: string): void {
    this.setStatus(this.retry > 0 ? 'reconnecting' : 'connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.fail()
      return
    }
    this.ws = ws
    const timeout = window.setTimeout(() => ws.close(), 70_000)
    ws.onopen = () => {
      window.clearTimeout(timeout)
      this.retry = 0
      this.send({ t: 'hello', sid: sid(), name: this.name })
      if (this.roomCode) this.send({ t: 'join', code: this.roomCode, name: this.name })
      this.setStatus('online')
      this.openWaiters.splice(0).forEach((f) => f(true))
      this.startPing()
    }
    ws.onmessage = (e) => {
      let m: ServerMsg
      try {
        m = JSON.parse(String(e.data)) as ServerMsg
      } catch {
        return
      }
      if (m.t === 'pong') {
        this.ping = Math.round(performance.now() - this.sentAt)
        this.statusHandlers.forEach((f) => f(this.status, this.ping))
        return
      }
      this.handlers.forEach((f) => f(m))
    }
    ws.onclose = () => {
      window.clearTimeout(timeout)
      this.stopPing()
      if (this.ws === ws) this.ws = null
      if (this.wantOpen) this.fail()
    }
    ws.onerror = () => undefined
  }

  private fail(): void {
    this.retry += 1
    if (this.retry > 6) {
      this.setStatus('offline')
      this.openWaiters.splice(0).forEach((f) => f(false))
      this.retry = 0
      return
    }
    this.setStatus('reconnecting')
    const url = serverWsUrl()
    if (url) window.setTimeout(() => this.wantOpen && this.open(url), Math.min(8000, 800 * this.retry))
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = window.setInterval(() => {
      this.sentAt = performance.now()
      this.send({ t: 'ping', n: 1 })
    }, 5000)
  }
  private stopPing(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }

  close(): void {
    this.wantOpen = false
    this.roomCode = null
    this.stopPing()
    this.ws?.close()
    this.ws = null
    this.setStatus('idle')
  }
}
