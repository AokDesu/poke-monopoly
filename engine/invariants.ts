import { ABILITY_EFFECTS, abilityEffectOf } from './abilities.ts';
import { pendingDecision } from './decisions.ts';
import { concessionWithinBudget, dealValuation } from './deal-facts.ts';
import { applyAction, legalActions } from './contract/stubs.ts';
import {
  actionSchema,
  type Action,
  type ApplyActionResult,
  type EngineEvent,
  type GameState,
  type Player,
} from './contract/schema.ts';
import { canonicalJson, stateHash } from './state-hash.ts';
import { pendingRollPurpose } from './turns.ts';
import { actorRevision, publicRevision } from './visibility.ts';
import { nextEvolutionForms } from './forms.ts';

/** Spec §8 engine invariants, plus the §6.5 Lap credit rules that issue #14 names. */
export type InvariantId =
  | 'coins-non-negative'
  | 'coin-transfer-sourced'
  | 'start-income-from-bank'
  | 'start-payment-precedes-sell'
  | 'forced-movement-no-start-income'
  | 'uid-unique'
  | 'uid-lifecycle-logged'
  | 'rejected-or-stale-unchanged'
  | 'catch-consumes-one-ball'
  | 'credited-lap-monotonic'
  | 'credited-lap-pays-once'
  | 'replay-reproduces-state'
  | 'game-can-finish'
  | 'pvp-turn-ownership'
  | 'attack-attempt-logged'
  | 'deals-atomic'
  | 'move-debuff-until-next-move'
  | 'tired-and-nurse-joy-useful'
  | 'promise-closes-on-own-turn'
  | 'resume-creates-nothing'
  | 'ability-once-per-instance-per-lap'
  | 'ability-once-per-player-turn'
  | 'evolution-keeps-cooldowns'
  | 'rescue-starter-no-coin-loop'
  | 'battle-reward-coins-or-evolution'
  | 'evolution-one-stage-same-uid';

export interface Violation {
  invariant: InvariantId;
  message: string;
}

export type ApplyActionFn = (state: GameState, action: unknown) => ApplyActionResult;

/** One checked step; `parsed` is the action when it matches the command schema. */
interface Step {
  before: GameState;
  parsed: Action | null;
  result: ApplyActionResult;
  apply: ApplyActionFn;
}

interface InvariantBase {
  id: InvariantId;
  /** Spec section and the exact spec line the invariant comes from. */
  section: string;
  specLine: string;
}

export type InvariantDefinition =
  | (InvariantBase & { status: 'active'; check: (step: Step) => string[] })
  | (InvariantBase & { status: 'pending' });

function checkEvolution({ before, result }: Step): string[] {
  if (!('accepted' in result)) return [];
  const errors: string[] = [];
  const events = eventsOf(result.events, 'pokemon_evolved');
  for (const event of events) {
    const previous = before.players
      .find((owner) => owner.actorId === event.ownerId)
      ?.team.find((pokemon) => pokemon.instanceId === event.instanceId);
    const current = result.state.players
      .find((owner) => owner.actorId === event.ownerId)
      ?.team.find((pokemon) => pokemon.instanceId === event.instanceId);
    if (!previous || !current) errors.push('Evolution did not retain the owned UID');
    else if (
      event.fromFormId !== previous.speciesId ||
      event.toFormId !== current.speciesId ||
      event.evolutionStage !== current.evolutionStage ||
      current.evolutionStage !== previous.evolutionStage + 1 ||
      !nextEvolutionForms(before.content, previous.speciesId).includes(current.speciesId)
    )
      errors.push('Evolution did not follow exactly one authored stage');
    if (
      result.events.some(
        (entry) =>
          (entry.kind === 'uid_created' || entry.kind === 'uid_destroyed') &&
          entry.instanceId === event.instanceId,
      )
    )
      errors.push('Evolution created or destroyed its UID');
  }
  for (const owner of before.players) {
    for (const previous of owner.team) {
      const current = result.state.players
        .find((player) => player.actorId === owner.actorId)
        ?.team.find((pokemon) => pokemon.instanceId === previous.instanceId);
      const count = events.filter((event) => event.instanceId === previous.instanceId).length;
      const changed =
        current &&
        (current.speciesId !== previous.speciesId ||
          current.evolutionStage !== previous.evolutionStage);
      if (count !== (changed ? 1 : 0)) errors.push('Evolution lacks exactly one matching UID log');
    }
  }
  return errors;
}

function checkEvolutionFields({ before, result }: Step): string[] {
  if (!('accepted' in result)) return [];
  const errors: string[] = [];
  for (const owner of before.players) {
    const currentOwner = result.state.players.find((player) => player.actorId === owner.actorId);
    for (const previous of owner.team) {
      const current = currentOwner?.team.find(
        (pokemon) => pokemon.instanceId === previous.instanceId,
      );
      if (
        !current ||
        (current.speciesId === previous.speciesId &&
          current.evolutionStage === previous.evolutionStage)
      )
        continue;
      // Preserve all UID-bound fields, including future status/cooldown metadata. A status change
      // logged in the same action (Dragon Rush's post-reward Tired, D13) is checked elsewhere.
      const statusLogged = eventsOf(result.events, 'status_changed').some(
        (event) => event.instanceId === previous.instanceId,
      );
      const retained = (pokemon: typeof previous) => {
        const fields: Partial<typeof previous> = { ...pokemon };
        delete fields.speciesId;
        delete fields.evolutionStage;
        if (statusLogged) {
          delete fields.tired;
          delete fields.tiredExpiresOwnTurnNo;
        }
        return fields;
      };
      if (
        canonicalJson(retained(previous)) !== canonicalJson(retained(current)) ||
        owner.abilityUsedGlobalTurnNo !== currentOwner?.abilityUsedGlobalTurnNo
      ) {
        errors.push('Evolution changed origin, status, tradeability or cooldowns');
      }
    }
  }
  return errors;
}

