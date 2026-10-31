import { getSettings, onSettings } from '../game/settings'

type Sfx = 'click' | 'throw' | 'hit' | 'hitHard' | 'sweep' | 'perfect' | 'out' | 'sink' | 'cheer' | 'lose' | 'score' | 'bingo' | 'tick'

/** 以 WebAudio 合成所有音效與簡單 BGM；沒有外部授權素材。若 /audio/bgm.mp3 存在則優先播放它。 */
class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sfxGain!: GainNode
  private musicGain!: GainNode
  private noiseBuf: AudioBuffer | null = null
  private slideNode: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null
  private musicTimer: number | null = null
  private musicStep = 0
  private extBgm: HTMLAudioElement | null = null
  private triedExt = false
  unlocked = false

  constructor() {
    onSettings(() => this.applyVolumes())
  }

  /** 第一次使用者手勢後呼叫，解除瀏覽器音訊限制。 */
  unlock(): void {
    if (this.unlocked) {
      this.ctx?.resume()
      return
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.sfxGain = this.ctx.createGain()
    this.musicGain = this.ctx.createGain()
    this.sfxGain.connect(this.master)
    this.musicGain.connect(this.master)
    this.master.connect(this.ctx.destination)
    const len = this.ctx.sampleRate * 2
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.unlocked = true
    this.ctx.resume()
    this.applyVolumes()
    if (getSettings().musicOn) this.startMusic()
  }

  applyVolumes(): void {
    if (!this.ctx) return
    const s = getSettings()
    this.sfxGain.gain.value = s.sfxOn ? (s.sfxVol / 100) * 0.9 : 0
    this.musicGain.gain.value = s.musicOn ? (s.musicVol / 100) * 0.35 : 0
    if (this.extBgm) this.extBgm.volume = s.musicOn ? (s.musicVol / 100) * 0.6 : 0
    if (s.musicOn && this.unlocked && this.musicTimer === null && !this.extBgm) this.startMusic()
    if (!s.musicOn) this.stopMusic()
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime + when
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.sfxGain)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private noise(dur: number, vol: number, freq: number, q = 1, when = 0, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx || !this.noiseBuf) return
    const t = this.ctx.currentTime + when
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.sfxGain)
    src.start(t, Math.random())
    src.stop(t + dur + 0.02)
  }

  play(name: Sfx, strength = 1): void {
    if (!this.ctx || !this.unlocked) return
    switch (name) {
      case 'click':
        this.tone(660, 0.06, 'square', 0.12)
        break
      case 'tick':
        this.tone(880, 0.04, 'square', 0.08)
        break
      case 'throw':
        this.noise(0.35, 0.5, 600, 0.7)
        this.tone(180, 0.25, 'triangle', 0.25, 0, 90)
        break
      case 'hit':
        this.tone(220 + strength * 60, 0.12, 'triangle', 0.3 * Math.min(1, strength))
        this.noise(0.08, 0.35 * Math.min(1, strength), 2400, 2)
        break
      case 'hitHard':
        this.tone(140, 0.2, 'sawtooth', 0.35, 0, 70)
        this.noise(0.14, 0.6, 3000, 2)
        break
      case 'sweep':
        this.noise(0.22, 0.28 * strength, 1800 + strength * 600, 0.9)
        break
      case 'perfect':
        this.tone(880, 0.12, 'sine', 0.25)
        this.tone(1320, 0.18, 'sine', 0.2, 0.06)
        break
      case 'out':
        this.tone(300, 0.35, 'sine', 0.22, 0, 120)
        break
      case 'sink':
        this.noise(0.4, 0.45, 900, 0.6)
        this.tone(520, 0.25, 'sine', 0.25, 0, 160)
        this.tone(780, 0.3, 'sine', 0.22, 0.12)
        break
      case 'score':
        ;[523, 659, 784].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.25, i * 0.1))
        break
      case 'cheer':
        ;[523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.28, i * 0.1))
        this.noise(0.9, 0.3, 1500, 0.4, 0.1)
        break
      case 'lose':
        ;[392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.25, i * 0.18))
        break
      case 'bingo':
        ;[659, 784, 988, 1319].forEach((f, i) => this.tone(f, 0.18, 'square', 0.16, i * 0.08))
        this.noise(0.6, 0.3, 3500, 0.5, 0.1)
        break
    }
  }

  /** 壺滑行的持續摩擦聲：speed 以 m/s 為單位，0 時停止。 */
  slide(speed: number): void {
    if (!this.ctx || !this.noiseBuf || !this.unlocked) return
    if (speed <= 0.02) {
      if (this.slideNode) {
        this.slideNode.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08)
        const n = this.slideNode
        this.slideNode = null
        setTimeout(() => n.src.stop(), 400)
      }
      return
    }
    if (!this.slideNode) {
      const src = this.ctx.createBufferSource()
      src.buffer = this.noiseBuf
      src.loop = true
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.Q.value = 0.8
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      src.connect(filter).connect(gain).connect(this.sfxGain)
      src.start()
      this.slideNode = { src, gain, filter }
    }
    const t = this.ctx.currentTime
    this.slideNode.filter.frequency.setTargetAtTime(300 + speed * 220, t, 0.05)
    this.slideNode.gain.gain.setTargetAtTime(Math.min(0.22, 0.04 + speed * 0.04), t, 0.05)
  }

  stopSlide(): void {
    this.slide(0)
  }

  vibrate(ms: number | number[]): void {
    if (getSettings().haptics && 'vibrate' in navigator) navigator.vibrate(ms)
  }

  /* BGM：C 大調五聲音階的輕快循環；可被 /audio/bgm.mp3 取代。 */
  async startMusic(): Promise<void> {
    if (!this.ctx) return
    if (!this.triedExt) {
      this.triedExt = true
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}audio/bgm.mp3`, { method: 'HEAD' })
        const type = res.headers.get('content-type') ?? ''
        if (res.ok && type.includes('audio')) {
          this.extBgm = new Audio(`${import.meta.env.BASE_URL}audio/bgm.mp3`)
          this.extBgm.loop = true
        }
      } catch {
        /* 沒有外部素材，使用合成 BGM */
      }
    }
    if (this.extBgm) {
      this.applyVolumes()
      void this.extBgm.play().catch(() => undefined)
      return
    }
    if (this.musicTimer !== null) return
    const scale = [0, 2, 4, 7, 9]
    const prog = [0, 5, 7, 4]
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx) return
      const beat = this.musicStep++
      const bar = Math.floor(beat / 8) % 4
      const root = 48 + prog[bar]
      const note = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
      const t = this.ctx.currentTime
      const play = (m: number, dur: number, vol: number, type: OscillatorType) => {
        const o = this.ctx!.createOscillator()
        const g = this.ctx!.createGain()
        o.type = type
        o.frequency.value = note(m)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(vol, t + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        o.connect(g).connect(this.musicGain)
        o.start(t)
        o.stop(t + dur + 0.05)
      }
      if (beat % 8 === 0) play(root - 12, 1.8, 0.16, 'sine')
      if (beat % 4 === 2) play(root, 0.6, 0.06, 'triangle')
      const idx = (beat * 3 + bar) % scale.length
      play(root + 12 + scale[idx] + (beat % 16 >= 8 ? 12 : 0), 0.28, 0.08, 'triangle')
    }, 260)
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer)
      this.musicTimer = null
    }
    this.extBgm?.pause()
  }
}

export const audio = new AudioEngine()
