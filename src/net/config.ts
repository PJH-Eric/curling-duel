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

export function serverWsUrl(): string | null {
  const http = serverHttpUrl()
  return http ? http.replace(/^http/, 'ws') : null
}
