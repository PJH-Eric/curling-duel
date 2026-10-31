import * as THREE from 'three'
import type { GameKind } from '../core/game'
import { GRID_CELL, GRID_CENTER, HOLE_BACK_Y, HOLES } from '../core/variants'
import { SHEET, STONE_R, type Stone } from '../core/types'
import type { CatStyle } from '../game/settings'
import { getSettings } from '../game/settings'
import { Particles } from './effects'
import { AVATAR_LOOKS, makeAvatar, makeCatStone, makeGlbSweeper, type Actor, type Avatar, type CatStoneParts, type Pose } from './models'
import { ICE, makeBannerTexture, makeIceTexture } from './textures'

export type CamMode = 'aim' | 'follow' | 'house' | 'top'

export interface ArenaOptions {
  canvas: HTMLCanvasElement
  kind: GameKind
  teamColors: [string, string]
  cat: CatStyle
}

export interface AimView {
  ring: { x: number; y: number }
  path: { x: number; y: number }[]
  stop: { x: number; y: number }
}

export type PlanePhase = 'down' | 'move' | 'up'

const w = (y: number) => -y // 模擬 y（向前）→ 世界 z

/** 3D 場景：場館、冰道、貓咪壺、人物、特效與鏡頭。座標：世界 x = 模擬 x，世界 z = −模擬 y。 */
export class Arena {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 220)
  private canvas: HTMLCanvasElement
  private kind: GameKind
  private teamColors: [string, string]
  private cat: CatStyle
  private stoneMeshes = new Map<number, { parts: CatStoneParts; team: number }>()
  private stoneRoot = new THREE.Group()
  private particles = new Particles(1200, 0.14)
  private confetti = new Particles(500, 0.2)
  private scratches = new Particles(700, 0.085)
  private rings: { mesh: THREE.Mesh; t: number; life: number; r1: number }[] = []
  private swStrength = 0
  private swSpeed = 0
  private swEase = [0, 0]
  private swPhase = [0, 0]
  private swFx = [0, 0]
  private swScr = [0, 0]
  private swPrevX = [0, 0]
  private tmpV = new THREE.Vector3()
  private avatars: Actor[] = []
  private sweepers: Actor[] = []
  private thrower: Avatar | null = null
  private raf = 0
  private last = 0
  private clock = 0
  private frameCbs: ((dt: number) => void)[] = []
  private planeCb: ((x: number, y: number, phase: PlanePhase) => void) | null = null
  private dragging = false
  private aimEnabled = false
  private camMode: CamMode = 'aim'
  private camFocus = new THREE.Vector3(0, 0, -10)
  private camPos = new THREE.Vector3(0, 6, 9)
  private camLook = new THREE.Vector3(0, 0, -10)
  private shake = 0
  private cheerT = 0
  private crowd!: THREE.InstancedMesh
  private crowdHeads!: THREE.InstancedMesh
  private crowdBase: { x: number; y: number; z: number; ph: number }[] = []
  private ice!: THREE.Mesh
  private iceTex!: THREE.CanvasTexture
  private variantGroup = new THREE.Group()
  private cellMeshes: THREE.Mesh[] = []
  private aimGroup = new THREE.Group()
  private aimDots!: THREE.InstancedMesh
  private aimRing!: THREE.Mesh
  private aimStop!: THREE.Mesh
  private aimGhost: CatStoneParts | null = null
  private trailT = 0
  private raycaster = new THREE.Raycaster()
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private disposed = false
  private sun!: THREE.DirectionalLight
  private heldStone: number | null = null
  private activeStoneId: number | null = null
  private bound: { type: string; fn: EventListener }[] = []
  private ro?: ResizeObserver

  constructor(o: ArenaOptions) {
    this.canvas = o.canvas
    this.kind = o.kind
    this.teamColors = o.teamColors
    this.cat = o.cat
    this.renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.buildBackground()
    this.buildLights()
    this.buildArena()
    this.buildVariant()
    this.buildAimVisuals()
    this.buildPeople()
    this.scene.add(this.stoneRoot, this.scratches.points, this.particles.points, this.confetti.points)
    this.bindPointer()
    this.resize()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.canvas.parentElement ?? this.canvas)
    this.camPos.set(0, 6, 9)
    this.applyCameraMode(true)
  }

  /* ───────── 建置 ───────── */

  private buildBackground(): void {
    const c = document.createElement('canvas')
    c.width = 2
    c.height = 256
    const g = c.getContext('2d')!
    const gr = g.createLinearGradient(0, 0, 0, 256)
    gr.addColorStop(0, '#6fa6e6')
    gr.addColorStop(0.55, '#bcd8f2')
    gr.addColorStop(1, '#eaf4ff')
    g.fillStyle = gr
    g.fillRect(0, 0, 2, 256)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    this.scene.background = t
    this.scene.fog = new THREE.Fog(0xdcebfb, 45, 120)
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb4d0, 1.9))
    this.sun = new THREE.DirectionalLight(0xfff4dd, 2.2)
    this.sun.position.set(-6, 22, 8)
    this.sun.castShadow = true
    const mobile = Math.min(window.innerWidth, window.innerHeight) < 700
    this.sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048)
    Object.assign(this.sun.shadow.camera, { left: -10, right: 10, top: 14, bottom: -14, near: 1, far: 70 })
    this.sun.shadow.bias = -0.0005
    this.scene.add(this.sun, this.sun.target)
  }

  private buildArena(): void {
    const len = ICE.y1 - ICE.y0
    this.iceTex = makeIceTexture(this.kind)
    this.ice = new THREE.Mesh(new THREE.PlaneGeometry(ICE.width, len), new THREE.MeshStandardMaterial({ map: this.iceTex, roughness: 0.14, metalness: 0.08 }))
    this.ice.rotation.x = -Math.PI / 2
    this.ice.position.set(0, 0, w((ICE.y0 + ICE.y1) / 2))
    this.ice.receiveShadow = true
    this.scene.add(this.ice)

    const midZ = w((ICE.y0 + ICE.y1) / 2)
    const laneM = new THREE.MeshStandardMaterial({ color: 0x1747c8, roughness: 0.6 })
    const adjTex = this.iceTex
    const adjM = new THREE.MeshStandardMaterial({ color: 0xaec3df, roughness: 0.3, metalness: 0.02 })
    for (const s of [-1, 1]) {
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, len), laneM)
      lane.rotation.x = -Math.PI / 2
      lane.position.set(s * (SHEET.halfWidth + 1.4), 0.01, midZ)
      lane.receiveShadow = true
      this.scene.add(lane)
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, len), new THREE.MeshStandardMaterial({ color: 0x7d8798 }))
      edge.position.set(s * (SHEET.halfWidth + 0.11), 0.1, midZ)
      edge.castShadow = true
      this.scene.add(edge)
      const adj = new THREE.Mesh(new THREE.PlaneGeometry(ICE.width, len), adjM)
      adj.rotation.x = -Math.PI / 2
      adj.position.set(s * (ICE.width + 2.9), 0, midZ)
      this.scene.add(adj)
      const lane2 = new THREE.Mesh(new THREE.PlaneGeometry(2.6, len), laneM)
      lane2.rotation.x = -Math.PI / 2
      lane2.position.set(s * (ICE.width * 1.5 + 4.2), 0.01, midZ)
      this.scene.add(lane2)
    }
    const adTex = makeBannerTexture()
    const adMat = new THREE.MeshStandardMaterial({ map: adTex, roughness: 0.5 })
    const endZ = w(ICE.y1)
    const end = new THREE.Mesh(new THREE.BoxGeometry(ICE.width * 3 + 12, 1.8, 0.4), adMat)
    end.position.set(0, 0.9, endZ)
    this.scene.add(end)
    const wallCv = document.createElement('canvas'); wallCv.width = 1024; wallCv.height = 256
    { const c = wallCv.getContext('2d')!; const gr = c.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#1c2540'); gr.addColorStop(1, '#2a3a78'); c.fillStyle = gr; c.fillRect(0, 0, 1024, 256); c.fillStyle = '#ffffff'; c.font = '900 120px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('ICE DUEL', 512, 112); c.fillStyle = '#ff7a59'; c.fillRect(300, 190, 424, 10) }
    const wallTex = new THREE.CanvasTexture(wallCv); wallTex.colorSpace = THREE.SRGBColorSpace
    const endTop = new THREE.Mesh(new THREE.BoxGeometry(ICE.width * 3 + 12, 6, 0.4), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 }))
    endTop.position.set(0, 4.8, endZ)
    endTop.visible = false
    const sideAd = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, len), adMat)
    for (const s of [-1, 1]) {
      const m = sideAd.clone()
      m.position.set(s * (ICE.width * 2 + 4.6), 0.55, midZ)
      this.scene.add(m)
    }
    // 看台
    const stM = [0x7f93c7, 0x8aa0d4, 0x97addf, 0xa6bbea].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }))
    const stepW = 4.4
    for (let i = 0; i < 4; i++) {
      for (const s of [-1, 1]) {
        const hh = 1.4 + i * 1.1
        const st = new THREE.Mesh(new THREE.BoxGeometry(stepW, hh, len), stM[i])
        st.position.set(s * (ICE.width * 2 + 7.4 + i * stepW), hh / 2, midZ)
        this.scene.add(st)
      }
    }
    // 觀眾（InstancedMesh）
    const count = 340
    const bodyGeo = new THREE.CapsuleGeometry(0.22, 0.4, 3, 8)
    const headGeo = new THREE.SphereGeometry(0.2, 10, 8)
    this.crowd = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), count)
    this.crowdHeads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), count)
    const colors = [0xff7a59, 0xffd36b, 0x6bb6ff, 0xffffff, 0xff6fa8, 0x7be08f, 0xb36bff]
    const skins = [0xf2c9a0, 0xe0b088, 0x8a5a3c, 0xf7d9b8]
    const col = new THREE.Color()
    for (let i = 0; i < count; i++) {
      const s = Math.random() < 0.5 ? -1 : 1
      const row = Math.floor(Math.random() * 4)
      const x = s * (ICE.width * 2 + 6.4 + row * stepW + Math.random() * 3)
      const y = 1.4 + row * 1.1 + 0.55
      const z = midZ + (Math.random() - 0.5) * (len - 4)
      this.crowdBase.push({ x, y, z, ph: Math.random() * 6.28 })
      this.crowd.setColorAt(i, col.setHex(colors[i % colors.length]))
      this.crowdHeads.setColorAt(i, col.setHex(skins[i % skins.length]))
    }
    this.crowd.castShadow = false
    this.scene.add(this.crowd, this.crowdHeads)
    this.updateCrowd(0)
    // 天花板燈
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    for (let i = 0; i < 6; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 1.2), lightMat)
      l.position.set(0, 14, w(i * 4 - 2))
      this.scene.add(l)
    }
  }

  private buildVariant(): void {
    this.scene.add(this.variantGroup)
    if (this.kind === 'grid') {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(GRID_CELL - 0.06, 0.02, GRID_CELL - 0.06), new THREE.MeshStandardMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.22, roughness: 0.4 }))
          m.position.set((c - 1) * GRID_CELL + GRID_CENTER.x, 0.012, w((r - 1) * GRID_CELL + GRID_CENTER.y))
          m.receiveShadow = true
          this.variantGroup.add(m)
          this.cellMeshes.push(m)
        }
      }
    } else if (this.kind === 'hole') {
      const wallM = new THREE.MeshStandardMaterial({ color: 0x4d74ee, roughness: 0.5 })
      const back = new THREE.Mesh(new THREE.BoxGeometry(ICE.width + 0.4, 0.6, 0.3), wallM)
      back.position.set(0, 0.3, w(HOLE_BACK_Y + 0.15))
      back.castShadow = true
      this.variantGroup.add(back)
      for (const h of HOLES) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(h.r, 0.04, 8, 32), new THREE.MeshStandardMaterial({ color: 0xffffff }))
        ring.rotation.x = Math.PI / 2
        ring.position.set(h.x, 0.04, w(h.y))
        this.variantGroup.add(ring)
      }
    }
  }

  private buildAimVisuals(): void {
    this.scene.add(this.aimGroup)
    this.aimDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd36b }), 220)
    this.aimDots.count = 0
    this.aimDots.frustumCulled = false
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 40), new THREE.MeshBasicMaterial({ color: 0xffd36b, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }))
    this.aimRing.rotation.x = -Math.PI / 2
    this.aimStop = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }))
    this.aimStop.rotation.x = -Math.PI / 2
    this.aimGroup.add(this.aimDots, this.aimRing, this.aimStop)
    this.aimGroup.visible = false
    this.aimGhost = makeCatStone(this.teamColors[0], this.cat)
    this.aimGhost.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.material = (m.material as THREE.MeshStandardMaterial).clone()
        ;(m.material as THREE.MeshStandardMaterial).transparent = true
        ;(m.material as THREE.MeshStandardMaterial).opacity = 0.4
        m.castShadow = false
      }
    })
    this.aimGroup.add(this.aimGhost.group)
  }

  private buildPeople(): void {
    this.thrower = makeAvatar(AVATAR_LOOKS[0])
    this.thrower.root.scale.setScalar(1.0)
    this.thrower.root.position.set(-0.55, 0, 0.9)
    this.scene.add(this.thrower.root)
    this.avatars.push(this.thrower)
    for (let i = 0; i < 2; i++) {
      const look = AVATAR_LOOKS[(i + 1) % AVATAR_LOOKS.length]
      const a: Actor = makeGlbSweeper(look) ?? makeAvatar(look)
      a.root.position.set(i === 0 ? -1.6 : 1.6, 0, 2.2)
      this.scene.add(a.root)
      this.sweepers.push(a)
      this.avatars.push(a)
    }
    this.setTeamLook(0)
  }

  /** 換隊伍色：人物袖口與壺跟著變。 */
  setTeamLook(team: number): void {
    const color = this.teamColors[team]
    for (const a of this.avatars) a.setShirt(color)
  }

  setTeamColors(colors: [string, string], cat: CatStyle): void {
    this.teamColors = colors
    this.cat = cat
    for (const [, v] of this.stoneMeshes) {
      this.stoneRoot.remove(v.parts.group)
    }
    this.stoneMeshes.clear()
  }

  /* ───────── 壺 ───────── */

  private ensureStone(s: Stone): { parts: CatStoneParts; team: number } {
    let e = this.stoneMeshes.get(s.id)
    if (!e) {
      const parts = makeCatStone(this.teamColors[s.team % 2], this.cat)
      parts.group.visible = false
      this.stoneRoot.add(parts.group)
      e = { parts, team: s.team }
      this.stoneMeshes.set(s.id, e)
    }
    return e
  }

  /** 以最新場面更新所有壺的位置與可見性。 */
  syncStones(stones: readonly Stone[], dt = 0): void {
    for (const s of stones) {
      const e = this.ensureStone(s)
      const g = e.parts.group
      const held = this.heldStone === s.id && !s.thrown
      g.visible = s.inPlay || held
      if (held) {
        g.position.set(0, 0, w(0))
      } else if (s.inPlay) {
        g.position.set(s.x, 0, w(s.y))
        const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy)
        if (sp > 0.02) g.rotation.y -= s.spin * 0.9 * dt * Math.min(1.5, sp)
      }
      if (this.activeStoneId === s.id) e.parts.head.rotation.y = 0
    }
  }

  setHeldStone(id: number | null): void {
    this.heldStone = id
  }

  setActiveStone(id: number | null): void {
    this.activeStoneId = id
  }

  /** 「出界」「入洞」時讓壺飛出或消失的簡單演出。 */
  popStone(id: number, kind: 'out' | 'sink'): void {
    const e = this.stoneMeshes.get(id)
    if (!e) return
    if (kind === 'sink') {
      const p = e.parts.group.position
      this.burst(p.x, 0.2, p.z, 0x4ad0ff, 26, 3)
    }
  }

  getStonePosition(id: number): THREE.Vector3 | null {
    const e = this.stoneMeshes.get(id)
    return e ? e.parts.group.position.clone() : null
  }

  /* ───────── 瞄準視覺 ───────── */

  setAim(view: AimView | null, color?: string): void {
    this.aimGroup.visible = !!view
    if (!view) return
    this.aimRing.position.set(view.ring.x, 0.03, w(view.ring.y))
    this.aimStop.position.set(view.stop.x, 0.03, w(view.stop.y))
    this.aimGhost!.group.position.set(view.stop.x, 0, w(view.stop.y))
    if (color) this.aimGhost!.teamMats.forEach((m) => m.color.set(color))
    const m = new THREE.Matrix4()
    let n = 0
    const pts = view.path
    for (let i = 1; i < pts.length - 1 && n < 220; i++) {
      const sc = i % 2 ? 1 : 1.5
      m.makeScale(sc, sc, sc)
      m.setPosition(pts[i].x, 0.07, w(pts[i].y))
      this.aimDots.setMatrixAt(n++, m)
    }
    this.aimDots.count = n
    this.aimDots.instanceMatrix.needsUpdate = true
  }

  /* ───────── 九宮格高亮 ───────── */

  setGridOwners(owners: readonly number[]): void {
    this.cellMeshes.forEach((m, i) => {
      const mat = m.material as THREE.MeshStandardMaterial
      mat.opacity = owners[i] >= 0 ? 0.85 : 0.22
      if (owners[i] >= 0) { mat.color.set(this.teamColors[owners[i]]); mat.emissive.set(this.teamColors[owners[i]]).multiplyScalar(0.35) }
      else { mat.color.set(0xbfe0ff); mat.emissive.set(0x000000) }
    })
  }

  /* ───────── 人物 ───────── */

  setThrowerPose(pose: Pose, team?: number): void {
    if (team !== undefined) this.setTeamLook(team)
    this.throwerPose = pose
  }
  private throwerPose: Pose = 'idle'
  private sweepActive = false

  /** 掃冰員跟著壺走。 */
  setSweeping(active: boolean, strength = 1, speed = 0): void {
    this.sweepActive = active
    this.swStrength = active ? strength : 0
    this.swSpeed = speed
  }

  /* ───────── 特效 ───────── */

  burst(x: number, y: number, z: number, color: number, n = 20, speed = 2.5): void {
    if (getSettings().reduceMotion) return
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = speed * (0.3 + Math.random())
      this.particles.spawn(x, y, z, Math.cos(a) * sp, 1.2 + Math.random() * 2, Math.sin(a) * sp, 0.6 + Math.random() * 0.5, color, 7)
    }
  }

  hitEffect(x: number, y: number, speed: number): void {
    this.burst(x, 0.25, w(y), 0xffe9a8, Math.min(40, 10 + speed * 6), 1.5 + speed)
    this.burst(x, 0.25, w(y), 0xffffff, 10, 1)
    if (!getSettings().reduceMotion) this.shake = Math.min(0.25, 0.04 + speed * 0.05)
    this.ring(x, w(y), 0.7 + Math.min(1.4, speed * 0.5), speed > 1.2 ? 0xfff2c0 : 0xdff3ff, 0.55)
  }

  /** 撞擊衝擊波：貼著冰面擴散的淡圈。 */
  private ring(x: number, z: number, r1: number, color: number, life: number): void {
    if (getSettings().reduceMotion) return
    if (this.rings.length > 8) return
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }))
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.035, z)
    mesh.scale.setScalar(0.2)
    this.scene.add(mesh)
    this.rings.push({ mesh, t: 0, life, r1 })
  }

  sweepChips(x: number, y: number, quality: number): void {
    if (getSettings().reduceMotion) return
    const c = quality >= 1 ? 0xfff0a0 : quality >= 0.6 ? 0xbfe9ff : 0xffffff
    for (let i = 0; i < 8 + quality * 10; i++) {
      this.particles.spawn(x + (Math.random() - 0.5) * 0.6, 0.05, w(y) + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 1.6, 1 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6, 0.5, c, 6)
    }
  }

  confettiBurst(): void {
    this.cheerT = 3
    if (getSettings().reduceMotion) return
    const cols = [0xff6fa8, 0xffe14a, 0x4ad0ff, 0xb36bff, 0x7be08f, 0xff7a59]
    const cx = this.camLook.x
    const cz = this.camLook.z
    for (let i = 0; i < 160; i++) {
      this.confetti.spawn(cx + (Math.random() - 0.5) * 6, 5 + Math.random() * 2, cz + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 2, 0.5 + Math.random() * 2, (Math.random() - 0.5) * 2, 2.2 + Math.random(), cols[i % cols.length], 1.8)
    }
  }

  cheer(sec = 2): void {
    this.cheerT = Math.max(this.cheerT, sec)
  }

  /* ───────── 鏡頭 ───────── */

  setCameraMode(mode: CamMode, immediate = false): void {
    this.camMode = mode
    this.applyCameraMode(immediate)
  }

  private portrait(): boolean {
    return this.canvas.clientHeight > this.canvas.clientWidth * 1.05
  }

  private applyCameraMode(immediate: boolean): void {
    const portrait = this.portrait()
    const fk = this.kind === 'standard' || this.kind === 'mission'
    let pos: THREE.Vector3
    let look: THREE.Vector3
    switch (this.camMode) {
      case 'aim':
        pos = new THREE.Vector3(portrait ? 0.3 : 0.9, portrait ? 8.6 : fk ? 6.2 : 7, portrait ? 10.5 : 11.5)
        look = new THREE.Vector3(0, 0.2, w(portrait ? 7.5 : 11))
        break
      case 'follow': {
        const f = this.camFocus
        pos = new THREE.Vector3(f.x * 0.3 + 1.2, portrait ? 6.5 : 3.4, f.z + (portrait ? 9 : 6.5))
        look = new THREE.Vector3(f.x * 0.6, 0.2, f.z - 6)
        break
      }
      case 'house':
        pos = new THREE.Vector3(0, portrait ? 13 : 8.5, w(SHEET.teeY) + (portrait ? 8 : 6.5))
        look = new THREE.Vector3(0, 0, w(SHEET.teeY) - 0.5)
        break
      case 'top':
      default:
        pos = new THREE.Vector3(0, portrait ? 18 : 12, w(SHEET.teeY) + (portrait ? 6 : 5.5))
        look = new THREE.Vector3(0, 0, w(SHEET.teeY - 0.5))
        break
    }
    this.camTargetPos = pos
    this.camTargetLook = look
    if (immediate) {
      this.camPos.copy(pos)
      this.camLook.copy(look)
    }
  }
  private camTargetPos = new THREE.Vector3(0, 6, 9)
  private camTargetLook = new THREE.Vector3(0, 0, -10)

  followPoint(x: number, y: number): void {
    this.camFocus.set(x, 0, w(y))
  }

  /* ───────── 事件、尺寸 ───────── */

  onFrame(cb: (dt: number) => void): () => void {
    this.frameCbs.push(cb)
    return () => {
      this.frameCbs = this.frameCbs.filter((f) => f !== cb)
    }
  }

  setAimEnabled(v: boolean): void {
    this.aimEnabled = v
  }

  onPlane(cb: (x: number, y: number, phase: PlanePhase) => void): void {
    this.planeCb = cb
  }

  private planePoint(e: PointerEvent): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    const p = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(this.plane, p)) return null
    return { x: p.x, y: -p.z }
  }

  private bindPointer(): void {
    const add = (type: string, fn: (e: PointerEvent) => void) => {
      this.canvas.addEventListener(type, fn as EventListener)
      this.bound.push({ type, fn: fn as EventListener })
    }
    add('pointerdown', (e) => {
      if (!this.aimEnabled) return
      const p = this.planePoint(e)
      if (!p) return
      this.dragging = true
      this.canvas.setPointerCapture(e.pointerId)
      this.planeCb?.(p.x, p.y, 'down')
    })
    add('pointermove', (e) => {
      if (!this.dragging) return
      const p = this.planePoint(e)
      if (p) this.planeCb?.(p.x, p.y, 'move')
    })
    const up = (e: PointerEvent) => {
      if (!this.dragging) return
      this.dragging = false
      const p = this.planePoint(e)
      this.planeCb?.(p?.x ?? 0, p?.y ?? 0, 'up')
    }
    add('pointerup', up)
    add('pointercancel', up)
  }

  resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas
    const wpx = Math.max(1, parent.clientWidth)
    const hpx = Math.max(1, parent.clientHeight)
    this.renderer.setSize(wpx, hpx, false)
    this.camera.aspect = wpx / hpx
    this.camera.fov = this.portrait() ? 62 : wpx / hpx < 1.5 ? 56 : 48
    this.camera.updateProjectionMatrix()
    this.applyCameraMode(false)
  }

  /* ───────── 迴圈 ───────── */

  start(): void {
    if (this.raf) return
    this.last = performance.now()
    const loop = (now: number) => {
      if (this.disposed) return
      this.raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - this.last) / 1000)
      this.last = now
      this.tick(dt)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private updateCrowd(t: number): void {
    const m = new THREE.Matrix4()
    const amp = this.cheerT > 0 ? 0.3 : 0.04
    for (let i = 0; i < this.crowdBase.length; i++) {
      const b = this.crowdBase[i]
      const y = b.y + Math.abs(Math.sin(t * (this.cheerT > 0 ? 6 : 1.4) + b.ph)) * amp
      m.makeTranslation(b.x, y, b.z)
      this.crowd.setMatrixAt(i, m)
      m.makeTranslation(b.x, y + 0.55, b.z)
      this.crowdHeads.setMatrixAt(i, m)
    }
    this.crowd.instanceMatrix.needsUpdate = true
    this.crowdHeads.instanceMatrix.needsUpdate = true
  }

  private tick(dt: number): void {
    this.clock += dt
    for (const cb of this.frameCbs) cb(dt)
    this.cheerT = Math.max(0, this.cheerT - dt)
    if (!getSettings().reduceMotion) this.updateCrowd(this.clock)
    // 人物
    this.thrower?.update(this.thrower.pose === this.throwerPose ? this.throwerPose : this.throwerPose, this.clock)
    const active = this.activeStoneId !== null ? this.stoneMeshes.get(this.activeStoneId)?.parts.group.position : null
    for (let i = 0; i < this.sweepers.length; i++) {
      const sw = this.sweepers[i]
      const following = this.sweepActive && !!active
      // 掃冰強度平滑追上目標（停手就收勢），頻率隨壺速與強度變化
      const target = following ? this.swStrength : 0
      this.swEase[i] += (target - this.swEase[i]) * (1 - Math.exp(-dt * 9))
      const ease = this.swEase[i]
      this.swPhase[i] += dt * (7 + 7 * ease + Math.min(this.swSpeed, 4) * 0.9) / 9
      if (following) {
        sw.root.visible = true
        sw.root.position.lerp(new THREE.Vector3(active!.x + (i === 0 ? -0.55 : 0.55), 0, active!.z - 0.7), 1 - Math.exp(-dt * 10))
        sw.root.rotation.y = 0
        if (sw.animate) sw.animate(dt, 'sweep', ease, (7 + 7 * ease + Math.min(this.swSpeed, 4) * 0.9) / TAU_ARENA)
        else sw.update('sweep', this.swPhase[i] + i * 0.35, 0.22 + 0.78 * ease)
        if (!getSettings().reduceMotion && ease > 0.2) {
          let bx = sw.root.position.x + 0.1 + Math.sin(this.swPhase[i] * 9) * 0.2 * ease
          let bz = sw.root.position.z - 0.55
          let side = Math.cos(this.swPhase[i] * 9) > 0 ? 1 : -1
          if (sw.brushWorld && sw.brushWorld(this.tmpV)) {
            bx = this.tmpV.x
            bz = this.tmpV.z
            const dx = bx - this.swPrevX[i]
            if (Math.abs(dx) > 1e-4) side = dx > 0 ? 1 : -1
            this.swPrevX[i] = bx
          }
          this.swFx[i] += dt * 70 * ease
          while (this.swFx[i] >= 1) {
            this.swFx[i] -= 1
            this.particles.spawn(bx, 0.04, bz, side * (0.5 + Math.random() * 1.2), 0.7 + Math.random() * 1.2, 0.5 + Math.random() * 1.1, 0.4 + Math.random() * 0.3, Math.random() < 0.5 ? 0xffffff : 0xcdeeff, 6)
          }
          this.swScr[i] += dt
          if (this.swScr[i] > 0.05 && ease > 0.4) {
            this.swScr[i] = 0
            this.scratches.spawn(bx + (Math.random() - 0.5) * 0.12, 0.012, bz, 0, 0, 0, 3.2, 0xeaf6ff, 0)
          }
        }
      } else {
        sw.root.visible = this.camMode !== 'follow' || !this.sweepActive
        sw.root.position.lerp(new THREE.Vector3(i === 0 ? -1.7 : 1.7, 0, 2.3), 1 - Math.exp(-dt * 3))
        if (sw.animate) sw.animate(dt, this.cheerT > 0 ? 'cheer' : 'idle', 0, 1)
        else sw.update(this.cheerT > 0 ? 'cheer' : 'idle', this.clock + i)
      }
    }
    // 鏡頭
    if (this.camMode === 'follow') this.applyCameraMode(false)
    const k = 1 - Math.exp(-dt * (this.camMode === 'follow' ? 4 : 2.6))
    this.camPos.lerp(this.camTargetPos, k)
    this.camLook.lerp(this.camTargetLook, k)
    this.camera.position.copy(this.camPos)
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake
      this.camera.position.y += (Math.random() - 0.5) * this.shake
      this.shake = Math.max(0, this.shake - dt * 0.8)
    }
    this.camera.lookAt(this.camLook)
    // 陰影跟著鏡頭焦點
    const sf = this.camMode === 'follow' ? this.camFocus.z : this.camLook.z
    this.sun.target.position.set(0, 0, sf)
    this.sun.position.set(-6, 22, sf + 8)
    this.particles.update(dt)
    this.scratches.update(dt)
    this.confetti.update(dt)
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.t += dt
      const k = r.t / r.life
      if (k >= 1) {
        this.scene.remove(r.mesh)
        r.mesh.geometry.dispose()
        ;(r.mesh.material as THREE.Material).dispose()
        this.rings.splice(i, 1)
        continue
      }
      r.mesh.scale.setScalar(0.2 + (r.r1 - 0.2) * (1 - (1 - k) * (1 - k)))
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k)
    }
    this.renderer.render(this.scene, this.camera)
  }

  /** 軌跡：滑行中每隔一小段在壺後留下淡藍光點。 */
  trail(x: number, y: number, dt: number): void {
    if (getSettings().reduceMotion) return
    this.trailT += dt
    if (this.trailT > 0.045) {
      this.trailT = 0
      this.particles.spawn(x, 0.05, w(y), 0, 0.05, 0, 0.9, 0x8fd3ff, 0)
    }
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.ro?.disconnect()
    for (const b of this.bound) this.canvas.removeEventListener(b.type, b.fn)
    this.particles.dispose()
    this.scratches.dispose()
    this.confetti.dispose()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh || (o as THREE.Points).isPoints) {
        m.geometry?.dispose()
        const mat = m.material as THREE.Material | THREE.Material[]
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
      }
    })
    this.iceTex.dispose()
    this.renderer.dispose()
  }
}

const TAU_ARENA = Math.PI * 2

export { STONE_R }
