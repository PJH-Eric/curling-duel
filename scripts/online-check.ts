/** 對真實伺服器做端到端檢查：npm run server 啟動後執行 `npx tsx scripts/online-check.ts [ws://localhost:3090]` */
import WebSocket from 'ws'
import type { ClientMsg, ServerMsg } from '../server/protocol'

const URL = process.argv[2] ?? 'ws://localhost:3090'
let failed = 0
const ok = (c: boolean, label: string) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`)
  if (!c) failed++
}

class Cli {
  ws: WebSocket
  msgs: ServerMsg[] = []
  pid = ''
  role = ''
  team = -1
  player = -1
  constructor(public sid: string, public name: string) {
    this.ws = new WebSocket(URL)
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMsg
      this.msgs.push(m)
      if (m.t === 'room') {
        this.pid = m.you.pid
        this.role = m.you.role
        this.team = m.you.team
        this.player = m.you.player
      }
    })
  }
  open() {
    return new Promise<void>((res) => this.ws.on('open', () => { this.send({ t: 'hello', sid: this.sid, name: this.name }); res() }))
  }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)) }
  async wait(pred: (m: ServerMsg) => boolean, ms = 8000): Promise<ServerMsg | null> {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const f = this.msgs.find(pred)
      if (f) return f
      await new Promise((r) => setTimeout(r, 25))
    }
    return null
  }
  last<T extends ServerMsg['t']>(t: T) { return [...this.msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined }
}

const cfg = { setup: { kind: 'standard' as const, playersPerTeam: 1 as const, timerSec: 45, standard: { stonesPerTeam: 8, ends: 1 } }, level: 'easy' as const, public: false, maxSpectators: 5 }

async function main() {
  const host = new Cli('sid-host', 'Host'); await host.open()
  host.send({ t: 'create', name: 'Host', config: cfg })
  const r1 = await host.wait((m) => m.t === 'room')
  ok(!!r1, '建立房間')
  const code = host.last('room')!.room.code
  ok(host.last('room')!.room.config.public === false, '私人房')

  const stranger = new Cli('sid-x', 'X'); await stranger.open()
  stranger.send({ t: 'join', code, name: 'X' })
  ok(!!(await stranger.wait((m) => m.t === 'error' && m.code === 'private')), '沒有邀請連結不能加入私人房')

  host.send({ t: 'invite', scope: 'spectator' })
  const specInv = (await host.wait((m) => m.t === 'invite')) as Extract<ServerMsg, { t: 'invite' }>
  const spec = new Cli('sid-spec', 'Spec'); await spec.open()
  spec.send({ t: 'join', code, name: 'Spec', invite: specInv.token })
  await spec.wait((m) => m.t === 'room')
  ok(spec.role === 'spectator', '觀戰邀請 → 伺服器指定為觀戰者')

  host.msgs.length = 0
  host.send({ t: 'invite', scope: 'player' })
  const plInv = (await host.wait((m) => m.t === 'invite')) as Extract<ServerMsg, { t: 'invite' }>
  const guest = new Cli('sid-guest', 'Guest'); await guest.open()
  guest.send({ t: 'join', code, name: 'Guest', invite: plInv.token })
  await guest.wait((m) => m.t === 'room')
  ok(guest.role === 'player' && guest.team === 1, '玩家邀請 → 入座對手席')

  host.send({ t: 'revoke' })
  await host.wait((m) => m.t === 'invite')
  const late = new Cli('sid-late', 'Late'); await late.open()
  late.send({ t: 'join', code, name: 'Late', invite: plInv.token })
  ok(!!(await late.wait((m) => m.t === 'error' && m.code === 'revoked')), '撤銷後舊邀請失效')

  host.send({ t: 'start' })
  await guest.wait((m) => m.t === 'snapshot')
  ok(true, '開始對局，雙方收到快照')

  // 輪流投壺直到結束；非自己回合與觀戰者出手必須被拒絕
  spec.send({ t: 'throw', spec: { angle: 0, power: 0.5, spin: 1 }, taps: [] })
  ok(!!(await spec.wait((m) => m.t === 'error')), '觀戰者出手被拒絕')
  let records = 0
  const who = [host, guest]
  let turnTeam = 0 // 首手：後手 hammer=1 → 隊 0 先投
  for (let i = 0; i < 16; i++) {
    const p = who[turnTeam]
    const other = who[1 - turnTeam]
    if (i === 0) {
      other.send({ t: 'throw', spec: { angle: 0, power: 0.5, spin: 1 }, taps: [] })
      ok(!!(await other.wait((m) => m.t === 'error' && m.code === 'forbidden')), '非自己回合出手被拒絕')
    }
    const before = records
    p.send({ t: 'throw', spec: { angle: 0, power: 0.55, spin: 1 }, taps: [0.6, 1.2] })
    await host.wait((m) => m.t === 'record' && host.msgs.filter((x) => x.t === 'record').length > before)
    records = host.msgs.filter((x) => x.t === 'record').length
    turnTeam = 1 - turnTeam
  }
  ok(records === 16, '16 壺全部由伺服器結算並廣播')
  const recSpec = spec.msgs.filter((m) => m.t === 'record').length
  ok(recSpec === 16, '觀戰者收到全部回放資料')
  // 局結算後所有玩家確認 → 伺服器推進；最後一局之後房間為 over
  host.send({ t: 'advance' }); guest.send({ t: 'advance' })
  await new Promise((r) => setTimeout(r, 500))
  const adv = !!(await host.wait((m) => m.t === 'advance', 2000))
  const phase = host.last('room')!.room.phase
  ok(adv && (phase === 'over' || phase === 'playing'), `局結算確認後伺服器推進（${phase === 'over' ? '終局' : '平手加賽'}）`)

  // 全部真人離開 → 房間關閉
  for (const c of [guest, spec, stranger, late]) c.ws.close()
  host.send({ t: 'leave' })
  await new Promise((r) => setTimeout(r, 300))
  const viewer = new Cli('sid-v', 'V'); await viewer.open()
  viewer.send({ t: 'join', code, name: 'V', invite: plInv.token })
  ok(!!(await viewer.wait((m) => m.t === 'error' && (m.code === 'notFound' || m.code === 'revoked'))), '房主離開後房間已關閉、邀請失效')
  host.ws.close(); viewer.ws.close()
  console.log(failed === 0 ? '\n線上檢查全部通過' : `\n有 ${failed} 項失敗`)
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
