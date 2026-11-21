import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import console from 'node:console'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const repoImport = (path) => import(pathToFileURL(resolve(path)).href)
const { analyzePaired } = await repoImport('sim/analysis/paired.ts')
const { manifestSha256, parseManifest, planGames, reproducePlan, rowFields, toPairedRecord } =
  await repoImport('sim/experiments/run.ts')
const { seatSetup } = await repoImport('sim/runner.ts')

const [input, prefix, sourceSha, seedBaseArg, lastBlockArg] = process.argv.slice(2)
assert.ok(input && prefix && sourceSha, 'usage: analyze.mjs games.jsonl output-prefix run-sha [seed-base]')
const seedBase = seedBaseArg === undefined ? undefined : Number(seedBaseArg)
const seedSet = seedBase === undefined ? 'eval' : 'tune'
const text = execFileSync('git', ['show', sourceSha + ':sim/experiments/c5-plan.json'], { encoding: 'utf8' })
const rawManifest = JSON.parse(text)
const manifest = parseManifest(rawManifest)
const opts = rawManifest.analysis.uncertainty
const filter = lastBlockArg === undefined ? {} : { blocks: [0, Number(lastBlockArg)] }
const plans = planGames(manifest, filter, seedBase)
const inputText = readFileSync(input, 'utf8')
const rows = inputText.trim().split('\n').map((line) => JSON.parse(line))
assert.equal(rows.length, plans.length, 'exactly one row per planned game')
const byId = new Map(rows.map((r) => [r.gameId, r]))
assert.equal(byId.size, plans.length, 'game IDs unique')

const failures = []
for (const plan of plans) {
  const row = byId.get(plan.gameId)
  assert.ok(row, plan.gameId)
  for (const key of [
    'arm', 'block', 'seed', 'cell', 'focalSeat', 'focalClass', 'backgroundPersonality',
    'lapTarget', 'maxSteps', 'seatPolicies',
  ]) assert.deepEqual(row[key], plan[key], plan.gameId + ' ' + key)
  assert.equal(row.socialWindow, plan.social)
  assert.equal(row.mainSha, sourceSha)
  assert.equal(row.manifestSha256, manifestSha256(text))
  assert.deepEqual(manifest.tables.gameRow.filter((name) => !rowFields(row).includes(name)), [])
  if (row.finished) {
    assert.deepEqual(
      row.seatClasses,
      seatSetup(manifest.game.classPool, plan.cell.seats, plan.seed).map((seat) => seat.classId),
    )
    assert.equal(row.focalWinCredit, row.winners.includes(row.focalSeat) ? 1 / row.winners.length : 0)
  }
  for (const [kind, uses] of Object.entries(row.focalUses)) {
    assert.ok(uses <= row.focalOpportunities[kind])
  }
  const { promises } = row
  assert.equal(promises.accepted, promises.broken + promises.kept + promises.closedByGameEnd + promises.pending)
  assert.equal(promises.kept, promises.keptWithOpportunity + promises.keptWithoutOpportunity)
  if (row.finished) {
    assert.equal(promises.pending, 0)
    assert.equal(promises.offered, promises.accepted + promises.rejected)
  }
  if (row.failureReasons.length) failures.push({
    gameId: row.gameId, seed: row.seed, reasons: row.failureReasons, command: reproducePlan(plan, seedBase),
  })
}

const mapped = rows.map(toPairedRecord)
const report = analyzePaired(mapped, {
  seedSet,
  analysisSeed: opts.analysisRngSeed,
  resamples: opts.resamples,
  confidence: opts.level,
})
const incomplete = new Set([
  ...report.counts.missingBlockIds, ...report.counts.abortedBlockIds, ...report.counts.invariantBlockIds,
])
const pairs = plans.filter((p) => p.arm === 'control').map((plan) => {
  const control = byId.get(plan.gameId)
  const treatment = byId.get(plan.blockId + '/treatment')
  const complete = !incomplete.has(plan.blockId)
  return {
    cell: control.cell,
    block: control.block,
    seed: control.seed,
    controlGameId: control.gameId,
    treatmentGameId: treatment.gameId,
    complete,
    winCreditDifference: complete ? treatment.focalWinCredit - control.focalWinCredit : null,
    coinDifference: complete ? treatment.finalCoins[treatment.focalSeat] - control.finalCoins[control.focalSeat] : null,
    controlWinners: control.winners,
    treatmentWinners: treatment.winners,
  }
})
assert.equal(pairs.filter((p) => p.complete).length, report.counts.completePairs)

