/**
 * 大廳聊天室伺服器核心（TypeScript 版，與 Node／Cloudflare Worker 共用）。
 * 規則與其他小遊戲的 lib/lobby-chat.js 相同：
 *   - 每款遊戲一個大廳頻道，與房間聊天完全分開；新連線只收到空白訊息清單
 *   - 每則最多 60 字；不雅字詞換成＊；同一人連續送出相同內容會被擋
 *   - 系統訊息只有「某某開了新房間」（附房號，前端顯示「加入」）；私人房不公告
 *   - 送給每個人的版本不同：自己說的話帶 mine:true（前端在暱稱後加「（我）」）
 */

export interface LobbyChatMsg {
  id: number
  kind: 'msg' | 'room'
  name: string
  text?: string
  room?: string
  code?: string
  ts: number
  mine?: boolean
}

interface Stored extends LobbyChatMsg { from?: string }

export type LobbyChatOut =
  | { t: 'lobbychat'; op: 'history'; history: LobbyChatMsg[]; online: number }
  | { t: 'lobbychat'; op: 'msg'; msg: LobbyChatMsg }
  | { t: 'lobbychat'; op: 'online'; online: number }
  | { t: 'lobbychat'; op: 'error'; code: string }

export type LobbyChatIn = { t: 'lobbychat'; op: 'join' | 'leave' | 'send'; name?: string; text?: string }

const MAX_LEN = 60
const NAME_LEN = 16

const BAD_ZH = [
  '幹你娘', '幹您娘', '干你娘', '操你媽', '操你妈', '肏你', '靠北', '靠杯', '機掰', '雞掰', '鸡掰', '機巴', '雞巴', '鸡巴', '賤人', '贱人', '婊子',
  '王八蛋', '混蛋', '白癡', '白痴', '智障', '腦殘', '脑残', '去死', '傻逼', '傻屄', '煞筆', '沙比', '他媽的', '他妈的', '媽的', '妈的', '尼瑪', '尼玛',
  '草泥馬', '草泥马', '低能', '垃圾人', '廢物', '废物',
]
const BAD_EN = ['fuck', 'fucking', 'fucker', 'motherfucker', 'fck', 'fuk', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'pussy', 'slut', 'whore', 'wtf', 'stfu', 'nigger', 'nigga', 'retard']
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const BAD_RE = new RegExp(
  [...BAD_ZH].sort((a, b) => b.length - a.length).map((w) => Array.from(w).map(esc).join('\\s*'))
    .concat([...BAD_EN].sort((a, b) => b.length - a.length).map((w) => '\\b' + esc(w) + '\\b'))
    .join('|'), 'gi')

export function censor(text: string): string {
  return String(text).replace(BAD_RE, (m) => '＊'.repeat(Array.from(m.replace(/\s+/g, '')).length))
}

export function cleanText(input: unknown, max: number): string {
  const s = String(input ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(s).slice(0, max).join('')
}

const cleanName = (input: unknown, fallback?: string) => censor(cleanText(input, NAME_LEN)) || fallback || 'Player'

export class LobbyChat {
  private seq = 0
  private people = new Map<string, { name: string; last: string }>()
  constructor(private send: (id: string, msg: LobbyChatOut) => void, private now: () => number = Date.now) {}

  private view(m: Stored, viewer: string): LobbyChatMsg {
    const { from, ...rest } = m
    return from != null && from === viewer ? { ...rest, mine: true } : rest
  }
  private fanout(m: Stored): void {
    for (const id of this.people.keys()) this.send(id, { t: 'lobbychat', op: 'msg', msg: this.view(m, id) })
  }
  private bcastOnline(): void {
    for (const id of this.people.keys()) this.send(id, { t: 'lobbychat', op: 'online', online: this.people.size })
  }

  /** 處理一則 lobbychat 訊息 */
  handle(id: string, m: LobbyChatIn): void {
    if (m.op === 'join') {
      const p = this.people.get(id)
      if (p) p.name = cleanName(m.name, p.name)
      else this.people.set(id, { name: cleanName(m.name), last: '' })
      this.send(id, { t: 'lobbychat', op: 'history', history: [], online: this.people.size })
      this.bcastOnline()
    } else if (m.op === 'leave') {
      this.drop(id)
    } else if (m.op === 'send') {
      const p = this.people.get(id)
      const err = (code: string) => this.send(id, { t: 'lobbychat', op: 'error', code })
      if (!p) return err('notjoined')
      if (m.name != null) p.name = cleanName(m.name, p.name)
      const raw = cleanText(m.text, MAX_LEN + 1)
      if (!raw) return err('empty')
      if (Array.from(raw).length > MAX_LEN) return err('long')
      const norm = raw.toLowerCase().replace(/\s+/g, '')
      if (norm === p.last) return err('dup')
      p.last = norm
      this.fanout({ id: ++this.seq, kind: 'msg', name: p.name, text: censor(raw), ts: this.now(), from: id })
    }
  }

  drop(id: string): void {
    if (this.people.delete(id)) this.bcastOnline()
  }

  /** 公開房間建立時呼叫；私人房間不公告 */
  roomOpened(info: { code: string; roomName?: string; host: string; isPrivate?: boolean }): void {
    if (info.isPrivate || !info.code) return
    this.fanout({ id: ++this.seq, kind: 'room', name: cleanName(info.host), room: censor(cleanText(info.roomName ?? '', 24)), code: String(info.code).slice(0, 32), ts: this.now() })
  }
}
