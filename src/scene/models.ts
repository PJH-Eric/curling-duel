import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { CatStyle } from '../game/settings'

/* 所有模型都是程式生成的低模；若 /models/*.glb 存在（由 blender/ 腳本匯出），會優先使用。 */

const mat = (color: number | string, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })

export interface CatStoneParts {
  group: THREE.Group
  /** 隊伍色的材質（換色時使用） */
  teamMats: THREE.MeshStandardMaterial[]
  head: THREE.Group
}

/** 若 public/models/*.glb 存在（由 blender/ 腳本匯出）就改用它：cat_stone.glb（貓咪冰壺）、sweeper.glb（掃冰員與全套動畫）。 */
let stoneTemplate: THREE.Object3D | null = null
let sweeperTemplate: { scene: THREE.Object3D; clips: THREE.AnimationClip[] } | null = null

async function fetchGlb(name: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] } | null> {
  try {
    const url = `${import.meta.env.BASE_URL}models/${name}`
    const head = await fetch(url, { method: 'HEAD' })
    const type = head.headers.get('content-type') ?? ''
    if (!head.ok || type.includes('text/html')) return null
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    return await new GLTFLoader().loadAsync(url)
  } catch {
    return null
  }
}

export async function loadModelOverrides(): Promise<boolean> {
  const [stone, sweeper] = await Promise.all([fetchGlb('cat_stone.glb'), fetchGlb('sweeper.glb')])
  if (stone) stoneTemplate = stone.scene
  if (sweeper) sweeperTemplate = { scene: sweeper.scene, clips: sweeper.animations }
  return !!(stone || sweeper)
}

function fromTemplate(teamColor: string): CatStoneParts | null {
  if (!stoneTemplate) return null
  const group = new THREE.Group()
  const inst = stoneTemplate.clone(true)
  const teamMats: THREE.MeshStandardMaterial[] = []
  inst.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    const src = m.material as THREE.MeshStandardMaterial
    if (src.name === 'TeamColor') {
      const c = src.clone()
      c.color.set(teamColor)
      m.material = c
      teamMats.push(c)
    }
  })
  group.add(inst)
  const head = (inst.getObjectByName('Head') as THREE.Group | undefined) ?? new THREE.Group()
  return { group, teamMats, head }
}

export function makeCatStone(teamColor: string, cat: CatStyle): CatStoneParts {
  const ext = fromTemplate(teamColor)
  if (ext) return ext
  const group = new THREE.Group()
  const teamMat = mat(teamColor, 0.4)
  const furMat = mat(teamColor, 0.7)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.13, 32), mat(0x9aa0a8, 0.45, 0.1))
  body.position.y = 0.09
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 32), mat(0x6e7580, 0.5, 0.2))
  rim.rotation.x = Math.PI / 2
  rim.position.y = 0.06
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.05, 32), teamMat)
  top.position.y = 0.175
  group.add(body, rim, top)

  const head = new THREE.Group()
  head.position.y = 0.3
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 16), furMat)
  skull.scale.set(1.12, 0.92, 1)
  head.add(skull)
  // 耳朵
  const earGeo = cat.ears === 'round' ? new THREE.SphereGeometry(0.045, 10, 8) : new THREE.ConeGeometry(0.052, 0.11, 4)
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, furMat)
    ear.position.set(s * 0.085, 0.115, 0)
    if (cat.ears === 'fold') {
      ear.rotation.x = 0.9
      ear.position.set(s * 0.09, 0.1, -0.03)
    } else if (cat.ears === 'point') ear.rotation.z = -s * 0.15
    head.add(ear)
  }
  // 表情（朝 -z）
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a })
  if (cat.face === 'cool') {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, 0.02), eyeMat)
    glass.position.set(0, 0.025, -0.125)
    head.add(glass)
  } else if (cat.face === 'sleepy') {
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), eyeMat)
      l.position.set(s * 0.05, 0.02, -0.127)
      head.add(l)
    }
  } else {
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), eyeMat)
      e.position.set(s * 0.05, 0.02, -0.125)
      head.add(e)
    }
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), mat(0xff7a90))
  nose.position.set(0, -0.012, -0.13)
  head.add(nose)
  if (cat.face === 'smile' || cat.face === 'cool') {
    const sm = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 6, 12, Math.PI), eyeMat)
    sm.rotation.z = Math.PI
    sm.position.set(0, -0.03, -0.125)
    head.add(sm)
  }
  // 花色
  const dark = mat(new THREE.Color(teamColor).multiplyScalar(0.55).getHex(), 0.8)
  if (cat.pattern === 'stripe') {
    for (const dx of [-0.04, 0, 0.04]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.05, 0.01), dark)
      st.position.set(dx, 0.1, -0.1)
      st.rotation.x = -0.5
      head.add(st)
    }
  } else if (cat.pattern === 'spot') {
    for (const [x, y, z] of [[-0.07, 0.06, -0.1], [0.08, 0.02, -0.095], [0.02, 0.1, -0.09]]) {
      const sp = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 8), dark)
      sp.position.set(x, y, z)
      sp.scale.z = 0.4
      head.add(sp)
    }
  }
  group.add(head)
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return { group, teamMats: [teamMat, furMat], head }
}

