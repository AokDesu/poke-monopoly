import type {
  BattleChoicePreview,
  BattlePreview,
  CombatantSnapshot,
} from '../../../engine/index.ts';
import { t } from '../i18n/en.ts';
import { speciesName } from '../i18n/names.ts';
import { chancesFor } from './battle.ts';
import { seatLabel } from './labels.ts';

type Terms = Pick<BattlePreview | BattleChoicePreview, 'kind' | 'snapshot' | 'odds'>;
type Side = CombatantSnapshot;

/** The words for one chance line: win, tie and lose at a PvP battle, win alone at a Gym. */
export function chancesText(terms: Terms, viewerSeat: number): string {
  const chances = chancesFor(terms, viewerSeat);
  return chances.tie === undefined
    ? t('battle.chance.gym', { win: chances.win })
    : t('battle.chance.pvp', { win: chances.win, tie: chances.tie, lose: chances.lose ?? 0 });
}

const ROWS = [
  ['battle.term.battle', (side: Side) => side.member.effectiveBattle],
  ['battle.term.class', (side: Side) => side.classBonus],
  ['battle.term.ability', (side: Side) => side.abilityBonus],
  ['battle.term.item', (side: Side) => side.itemBonus],
  ['battle.term.debuff', (side: Side) => side.debuffs],
] as const;

/**
 * The engine's battle terms and exact chances before the roll (spec §3, §4.4): one column per
 * side, every figure copied from the snapshot, never added up here. A frozen snapshot is the
 * one the dice use; before that, the figures count only what is set so far.
 */
export function BattleTerms({
  terms,
  viewerSeat,
  frozen,
  forced,
}: {
  terms: Terms;
  viewerSeat: number;
  frozen: boolean;
  /** Why the challenge cannot be declined, when it is forced. */
  forced?: string;
}) {
  const { snapshot } = terms;
  const sides: Side[] =
    snapshot.kind === 'gym'
      ? [snapshot.challenger]
      : // The viewer's own side leads; a seat outside the battle reads attacker first.
        snapshot.defender.seatIndex === viewerSeat
        ? [snapshot.defender, snapshot.attacker]
        : [snapshot.attacker, snapshot.defender];
  return (
    <section className="battle-terms" aria-label={t('battle.terms')}>
      <h3>
        {snapshot.kind === 'gym' ? t('battle.termsGym', { dc: snapshot.dc }) : t('battle.terms')}
      </h3>
      <table>
        <thead>
          <tr>
            <td />
            {sides.map((side) => (
              <th scope="col" key={side.seatIndex}>
                {seatLabel(side.seatIndex, viewerSeat)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{t('battle.term.pokemon')}</th>
            {sides.map((side) => (
              <td key={side.seatIndex}>{speciesName(side.member.speciesId)}</td>
            ))}
          </tr>
          {ROWS.map(([label, read]) => (
            <tr key={label}>
              <th scope="row">{t(label)}</th>
              {sides.map((side) => (
                <td key={side.seatIndex}>{read(side)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="battle-chances" role="status">
        <strong>{seatLabel(chancesFor(terms, viewerSeat).seatIndex, viewerSeat)}</strong>
        {': '}
        {chancesText(terms, viewerSeat)}
      </p>
      <p className="panel-note">{t(frozen ? 'battle.frozen' : 'battle.notFrozen')}</p>
      {forced && <p className="battle-forced">{t('battle.forcedBy', { source: forced })}</p>}
    </section>
  );
}
