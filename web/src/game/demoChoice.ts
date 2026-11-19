import type { LegalAction, Observation } from '../../../engine/index.ts';
import type { DecisionDetail } from '../../../engine/contract/decision.ts';
import { t } from '../i18n/en.ts';
import { itemName, speciesName } from '../i18n/names.ts';
import type { OpponentAnswer } from './ai.ts';
import { currentForm } from './content.ts';

/** One option Jev was given, as the demo panel shows it. Every number is copied as received. */
export interface DemoRow {
  readonly id: string;
  readonly label: string;
  readonly probability: number;
  readonly chosen: boolean;
}

/**
 * What the demo-only "What Jev chose" panel shows for one AI decision (spec §11 step 3). It holds
 * labels and Jev's own numbers only: no observation, no action payload. It lives in the in-memory
 * feed and never in a save, an exported log or a request.
 */
export interface DemoChoice {
  readonly source: 'jev' | 'fallback';
  readonly fallbackReason?: string;
  /** Absent for a backup-bot decision, which asked Jev nothing. */
  readonly confidence?: number;
  /** The Sell Phase: Jev answers once per Pokémon, so the chances are independent. */
  readonly perPokemon: boolean;
  /** Most likely first; empty for a backup-bot decision. */
  readonly rows: readonly DemoRow[];
}

/** Decisions where no Jev question was asked and the game says nothing (spec §3). */
const SILENT_FALLBACKS = new Set(['auto', 'unsupported_decision_point']);

interface Context {
  readonly answer: OpponentAnswer;
  readonly detail: DecisionDetail | undefined;
  readonly decisionPoint: string;
  readonly enabledActions: readonly LegalAction[];
  /** The deciding AI seat's own observation: its items are private, which is what the demo shows. */
  readonly observation: Observation;
  /** The human seat reading the panel, so "You" and "AI rival" name the same seats as the board. */
  readonly viewerSeat: number;
}

const seatName = (seatIndex: number, viewerSeat: number) =>
  seatIndex === viewerSeat ? t('seat.you') : t('board.rivalLabel', { seat: seatIndex });

function optionLabel(action: LegalAction, { observation, viewerSeat }: Context): string {
  const { phase, players } = observation.public;
  const actor = players.find((player) => player.seatIndex === observation.own.seatIndex);
  switch (action.kind) {
    case 'use_item': {
      const owned = observation.own.items.find(
        (item) => item.instanceId === action.payload.itemInstanceId,
      );
      const item = owned ? itemName(owned.itemId) : t('demo.option.other');
      const { targetSeatIndex, targetPokemonInstanceId } = action.payload;
      const pokemon = actor?.team.find((member) => member.instanceId === targetPokemonInstanceId);
      if (pokemon)
        return t('demo.option.useItemOnPokemon', { item, pokemon: speciesName(pokemon.speciesId) });
      if (targetSeatIndex !== undefined)
        return t('demo.option.useItemOn', { item, target: seatName(targetSeatIndex, viewerSeat) });
      return t('demo.option.useItem', { item });
    }
    case 'activate_ability': {
      const member = actor?.team.find((entry) => entry.instanceId === action.payload.instanceId);
      const form = member ? currentForm(member.speciesId) : undefined;
      if (!form?.ability) return t('demo.option.other');
      const label = t('choice.ability', { ability: form.ability.name, pokemon: form.name });
      if (action.payload.scope === 'catch') return t('choice.abilityCatch', { label });
      if (action.payload.scope === 'combat') return t('choice.abilityCombat', { label });
      return label;
    }
    case 'skip':
      return t('demo.option.skip');
    case 'catch':
      return t('demo.option.catch', { ball: t(`board.ball.${action.payload.ballType}`) });
    case 'release':
      return t('demo.option.release', {
        pokemon: phase.kind === 'encounter' ? speciesName(phase.pokemon.speciesId) : '',
      });
    case 'skip_shop':
      return t('shop.skip');
    case 'buy': {
      const offer =
        phase.kind === 'shop'
          ? phase.offers.find((entry) => entry.id === action.payload.offerId)
          : undefined;
      return offer
        ? t(offer.price === 1 ? 'shop.buyOne' : 'shop.buy', {
            item: itemName(offer.itemId),
            price: offer.price,
          })
        : t('demo.option.other');
    }
    case 'declare_pvp':
      return t('demo.option.challenge', {
        target: seatName(action.payload.targetSeatIndex, viewerSeat),
      });
    default:
      return t('demo.option.other');
  }
}

/** Rows most likely first; equal chances keep the order Jev sent them in. */
const byProbability = (rows: DemoRow[]) =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.probability - a.row.probability || a.index - b.index)
    .map(({ row }) => row);

/**
 * The panel's data for one decision, or undefined when it shows nothing: no detail, one legal
 * action or a phase with no Jev question (spec §3), or a detail that does not match the options
 * this browser sent. The panel never invents an option and never shows one the browser did not
 * send, so a detail naming an unknown or repeated option is dropped whole, not trimmed.
 */
export function demoChoiceOf(context: Context): DemoChoice | undefined {
  const { answer, detail, decisionPoint, enabledActions } = context;
  if (answer.source === 'fallback') {
    const reason = answer.fallbackReason;
    if (reason === undefined || SILENT_FALLBACKS.has(reason)) return undefined;
    return { source: 'fallback', fallbackReason: reason, perPokemon: false, rows: [] };
  }
  if (!detail) return undefined;
  const ids = detail.options.map((option) => option.id);
  if (new Set(ids).size !== ids.length) return undefined;
  const perPokemon = decisionPoint === 'sell';
  const team =
    context.observation.public.players.find(
      (player) => player.seatIndex === context.observation.own.seatIndex,
    )?.team ?? [];
  const label = (id: string): string | undefined => {
    if (perPokemon) {
      const pokemon = team.find((member) => member.instanceId === id);
      const sellable = enabledActions.some(
        (action) => action.kind === 'sell' && action.payload.pokemonInstanceIds.includes(id),
      );
      return pokemon && sellable
        ? t('demo.option.sell', { pokemon: speciesName(pokemon.speciesId) })
        : undefined;
    }
    const action = enabledActions.find((entry) => entry.id === id);
    return action ? optionLabel(action, context) : undefined;
  };
  const chosenIds = 'choice' in answer ? [answer.choice] : answer.sellUids;
  const rows: DemoRow[] = [];
  for (const option of detail.options) {
    const text = label(option.id);
    if (text === undefined) return undefined;
    rows.push({
      id: option.id,
      label: text,
      probability: option.probability,
      chosen: chosenIds.includes(option.id),
    });
  }
  // The answer Jev gave must be among the options it is shown with.
  if (chosenIds.some((id) => !ids.includes(id))) return undefined;
  return {
    source: 'jev',
    confidence: detail.confidence ?? undefined,
    perPokemon,
    rows: byProbability(rows),
  };
}