/* ───────── Q 版人物 ───────── */

export interface AvatarLook {
  skin: number
  hair: number
  shirt: string
  /** 髮型 0 短髮 1 馬尾 2 包頭 */
  style: number
}

export const AVATAR_LOOKS: AvatarLook[] = [
  { skin: 0xf2c9a0, hair: 0x7a4a2a, shirt: '#e23b3b', style: 1 },
  { skin: 0x8a5a3c, hair: 0x241810, shirt: '#e23b3b', style: 0 },
  { skin: 0xf2c9a0, hair: 0xd7b25a, shirt: '#e23b3b', style: 0 },
  { skin: 0xe0b088, hair: 0x1b1b1b, shirt: '#e23b3b', style: 2 },
]

export type Pose = 'idle' | 'ready' | 'lunge' | 'sweep' | 'cheer' | 'sad' | 'watch'

export interface Avatar {
  root: THREE.Group
  body: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
  broom: THREE.Group
  sleeves: THREE.MeshStandardMaterial[]
  pose: Pose
  setShirt(color: string): void
  update(pose: Pose, t: number, amp?: number): void
}

/** 場上人物的共同介面：程式生成的 Avatar 與 Blender 匯出的 GlbSweeper 都符合。 */
export interface Actor {
  root: THREE.Object3D
  setShirt(color: string): void
  update(pose: Pose, t: number, amp?: number): void
  /** Blender 動畫專用：每影格呼叫。ease 為掃冰力度 0..1、freq 為掃冰頻率（Hz） */
  animate?(dt: number, mode: 'idle' | 'sweep' | 'cheer', ease: number, freq: number): void
  /** 刷頭的世界座標（冰屑與刮痕由此噴出）；回傳 false 表示不支援 */
  brushWorld?(out: THREE.Vector3): boolean
}

