/** 「怎麼玩」的規則示意圖：俯視球道（上方為圓心、下方為出手端），純向量、無文字，不受語言影響。 */
const RED = '#e23b3b'
const YEL = '#ffc21a'
const BLUE = '#2c6fe0'
const INK = '#1c2540'

const lane = (extra = '') => `
  <rect x="50" y="4" width="100" height="142" rx="4" fill="#f7fbff" stroke="#596a85" stroke-width="2"/>
  <line x1="100" y1="4" x2="100" y2="146" stroke="#9fb4d0" stroke-width="1.5"/>${extra}`
const house = (cy = 40, k = 1) => `
  <circle cx="100" cy="${cy}" r="${26 * k}" fill="${BLUE}"/><circle cx="100" cy="${cy}" r="${17 * k}" fill="#fff"/>
  <circle cx="100" cy="${cy}" r="${9 * k}" fill="${RED}"/><circle cx="100" cy="${cy}" r="${2.6 * k}" fill="#fff"/>`
const line = (y: number, col: string, w = 2.5) => `<line x1="50" y1="${y}" x2="150" y2="${y}" stroke="${col}" stroke-width="${w}"/>`
const stone = (x: number, y: number, col: string, extra = '') => `<circle cx="${x}" cy="${y}" r="6.5" fill="${col}" stroke="#12204a" stroke-width="1.6" ${extra}/><circle cx="${x}" cy="${y}" r="2.4" fill="#12204a" opacity=".55"/>`
const dash = (d: string, col = YEL, w = 3) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="6 5"/>`
const solid = (d: string, col: string, w = 3) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
const cross = (x: number, y: number, s = 7) => `<g stroke="#d11" stroke-width="3.4" stroke-linecap="round"><line x1="${x - s}" y1="${y - s}" x2="${x + s}" y2="${y + s}"/><line x1="${x + s}" y1="${y - s}" x2="${x - s}" y2="${y + s}"/></g>`
const tick = (x: number, y: number) => `<path d="M${x - 7} ${y} l5 6 l10 -12" fill="none" stroke="#1a9a4a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
const arrowHead = (x: number, y: number, rot: number, col = YEL) => `<path d="M-7 -4 L0 6 L7 -4 Z" fill="${col}" transform="translate(${x} ${y}) rotate(${rot})"/>`
const wrap = (inner: string, w = 200) => `<svg viewBox="0 0 ${w} 150" role="img" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`

