// AI 難度驗證：同難度互打的完整性，以及不同難度之間的勝率（雙方互換先後）。
import { autoPlay, type AiLevel } from '../src/core'

function duel(a: AiLevel, b: AiLevel, games: number): { aWins: number; bWins: number; draws: number; ms: number } {
  let aWins = 0
  let bWins = 0
  let draws = 0
  const t0 = Date.now()
  for (let i = 0; i < games; i++) {
    const aFirst = i % 2 === 0
    const r = autoPlay({ kind: 'standard', standard: { ends: 2, stonesPerTeam: 4 } }, aFirst ? [a, b] : [b, a], 500 + i)
    const aTeam = aFirst ? 0 : 1
    if (r.winner === aTeam) aWins++
    else if (r.winner === 1 - aTeam) bWins++
    else draws++
  }
  return { aWins, bWins, draws, ms: Date.now() - t0 }
}

const games = Number(process.argv[2] ?? 8)
for (const [a, b] of [['normal', 'easy'], ['hard', 'normal'], ['hard', 'easy']] as [AiLevel, AiLevel][]) {
  const r = duel(a, b, games)
  console.log(`${a} vs ${b}: ${a} 勝 ${r.aWins}、${b} 勝 ${r.bWins}、平手 ${r.draws}（${games} 場，${r.ms}ms）`)
}