function checkRewards({ before, result }: Step): string[] {
  if (!('accepted' in result)) return [];
  const errors: string[] = [];
  const events = eventsOf(result.events, 'battle_reward_resolved');
  const prior = before.resolvedRewardIds ?? [];
  const receipts = result.state.resolvedRewardIds ?? [];
  const added = receipts.filter((id) => !prior.includes(id));
  if (
    new Set(receipts).size !== receipts.length ||
    prior.some((id) => !receipts.includes(id)) ||
    canonicalJson(added.slice().sort()) !==
      canonicalJson(events.map((event) => event.rewardId).sort())
  ) {
    errors.push('Reward receipts do not match the new resolution logs');
  }
  const transfers = eventsOf(result.events, 'coin_transfer').filter(
    (event) => event.rewardId !== undefined || ['pvp_reward', 'gym_reward'].includes(event.reason),
  );
  if (transfers.some((transfer) => !events.some((event) => event.rewardId === transfer.rewardId))) {
    errors.push('Reward transfer lacks a resolution');
  }
  for (const event of events) {
    if (prior.includes(event.rewardId)) errors.push('Reward resolved more than once');
    const winner = before.players.find((player) => player.actorId === event.winnerId);
    const source = event.source;
    const loser =
      source.kind === 'pvp'
        ? before.players.find((player) => player.actorId === source.loserId)
        : undefined;
    if (!winner || (source.kind === 'pvp' && (!loser || loser === winner))) {
      errors.push('Reward has invalid participants');
      continue;
    }
    const amount =
      event.choice.kind === 'evolve'
        ? 0
        : source.kind === 'gym'
          ? 6
          : source.coinLossBlocked
            ? 0
            : Math.min(6, loser!.coins);
    const payments = transfers.filter((transfer) => transfer.rewardId === event.rewardId);
    if (
      event.coinAmount !== amount ||
      payments.length !== (amount > 0 ? 1 : 0) ||
      payments.some(
        (transfer) =>
          transfer.amount !== amount ||
          canonicalJson(transfer.source) !==
            canonicalJson(loser ? { kind: 'player', actorId: loser.actorId } : { kind: 'bank' }) ||
          canonicalJson(transfer.destination) !==
            canonicalJson({ kind: 'player', actorId: winner.actorId }) ||
          transfer.reason !== (loser ? 'pvp_reward' : 'gym_reward'),
      )
    )
      errors.push('Reward payment has the wrong amount or source');
    const evolutions = eventsOf(result.events, 'pokemon_evolved');
    const choice = event.choice;
    if (
      choice.kind === 'coins'
        ? evolutions.length !== 0
        : evolutions.length !== 1 ||
          evolutions[0]?.ownerId !== winner.actorId ||
          evolutions[0]?.instanceId !== choice.instanceId ||
          evolutions[0]?.toFormId !== choice.nextFormId
    ) {
      errors.push('Reward must grant exactly its selected outcome');
    }
    for (const player of before.players) {
      const current = result.state.players.find((entry) => entry.actorId === player.actorId);
      const delta = player === winner ? amount : player === loser ? -amount : 0;
      if (!current || current.coins !== player.coins + delta)
        errors.push('Reward changed an unexpected coin balance');
    }
  }
  return errors;
}

function checkStatuses({ before, result }: Step): string[] {
  if (!('accepted' in result)) return [];
  const errors: string[] = [];
  for (const owner of result.state.players) {
    const previous = before.players.find((player) => player.actorId === owner.actorId)!;
    const started = owner.ownTurnNo > previous.ownTurnNo;
    const nurse =
      result.state.content.classes.find((entry) => entry.id === owner.classId)?.passive ===
      'turn_start_team_heal';
    const ended = before.phase.kind === 'end' && before.activeSeatIndex === owner.seatIndex;
    for (const pokemon of owner.team) {
      if (started && nurse && pokemon.tired) errors.push('Nurse Joy did not heal at turn start');
      if (
        ended &&
        pokemon.tired &&
        pokemon.tiredExpiresOwnTurnNo !== undefined &&
        pokemon.tiredExpiresOwnTurnNo <= previous.ownTurnNo
      )
        errors.push('Tired outlived owner expiry');
      if (!pokemon.tired && pokemon.tiredExpiresOwnTurnNo !== undefined)
        errors.push('Cleared Tired retained expiry');
      const old = previous.team.find((entry) => entry.instanceId === pokemon.instanceId);
      if (
        old &&
        old.tired !== pokemon.tired &&
        !result.events.some(
          (event) =>
            event.kind === 'status_changed' &&
            event.instanceId === pokemon.instanceId &&
            event.status === 'tired' &&
            event.operation === (pokemon.tired ? 'applied' : 'cleared'),
        )
      )
        errors.push('Status change lacks a UID log');
    }
  }
  return errors;
}

const accepted = (result: ApplyActionResult) => 'accepted' in result;

/** Instance IDs that players own. An instance ID is created at the catch (issue #23). */
function ownedInstanceIds(state: GameState): string[] {
  return state.players.flatMap((player) => [
    ...player.team.map((pokemon) => pokemon.instanceId),
    ...player.items.map((item) => item.instanceId),
  ]);
}

/** The rewarded-milestone watermark, read as the engine reads it for older snapshots. */
const watermark = (player: Player) => player.highestRewardedMilestone ?? player.creditedLap;

function startIncome(events: EngineEvent[]) {
  return eventsOf(events, 'coin_transfer').filter((event) => event.reason === 'start_income');
}

function eventsOf<K extends EngineEvent['kind']>(events: EngineEvent[], kind: K) {
  return events.filter((event): event is Extract<EngineEvent, { kind: K }> => event.kind === kind);
}

function checkCoinsNonNegative({ result }: Step): string[] {
  return result.state.players
    .filter((player) => player.coins < 0)
    .map((player) => `${player.actorId} has ${player.coins} coins`);
}