const sum = (rows, get) => rows.reduce((total, row) => total + get(row), 0)
const tally = (keys) => Object.fromEntries([...new Set(keys)].sort().map((key) => [key, keys.filter((k) => k === key).length]))
const opportunities = (rows, field) => {
  const keys = new Set(rows.flatMap((row) => Object.keys(row[field])))
  return Object.fromEntries([...keys].sort().map((key) => [key, sum(rows, (row) => row[field][key] ?? 0)]))
}
const configKey = (policy, seats) => policy + '/' + seats + 'p/'
const cells = manifest.cells.map((cell) => {
  const { policy, seats, blocks: manifestBlocks } = cell
  const cellRows = rows.filter((row) => row.cell.policy === policy && row.cell.seats === seats)
  const control = cellRows.filter((row) => row.arm === 'control')
  const treatment = cellRows.filter((row) => row.arm === 'treatment')
  const result = report.comparisons.find((r) => r.treatmentPolicy === policy)?.bySeatCount[seats]
  const pairsPlanned = lastBlockArg === undefined ? manifestBlocks : Number(lastBlockArg) + 1
  const pairsComplete = result?.overall.n ?? 0
  const pairedRows = pairs.filter((p) => p.cell.policy === policy && p.cell.seats === seats && p.complete)
  assert.equal(pairedRows.length, pairsComplete)
  if (pairsComplete) {
    assert.equal(result.overall.differences.score.mean, sum(pairedRows.sort((a,b) => String(a.block).localeCompare(String(b.block))), (p) => p.winCreditDifference) / pairsComplete)
    assert.equal(result.overall.differences.coins.mean, sum(pairedRows, (p) => p.coinDifference) / pairsComplete)
  }
  for (const field of ['focalSeat', 'focalClass', 'backgroundPersonality']) {
    assert.deepEqual(tally(control.map((g) => g[field])), tally(treatment.map((g) => g[field])))
  }
  const opportunitiesControl = opportunities(control, 'focalOpportunities')
  const opportunitiesTreatment = opportunities(treatment, 'focalOpportunities')
  const usesControl = opportunities(control, 'focalUses')
  const usesTreatment = opportunities(treatment, 'focalUses')
  const vacuous = policy === 'never-negotiate' && !Object.values(opportunitiesControl).some((n) => n > 0)
  return {
    policy, seats, pairsPlanned, pairsComplete, pairsMissing: pairsPlanned - pairsComplete,
    opportunitiesControl, opportunitiesTreatment, usesControl, usesTreatment, vacuous,
    failingSeeds: failures.filter((item) => item.gameId.startsWith(configKey(policy, seats))),
    seatBalance: tally(control.map((g) => g.focalSeat)),
    classBalance: tally(control.map((g) => g.focalClass)),
    personalityBalance: tally(control.map((g) => g.backgroundPersonality)),
    seatClassBalance: tally(control.map((g) => g.focalSeat + '/' + g.focalClass)),
    seatPersonalityBalance: tally(control.map((g) => g.focalSeat + '/' + g.backgroundPersonality)),
    ...result,
  }
})

const allCounts = rows.reduce((acc, row) => ({
  finished: acc.finished + Number(row.finished),
  aborted: acc.aborted + Number(!row.finished),
  replayPass: acc.replayPass + Number(row.replayPass === true),
  illegalAppliedActionCount: acc.illegalAppliedActionCount + row.illegalAppliedActionCount,
  invariantFailures: acc.invariantFailures + row.invariantFailures,
}), { finished: 0, aborted: 0, replayPass: 0, illegalAppliedActionCount: 0, invariantFailures: 0 })

const interactions = []
for (const seats of manifest.game.seatCounts) {
  for (const arm of ['control', 'treatment']) {
    const group = rows.filter((row) => row.cell.seats === seats && row.arm === arm)
    const social = group.filter((row) => row.socialWindow)
    const promises = Object.fromEntries(
      Object.keys(social[0].promises).map((key) => [key, sum(social, (row) => row.promises[key])]),
    )
    const buckets = new Map()
    for (const row of group.flatMap((game) => game.hostility.byPersonalityLap)) {
      const key = JSON.stringify([row.personalityId, row.lap])
      const counts = buckets.get(key) ?? {
        personalityId: row.personalityId, lap: row.lap, hostileUsed: 0, legalHostileOpportunity: 0,
      }
      counts.hostileUsed += row.hostileUsed
      counts.legalHostileOpportunity += row.legalHostileOpportunity
      buckets.set(key, counts)
    }
    const hostility = [...buckets.values()].sort((a, b) =>
      a.personalityId.localeCompare(b.personalityId) || a.lap - b.lap,
    )
    for (const field of ['hostileUsed', 'legalHostileOpportunity']) {
      assert.equal(sum(hostility, (row) => row[field]), sum(group, (row) => row.hostility[field]))
    }
    interactions.push({ seats, arm, games: group.length, socialGames: social.length, promises, hostility })
  }
}
const cleanJson = (data) => JSON.stringify(data, null, 2) + '\n'
writeFileSync(prefix + '-pairs.jsonl', pairs.map((p) => JSON.stringify(p)).join('\n') + '\n')
writeFileSync(prefix + '-analysis.json', cleanJson({
  seedSet,
  sourceSha,
  seedFirst: Math.min(...plans.map((p) => p.seed)),
  seedLast: Math.max(...plans.map((p) => p.seed)),
  gamesSha256: createHash('sha256').update(inputText).digest('hex'),
  manifestSha256: manifestSha256(text),
  versions: rows.reduce((versions, row) => {
    assert.equal(row.engineVersion, versions.engine)
    assert.equal(row.contentVersion, versions.content)
    return versions
  }, { engine: rows[0].engineVersion, content: rows[0].contentVersion }),
  method: report.method,
  options: { seed: report.analysisSeed, resamples: report.resamples, confidence: report.confidence },
  counts: { ...report.counts, ...allCounts },
  failures,
  cells,
  interactions,
}))
console.log(seedSet, rows.length, 'games', report.counts.completePairs, 'complete pairs', failures.length, 'failing games')
