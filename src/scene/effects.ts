import * as THREE from 'three'

/** 簡單粒子池：冰屑、撞擊火花、軌跡、彩帶。 */
export class Particles {
  readonly points: THREE.Points
  private pos: Float32Array
  private col: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private maxLife: Float32Array
  private gravity: Float32Array
  private n: number
  private next = 0

  constructor(count = 900, size = 0.12) {
    this.n = count
    this.pos = new Float32Array(count * 3)
    this.col = new Float32Array(count * 4)
    this.vel = new Float32Array(count * 3)
    this.life = new Float32Array(count)
    this.maxLife = new Float32Array(count).fill(1)
    this.gravity = new Float32Array(count)
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -100
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4))
    const mat = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color | number, gravity = 6): void {
    const i = this.next
    this.next = (this.next + 1) % this.n
    this.pos[i * 3] = x
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = z
    this.vel[i * 3] = vx
    this.vel[i * 3 + 1] = vy
    this.vel[i * 3 + 2] = vz
    this.life[i] = life
    this.maxLife[i] = life
    this.gravity[i] = gravity
    const c = color instanceof THREE.Color ? color : new THREE.Color(color)
    this.col[i * 4] = c.r
    this.col[i * 4 + 1] = c.g
    this.col[i * 4 + 2] = c.b
    this.col[i * 4 + 3] = 1
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -100
        continue
      }
      this.vel[i * 3 + 1] -= this.gravity[i] * dt
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      if (this.pos[i * 3 + 1] < 0.02 && this.gravity[i] > 0) {
        this.pos[i * 3 + 1] = 0.02
        this.vel[i * 3 + 1] *= -0.3
      }
      const f = this.life[i] / this.maxLife[i]
      this.col[i * 4 + 3] = Math.min(1, f * 2)
    }
    ;(this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
  }

  dispose(): void {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}