function checkCoinTransfers({ before, result }: Step): string[] {
  if (!accepted(result)) return [];
  const problems: string[] = [];
  const actors = new Set(result.state.players.map((player) => player.actorId));
  const net = new Map<string, number>();
  const credit = (actorId: string, amount: number) =>
    net.set(actorId, (net.get(actorId) ?? 0) + amount);
  for (const transfer of eventsOf(result.events, 'coin_transfer')) {
    // Events are checked as untrusted data: a broken engine may omit the source.
    const source = transfer.source as typeof transfer.source | undefined;
    if (!source || (source.kind === 'player' && !actors.has(source.actorId))) {
      problems.push(`coin_transfer "${transfer.reason}" has no valid source`);
    } else if (source.kind === 'player') {
      credit(source.actorId, -transfer.amount);
    }
    if (transfer.destination.kind === 'player') {
      credit(transfer.destination.actorId, transfer.amount);
    }
  }
  for (const player of result.state.players) {
    const previous = before.players.find((candidate) => candidate.actorId === player.actorId);
    const change = player.coins - (previous?.coins ?? 0);
    const logged = net.get(player.actorId) ?? 0;
    if (change !== logged) {
      problems.push(
        `${player.actorId} coins changed by ${change} but coin_transfer events net ${logged}`,
      );
    }
  }
  return problems;
}

function checkUidUnique({ result }: Step): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const ids = ownedInstanceIds(result.state);
  // A historical encounter's Pokémon must not reuse an owned ID; live draws have none until caught.
  const { phase } = result.state;
  if (phase.kind === 'encounter' && 'instanceId' in phase.pokemon) {
    ids.push(phase.pokemon.instanceId);
  }
  for (const id of ids) (seen.has(id) ? duplicates : seen).add(id);
  return [...duplicates].map((id) => `instance ID ${id} appears more than once`);
}

function checkUidLifecycle({ before, result }: Step): string[] {
  if (!accepted(result)) return [];
  const problems: string[] = [];
  const was = new Set(ownedInstanceIds(before));
  const now = new Set(ownedInstanceIds(result.state));
  const created = new Set(eventsOf(result.events, 'uid_created').map((event) => event.instanceId));
  const destroyed = new Set(
    eventsOf(result.events, 'uid_destroyed').map((event) => event.instanceId),
  );
  for (const id of now) {
    if (!was.has(id) && !created.has(id)) problems.push(`${id} appeared without uid_created`);
  }
  for (const id of was) {
    if (!now.has(id) && !destroyed.has(id)) problems.push(`${id} vanished without uid_destroyed`);
  }
  for (const id of created) {
    if (was.has(id) || !now.has(id)) problems.push(`uid_created ${id} does not match the state`);
  }
  for (const id of destroyed) {
    if (!was.has(id) || now.has(id)) problems.push(`uid_destroyed ${id} does not match the state`);
  }
  return problems;
}

function checkRejectedOrStale({ before, parsed, result }: Step): string[] {
  const stale =
    parsed !== null && parsed.stateRevisionBefore !== actorRevision(before, parsed.actorId);
  if (!stale && accepted(result)) return [];
  if (stateHash(result.state) === stateHash(before)) return [];
  return [`${stale ? 'stale' : 'rejected'} action changed the state hash`];
}

function checkCatchBalls({ before, parsed, result }: Step): string[] {
  if (!accepted(result) || !parsed || (parsed.kind !== 'catch' && parsed.kind !== 'release')) {
    return [];
  }
  const was = before.players.find((player) => player.actorId === parsed.actorId)?.balls;
  const now = result.state.players.find((player) => player.actorId === parsed.actorId)?.balls;
  if (!was || !now) return [`${parsed.kind} actor ${parsed.actorId} has no Ball pouch`];
  const problems: string[] = [];
  for (const type of ['poke', 'great', 'ultra'] as const) {
    const used = was[type] - now[type];
    const expected = parsed.kind === 'catch' && parsed.payload.ballType === type ? 1 : 0;
    if (used !== expected) problems.push(`${parsed.kind} consumed ${used} ${type} Ball(s)`);
  }
  return problems;
}

function checkStartIncomeFromBank({ result }: Step): string[] {
  if (!accepted(result)) return [];
  return startIncome(result.events)
    .filter((event) => event.source?.kind !== 'bank' || event.destination.kind !== 'player')
    .map(() => 'start_income is not a bank-to-player transfer');
}

function checkCreditedLap({ before, result }: Step): string[] {
  const problems: string[] = [];
  for (const player of result.state.players) {
    const previous = before.players.find((candidate) => candidate.actorId === player.actorId);
    if (!previous) continue;
    if (player.creditedLap < previous.creditedLap) {
      problems.push(
        `${player.actorId} creditedLap fell from ${previous.creditedLap} to ${player.creditedLap}`,
      );
    }
    if (watermark(player) < watermark(previous)) {
      problems.push(
        `${player.actorId} highestRewardedMilestone fell from ${watermark(previous)} to ${watermark(player)}`,
      );
    }
    if (player.creditedLap > watermark(player)) {
      problems.push(
        `${player.actorId} creditedLap ${player.creditedLap} exceeds the rewarded milestone ${watermark(player)}`,
      );
    }
  }
  return problems;
}

function checkCreditedLapPaysOnce({ before, result }: Step): string[] {
  if (!accepted(result)) return [];
  const problems: string[] = [];
  const squares = result.state.content.board.length;
  const income = startIncome(result.events);
  for (const player of result.state.players) {
    const previous = before.players.find((candidate) => candidate.actorId === player.actorId);
    if (!previous) continue;
    const paid = income.filter(
      ({ destination }) => destination.kind === 'player' && destination.actorId === player.actorId,
    ).length;
    const credited = player.creditedLap - previous.creditedLap;
    if (credited >= 0 && paid !== credited) {
      problems.push(
        `${player.actorId} creditedLap rose by ${credited} but Start income paid ${paid}`,
      );
    }
    if (paid === 0) {
      if (watermark(player) > watermark(previous)) {
        problems.push(`${player.actorId} highestRewardedMilestone rose without Start income`);
      }
      continue;
    }
    const milestone = Math.floor(player.routeProgress / squares);
    if (
      paid > 1 ||
      milestone <= watermark(previous) ||
      milestone <= Math.floor(previous.routeProgress / squares) ||
      watermark(player) !== milestone
    ) {
      problems.push(
        `${player.actorId} Start income for milestone ${milestone} is not one new milestone crossed this step`,
      );
    }
  }
  return problems;
}