/** 用 Blender 匯出的 sweeper.glb 建立掃冰員；沒有檔案時回傳 null（改用程式生成的小人）。 */
export function makeGlbSweeper(look: AvatarLook): Actor | null {
  if (!sweeperTemplate) return null
  const root = new THREE.Group()
  const inst = cloneSkeleton(sweeperTemplate.scene)
  root.add(inst)
  const mats: Record<string, THREE.MeshStandardMaterial[]> = {}
  inst.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    const c = (m.material as THREE.MeshStandardMaterial).clone()
    m.material = c
    ;(mats[c.name] ??= []).push(c)
    if (m.name === 'Tail') m.visible = look.style === 1
    if (m.name === 'Bun') m.visible = look.style === 2
  })
  for (const x of mats.Skin ?? []) x.color.set(look.skin)
  for (const x of mats.Hair ?? []) x.color.set(look.hair)
  for (const x of mats.TeamColor ?? []) x.color.set(look.shirt)
  const brush = inst.getObjectByName('BroomBrush')
  const mixer = new THREE.AnimationMixer(inst)
  const names = ['Idle', 'SweepLight', 'SweepHard', 'Cheer'] as const
  const act: Partial<Record<(typeof names)[number], THREE.AnimationAction>> = {}
  const weight: Record<string, number> = { Idle: 1, SweepLight: 0, SweepHard: 0, Cheer: 0 }
  for (const n of names) {
    const clip = THREE.AnimationClip.findByName(sweeperTemplate.clips, n)
    if (!clip) continue
    const a = mixer.clipAction(clip)
    a.setEffectiveWeight(weight[n])
    a.play()
    act[n] = a
  }
  const period = { SweepLight: act.SweepLight?.getClip().duration ?? 0.8, SweepHard: act.SweepHard?.getClip().duration ?? 0.4 }
  return {
    root,
    setShirt(color) {
      for (const x of mats.TeamColor ?? []) x.color.set(color)
    },
    update() {
      /* 動畫由 animate() 驅動 */
    },
    brushWorld(out) {
      if (!brush) return false
      brush.getWorldPosition(out)
      return true
    },
    animate(dt, mode, ease, freq) {
      const target = { Idle: mode === 'idle' ? 1 : 0, SweepLight: mode === 'sweep' ? 1 - ease : 0, SweepHard: mode === 'sweep' ? ease : 0, Cheer: mode === 'cheer' ? 1 : 0 }
      const k = 1 - Math.exp(-dt * 10)
      for (const n of names) {
        weight[n] += (target[n] - weight[n]) * k
        act[n]?.setEffectiveWeight(weight[n])
      }
      // 掃冰頻率隨壺速與力度改變：一圈 hard 約 0.4 秒、light 約 0.8 秒時 freq=2.5Hz／1.25Hz
      act.SweepHard?.setEffectiveTimeScale(Math.max(0.3, (freq * period.SweepHard)))
      act.SweepLight?.setEffectiveTimeScale(Math.max(0.3, (freq * period.SweepLight)))
      mixer.update(dt)
    },
  }
}

