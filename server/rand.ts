/** 跨平台亂數工具（Node 20+、Cloudflare Workers 都有全域 Web Crypto），不依賴 node:crypto / Buffer。 */
export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export function randomHex(n: number): string {
  return Array.from(randomBytes(n), (x) => x.toString(16).padStart(2, '0')).join('')
}

export function randomBase64Url(n: number): string {
  let bin = ''
  for (const x of randomBytes(n)) bin += String.fromCharCode(x)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomUint32(): number {
  return new DataView(randomBytes(4).buffer).getUint32(0)
}