function checkStartPaymentOrder({ before, result }: Step): string[] {
  if (!accepted(result)) return [];
  const problems: string[] = [];
  const { events } = result;
  const paidAt = events.findIndex(
    (event) => event.kind === 'coin_transfer' && event.reason === 'start_income',
  );
  const sellAt = events.findIndex((event) => event.kind === 'phase_changed' && event.to === 'sell');
  if (sellAt !== -1 && (paidAt === -1 || paidAt > sellAt)) {
    problems.push('the Sell Phase starts without Start income paid before it');
  }
  if (paidAt !== -1 && result.state.phase.kind !== 'sell') {
    problems.push(`Start income is followed by phase ${result.state.phase.kind}, not Sell`);
  }
  if (before.phase.kind !== 'resolve' && eventsOf(events, 'space_resolved').length > 0) {
    problems.push(`the destination resolves in phase ${before.phase.kind}, not after Sell`);
  }
  return problems;
}

function checkForcedMovementIncome({ before, parsed, result }: Step): string[] {
  if (!accepted(result)) return [];
  // Start income is paid only while the payee's own Move phase resolves: its die, a kept or
  // rerolled die (D11) or a fixed move (C.5). Displacement happens outside Move (D9).
  const ownMoveRoll =
    before.phase.kind === 'move' &&
    (parsed?.kind === 'dice_result'
      ? pendingRollPurpose(before)?.startsWith('move:') === true
      : parsed?.kind === 'roll' || parsed?.kind === 'skip');
  const mover = before.players.find((player) => player.seatIndex === before.activeSeatIndex);
  return startIncome(result.events)
    .filter(
      ({ destination }) =>
        !ownMoveRoll || destination.kind !== 'player' || destination.actorId !== mover?.actorId,
    )
    .map(({ destination }) =>
      destination.kind === 'player'
        ? `${destination.actorId} received Start income outside their own move`
        : 'Start income paid outside an own move',
    );
}

function checkReplay({ before, parsed, result, apply }: Step): string[] {
  if (!('accepted' in result)) return [];
  const { record } = result;
  if (!parsed || canonicalJson(record.action) !== canonicalJson(parsed)) {
    return ['the logged record does not hold the submitted action'];
  }
  if (canonicalJson(record.events) !== canonicalJson(result.events)) {
    return ['the logged record does not hold the emitted events'];
  }
  const again = apply(before, record.action);
  if (!('accepted' in again)) return [`replaying the logged action is rejected: ${again.reason}`];
  if (stateHash(again.state) !== stateHash(result.state)) {
    return ['replaying the logged action produces a different state'];
  }
  if (canonicalJson(again.events) !== canonicalJson(result.events)) {
    return ['replaying the logged action produces different events'];
  }
  return [];
}

function checkGameCanFinish({ result }: Step): string[] {
  const { state } = result;
  if (state.phase.kind === 'finished') return [];
  const seated =
    state.config.seats.some((seat) => seat.seatIndex === state.activeSeatIndex) &&
    state.players.some((player) => player.seatIndex === state.activeSeatIndex);
  if (!seated) return [`active seat ${state.activeSeatIndex} is not a configured player`];
  if (pendingRollPurpose(state)) return [];
  const decision = pendingDecision(state);
  if (!decision || legalActions(state, decision.seatIndex).enabled.length === 0) {
    return [`no pending seat has an enabled choice in phase ${state.phase.kind}`];
  }
  return [];
}

function checkPvpOwnership({ before, parsed, result }: Step): string[] {
  if (!('accepted' in result) || (before.phase.kind !== 'pvp' && parsed?.kind !== 'declare_pvp'))
    return [];
  const after = result.state;
  const errors: string[] = [];
  if (
    after.activeSeatIndex !== before.activeSeatIndex ||
    after.globalTurnNo !== before.globalTurnNo ||
    before.players.some(
      (player) =>
        after.players.find((entry) => entry.actorId === player.actorId)?.ownTurnNo !==
        player.ownTurnNo,
    )
  ) {
    errors.push('PvP advanced or transferred the challenger’s turn');
  }
  const expected = {
    ...before.turnBudgets,
    tacticalAction: before.turnBudgets.tacticalAction - (parsed?.kind === 'declare_pvp' ? 1 : 0),
    // The active challenger's own window activation spends its pokemonAbility (C.3).
    pokemonAbility:
      before.turnBudgets.pokemonAbility -
      (parsed?.kind === 'activate_ability' &&
      before.players.find((player) => player.actorId === parsed.actorId)?.seatIndex ===
        before.activeSeatIndex
        ? 1
        : 0),
  };
  if (canonicalJson(after.turnBudgets) !== canonicalJson(expected))
    errors.push('PvP changed unexpected turn budgets');
  return errors;
}

function checkAttackEvidence({ before, parsed, result }: Step): string[] {
  if (!('accepted' in result)) return [];
  const history = result.state.attackHistory ?? [];
  const prior = before.attackHistory ?? [];
  const attempts = eventsOf(result.events, 'attack_attempt');
  const errors: string[] = [];
  if (canonicalJson(history) !== canonicalJson([...prior, ...attempts]))
    errors.push('Attack history does not match the accepted attempt events');
  const expected = expectedAttempt(before, parsed);
  if (expected) {
    if (attempts.length !== 1 || canonicalJson(attempts[0]) !== canonicalJson(expected))
      errors.push('Declaration lacks exactly one directed attack attempt');
  } else if (attempts.length) errors.push('Attack attempt recorded without a declaration');
  return errors;
}

const DEAL_KINDS = [
  'propose_deal',
  'respond_deal',
  'counter_deal',
  'confirm_deal',
  'cancel_deal',
] as const;

/** Who holds each Pokémon and item instance, by actor. */
function holders(state: GameState): Map<string, string> {
  return new Map(
    state.players.flatMap((player) => [
      ...player.team.map((pokemon) => [pokemon.instanceId, player.actorId] as const),
      ...player.items.map((item) => [item.instanceId, player.actorId] as const),
    ]),
  );
}

