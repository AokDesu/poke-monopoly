import type { LegalAction, LegalActions, Observation } from '../../engine/index.ts';
import type { PolicyChoice, SeatFacts } from '../policy.ts';

/**
 * One decision at which an exploit's rule had something to act on (`kind`), and whether the
 * decision took it (`used`). Reporting only: it reads what the policy was handed (§5.2), never the
 * game state, and it is computed the same way for both arms of a block, so the control arm's
 * count of opportunities is comparable with the treatment arm's (§8 Critic, vacuity rule).
 */
export type Moment = { kind: string; used: boolean };

function chosen(legal: LegalActions, picked: PolicyChoice): LegalAction | undefined {
  return typeof picked === 'string' ? legal.enabled.find((c) => c.id === picked) : undefined;
}

const isSale = (choice: LegalAction | undefined) => choice?.kind === 'sell';

function sellsNothing(choice: LegalAction | undefined): boolean {
  return (
    choice?.kind === 'finish_sell' ||
    (choice?.kind === 'sell' && choice.payload.pokemonInstanceIds.length === 0)
  );
}

/** The moment an exploit policy `policyId` faced at this decision, or `undefined` for none. */
export function exploitMoment(
  policyId: string,
  observation: Observation,
  legal: LegalActions,
  facts: SeatFacts | undefined,
  picked: PolicyChoice,
): Moment | undefined {
  const { enabled } = legal;
  const pick = chosen(legal, picked);
  switch (policyId) {
    case 'always-pvp': {
      const accept = enabled.some((c) => c.kind === 'respond_pvp' && c.payload.accept);
      if (accept)
        return { kind: 'accept', used: pick?.kind === 'respond_pvp' && pick.payload.accept };
      const voluntary = (c: LegalAction | undefined) =>
        c?.kind === 'declare_pvp' && c.payload.force === undefined;
      return enabled.some(voluntary) ? { kind: 'challenge', used: voluntary(pick) } : undefined;
    }
    case 'force-weak-target': {
      const force = (id: string | undefined) => {
        const source = id === undefined ? undefined : facts?.challenge?.[id]?.source;
        return source !== undefined && source !== 'voluntary';
      };
      return enabled.some((c) => force(c.id))
        ? { kind: 'force', used: force(pick?.id) }
        : undefined;
    }
    case 'immediate-ability':
      return enabled.some((c) => c.kind === 'activate_ability')
        ? { kind: 'ability', used: pick?.kind === 'activate_ability' }
        : undefined;
    case 'sell-all': {
      const sales = enabled.filter(
        (c) => c.kind === 'sell' && c.payload.pokemonInstanceIds.length > 0,
      );
      if (sales.length === 0) return undefined;
      const sold =
        typeof picked !== 'string'
          ? picked.sellUids.length > 0
          : isSale(pick) && !sellsNothing(pick);
      return { kind: 'sell', used: sold };
    }
    case 'keep-to-evolve': {
      if (enabled.some((c) => c.kind === 'choose_reward' && c.payload.kind === 'evolve')) {
        return {
          kind: 'evolve',
          used: pick?.kind === 'choose_reward' && pick.payload.kind === 'evolve',
        };
      }
      return enabled.some((c) => c.kind === 'sell')
        ? { kind: 'keep', used: typeof picked === 'string' && sellsNothing(pick) }
        : undefined;
    }
    case 'ultra-only': {
      const { phase } = observation.public;
      if (phase.kind !== 'shop') return undefined;
      const ultra = new Set(
        phase.offers.flatMap((o) => (o.kind === 'ball' && o.ballType === 'ultra' ? [o.id] : [])),
      );
      const isUltra = (c: LegalAction | undefined) =>
        c?.kind === 'buy' && ultra.has(c.payload.offerId);
      return enabled.some(isUltra) ? { kind: 'ultra', used: isUltra(pick) } : undefined;
    }
    case 'never-negotiate': {
      if (enabled.some((c) => c.kind === 'respond')) {
        return {
          kind: 'respond',
          used: pick?.kind === 'respond' && pick.payload.answer === 'reject',
        };
      }
      return enabled.some((c) => c.kind === 'chat' || c.kind === 'offer_promise')
        ? { kind: 'offer', used: pick?.kind === 'skip' }
        : undefined;
    }
    default:
      return undefined;
  }
}
