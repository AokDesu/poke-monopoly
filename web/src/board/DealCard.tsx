import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { DealTerms, ItemInstance, LegalActions, Observation } from '../../../engine/index.ts';
import { speciesType, type PokemonType } from '../game/content.ts';
import {
  dealOfferThisTurn,
  dealOptions,
  dealOutcomeThisTurn,
  pendingDeal,
  readTerms,
  type DealAsset,
  type DealDirection,
} from '../game/deals.ts';
import type { ConfirmDealResult, SeatFeedEntry } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { itemName, memberName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { TypeOrb } from '../ui/TypeOrb.tsx';
import { DecisionCard, Folded, foldLabel, useCardLive, useInView } from './DecisionCard.tsx';
import { itemEffectLine } from './ItemFacts.tsx';
import './deal-card.css';

export interface DealCardProps {
  observation: Observation;
  legalActions: LegalActions;
  feed: readonly SeatFeedEntry[];
  rivalName: (seatIndex: number) => string;
  /** Leaves the builder for the Social window. */
  onBack: () => void;
  /** Submits one of the engine's own enabled choices by its ID (a proposal, Walk away, Continue). */
  onChoose: (id: string) => void;
  /** The final Confirm, for the terms and revision on screen. */
  onConfirm: (shown: { revision: number; terms: DealTerms }) => ConfirmDealResult;
}

const coinsText = (count: number) => t(count === 1 ? 'deal.coinsOne' : 'deal.coinsMany', { count });
const assetKey = (asset: DealAsset) => `${asset.kind}:${asset.instanceId}`;
const unique = <T,>(values: readonly T[]) => [...new Set(values)];

/** How a card names the assets it shows: who a Pokémon is and, for an item, what it does. */
interface Assets {
  pokemon(instanceId: string): { name: string; type: PokemonType | undefined; tired: boolean };
  item(instanceId: string): { name: string; effect: string | undefined; secret: boolean };
}

function assetsOf(observation: Observation, revealed?: ItemInstance): Assets {
  const { players } = observation.public;
  return {
    pokemon: (instanceId) => {
      const team = players.find((player) =>
        player.team.some((entry) => entry.instanceId === instanceId),
      )?.team;
      const member = team?.find((entry) => entry.instanceId === instanceId);
      return {
        name: team ? memberName(team, instanceId) : t('team.memberUnknown'),
        type: member ? speciesType(member.speciesId) : undefined,
        tired: member?.tired === true,
      };
    },
    item: (instanceId) => {
      // The engine's own record of the offered item first; then only an item this seat holds or a rival shows.
      const item =
        (revealed?.instanceId === instanceId ? revealed : undefined) ??
        observation.own.items.find((entry) => entry.instanceId === instanceId) ??
        players
          .flatMap((player) => player.knownItems)
          .find((entry) => entry.instanceId === instanceId);
      return item
        ? {
            name: itemName(item.itemId),
            effect: itemEffectLine(item.itemId),
            secret: item.visibility === 'secret',
          }
        : { name: t('deal.itemUnknown'), effect: undefined, secret: false };
    },
  };
}

function AssetLine({
  asset,
  assets,
  rival,
}: {
  asset: DealAsset;
  assets: Assets;
  /** The rival who is shown a secret item of the player's own; absent where nothing is being offered. */
  rival?: string;
}) {
  if (asset.kind === 'pokemon') {
    const pokemon = assets.pokemon(asset.instanceId);
    return (
      <span className="deal-asset-line">
        {pokemon.type && <TypeOrb type={pokemon.type} className="size-8" />}
        <span>
          <strong>{pokemon.name}</strong>
          {pokemon.tired && <small>{t('board.tired')}</small>}
        </span>
      </span>
    );
  }
  const item = assets.item(asset.instanceId);
  return (
    <span className="deal-asset-line">
      <span className="item-capsule" aria-hidden="true" />
      <span>
        <strong>{item.name}</strong>
        {item.effect && <small>{item.effect}</small>}
        {rival && item.secret && <small>{t('deal.shownOnly', { rival })}</small>}
      </span>
    </span>
  );
}

/**
 * The ledger: what the player gives and what it gets, always from the player's own side. After a counter it
 * shows the first price struck out beside the new one; only the current price is ever confirmed.
 */
function Terms({
  terms,
  assets,
  rival,
  heading = t('deal.terms'),
  past = false,
  offered,
  focusRef,
}: {
  terms: DealTerms;
  assets: Assets;
  rival: string;
  heading?: string;
  past?: boolean;
  offered?: number;
  focusRef?: RefObject<HTMLElement | null>;
}) {
  const { direction, asset, coins } = readTerms(terms);
  const assetPart = (
    <AssetLine asset={asset} assets={assets} rival={direction === 'sell' ? rival : undefined} />
  );
  const coinPart = <strong className="deal-coins">{coinsText(coins)}</strong>;
  const give = direction === 'sell' ? assetPart : coinPart;
  const get = direction === 'sell' ? coinPart : assetPart;
  return (
    <section
      ref={focusRef}
      tabIndex={-1}
      className="deal-terms"
      aria-label={heading}
      data-deal-terms=""
      data-direction={direction}
    >
      <h3>{heading}</h3>
      <div className="deal-ledger">
        <div className="deal-side" data-side="give">
          <span className="deal-side-label">{t(past ? 'deal.youGave' : 'deal.youGive')}</span>
          {give}
        </div>
        <div className="deal-side" data-side="get">
          <span className="deal-side-label">{t(past ? 'deal.youGot' : 'deal.youGet')}</span>
          {get}
        </div>
      </div>
      {offered !== undefined && offered !== coins && (
        <p className="deal-price-change" data-deal-counter="">
          <s>
            {t('deal.yourOffer')}: {coinsText(offered)}
          </s>
          <span>
            <span className="deal-new">{t('deal.newPrice')}</span> {coinsText(coins)}
          </span>
        </p>
      )}
    </section>
  );
}

/**
 * The Deal Card (spec §4.8; issue #138): one Pokémon or one item against coins with one rival. The builder
 * offers only what the engine lists, a proposal it will not allow is greyed out with the engine's own
 * reason, and the review shows the terms in force. Only the player's own Confirm commits; the rival's yes or
 * a new price never does, and nothing here says how the rival's answer was reached.
 */
export function DealCard({
  observation,
  legalActions,
  feed,
  rivalName,
  onBack,
  onChoose,
  onConfirm,
}: DealCardProps) {
  const live = useCardLive();
  const { globalTurnNo } = observation.public;
  const pending = pendingDeal(observation);
  const outcome = pending ? null : dealOutcomeThisTurn(feed, globalTurnNo);
  const offer = dealOfferThisTurn(feed, globalTurnNo);
  const assets = assetsOf(
    observation,
    pending?.revealedItem ?? outcome?.revealedItem ?? offer?.revealedItem,
  );
  const cancel = legalActions.enabled.find((action) => action.kind === 'cancel_deal');
  const confirmListed = legalActions.enabled.some((action) => action.kind === 'confirm_deal');
  const proceed = legalActions.enabled.find((action) => action.kind === 'skip');
  const focus = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // A Confirm that was refused, or terms that moved while this review was open, ask for another look.
  const [stale, setStale] = useState(false);
  const reviewKey =
    pending && pending.stage !== 'proposed'
      ? JSON.stringify([pending.stage, confirmListed, readTerms(pending.terms)])
      : null;
  const lastReview = useRef<string | null>(null);
  useEffect(() => {
    if (lastReview.current !== null && reviewKey !== null && lastReview.current !== reviewKey) {
      setStale(true);
    }
    lastReview.current = reviewKey;
  }, [reviewKey]);

  // The player's eyes follow the state: the terms for a review or a result, the card for the builder.
  const stateKey = pending ? `${pending.stage}:${reviewKey}` : outcome ? outcome.kind : 'build';
  useEffect(() => {
    if (!live) return;
    (focus.current ?? body.current?.closest<HTMLElement>('.decision-card'))?.focus();
  }, [live, stateKey]);

  if (pending) {
    const rival = rivalName(pending.rivalSeatIndex);
    const { direction, coins } = readTerms(pending.terms);
    const original = offer ? readTerms(offer.terms).coins : undefined;
    const blocked = pending.stage !== 'proposed' && !confirmListed;
    const lead =
      pending.stage === 'proposed'
        ? t('deal.lead.waiting', { rival })
        : blocked
          ? t('deal.lead.blocked')
          : pending.stage === 'accepted'
            ? t('deal.lead.accepted', { rival })
            : t(direction === 'buy' ? 'deal.lead.countered.asks' : 'deal.lead.countered.offers', {
                rival,
                coins: coinsText(coins),
              });
    const confirm = () => {
      setStale(false);
      const result = onConfirm({
        revision: observation.public.stateRevision,
        terms: pending.terms,
      });
      if ('stale' in result) setStale(true);
    };
    return (
      <DecisionCard
        kind="deal"
        heading={t('deal.heading')}
        lead={lead}
        actions={
          pending.stage === 'proposed' ? undefined : (
            <>
              {!blocked && (
                <ActionButton enabled variant="primary" data-deal-confirm="" onClick={confirm}>
                  {t('deal.confirmPrice', { coins: coinsText(coins) })}
                </ActionButton>
              )}
              {cancel && (
                <ActionButton
                  enabled
                  variant="secondary"
                  data-deal-cancel=""
                  onClick={() => onChoose(cancel.id)}
                >
                  {t('deal.cancel')}
                </ActionButton>
              )}
            </>
          )
        }
      >
        <div className="deal-body" ref={body} data-deal-stage={blocked ? 'blocked' : pending.stage}>
          {stale && (
            <p className="card-alert" role="alert" data-deal-stale="">
              {t('deal.stale')}
            </p>
          )}
          {blocked && <p className="deal-with">{t('deal.with', { rival })}</p>}
          <Terms
            terms={pending.terms}
            assets={assets}
            rival={rival}
            offered={pending.stage === 'countered' ? original : undefined}
            focusRef={focus}
          />
          <p className="panel-note" data-deal-only-confirm="">
            {t('deal.reconfirmAfterFallback')}
          </p>
        </div>
      </DecisionCard>
    );
  }

  if (outcome) {
    const rival = rivalName(outcome.rivalSeatIndex);
    const done = outcome.kind === 'committed';
    return (
      <DecisionCard
        kind="deal"
        heading={t('deal.heading')}
        lead={t(`deal.lead.${outcome.kind}`, { rival })}
        actions={
          proceed && (
            <ActionButton
              enabled
              variant="primary"
              data-primary=""
              onClick={() => onChoose(proceed.id)}
            >
              {t('social.continue')}
            </ActionButton>
          )
        }
      >
        <div className="deal-body" ref={body} data-deal-stage={outcome.kind}>
          <Terms
            terms={outcome.terms}
            assets={assets}
            rival={rival}
            heading={done ? t('deal.done') : t('deal.yourOffer')}
            past={done}
            focusRef={focus}
          />
        </div>
      </DecisionCard>
    );
  }

  return (
    <Builder
      observation={observation}
      legalActions={legalActions}
      assets={assets}
      rivalName={rivalName}
      onBack={onBack}
      onChoose={onChoose}
      body={body}
    />
  );
}

/** One row of choices with its label beside it, so the builder's controls take as little height as they can. */
function PickRow({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="deal-pick" role="group" aria-labelledby={id}>
      <span className="deal-pick-label" id={id}>
        {label}
      </span>
      <div className="deal-pick-choices">{children}</div>
    </div>
  );
}

/** The proposal builder: rival, direction, one asset, one price. Every pick is a proposal the engine listed. */
function Builder({
  observation,
  legalActions,
  assets,
  rivalName,
  onBack,
  onChoose,
  body,
}: Pick<DealCardProps, 'observation' | 'legalActions' | 'rivalName' | 'onBack' | 'onChoose'> & {
  assets: Assets;
  body: RefObject<HTMLDivElement | null>;
}) {
  const options = dealOptions(legalActions);
  const listed = options.filter((option) => option.reason === undefined);
  const rivals = unique(options.map((option) => option.rivalSeatIndex)).toSorted((a, b) => a - b);
  const [rivalPick, setRivalPick] = useState<number>();
  const [directionPick, setDirectionPick] = useState<DealDirection>();
  const [assetPick, setAssetPick] = useState<string>();
  const [coinsPick, setCoinsPick] = useState<number>();

  const rival = rivalPick !== undefined && rivals.includes(rivalPick) ? rivalPick : rivals[0];
  const forRival = options.filter((option) => option.rivalSeatIndex === rival);
  const directionsListed = (['sell', 'buy'] as const).filter((direction) =>
    forRival.some((option) => option.direction === direction && option.reason === undefined),
  );
  const direction =
    directionPick ?? (directionsListed.includes('sell') ? 'sell' : (directionsListed[0] ?? 'sell'));
  const here = forRival.filter((option) => option.direction === direction);
  const assetsHere = unique(here.map((option) => assetKey(option.asset))).map((key) => {
    const rungs = here.filter((option) => assetKey(option.asset) === key);
    return {
      key,
      asset: rungs[0]!.asset,
      rungs,
      offered: rungs.filter((option) => !option.reason),
    };
  });
  const tradable = assetsHere.filter((entry) => entry.offered.length > 0);
  const folded = assetsHere.filter((entry) => entry.offered.length === 0);
  const picked = tradable.find((entry) => entry.key === assetPick);
  const chosen = picked?.offered.find((option) => option.coins === coinsPick);
  // The terms of the chosen proposal come into view when they appear, so the player sees what Send will offer.
  const previewRef = useInView<HTMLDivElement>(chosen?.id);
  const rivalLabel = rival === undefined ? '' : rivalName(rival);
  const you = observation.own.seatIndex;
  const players = observation.public.players;
  const balance =
    direction === 'sell'
      ? t('deal.balance.rival', {
          rival: rivalLabel,
          coins: coinsText(players.find((player) => player.seatIndex === rival)?.coins ?? 0),
        })
      : t('deal.balance.you', {
          coins: coinsText(players.find((player) => player.seatIndex === you)?.coins ?? 0),
        });
  const priceReasons = unique(
    (picked?.rungs ?? []).flatMap((option) => (option.reason ? [option.reason.text] : [])),
  );
  const asked =
    direction === 'sell'
      ? [
          { label: t('deal.group.ownPokemon'), kind: 'pokemon' as const },
          { label: t('deal.group.ownItems'), kind: 'item' as const },
        ]
      : [
          { label: t('deal.group.theirPokemon', { rival: rivalLabel }), kind: 'pokemon' as const },
          { label: t('deal.group.theirItems', { rival: rivalLabel }), kind: 'item' as const },
        ];
  const missing =
    picked === undefined ? 'deal.reason.chooseAsset' : ('deal.reason.choosePrice' as const);

  return (
    <DecisionCard
      kind="deal"
      heading={t('deal.heading')}
      lead={t('deal.lead.build')}
      actions={
        <>
          {listed.length === 0 ? null : chosen ? (
            <ActionButton
              enabled
              data-primary=""
              data-deal-send=""
              onClick={() => onChoose(chosen.id)}
            >
              {t('deal.send')}
            </ActionButton>
          ) : (
            <ActionButton enabled={false} data-deal-send="" reasonText={t(missing)}>
              {t('deal.send')}
            </ActionButton>
          )}
          <ActionButton enabled variant="secondary" data-deal-back="" onClick={onBack}>
            {t('deal.back')}
          </ActionButton>
        </>
      }
    >
      <div className="deal-body" ref={body} data-deal-stage="build">
        {listed.length === 0 ? (
          <>
            <p className="panel-note">{t('deal.none')}</p>
            <ul className="deal-reasons">
              {unique(options.map((option) => option.reason?.text ?? '')).map((text) => (
                <li key={text}>{t('action.engineReason', { reason: text })}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {rivals.length > 1 ? (
              <PickRow label={t('deal.rival')}>
                {rivals.map((seat) => (
                  <ActionButton
                    key={seat}
                    enabled
                    variant={rival === seat ? 'reward' : 'secondary'}
                    aria-pressed={rival === seat}
                    onClick={() => {
                      setRivalPick(seat);
                      setAssetPick(undefined);
                      setCoinsPick(undefined);
                    }}
                  >
                    {rivalName(seat)}
                  </ActionButton>
                ))}
              </PickRow>
            ) : (
              <p className="deal-with">{t('deal.with', { rival: rivalLabel })}</p>
            )}
            <PickRow label={t('deal.direction')}>
              {(['sell', 'buy'] as const).map((entry) =>
                directionsListed.includes(entry) ? (
                  <ActionButton
                    key={entry}
                    enabled
                    variant={direction === entry ? 'reward' : 'secondary'}
                    aria-pressed={direction === entry}
                    onClick={() => {
                      setDirectionPick(entry);
                      setAssetPick(undefined);
                      setCoinsPick(undefined);
                    }}
                  >
                    {t(`deal.direction.${entry}`)}
                  </ActionButton>
                ) : (
                  <ActionButton
                    key={entry}
                    enabled={false}
                    variant="secondary"
                    reasonText={t('action.engineReason', {
                      reason:
                        forRival.find((option) => option.direction === entry)?.reason?.text ??
                        t('deal.none'),
                    })}
                  >
                    {t(`deal.direction.${entry}`)}
                  </ActionButton>
                ),
              )}
            </PickRow>
            {asked.map(({ label, kind }) => {
              const group = tradable.filter((entry) => entry.asset.kind === kind);
              if (group.length === 0) return null;
              return (
                <fieldset className="social-group deal-assets" key={kind} role="radiogroup">
                  <legend>{label}</legend>
                  {group.map((entry) => (
                    <label
                      className="deal-asset"
                      key={entry.key}
                      data-selected={entry.key === assetPick ? 'true' : undefined}
                    >
                      <input
                        type="radio"
                        name="deal-asset"
                        checked={entry.key === assetPick}
                        onChange={() => {
                          setAssetPick(entry.key);
                          setCoinsPick(undefined);
                        }}
                      />
                      <AssetLine
                        asset={entry.asset}
                        assets={assets}
                        rival={direction === 'sell' ? rivalLabel : undefined}
                      />
                    </label>
                  ))}
                </fieldset>
              );
            })}
            {folded.length > 0 && (
              <Folded label={foldLabel(folded.length, 'deals')}>
                <ul className="deal-reasons">
                  {folded.map((entry) => (
                    <li key={entry.key}>
                      <AssetLine asset={entry.asset} assets={assets} />
                      <span>
                        {t('action.engineReason', { reason: entry.rungs[0]!.reason?.text ?? '' })}
                      </span>
                    </li>
                  ))}
                </ul>
              </Folded>
            )}
            {direction === 'buy' && (
              <p className="panel-note">{t('deal.secretNote', { rival: rivalLabel })}</p>
            )}
            {direction === 'sell' &&
              picked?.asset.kind === 'item' &&
              assets.item(picked.asset.instanceId).secret && (
                <p className="panel-note">{t('deal.revealNote', { rival: rivalLabel })}</p>
              )}
            {picked && (
              <fieldset className="social-group deal-price" role="radiogroup">
                <legend>{t('deal.price')}</legend>
                <div className="deal-chips">
                  {picked.offered.map((option) => (
                    <label
                      className="deal-chip"
                      key={option.id}
                      data-selected={option.coins === coinsPick ? 'true' : undefined}
                    >
                      <input
                        type="radio"
                        name="deal-price"
                        checked={option.coins === coinsPick}
                        onChange={() => setCoinsPick(option.coins)}
                      />
                      <span>{coinsText(option.coins)}</span>
                    </label>
                  ))}
                </div>
                <p className="panel-note">{balance}</p>
                {priceReasons.map((text) => (
                  <p className="panel-note" key={text} data-deal-price-reason="">
                    {t('action.engineReason', { reason: text })}
                  </p>
                ))}
              </fieldset>
            )}
            {chosen && (
              <div ref={previewRef}>
                <Terms
                  terms={{ give: chosen.payload.give, get: chosen.payload.get }}
                  assets={assets}
                  rival={rivalLabel}
                />
              </div>
            )}
          </>
        )}
      </div>
    </DecisionCard>
  );
}