const ART: Record<string | number, string> = {
  // 1 選方向：拖曳光圈，虛線為預估路線
  1: wrap(`${lane()}${house(40)}${line(100, '#d33')}
    ${dash('M100 128 C 98 100, 112 70, 112 46')}
    ${stone(100, 130, RED)}
    <circle cx="112" cy="44" r="8" fill="none" stroke="${YEL}" stroke-width="3"/><circle cx="112" cy="44" r="2.6" fill="${YEL}"/>
    <g transform="translate(150 62)"><path d="M0 14 q-2 -14 4 -18 q4 -2 5 3 l1 5 l3 -8 q3 -2 5 1 l-2 9 l5 -5 q3 0 3 3 l-6 12 q-2 6 -10 8 q-9 1 -9 -10z" fill="#fff" stroke="${INK}" stroke-width="1.6"/></g>`),
  // 2 力道與旋轉：順時針右彎、逆時針左彎，下方力道條
  2: wrap(`${lane()}${house(40)}${line(100, '#d33')}
    ${dash('M100 124 C 98 90, 76 70, 70 40')}${dash('M100 124 C 102 90, 124 70, 130 40')}
    ${stone(100, 128, RED)}
    <g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"><path d="M64 70 a9 9 0 1 0 -9 -9"/><path d="M136 70 a9 9 0 1 1 9 -9"/></g>
    ${arrowHead(55, 62, 200, INK)}${arrowHead(145, 62, 160, INK)}
    <rect x="8" y="136" width="184" height="9" rx="2" fill="#11193a"/><rect x="8" y="136" width="120" height="9" rx="2" fill="url(#pg)"/>
    <rect x="126" y="132" width="5" height="17" fill="#fff" stroke="${INK}"/>
    <defs><linearGradient id="pg" x1="0" x2="1"><stop offset="0" stop-color="#2457d6"/><stop offset=".6" stop-color="#ff9d3a"/><stop offset="1" stop-color="#ffd23a"/></linearGradient></defs>`),
  // 3 刷冰：壺前方刷，滑得更遠更直（淡色為不刷的路線）
  3: wrap(`${lane()}${house(40)}${line(100, '#d33')}
    <g opacity=".45">${dash('M100 126 C 96 110, 84 96, 78 86', '#8a94a6', 3)}${stone(78, 84, '#8a94a6')}</g>
    ${dash('M100 126 C 100 100, 100 70, 100 52')}
    ${stone(100, 126, RED)}
    <g stroke="${INK}" stroke-width="3" stroke-linecap="round" fill="none"><path d="M80 98 l14 -6"/><path d="M80 108 l14 -6"/><path d="M80 88 l14 -6"/></g>
    <g transform="translate(127 86) rotate(-28)"><rect x="-3" y="-30" width="6" height="30" fill="#8a5a2b"/><path d="M-12 0 h24 l-3 16 h-18z" fill="#f2b84b" stroke="${INK}" stroke-width="1.6"/></g>`),
  // 4 計分：最近的一方，比對手最近壺更近的每顆 1 分
  4: wrap(`${lane()}${house(60, 1.25)}
    ${stone(100, 60, RED)}${stone(92, 76, RED)}${stone(122, 82, YEL)}${stone(84, 40, RED, 'opacity=".9"')}
    <circle cx="100" cy="60" r="11" fill="none" stroke="#1a9a4a" stroke-width="3"/><circle cx="92" cy="76" r="11" fill="none" stroke="#1a9a4a" stroke-width="3"/>
    <g font-family="sans-serif" font-weight="900" fill="${INK}"><text x="150" y="40" font-size="26">+2</text></g>`, 200),
  // 5 守護區：橘色區；前 5 壺不可撞出，可撞開
  5: wrap(`${lane(`<rect x="50" y="40" width="100" height="60" fill="rgba(255,170,40,.5)"/>`)}${house(40)}${line(100, '#d33')}
    ${stone(88, 74, YEL)}
    ${solid('M88 130 L88 84', RED, 3)}${stone(88, 132, RED)}
    <g opacity=".95">${dash('M96 70 L126 52', YEL, 3)}${tick(138, 46)}</g>
    ${cross(88, 56, 8)}`),
  // 6 出界：側線、底線、沒過前擲線
  6: wrap(`${lane()}${house(40)}${line(100, '#d33', 3.5)}${line(12, '#6b86b8', 3.5)}
    ${stone(158, 70, '#8a94a6', 'opacity=".9"')}${cross(158, 70)}
    ${stone(100, 6, '#8a94a6', 'opacity=".9"')}${cross(100, 6, 5)}
    ${stone(78, 108, '#8a94a6', 'opacity=".9"')}${cross(78, 108)}
    <g stroke="#596a85" stroke-width="3"><line x1="50" y1="4" x2="50" y2="146"/><line x1="150" y1="4" x2="150" y2="146"/></g>`),
  // 7 後手與局數：雙方輪流投、最後一壺為後手；共 8 壺
  7: wrap(`
    <g>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => stone(20 + i * 23, 34, i % 2 === 0 ? YEL : RED)).join('')}</g>
    <g>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => stone(20 + i * 23, 66, i % 2 === 0 ? RED : YEL)).join('')}</g>
    <path d="M180 94 l4.5 9 l10 1.4 l-7.3 7 l1.8 10 l-9 -4.8 l-9 4.8 l1.8 -10 l-7.3 -7 l10 -1.4z" fill="${YEL}" stroke="#7a5a00" stroke-width="1.5"/>
    <g fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"><path d="M20 98 h110"/><path d="M20 118 h110" opacity=".5"/><path d="M20 138 h110" opacity=".3"/></g>
    <g fill="${INK}" opacity=".85"><circle cx="20" cy="98" r="3.6"/><circle cx="20" cy="118" r="3.6"/><circle cx="20" cy="138" r="3.6"/></g>`),
}


