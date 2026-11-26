import { describe, expect, it, vi } from 'vitest'
import { selectBackend, serverWsUrl } from '../src/net/config'

const PRIMARY = 'https://ice-duel-server.onrender.com'
const BACKUP = 'https://curling-duel.eric-games.workers.dev'
const site = new URL('https://pjh-eric.github.io/curling-duel/')

describe('線上對戰後端選擇', () => {
  it('先試主服務，成功後保留其房間協定', async () => {
    const probe = vi.fn(async () => true)
    const backend = await selectBackend(PRIMARY, site, probe)
    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith({ origin: PRIMARY, id: 'primary', roomRouting: false })
    expect(backend).toMatchObject({ origin: PRIMARY, roomRouting: false, fallback: { origin: BACKUP } })
  })

  it('主服務連線失敗後，使用備援 Worker 建房與連房', async () => {
    const probe = vi.fn(async () => false)
    const backend = await selectBackend(PRIMARY, site, probe)
    expect(probe).toHaveBeenCalledOnce()
    expect(backend).toEqual({ origin: BACKUP, id: 'cloudflare', roomRouting: true })
    expect(serverWsUrl(backend, 'ab234', 'reservation')).toBe('wss://curling-duel.eric-games.workers.dev/?room=AB234&reservation=reservation')
  })

  it.each([
    ['cloudflare', BACKUP], ['primary', PRIMARY], ['render', PRIMARY],
  ])('固定後端的邀請直接加入 %s', async (id, origin) => {
    const invite = new URL(site)
    invite.searchParams.set('backend', id)
    const probe = vi.fn(async () => true)
    expect((await selectBackend(PRIMARY, invite, probe)).origin).toBe(origin)
    expect(probe).not.toHaveBeenCalled()
  })

  it('本機遊戲使用設定的伺服器', async () => {
    const probe = vi.fn(async () => false)
    const local = 'http://localhost:3090'
    expect((await selectBackend(local, new URL('http://localhost:5173'), probe)).origin).toBe(local)
    expect(probe).not.toHaveBeenCalled()
  })
})
