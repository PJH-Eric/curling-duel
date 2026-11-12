/** 線上大廳聊天室（左下氣泡）：共用元件 lobby-chat.js 的轉接層，跟房間聊天分開 */
import '../ui/lobby-chat.js'
import '../ui/lobby-chat.css'
import type { ServerMsg } from '../../server/protocol'
import type { NetClient } from './client'
import { getLang, onLangChange } from '../i18n'

export interface LobbyChatUI {
  setConnected(on: boolean): void
  history(msgs: unknown[], online: number): void
  add(msg: unknown): void
  online(n: number): void
  error(code: string): void
  setEnabled(on: boolean): void
  isEnabled(): boolean
  refresh(): void
  relabel(): void
  text(key: string): string
}

export function createLobbyChat(net: NetClient, o: { active: () => boolean; getName: () => string; setName: (n: string) => void; joinRoom: (code: string) => void }): LobbyChatUI | null {
  const LC = (window as unknown as { LobbyChat?: { create(opts: object): LobbyChatUI } }).LobbyChat
  if (!LC) return null
  const chat = LC.create({
    game: 'ice-duel',
    active: o.active,
    lang: () => getLang(),
    getName: o.getName,
    setName: o.setName,
    join: (name: string) => net.send({ t: 'lobbychat', op: 'join', name }),
    leave: () => net.send({ t: 'lobbychat', op: 'leave' }),
    send: (text: string, name: string) => net.send({ t: 'lobbychat', op: 'send', text, name }),
    joinRoom: o.joinRoom,
  })
  chat.setConnected(net.status === 'online')
  net.onStatus((s) => chat.setConnected(s === 'online'))
  net.on((m: ServerMsg) => {
    if (m.t !== 'lobbychat') return
    if (m.op === 'history') chat.history(m.history, m.online)
    else if (m.op === 'msg') chat.add(m.msg)
    else if (m.op === 'online') chat.online(m.online)
    else if (m.op === 'error') chat.error(m.code)
  })
  onLangChange(() => chat.relabel())
  return chat
}