/**
 * Deals are atomic (§4.8, §8): an asset changes owner only in an accepted `confirm_deal`, and then exactly the
 * pending terms move, once: the asset from its giver to its receiver and the coins from the receiver to the giver
 * through one sourced `coin_transfer` (reason `deal`), with every other holding, coin balance and player untouched,
 * and both parties' one-deal-per-Lap marker set. Every other deal step moves nothing and keeps a counter within
 * depth 1; a refused deal step leaves the state hash unchanged (the generic check names a stale or refused action).
 */
function checkDealsAtomic({ before, parsed, result }: Step): string[] {
  const isDeal = parsed !== null && (DEAL_KINDS as readonly string[]).includes(parsed.kind);
  if (!accepted(result)) {
    return isDeal && stateHash(result.state) !== stateHash(before)
      ? ['a refused deal step changed the state hash']
      : [];
  }
  const errors: string[] = [];
  const was = holders(before);
  const now = holders(result.state);
  const moved = [...now].filter(([id, owner]) => was.has(id) && was.get(id) !== owner);
  const transfers = eventsOf(result.events, 'coin_transfer').filter((e) => e.reason === 'deal');
  const pending = before.pendingResponse;
  if (parsed?.kind !== 'confirm_deal') {
    if (moved.length > 0) errors.push('an asset changed owner outside a confirmed deal');
    if (transfers.length > 0) errors.push('a deal coin transfer was logged outside a confirm');
    if (eventsOf(result.events, 'deal_committed').length > 0) {
      errors.push('deal_committed was logged outside a confirm');
    }
  } else if (pending?.kind !== 'deal') {
    errors.push('a deal was confirmed with no Deal Card pending');
  } else {
    const { terms } = pending;
    const assetSide = terms.give.pokemonInstanceIds.length + terms.give.itemInstanceIds.length > 0;
    const asset = assetSide ? terms.give : terms.get;
    const coinSide = assetSide ? terms.get : terms.give;
    const initiator = before.players.find((p) => p.seatIndex === pending.initiatorSeatIndex)!;
    const target = before.players.find((p) => p.seatIndex === pending.targetSeatIndex)!;
    const [giver, receiver] = assetSide ? [initiator, target] : [target, initiator];
    const ids = [...asset.pokemonInstanceIds, ...asset.itemInstanceIds].sort();
    if (
      JSON.stringify(moved.map(([id]) => id).sort()) !== JSON.stringify(ids) ||
      moved.some(([id, owner]) => was.get(id) !== giver.actorId || owner !== receiver.actorId)
    ) {
      errors.push('a confirmed deal did not move exactly its asset from giver to receiver');
    }
    const transfer = transfers[0];
    if (
      transfers.length !== 1 ||
      transfer?.amount !== coinSide.coins ||
      transfer.source.kind !== 'player' ||
      transfer.source.actorId !== receiver.actorId ||
      transfer.destination.kind !== 'player' ||
      transfer.destination.actorId !== giver.actorId
    ) {
      errors.push('a confirmed deal did not move exactly its coins from receiver to giver');
    }
    if (eventsOf(result.events, 'deal_committed').length !== 1) {
      errors.push('a confirmed deal must log exactly one deal_committed');
    }
    // §4.8: the AI's concession is charged on commit, once, and never past its budget.
    const { concession } = dealValuation(
      before,
      pending.initiatorSeatIndex,
      pending.targetSeatIndex,
      terms,
    );
    const charged = result.state.players.find((p) => p.seatIndex === pending.targetSeatIndex)!;
    if ((charged.dealConcessionSpent ?? 0) !== (target.dealConcessionSpent ?? 0) + concession) {
      errors.push('a confirmed deal did not charge exactly its concession to the AI budget');
    }
    if (!concessionWithinBudget(before, target, concession)) {
      errors.push('a confirmed deal conceded more than the AI budget allows');
    }
    for (const seatIndex of [pending.initiatorSeatIndex, pending.targetSeatIndex]) {
      const after = result.state.players.find((p) => p.seatIndex === seatIndex)!;
      if (after.dealUsedLap !== after.creditedLap) errors.push('a deal did not use its Lap quota');
    }
    // Nothing but the two parties' holdings changed hands: a third player is unchanged.
    for (const other of result.state.players) {
      if (
        other.seatIndex === pending.initiatorSeatIndex ||
        other.seatIndex === pending.targetSeatIndex
      ) {
        continue;
      }
      const previous = before.players.find((p) => p.actorId === other.actorId)!;
      // A seat outside a Deal Card only counts it among the records it does not see.
      const unchanged = (player: Player) => ({ ...player, unseenRecords: 0 });
      if (canonicalJson(unchanged(previous)) !== canonicalJson(unchanged(other))) {
        errors.push('a deal changed a seat outside it');
      }
    }
    if (result.state.pendingResponse) errors.push('a confirmed deal left its question pending');
  }
  if (parsed?.kind !== 'confirm_deal') {
    for (const player of result.state.players) {
      const previous = before.players.find((p) => p.actorId === player.actorId);
      if ((player.dealConcessionSpent ?? 0) !== (previous?.dealConcessionSpent ?? 0)) {
        errors.push('a concession was charged outside a confirmed deal');
      }
    }
  }
  const after = result.state.pendingResponse;
  if (after?.kind === 'deal' && after.counterDepth > 1) errors.push('counter depth exceeds 1');
  return errors;
}

/**
 * §4.8 / §4.2 step 7: a promise closes exactly at End of its promiser's `closesOwnTurnNo` turn, or at game end
 * if that comes first; its trust change follows the table (−2, +1 capped at +2 per pair, 0, none), clamped to
 * −3..3; and a promise is never left open once its closing turn has ended.
 */
