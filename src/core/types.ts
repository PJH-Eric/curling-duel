/** 座標系：x 向右、y 沿冰道向前（從出手點 y=0 指向大本營）。單位：公尺。 */
export const STONE_R = 0.18

export const SHEET = {
  halfWidth: 2.375,
  teeY: 16,
  /** 遠端 hog line（壺必須完全越過）。 */
  hogY: 9.6,
  /** back line：壺完全越過即出界。 */
  backY: 17.83,
  houseR: 1.83,
  /** 出手位置 */
  releaseY: 0,
} as const

export type TeamId = 0 | 1
export type Spin = 1 | -1

export interface Stone {
  id: number
  team: number
  x: number
  y: number
  vx: number
  vy: number
  spin: Spin
  /** 仍在場上 */
  inPlay: boolean
  /** 已經投出過（false 表示還在手上，不在冰面） */
  thrown: boolean
}

export interface ThrowSpec {
  /** 出手方向：0 為正前方，正值朝 +x（右）。弧度。 */
  angle: number
  /** 力道 0..1 */
  power: number
  spin: Spin
}

export type SimEvent =
  | { type: 'hit'; t: number; a: number; b: number; speed: number; x: number; y: number }
  | { type: 'out'; t: number; id: number; reason: 'side' | 'back' | 'hog' | 'wall' }
  | { type: 'sink'; t: number; id: number; hole: number; points: number }
  | { type: 'stop'; t: number; id: number }

export function cloneStone(s: Stone): Stone {
  return { ...s }
}

export function cloneStones(list: readonly Stone[]): Stone[] {
  return list.map(cloneStone)
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return Math.sqrt(dx * dx + dy * dy)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
