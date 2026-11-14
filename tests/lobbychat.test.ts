import { describe, expect, it } from 'vitest'
import { LobbyChat } from '../server/lobbychat'

describe('大廳聊天室連線訊息', () => {
  it('新連線從空白開始，仍即時收到在線訊息', () => {
    const sent: Array<{ id: string; msg: unknown }> = []
    const chat = new LobbyChat((id, msg) => sent.push({ id, msg }))
    const join = (id: string, name: string) => chat.handle(id, { t: 'lobbychat', op: 'join', name })
    const messagesFor = (id: string) => sent.filter((event) => event.id === id)
      .map((event) => event.msg as { op: string; history?: unknown[]; msg?: { text?: string }; online?: number })
    const last = (id: string, op: string) => messagesFor(id).filter((message) => message.op === op).at(-1)

    join('first', 'First')
    expect(last('first', 'history')?.history).toEqual([])
    expect(last('first', 'history')?.online).toBe(1)
    expect(last('first', 'online')?.online).toBe(1)
    chat.handle('first', { t: 'lobbychat', op: 'send', text: '本次連線訊息' })
    expect(last('first', 'msg')?.msg?.text).toBe('本次連線訊息')

    join('second', 'Second')
    expect(last('second', 'history')?.history).toEqual([])
    expect(last('second', 'history')?.online).toBe(2)
    expect(last('second', 'online')?.online).toBe(2)
    expect(last('first', 'online')?.online).toBe(2)
    chat.handle('second', { t: 'lobbychat', op: 'send', text: '即時訊息' })
    expect(last('first', 'msg')?.msg?.text).toBe('即時訊息')

    chat.drop('second')
    expect(last('first', 'online')?.online).toBe(1)
    join('second', 'Second')
    expect(last('second', 'history')?.history).toEqual([])
    expect(last('second', 'history')?.online).toBe(2)
    chat.drop('second')
    expect(last('first', 'online')?.online).toBe(1)
  })
})