function checkPromiseClosure({ before, parsed, result }: Step): string[] {
  if (!accepted(result)) return [];
  const after = result.state;
  const errors: string[] = [];
  const priorPromises = before.promises ?? [];
  const closedEvents = eventsOf(result.events, 'promise_closed');
  const newlyClosed = (after.promises ?? []).filter((promise, index) => {
    if (!promise.settled) return false;
    const prior = priorPromises[index];
    if (prior?.settled && canonicalJson(prior.settled) !== canonicalJson(promise.settled)) {
      errors.push('a settled promise changed its outcome');
    }
    return !prior?.settled;
  });
  if (newlyClosed.length !== closedEvents.length)
    errors.push('promise_closed events do not match the promises closed in this step');
  const expectedTrust = new Map<string, { value: number; keptGain: number }>();
  const trustKey = (from: number, to: number) => `${from}>${to}`;
  for (const entry of before.trust ?? []) {
    expectedTrust.set(trustKey(entry.fromSeatIndex, entry.toSeatIndex), {
      value: entry.value,
      keptGain: entry.keptGain,
    });
  }
  for (const promise of newlyClosed) {
    const outcome = promise.settled!.outcome;
    const promiser = after.players.find((entry) => entry.seatIndex === promise.promiserSeatIndex)!;
    const atEnd =
      parsed?.kind === 'skip' &&
      before.phase.kind === 'end' &&
      before.activeSeatIndex === promise.promiserSeatIndex &&
      promiser.ownTurnNo === promise.closesOwnTurnNo;
    if (outcome === 'closed_by_game_end') {
      if (after.phase.kind !== 'finished' || promiser.ownTurnNo >= promise.closesOwnTurnNo)
        errors.push('a promise closed by game end outside the end of the game or after its turn');
    } else if (!atEnd) {
      errors.push(
        `promise of seat ${promise.promiserSeatIndex} closed outside the End of its own turn ${promise.closesOwnTurnNo}`,
      );
    }
    if (
      !closedEvents.some(
        (event) =>
          event.promiserSeatIndex === promise.promiserSeatIndex &&
          event.recipientSeatIndex === promise.recipientSeatIndex &&
          event.globalTurnNo === promise.settled!.globalTurnNo,
      )
    ) {
      errors.push('a closed promise has no promise_closed event');
    }
    if (outcome === 'kept_with_chance' && !promise.chance)
      errors.push('a promise was kept with a chance that was never recorded');
    if (outcome === 'kept_without_chance' && promise.chance)
      errors.push('a promise with a recorded chance was kept without one');
    if (outcome === 'broken' || outcome === 'kept_with_chance') {
      const key = trustKey(promise.recipientSeatIndex, promise.promiserSeatIndex);
      const entry = expectedTrust.get(key) ?? { value: 0, keptGain: 0 };
      if (outcome === 'broken') entry.value = Math.max(-3, entry.value - 2);
      else if (entry.keptGain < 2) {
        entry.keptGain++;
        entry.value = Math.min(3, entry.value + 1);
      }
      expectedTrust.set(key, entry);
    }
  }
  for (const entry of after.trust ?? []) {
    const expected = expectedTrust.get(trustKey(entry.fromSeatIndex, entry.toSeatIndex));
    if (!expected || expected.value !== entry.value || expected.keptGain !== entry.keptGain)
      errors.push(
        `trust of seat ${entry.fromSeatIndex} in seat ${entry.toSeatIndex} is not the table's`,
      );
    if (entry.value < -3 || entry.value > 3 || entry.keptGain > 2)
      errors.push('trust left its -3..3 range or its +2 cap');
  }
  for (const promise of after.promises ?? []) {
    if (promise.settled) continue;
    const promiser = after.players.find((entry) => entry.seatIndex === promise.promiserSeatIndex)!;
    const overdue =
      after.phase.kind === 'finished' ||
      promiser.ownTurnNo > promise.closesOwnTurnNo ||
      (promiser.ownTurnNo === promise.closesOwnTurnNo &&
        after.activeSeatIndex !== promise.promiserSeatIndex);
    if (overdue)
      errors.push(`promise of seat ${promise.promiserSeatIndex} stayed open past its closing turn`);
  }
  return errors;
}

const HOSTILE_ITEMS = ['repel', 'pickpocket', 'sticky-web', 'battle-ticket'];

/** The one attempt a PvP declaration or hostile item use must record (§4.4, §4.6, D6). */
function expectedAttempt(before: GameState, parsed: Step['parsed']) {
  if (!parsed) return;
  const actor = before.players.find((player) => player.actorId === parsed.actorId);
  let source: 'pvp_declaration' | 'hostile_item' | 'hostile_ability' | undefined;
  let prefix = '';
  let targetSeatIndex: number | undefined;
  if (parsed.kind === 'declare_pvp') {
    [source, prefix, targetSeatIndex] = ['pvp_declaration', 'pvp', parsed.payload.targetSeatIndex];
  } else if (parsed.kind === 'use_item') {
    const item = actor?.items.find((entry) => entry.instanceId === parsed.payload.itemInstanceId);
    if (item && HOSTILE_ITEMS.includes(item.itemId)) {
      [source, prefix, targetSeatIndex] = [
        'hostile_item',
        'hostile',
        parsed.payload.targetSeatIndex,
      ];
    }
  }
  if (parsed.kind === 'activate_ability') {
    const pokemon = actor?.team.find((entry) => entry.instanceId === parsed.payload.instanceId);
    const effect = pokemon && abilityEffectOf(before, pokemon);
    if (effect && ABILITY_EFFECTS[effect].hostile) {
      [source, prefix, targetSeatIndex] = [
        'hostile_ability',
        'ability',
        parsed.payload.targetSeatIndex,
      ];
    }
  }
  if (!source) return;
  return {
    kind: 'attack_attempt',
    // The ID a seat sees skips chats; the internal sequence counts every record (§4.8, §6.3).
    attackId: `${prefix}:${publicRevision(before) + 1}`,
    actorId: parsed.actorId,
    targetId: before.players.find((player) => player.seatIndex === targetSeatIndex)?.actorId,
    source,
    actionSeq: before.stateRevision + 1,
    globalTurnNo: before.globalTurnNo,
  };
}

/**
 * §8 replay/resume: the RNG advances by exactly the draws an accepted action logs, numbered in
 * order, so no die is ever re-rolled silently; and a saved copy of the state re-asks the same seat.
 */
