import type { LegalAction, Observation } from '../engine/index.ts';
import type { PolicyChoice } from '../sim/policy.ts';

/**
 * The listed action for this sale: the finish for none (an empty sale in the current engine,
 * `finish_sell` in older saves), the one-Pokémon sale, or a batch (the engine sells a batch of two
 * or more in one atomic step, §4.7). `undefined` when no listed action matches.
 */
export function sellChoice(
  enabled: readonly LegalAction[],
  sellUids: string[],
): PolicyChoice | undefined {
  if (sellUids.length === 0) {
    return enabled.find(
      (action) =>
        action.kind === 'finish_sell' ||
        (action.kind === 'sell' && action.payload.pokemonInstanceIds.length === 0),
    )?.id;
  }
  const sales = enabled.filter((action) => action.kind === 'sell');
  const single = (id: string) =>
    sales.find(
      (action) =>
        action.payload.pokemonInstanceIds.length === 1 &&
        action.payload.pokemonInstanceIds[0] === id,
    );
  if (!sellUids.every((id) => single(id))) return undefined;
  return sellUids.length === 1 ? single(sellUids[0]!)!.id : { sellUids };
}

/**
 * Spec §5.6, last Sell Phase: true when the engine says this is the seat's last Sell Phase and
 * the space it lands on after selling is not a Gym. Both are engine facts of the observation: the
 * announced Final Table Round (`finalTableRound`, so this Sell is on the seat's own last turn,
 * §4.7.3) and the Sell phase's `destinationPosition` read against the engine's `board`. Nothing
 * here knows which spaces are Gyms, and a destination the board does not list asks Jev as usual.
 */
export function sellsEverythingNow(observation: Observation): boolean {
  const { phase, finalTableRound, board } = observation.public;
  if (phase.kind !== 'sell' || finalTableRound === null) return false;
  const destination = board.find((space) => space.position === phase.destinationPosition);
  return destination !== undefined && destination.kind !== 'gym';
}

/**
 * The sale every personality makes in that Sell Phase, on the Jev path and the fallback alike:
 * every Pokémon the engine lists as sellable (§4.7). A kept Pokémon cannot be used again before
 * the game's own sale at half price with no class bonus (§4.7.3), unless a Gym follows, which is
 * the case this rule leaves to Jev. A Rescue Starter sells for nothing and the game does not pay
 * for one at its end, so it is never sold; a member the engine does not list is not sold either.
 * `undefined` when the rule does not apply, so the caller decides as for any Sell Phase.
 */
export function lastSellChoice(
  observation: Observation,
  enabled: readonly LegalAction[],
): PolicyChoice | undefined {
  if (!sellsEverythingNow(observation)) return undefined;
  const you = observation.public.players.find(
    (player) => player.seatIndex === observation.own.seatIndex,
  );
  if (!you) return undefined;
  const listed = new Set(
    enabled.flatMap((action) =>
      action.kind === 'sell' && action.payload.pokemonInstanceIds.length === 1
        ? action.payload.pokemonInstanceIds
        : [],
    ),
  );
  const ids = you.team
    .filter((pokemon) => pokemon.origin !== 'rescue_starter' && listed.has(pokemon.instanceId))
    .map((pokemon) => pokemon.instanceId);
  return sellChoice(enabled, ids);
}
