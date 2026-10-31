import * as THREE from 'three'
import { GRID_CELL, GRID_CENTER, HOLES } from '../core/variants'
import { SHEET } from '../core/types'
import type { GameKind } from '../core/game'

export const ICE = { width: SHEET.halfWidth * 2, y0: -4, y1: 21 }

/** 冰面貼圖：y 由近到遠對應畫布由下到上。 */
export function makeIceTexture(kind: GameKind): THREE.CanvasTexture {
  const ppu = 72
  const w = Math.round(ICE.width * ppu)
  const h = Math.round((ICE.y1 - ICE.y0) * ppu)
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')!
  const X = (x: number) => (x + ICE.width / 2) * ppu
  const Y = (y: number) => h - (y - ICE.y0) * ppu
  const grd = g.createLinearGradient(0, 0, w, 0)
  grd.addColorStop(0, '#d4ebfa')
  grd.addColorStop(0.5, '#f5fbff')
  grd.addColorStop(1, '#d4ebfa')
  g.fillStyle = grd
  g.fillRect(0, 0, w, h)
  // 冰面小凸點
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2)
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(150,190,225,${Math.random() * 0.18})`
    g.fillRect(Math.random() * w, Math.random() * h, 2, 3)
  }
  // 中線與橫線
  g.strokeStyle = '#6a9fcb'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(X(0), 0)
  g.lineTo(X(0), h)
  g.stroke()
  const hline = (y: number, color: string, lw: number) => {
    g.strokeStyle = color
    g.lineWidth = lw
    g.beginPath()
    g.moveTo(0, Y(y))
    g.lineTo(w, Y(y))
    g.stroke()
  }
  hline(SHEET.teeY, '#6a9fcb', 3)
  hline(SHEET.hogY, '#d83a3a', 10)
  hline(SHEET.backY, '#6a9fcb', 3)
  hline(0.8, '#d83a3a', 10)
  hline(-1.2, '#6a9fcb', 3)
  if (kind === 'standard' || kind === 'mission') {
    const ring = (r: number, c: string) => {
      g.fillStyle = c
      g.beginPath()
      g.arc(X(0), Y(SHEET.teeY), r * ppu, 0, Math.PI * 2)
      g.fill()
    }
    ring(SHEET.houseR, '#2f6fd0')
    ring(1.22, '#f4fbff')
    ring(0.61, '#d83a3a')
    ring(0.15, '#f4fbff')
  } else if (kind === 'grid') {
    const rr = (x: number, y: number, ww: number, hh: number, r: number) => {
      g.beginPath()
      g.moveTo(x + r, y)
      g.arcTo(x + ww, y, x + ww, y + hh, r)
      g.arcTo(x + ww, y + hh, x, y + hh, r)
      g.arcTo(x, y + hh, x, y, r)
      g.arcTo(x, y, x + ww, y, r)
      g.closePath()
    }
    const cell = GRID_CELL * ppu
    const x0 = X(GRID_CENTER.x - GRID_CELL * 1.5)
    const y0 = Y(GRID_CENTER.y + GRID_CELL * 1.5)
    // 外框底板與光暈
    g.save()
    g.shadowColor = 'rgba(47,111,208,.45)'
    g.shadowBlur = 26
    g.fillStyle = 'rgba(47,111,208,.22)'
    rr(x0 - 14, y0 - 14, cell * 3 + 28, cell * 3 + 28, 22)
    g.fill()
    g.restore()
    g.strokeStyle = '#2f6fd0'
    g.lineWidth = 6
    rr(x0 - 14, y0 - 14, cell * 3 + 28, cell * 3 + 28, 22)
    g.stroke()
    g.strokeStyle = 'rgba(255,255,255,.9)'
    g.lineWidth = 2
    rr(x0 - 8, y0 - 8, cell * 3 + 16, cell * 3 + 16, 16)
    g.stroke()
    // 每格：圓角磚、白邊、十字格心
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cx = x0 + (c + 0.5) * cell
        const cy = y0 + (r + 0.5) * cell
        const grad = g.createLinearGradient(cx, cy - cell / 2, cx, cy + cell / 2)
        grad.addColorStop(0, 'rgba(255,255,255,.85)')
        grad.addColorStop(1, 'rgba(160,200,245,.55)')
        g.fillStyle = grad
        rr(cx - cell / 2 + 5, cy - cell / 2 + 5, cell - 10, cell - 10, 12)
        g.fill()
        g.strokeStyle = '#4f86d8'
        g.lineWidth = 3
        g.stroke()
        g.strokeStyle = 'rgba(47,111,208,.55)'
        g.lineWidth = 2.5
        g.beginPath()
        g.moveTo(cx - 9, cy)
        g.lineTo(cx + 9, cy)
        g.moveTo(cx, cy - 9)
        g.lineTo(cx, cy + 9)
        g.stroke()
      }
    }
  } else if (kind === 'hole') {
    const tier = (p: number) => (p >= 50 ? '#ffb300' : p >= 40 ? '#ff7a3d' : p >= 20 ? '#4ad0ff' : '#9ad8ff')
    for (const hole of HOLES) {
      const cx = X(hole.x)
      const cy = Y(hole.y)
      const R = hole.r * ppu
      // 外圍光暈與分數色環
      const halo = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.9)
      halo.addColorStop(0, 'rgba(255,255,255,.85)')
      halo.addColorStop(0.35, tier(hole.points) + '88')
      halo.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = halo
      g.beginPath()
      g.arc(cx, cy, R * 1.9, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = tier(hole.points)
      g.beginPath()
      g.arc(cx, cy, R * 1.22, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#ffffff'
      g.lineWidth = 5
      g.stroke()
      // 洞：由外到內漸暗，營造深度
      const pit = g.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R)
      pit.addColorStop(0, '#2a86b8')
      pit.addColorStop(0.6, '#0f4c75')
      pit.addColorStop(1, '#04202f')
      g.fillStyle = pit
      g.beginPath()
      g.arc(cx, cy, R, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(255,255,255,.55)'
      g.lineWidth = 2
      g.beginPath()
      g.arc(cx, cy, R * 0.82, Math.PI * 1.1, Math.PI * 1.7)
      g.stroke()
      // 分數
      const fs = Math.max(20, Math.round(R * 0.95))
      g.font = `900 ${fs}px system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.lineWidth = Math.max(5, fs * 0.2)
      g.strokeStyle = '#04202f'
      g.strokeText(String(hole.points), cx, cy + 2)
      g.fillStyle = '#ffffff'
      g.fillText(String(hole.points), cx, cy + 2)
    }
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

export function makeBannerTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 1024
  cv.height = 64
  const g = cv.getContext('2d')!
  const cols = ['#ff6fa8', '#ffb34a', '#b36bff', '#4ad0ff', '#ffe14a']
  for (let i = 0; i < 16; i++) {
    const gg = g.createLinearGradient(i * 64, 0, i * 64 + 64, 64)
    gg.addColorStop(0, cols[i % 5])
    gg.addColorStop(1, cols[(i + 2) % 5])
    g.fillStyle = gg
    g.fillRect(i * 64, 0, 64, 64)
    g.fillStyle = 'rgba(255,255,255,.55)'
    g.beginPath()
    g.arc(i * 64 + 32, 32, 13, 0, 7)
    g.fill()
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.repeat.set(4, 1)
  return t
}