function checkResumeCreatesNothing({ before, result }: Step): string[] {
  if (!('accepted' in result)) return [];
  const errors: string[] = [];
  const draws = eventsOf(result.events, 'random_result').filter(
    (event) => event.drawCounter !== undefined,
  );
  const expected = draws.map((_, index) => before.rng.cursor + index + 1);
  if (
    result.state.rng.cursor !== before.rng.cursor + draws.length ||
    canonicalJson(draws.map((event) => event.drawCounter)) !== canonicalJson(expected)
  ) {
    errors.push('RNG advanced without a matching logged draw');
  }
  const saved = JSON.parse(JSON.stringify(result.state)) as GameState;
  if (canonicalJson(pendingDecision(saved)) !== canonicalJson(pendingDecision(result.state))) {
    errors.push('A saved state asks a different seat');
  }
  return errors;
}

/** §4.5/§8: a Rescue Starter is worth 0, untradeable and never resold in its own Sell Phase. */
function checkRescueNoCoinLoop({ before, result }: Step): string[] {
  if (!('accepted' in result)) return [];
  const errors: string[] = [];
  const events = result.events;
  const created = new Set(
    eventsOf(events, 'uid_created')
      .filter((event) => event.entity === 'pokemon')
      .map((event) => event.instanceId),
  );
  const rescues = new Set(
    before.players.flatMap((player) =>
      player.team.filter((pokemon) => pokemon.origin === 'rescue_starter').map((p) => p.instanceId),
    ),
  );
  events.forEach((event, index) => {
    if (event.kind !== 'uid_destroyed' || event.entity !== 'pokemon') return;
    if (created.has(event.instanceId)) errors.push('A Rescue Starter was resold in its own phase');
    const payment = events[index - 1];
    if (
      rescues.has(event.instanceId) &&
      payment?.kind === 'coin_transfer' &&
      payment.amount !== 0
    ) {
      errors.push('A Rescue Starter sold for coins');
    }
  });
  for (const player of result.state.players) {
    if (
      player.team.some(
        (pokemon) => pokemon.origin === 'rescue_starter' && pokemon.tradeable !== false,
      )
    ) {
      errors.push('A Rescue Starter is tradeable');
    }
  }
  return errors;
}

/** §8: a pending slow lasts until its owner's next actual move, never clearing at Start (D8). */
function checkMoveDebuffs({ before, parsed, result }: Step): string[] {
  if (!('accepted' in result)) return [];
  const errors: string[] = [];
  const ownMove =
    before.phase.kind === 'move' &&
    (parsed?.kind === 'dice_result' || parsed?.kind === 'roll' || parsed?.kind === 'skip');
  for (const player of before.players) {
    const after = result.state.players.find((entry) => entry.actorId === player.actorId);
    const was = player.pendingSlows ?? [];
    const now = after?.pendingSlows ?? [];
    const cleared = was.filter((slow) => !now.includes(slow));
    const moved = after && after.routeProgress !== player.routeProgress;
    if (cleared.length && !(ownMove && player.seatIndex === before.activeSeatIndex && moved))
      errors.push(`${player.actorId}'s pending slow cleared without its actual move`);
    if (ownMove && player.seatIndex === before.activeSeatIndex && moved && now.length)
      errors.push(`${player.actorId}'s actual move did not clear its pending slows`);
  }
  return errors;
}

/** §4.5: an instance fires once per Lap; only a qualifying owner Start credit makes it ready. */
function checkAbilityPerInstanceLap({ before, result }: Step): string[] {
  if (!('accepted' in result)) return [];
  const errors: string[] = [];
  const activations = eventsOf(result.events, 'ability_activated');
  const resets = eventsOf(result.events, 'abilities_reset');
  const paid = new Set(
    startIncome(result.events).map((event) =>
      event.destination.kind === 'player' ? event.destination.actorId : '',
    ),
  );
  for (const owner of before.players) {
    const after = result.state.players.find((player) => player.actorId === owner.actorId);
    for (const previous of owner.team) {
      const current = after?.team.find((pokemon) => pokemon.instanceId === previous.instanceId);
      const fired = activations.filter((event) => event.instanceId === previous.instanceId);
      if (fired.length > 1) errors.push('An instance activated twice in one action');
      if (fired.length && !previous.abilityReady)
        errors.push('An instance activated while not ready');
      if (!current) continue;
      const reset = resets.some(
        (event) =>
          event.ownerId === owner.actorId && event.instanceIds.includes(previous.instanceId),
      );
      if (!previous.abilityReady && current.abilityReady && (!reset || !paid.has(owner.actorId)))
        errors.push('An instance became ready without a qualifying Start credit');
      if (fired.length && current.abilityReady && !reset)
        errors.push('An activation did not spend its instance readiness');
    }
  }
  return errors;
}

/** §4.5: each player activates at most one Ability per globalTurnNo, reactions included. */
function checkAbilityPerPlayerTurn({ before, result }: Step): string[] {
  if (!('accepted' in result)) return [];
  const errors: string[] = [];
  const activations = eventsOf(result.events, 'ability_activated');
  for (const owner of before.players) {
    const after = result.state.players.find((player) => player.actorId === owner.actorId);
    const fired = activations.filter((event) => event.ownerId === owner.actorId);
    if (fired.length > 1) errors.push('A player activated twice in one action');
    if (fired.length && owner.abilityUsedGlobalTurnNo === before.globalTurnNo)
      errors.push('A player activated twice in one globalTurnNo');
    if (fired.length && after?.abilityUsedGlobalTurnNo !== before.globalTurnNo)
      errors.push('An activation did not spend the player allowance');
    if (!fired.length && after && after.abilityUsedGlobalTurnNo !== owner.abilityUsedGlobalTurnNo)
      errors.push('A player allowance changed without an activation');
  }
  return errors;
}

const S8_COINS = 'Coins never go negative, and every transfer has a source.';
const S8_START =
  'Start income is a sourced bank transfer; paid laps and rewarded-milestone watermarks never decrease. Payment precedes Sell, and destination resolution follows Sell. Forced movement never grants Start income.';
const S8_UIDS = 'UIDs are unique, and every creation or destruction is logged.';
const S8_REJECTED = 'Rejected or stale actions do not change state, and deals are atomic.';
const S8_REPLAY = 'Replay and resume never create assets or re-roll dice.';
const S8_ABILITIES =
  'Abilities fire ≤1 per instance per Lap and ≤1 per player turn, and evolution does not reset cooldowns.';