export function makeAvatar(look: AvatarLook): Avatar {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const shirtMat = mat(0xffffff, 0.7)
  const sleeveMat = mat(look.shirt, 0.6)
  const skinMat = mat(look.skin, 0.65)
  const hairMat = mat(look.hair, 0.8)
  const pantsMat = mat(0x1f2a40, 0.8)

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 6, 12), shirtMat)
  torso.position.y = 0.72
  const bib = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.2), sleeveMat)
  bib.position.set(0, 0.55, 0)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 20), skinMat)
  head.position.y = 1.16
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.285, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat)
  hair.position.y = 1.2
  hair.rotation.x = -0.25
  body.add(torso, bib, head, hair)
  if (look.style === 1) {
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), hairMat)
    tail.position.set(0, 1.2, 0.27)
    body.add(tail)
  } else if (look.style === 2) {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), hairMat)
    bun.position.set(0, 1.46, 0.02)
    body.add(bun)
  }
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 })
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), eyeMat)
    e.position.set(s * 0.1, 1.17, -0.245)
    body.add(e)
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), new THREE.MeshBasicMaterial({ color: 0xff8a8a, transparent: true, opacity: 0.5 }))
    blush.position.set(s * 0.15, 1.1, -0.235)
    blush.rotation.y = Math.PI
    body.add(blush)
  }

  const limb = (len: number, r: number, m: THREE.Material, y: number, x: number): THREE.Group => {
    const g = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, len, 10), m)
    mesh.position.y = -len / 2
    g.add(mesh)
    g.position.set(x, y, 0)
    return g
  }
  const armL = limb(0.38, 0.06, sleeveMat, 0.9, -0.23)
  const armR = limb(0.38, 0.06, sleeveMat, 0.9, 0.23)
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), skinMat)
  handL.position.y = -0.4
  armL.add(handL)
  const handR = handL.clone()
  armR.add(handR)
  const legL = limb(0.52, 0.075, pantsMat, 0.5, -0.1)
  const legR = limb(0.52, 0.075, pantsMat, 0.5, 0.1)
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.2), mat(0xf4f4f4))
  shoeL.position.set(0, -0.53, -0.04)
  legL.add(shoeL)
  const shoeR = shoeL.clone()
  legR.add(shoeR)
  body.add(armL, armR, legL, legR)

  // 刷子
  const broom = new THREE.Group()
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 6), mat(0x8a95a6, 0.4, 0.4))
  stick.position.y = 0.62
  const bh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.14), mat(0xffffff, 0.9))
  bh.position.y = 0.02
  const bt = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.14), mat(0x35c46a, 0.9))
  bt.position.y = -0.015
  broom.add(stick, bh, bt)
  broom.visible = false
  root.add(broom)

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
    }
  })

  const av: Avatar = {
    root,
    body,
    armL,
    armR,
    legL,
    legR,
    broom,
    sleeves: [sleeveMat],
    pose: 'idle',
    setShirt(color) {
      sleeveMat.color.set(color)
    },
    update(pose, t, amp = 1) {
      av.pose = pose
      const sw = Math.sin(t * 9)
      body.position.set(0, 0, 0)
      body.rotation.set(0, 0, 0)
      armL.rotation.set(0, 0, 0)
      armR.rotation.set(0, 0, 0)
      legL.rotation.set(0, 0, 0)
      legR.rotation.set(0, 0, 0)
      broom.visible = false
      switch (pose) {
        case 'idle':
          armL.rotation.x = Math.sin(t * 1.6) * 0.06
          armR.rotation.x = -Math.sin(t * 1.6) * 0.06
          body.position.y = Math.sin(t * 2) * 0.01
          break
        case 'watch':
          body.rotation.x = 0.1
          armL.rotation.z = -0.1
          armR.rotation.z = 0.1
          break
        case 'ready':
          body.rotation.x = 0.7
          body.position.set(0, -0.28, 0.05)
          armL.rotation.x = -1.2
          armR.rotation.x = -1.2
          legL.rotation.x = -1.3
          legR.rotation.x = 0.4
          break
        case 'lunge':
          body.rotation.x = 0.95
          body.position.set(0, -0.34, -0.2)
          armL.rotation.x = -1.6
          armR.rotation.x = -1.6
          legL.rotation.x = -1.5
          legR.rotation.x = 1.0
          break
        case 'sweep': {
          // amp：掃冰力度 0..1（0 為跟著壺小跑、1 為全力刷）
          const bob = Math.abs(Math.sin(t * 9)) * 0.035 * amp
          body.rotation.x = 0.35 + 0.5 * amp
          body.rotation.y = sw * 0.1 * amp
          body.position.set(0, -0.2 * amp + bob, 0)
          armL.rotation.x = -0.6 - 0.8 * amp + sw * 0.25 * amp
          armR.rotation.x = -0.5 - 0.6 * amp - sw * 0.25 * amp
          armL.rotation.z = sw * 0.12 * amp
          armR.rotation.z = sw * 0.12 * amp
          legL.rotation.x = -0.1 - 0.25 * amp + sw * (0.35 + 0.35 * amp)
          legR.rotation.x = -0.1 - 0.25 * amp - sw * (0.35 + 0.35 * amp)
          broom.visible = true
          broom.position.set(0.1 + sw * 0.2 * amp, 0.02, -0.55 + Math.cos(t * 9) * 0.06 * amp)
          broom.rotation.set(-0.55, sw * 0.15 * amp, sw * 0.35 * amp)
          break
        }
        case 'cheer':
          body.position.y = Math.abs(Math.sin(t * 6)) * 0.18
          armL.rotation.set(-2.8, 0, -0.35)
          armR.rotation.set(-2.8, 0, 0.35)
          break
        case 'sad':
          body.rotation.x = 0.25
          armL.rotation.x = 0.1
          armR.rotation.x = 0.1
          break
      }
    },
  }
  return av
}