const board = (ox: number, oy: number, c: number) => {
  let r = `<rect x="${ox - 4}" y="${oy - 4}" width="${c * 3 + 8}" height="${c * 3 + 8}" rx="4" fill="#f7fbff" stroke="#596a85" stroke-width="2"/><g fill="none" stroke="${BLUE}" stroke-width="2">`
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r += `<rect x="${ox + j * c}" y="${oy + i * c}" width="${c}" height="${c}"/>`
  return r + '</g>'
}
const cc = (ox: number, oy: number, c: number, row: number, col: number) => ({ x: ox + (col + 0.5) * c, y: oy + (row + 0.5) * c })
const sstone = (x: number, y: number, col: string, r = 5.2) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" stroke="#12204a" stroke-width="1.4"/><circle cx="${x}" cy="${y}" r="${r * 0.37}" fill="#12204a" opacity=".55"/>`
const ring = (x: number, y: number, r = 11, col = '#1a9a4a') => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${col}" stroke-width="3"/>`
const txt = (x: number, y: number, s: string, size = 22, col = INK, anchor = 'middle') => `<text x="${x}" y="${y}" font-family="sans-serif" font-weight="900" font-size="${size}" fill="${col}" text-anchor="${anchor}">${s}</text>`
const star = (x: number, y: number, k = 1) => `<path transform="translate(${x} ${y}) scale(${k})" d="M0 -9 l2.6 6 l6.4 .6 l-4.9 4.3 l1.5 6.3 l-5.6 -3.4 l-5.6 3.4 l1.5 -6.3 l-4.9 -4.3 l6.4 -.6z" fill="${YEL}" stroke="#7a5a00" stroke-width="1.2"/>`

