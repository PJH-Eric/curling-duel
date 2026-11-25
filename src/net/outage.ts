import type { NetStatus } from './client'

export const OUTAGE_WAIT_MS = 30_000

export interface OutageDeps {
  /** 目前是否在線上大廳／房間（單機、首頁、對局中不提示） */
  eligible: () => boolean
  show: () => void
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (id: number) => void
}

/** 連續 30 秒連不上伺服器才提示；連上或離開線上就取消，同一次故障只提示一次。 */
export function createOutageWatcher(d: OutageDeps): { onStatus: (s: NetStatus) => void } {
  const setT = d.setTimer ?? ((fn, ms) => window.setTimeout(fn, ms))
  const clearT = d.clearTimer ?? ((id) => window.clearTimeout(id))
  let timer = 0
  let attempted = false
  let shown = false

  const reset = (): void => {
    if (timer) clearT(timer)
    timer = 0
    attempted = false
    shown = false
  }
  const fire = (): void => {
    timer = 0
    if (shown || !attempted || !d.eligible()) return
    shown = true
    d.show()
  }
  const onStatus = (s: NetStatus): void => {
    if (s === 'online' || s === 'idle') return reset()
    if (s === 'connecting' || s === 'reconnecting') {
      attempted = true
      if (!timer && !shown) timer = setT(fire, OUTAGE_WAIT_MS)
      return
    }
    if (s === 'offline' && attempted) {
      if (timer) clearT(timer)
      fire()
    }
  }
  return { onStatus }
}