const S8_BATTLE =
  'A Battle Reward gives coins or evolution, never both. Evolution is one stage at a time on the same UID.';

/** Every spec §8 invariant; pending ones switch on when their rules land. */
export const INVARIANTS: readonly InvariantDefinition[] = [
  {
    id: 'pvp-turn-ownership',
    status: 'active',
    section: '§8',
    specLine:
      'PvP responses, dice and reward choices preserve the challenger’s active seat, global turn and every own-turn counter.',
    check: checkPvpOwnership,
  },
  {
    id: 'attack-attempt-logged',
    status: 'active',
    section: '§8',
    specLine:
      'Every PvP declaration records exactly one directed attack attempt; accepting, declining, rolling and rewarding add none.',
    check: checkAttackEvidence,
  },
  {
    id: 'coins-non-negative',
    status: 'active',
    section: '§8',
    specLine: S8_COINS,
    check: checkCoinsNonNegative,
  },
  {
    id: 'coin-transfer-sourced',
    status: 'active',
    section: '§8',
    specLine: S8_COINS,
    check: checkCoinTransfers,
  },
  {
    id: 'start-income-from-bank',
    status: 'active',
    section: '§8',
    specLine: S8_START,
    check: checkStartIncomeFromBank,
  },
  {
    id: 'credited-lap-monotonic',
    status: 'active',
    section: '§8',
    specLine: S8_START,
    check: checkCreditedLap,
  },
  {
    id: 'start-payment-precedes-sell',
    status: 'active',
    section: '§8',
    specLine: S8_START,
    check: checkStartPaymentOrder,
  },
  {
    id: 'forced-movement-no-start-income',
    status: 'active',
    section: '§8',
    specLine: S8_START,
    check: checkForcedMovementIncome,
  },
  {
    id: 'credited-lap-pays-once',
    status: 'active',
    section: '§6.5',
    specLine: 'Being pushed or pulled, or re-crossing an old milestone, gives no reward.',
    check: checkCreditedLapPaysOnce,
  },
  { id: 'uid-unique', status: 'active', section: '§8', specLine: S8_UIDS, check: checkUidUnique },
  {
    id: 'uid-lifecycle-logged',
    status: 'active',
    section: '§8',
    specLine: S8_UIDS,
    check: checkUidLifecycle,
  },
  {
    id: 'rejected-or-stale-unchanged',
    status: 'active',
    section: '§8',
    specLine: S8_REJECTED,
    check: checkRejectedOrStale,
  },
  {
    id: 'catch-consumes-one-ball',
    status: 'active',
    section: '§8',
    specLine: 'Every catch attempt consumes exactly 1 Ball, and releasing consumes none.',
    check: checkCatchBalls,
  },
  {
    id: 'replay-reproduces-state',
    status: 'active',
    section: '§8',
    specLine: S8_REPLAY,
    check: checkReplay,
  },
  {
    id: 'game-can-finish',
    status: 'active',
    section: '§8',
    specLine: 'The game can finish after an AI failure with any number of AIs.',
    check: checkGameCanFinish,
  },
  {
    id: 'deals-atomic',
    status: 'active',
    section: '§8',
    specLine: S8_REJECTED,
    check: checkDealsAtomic,
  },
  {
    id: 'move-debuff-until-next-move',
    status: 'active',
    check: checkMoveDebuffs,
    section: '§8',
    specLine: 'Move debuffs last until the next move.',
  },
  {
    id: 'tired-and-nurse-joy-useful',
    status: 'active',
    check: checkStatuses,
    section: '§8',
    specLine: 'Tired and Nurse Joy each have real use cases.',
  },
  {
    id: 'promise-closes-on-own-turn',
    status: 'active',
    check: checkPromiseClosure,
    section: '§8',
    specLine: 'Promises close on the correct `ownTurnNo`.',
  },
  {
    id: 'resume-creates-nothing',
    status: 'active',
    check: checkResumeCreatesNothing,
    section: '§8',
    specLine: S8_REPLAY,
  },
  {
    id: 'ability-once-per-instance-per-lap',
    status: 'active',
    check: checkAbilityPerInstanceLap,
    section: '§8',
    specLine: S8_ABILITIES,
  },
  {
    id: 'ability-once-per-player-turn',
    status: 'active',
    check: checkAbilityPerPlayerTurn,
    section: '§8',
    specLine: S8_ABILITIES,
  },
  {
    id: 'evolution-keeps-cooldowns',
    status: 'active',
    check: checkEvolutionFields,
    section: '§8',
    specLine: S8_ABILITIES,
  },
  {
    id: 'rescue-starter-no-coin-loop',
    status: 'active',
    check: checkRescueNoCoinLoop,
    section: '§8',
    specLine: 'Rescue Starters cannot create a coin loop.',
  },
  {
    id: 'battle-reward-coins-or-evolution',
    status: 'active',
    check: checkRewards,
    section: '§8',
    specLine: S8_BATTLE,
  },
  {
    id: 'evolution-one-stage-same-uid',
    status: 'active',
    check: checkEvolution,
    section: '§8',
    specLine: S8_BATTLE,
  },
];

/**
 * Checks one engine step against every active invariant. `apply` re-runs the step for the replay
 * invariant; tests pass a deliberately broken engine so each mutation trips only its invariant.
 */
export function createInvariantChecker(apply: ApplyActionFn = applyAction) {
  return (before: GameState, action: unknown, result: ApplyActionResult): Violation[] => {
    const parsed = actionSchema.safeParse(action);
    const step: Step = {
      before,
      parsed: parsed.success ? parsed.data : null,
      result,
      apply,
    };
    return INVARIANTS.flatMap((invariant) =>
      invariant.status === 'active'
        ? invariant.check(step).map((message) => ({ invariant: invariant.id, message }))
        : [],
    );
  };
}

const checkWithEngine = createInvariantChecker();

/** Pure: no IO, no randomness. Call after every `applyAction` with its input and result. */
export function checkInvariants(
  before: GameState,
  action: unknown,
  result: ApplyActionResult,
): Violation[] {
  return checkWithEngine(before, action, result);
}