Object.assign(ART, {
  // 九宮格 1：壺的中心在格內才算占格；同格取離格心最近者
  g1: (() => {
    const [ox, oy, c] = [46, 16, 36]
    const p = (r: number, k: number) => cc(ox, oy, c, r, k)
    const a = p(0, 0), b = p(1, 2), d = p(1, 1), e = p(2, 0)
    return wrap(`${board(ox, oy, c)}
      ${sstone(a.x + 3, a.y - 2, RED)}${sstone(b.x - 2, b.y + 3, YEL)}${sstone(e.x - 3, e.y + 4, YEL)}
      <circle cx="${d.x}" cy="${d.y}" r="2" fill="${INK}" opacity=".5"/>
      ${sstone(d.x + 1, d.y - 1, YEL, 6)}${sstone(d.x - 11, d.y + 9, RED, 6)}
      ${ring(d.x + 1, d.y - 1, 11)}`)
  })(),
  // 九宮格 2：橫、直、斜任一線連成三顆即贏
  g2: (() => {
    const c = 18
    const mini = (ox: number, cells: number[][], l: number[][]) => {
      const oy = 38
      const pts = cells.map(([r, k]) => cc(ox, oy, c, r, k))
      const s = cc(ox, oy, c, l[0][0], l[0][1]), e = cc(ox, oy, c, l[1][0], l[1][1])
      return `${board(ox, oy, c)}${pts.map((q) => sstone(q.x, q.y, RED, 5.4)).join('')}<line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}" stroke="#1a9a4a" stroke-width="3.4" stroke-linecap="round" opacity=".9"/>`
    }
    return wrap(`${mini(8, [[1, 0], [1, 1], [1, 2]], [[1, 0], [1, 2]])}${mini(73, [[0, 1], [1, 1], [2, 1]], [[0, 1], [2, 1]])}${mini(138, [[0, 0], [1, 1], [2, 2]], [[0, 0], [2, 2]])}
      ${tick(36, 120)}${tick(101, 120)}${tick(166, 120)}`)
  })(),
  // 九宮格 3：可以撞走對手的壺；壺放完仍沒連線，比占格數
  g3: (() => {
    const [ox, oy, c] = [46, 8, 36]
    const t = cc(ox, oy, c, 0, 1), m = cc(ox, oy, c, 1, 1)
    return wrap(`${board(ox, oy, c)}
      <g opacity=".5">${sstone(t.x, t.y, YEL, 6)}</g>${dash(`M${t.x + 8} ${t.y - 4} L166 8`, '#d33', 2.8)}${cross(172, 8, 6)}
      ${solid(`M100 140 L${m.x} ${m.y + 10}`, RED, 3)}${sstone(100, 142, RED, 6.5)}${sstone(m.x, m.y, RED, 6)}
      ${sstone(ox + 18, oy + 2.5 * c, YEL, 5.4)}${sstone(ox + 3 * c - 18, oy + 2.5 * c, RED, 5.4)}`)
  })(),
  // 得分 2：兩方離圓心一樣近 → 空局，0 分、後手不變
  s2: wrap(`${lane()}${house(66, 1.3)}
    <line x1="100" y1="66" x2="84" y2="66" stroke="${INK}" stroke-width="2" stroke-dasharray="3 3"/><line x1="100" y1="66" x2="116" y2="66" stroke="${INK}" stroke-width="2" stroke-dasharray="3 3"/>
    ${stone(84, 66, RED)}${stone(116, 66, YEL)}${txt(168, 40, '0', 30)}`),
  // 得分 3：預設 4 局，平手加賽（虛線）最多 2 局
  s3: wrap(`${[0, 1, 2, 3].map((i) => `<circle cx="${30 + i * 36}" cy="36" r="13" fill="${BLUE}" stroke="${INK}" stroke-width="2"/>${txt(30 + i * 36, 43, String(i + 1), 18, '#fff')}`).join('')}
    ${[4, 5].map((i) => `<circle cx="${30 + i * 36}" cy="36" r="13" fill="none" stroke="${INK}" stroke-width="2.4" stroke-dasharray="4 4"/>${txt(30 + i * 36, 43, String(i + 1), 18, INK)}`).join('')}
    <rect x="24" y="78" width="70" height="16" rx="3" fill="${RED}"/><rect x="24" y="104" width="70" height="16" rx="3" fill="${YEL}"/>
    ${txt(118, 110, '=', 30)}`),
  // 得分 4：九宮連線以局數計，先贏過半者勝
  s4: wrap(`${[0, 1, 2].map((i) => `<circle cx="${58 + i * 34}" cy="44" r="12" fill="${i < 2 ? RED : 'none'}" stroke="${INK}" stroke-width="2.4" ${i < 2 ? '' : 'stroke-dasharray="4 4"'}/>`).join('')}
    ${[0, 1, 2].map((i) => `<circle cx="${58 + i * 34}" cy="92" r="12" fill="${i < 1 ? YEL : 'none'}" stroke="${INK}" stroke-width="2.4" ${i < 1 ? '' : 'stroke-dasharray="4 4"'}/>`).join('')}
    ${sstone(24, 44, RED, 8)}${sstone(24, 92, YEL, 8)}${tick(176, 44)}${cross(176, 92, 7)}${txt(100, 138, '2 : 1', 18)}`),
  // 得分 5：冰洞挑戰，洞越小分數越高；太快會飛過去
  s5: wrap(`<rect x="50" y="4" width="100" height="142" rx="4" fill="#f7fbff" stroke="#596a85" stroke-width="2"/>
    <circle cx="80" cy="26" r="11" fill="#0b3b57"/><circle cx="122" cy="52" r="14" fill="#1d6a96"/><circle cx="80" cy="82" r="17" fill="#1d6a96"/>
    ${txt(80, 31, '50', 12, '#fff')}${txt(122, 56, '40', 13, '#fff')}${txt(80, 87, '20', 15, '#fff')}
    <circle cx="124" cy="100" r="20" fill="#2a86b8"/>${txt(124, 107, '10', 17, '#fff')}
    ${dash('M124 140 C 124 128, 124 118, 124 112', YEL, 2.8)}${stone(124, 142, RED)}`),
  // 冰洞：太快飛過、夠慢才掉入
  h2: wrap(`<rect x="50" y="4" width="100" height="142" rx="4" fill="#f7fbff" stroke="#596a85" stroke-width="2"/>
    <circle cx="80" cy="46" r="15" fill="#1d6a96"/><circle cx="122" cy="46" r="15" fill="#1d6a96"/>
    ${solid('M80 130 L80 66', YEL, 3)}${arrowHead(80, 60, 180)}${tick(80, 20)}
    ${solid('M122 130 L122 10', '#8a94a6', 3)}${stone(122, 132, '#8a94a6')}${cross(122, 28, 7)}${stone(80, 132, RED)}`),
  // 冰洞：雙方輪流各 6 壺、2 局
  h3: wrap(`${[0, 1, 2, 3, 4, 5].map((i) => stone(24 + i * 30, 30, i % 2 ? YEL : RED)).join('')}${[0, 1, 2, 3, 4, 5].map((i) => stone(24 + i * 30, 62, i % 2 ? RED : YEL)).join('')}
    <circle cx="70" cy="112" r="11" fill="${BLUE}" stroke="${INK}" stroke-width="2"/>${txt(70, 119, '1', 16, '#fff')}<circle cx="130" cy="112" r="11" fill="${BLUE}" stroke="${INK}" stroke-width="2"/>${txt(130, 119, '2', 16, '#fff')}
    <path d="M84 112 h32" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`),
  // 任務：停進大本營拿星星
  m: wrap(`${lane()}${house(60, 1.3)}
    ${star(100, 60, 0.9)}${star(70, 78, 0.9)}${star(130, 78, 0.9)}
    ${dash('M100 134 C 98 110, 100 92, 100 82', YEL, 3)}${stone(100, 136, RED)}`),
})

export function howtoArt(key: number | string): string {
  return ART[key as number] ?? ''
}
