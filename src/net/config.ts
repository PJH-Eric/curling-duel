const PAGES_ORIGIN = 'https://pjh-eric.github.io'
const BACKUP_ORIGIN = 'https://curling-duel.eric-games.workers.dev'

export type BackendId = 'primary' | 'cloudflare'
export interface Backend {
  origin: string
  id?: BackendId
  roomRouting?: boolean
  fallback?: Backend
}

/** 伺服器網址的唯一來源：建置時由 VITE_GAME_SERVER_URL 注入（GitHub Pages 工作流程以 GAME_SERVER_URL 變數提供）。 */
export function serverHttpUrl(): string | null {
  const raw = (import.meta.env.VITE_GAME_SERVER_URL as string | undefined)?.trim()
  if (raw) return validate(raw)
  // 只有本機開發才允許預設值；正式建置沒有設定就視為「尚未設定」
  // 以目前網址的主機名稱連線：用電腦 IP 開頁面的手機／平板，才會連到那台電腦的伺服器
  if (import.meta.env.DEV) return `http://${location.hostname || 'localhost'}:3090`
  return null
}

function validate(u: string): string | null {
  try {
    const url = new URL(u)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

export function serverWsUrl(backend: Backend, room?: string, reservation?: string): string {
  const url = new URL(backend.origin.replace(/^http/, 'ws'))
  if (room) url.searchParams.set('room', room.toUpperCase())
  if (reservation) url.searchParams.set('reservation', reservation)
  return url.href
}

function canConnect(backend: Backend): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new WebSocket(serverWsUrl(backend))
    const finish = (ok: boolean) => {
      window.clearTimeout(timeout)
      socket.onopen = socket.onerror = socket.onclose = null
      socket.close()
      resolve(ok)
    }
    const timeout = window.setTimeout(() => finish(false), 4500)
    socket.onopen = () => finish(true)
    socket.onerror = socket.onclose = () => finish(false)
  }).catch(() => false)
}

export async function selectBackend(origin: string, page: URL, probe = canConnect): Promise<Backend> {
  const primary: Backend = { origin, roomRouting: new URL(origin).hostname.endsWith('.onrender.com') ? false : undefined }
  if (page.origin !== PAGES_ORIGIN) return primary

  const backup: Backend = { origin: BACKUP_ORIGIN, id: 'cloudflare', roomRouting: true }
  if (origin === BACKUP_ORIGIN) return backup
  primary.id = 'primary'
  const pinned = page.searchParams.get('backend')
  if (pinned === 'cloudflare') return backup
  if (pinned === 'primary' || pinned === 'render') return primary
  return await probe(primary) ? { ...primary, fallback: backup } : backup
}
