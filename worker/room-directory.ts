import type { RoomListItem } from '../server/protocol'
import { LIMITS, randomRoomCode } from '../server/rooms'

const PREFIX = 'room:'
const RESERVATION_MS = 60_000
const ROOM_LEASE_MS = 120_000

interface Entry {
  token: string
  expires: number
  active: boolean
  summary: RoomListItem | null
}

export class RoomDirectory {
  private entries = new Map<string, Entry>()

  constructor(private storage: DurableObjectStorage) {}

  async load(): Promise<void> {
    const entries = await this.storage.list<Entry>({ prefix: PREFIX })
    for (const [key, entry] of entries) this.entries.set(key.slice(PREFIX.length), entry)
  }

  lookup(code: string): Entry | undefined {
    const entry = this.entries.get(code)
    return entry && entry.expires > Date.now() ? entry : undefined
  }

  count(): number {
    return [...this.entries.keys()].filter((code) => this.lookup(code)?.active).length
  }

  list(): RoomListItem[] {
    return [...this.entries.keys()].flatMap((code) => {
      const summary = this.lookup(code)?.summary
      return summary ? [summary] : []
    })
  }

  async reserve(): Promise<{ code: string; token: string } | null> {
    const expired = [...this.entries.keys()].filter((code) => !this.lookup(code))
    for (const code of expired) this.entries.delete(code)
    const cleanup = expired.length ? this.storage.delete(expired.map((code) => PREFIX + code)) : undefined
    if (this.entries.size >= LIMITS.rooms) {
      await cleanup
      return null
    }

    for (let i = 0; i < 50; i++) {
      const code = randomRoomCode()
      if (this.entries.has(code)) continue
      const token = crypto.randomUUID()
      const entry = { token, expires: Date.now() + RESERVATION_MS, active: false, summary: null }
      this.entries.set(code, entry)
      await Promise.all([this.storage.put(PREFIX + code, entry), cleanup])
      return { code, token }
    }
    await cleanup
    return null
  }

  async update(code: string, token: string, state: { summary: RoomListItem | null } | null): Promise<boolean> {
    const previous = this.lookup(code)
    if (previous?.token !== token) return false
    if (!state) {
      this.entries.delete(code)
      await this.storage.delete(PREFIX + code)
      return true
    }
    const entry = { token, expires: Date.now() + ROOM_LEASE_MS, active: true, summary: state.summary }
    this.entries.set(code, entry)
    await this.storage.put(PREFIX + code, entry)
    return true
  }
}
