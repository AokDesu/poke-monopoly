import type { SaleQuote } from '../../../engine/index.ts';
import { inSocialWindow, sentThisTurn } from '../game/chat.ts';
import { answerThisTurn, rivalOwesAnswer } from '../game/promises.ts';
import type { SeatView } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { className } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { DieFace } from '../ui/DieFace.tsx';
import { AiTurn, PaceButtons, usePaceKeys } from './AiTurn.tsx';
import { BattlePanel } from './BattlePanel.tsx';
import { BattleResult } from './BattleResult.tsx';
import { BattleTerms } from './BattleTerms.tsx';
import { battleCopy, forcedSource } from './battle.ts';
import { CardFrameProvider, DecisionCard } from './DecisionCard.tsx';
import { EncounterCard } from './EncounterCard.tsx';
import { latestEvent } from './eventCard.ts';
import { JevChoicePanel } from './JevChoicePanel.tsx';
import { phaseLabel } from './labels.ts';
import { SellPanel } from './SellPanel.tsx';
import { ShopPanel } from './ShopPanel.tsx';
import { ChoicePanel } from './ChoicePanel.tsx';
import { StrategyPanel } from './StrategyPanel.tsx';
import { SocialPanel } from './SocialPanel.tsx';
import type { ChatReplyControls } from './useChatReply.ts';
import { turnMessages } from './turnMessages.ts';
import type { TurnPlayback } from './useTurnPlayback.ts';

const NO_REPLY: ChatReplyControls = { state: { status: 'none' }, retry: () => {} };

export interface TurnPanelProps {
  view: SeatView;
  playback: TurnPlayback;
  /** A one-time notice (a resumed save); the screen decides when it still applies. */
  notice?: string;
  /** The last human command was rejected for the current revision. */
  actionError: boolean;
  onChoose: (id: string) => void;
  onFinished?: () => void;
  /** The reply to this turn's topic message; absent where no window is open (the gallery). */
  social?: ChatReplyControls;
  /** The engine's quote for a Sell selection; with `onSell`, the Sell card can be shown. */
  quoteSale?: (ids: string[]) => SaleQuote;
  /** Sells one batch (an empty one keeps the whole team). */
  onSell?: (ids: string[]) => void;
  /** Dev gallery only: the card takes no focus and no key, so many cards can share one page. */
  inline?: boolean;
}

/**
 * The decision slot (spec §3, Board screen; issue #256): one card for what the viewing seat may do
 * now, or the rival's turn with its pace buttons. It routes to the card the engine's phase and
 * legal actions call for, from the viewing seat's own view only; around every card it keeps a
 * rejected action, a resume notice, the latest battle and the AI notes.
 */
export function TurnPanel({
  view,
  playback,
  notice,
  actionError,
  onChoose,
  onFinished,
  social = NO_REPLY,
  quoteSale,
  onSell,
  inline = false,
}: TurnPanelProps) {
  const { public: game } = view.observation;
  const finished = game.phase.kind === 'finished';
  const humanTurn = game.activeSeatIndex === view.seatIndex;
  const rivalTurn = !finished && !humanTurn;
  // Space is Next during a rival's turn and while the player's own result is held; P pauses a
  // rival's turn. A gallery card takes no key.
  usePaceKeys(playback, {
    next: !inline && (rivalTurn || playback.holding),
    pause: !inline && rivalTurn,
  });
  // A PvP or Gym battle has its own card for every decision, owned by the engine's pending seat
  // (the defender and the reward winner included), whoever holds the turn (§6.4).
  const battle = battleCopy(view);
  const owner = view.decision?.seatIndex === view.seatIndex;
  const gymEntry =
    game.phase.kind === 'gym' &&
    game.phase.battle.step === 'entry' &&
    view.legalActions.disabled.some((action) => action.kind === 'challenge_gym');
  const battleOpen = battle !== null && owner && (view.legalActions.enabled.length > 1 || gymEntry);
  // Ability windows and rerolls outside a battle (a move or catch die) list the engine's choices.
  const socialOpen = inSocialWindow(view);
  const encounterOpen = humanTurn && game.phase.kind === 'encounter' && !game.phase.catchRoll;
  const sellOpen = humanTurn && game.phase.kind === 'sell' && quoteSale && onSell;
  const choiceOpen =
    battle === null &&
    view.legalActions.enabled.length > 1 &&
    !socialOpen &&
    !['shop', 'strategy', 'sell'].includes(game.phase.kind) &&
    !(game.phase.kind === 'encounter' && !game.phase.catchRoll);
  const lastSale = view.feed.findLast(
    ({ before }) => before.activeSeatIndex === view.seatIndex && before.phase.kind === 'sell',
  );
  const receivedRescue = lastSale?.record.events.some(
    (event) => event.kind === 'uid_created' && event.entity === 'pokemon',
  );
  const frame = {
    live: !inline,
    notices: (actionError || notice) && (
      <>
        {actionError && (
          <p className="card-alert" role="alert">
            {t('turn.actionError')}
          </p>
        )}
        {notice && (
          <p className="turn-banner" role="status">
            {notice}
          </p>
        )}
      </>
    ),
    trailing: (
      <>
        <JevChoicePanel view={view} />
        <BattleResult view={view} />
        {receivedRescue && (
          <p className="rescue-preview" role="status">
            {t('sell.rescueStarter')}
          </p>
        )}
        <AiTurn view={view} playback={playback} />
      </>
    ),
  };

  let card;
  if (finished) {
    card = (
      <DecisionCard
        kind="finished"
        heading={t('board.finished')}
        lead={t('turn.finished')}
        actions={
          onFinished && (
            <ActionButton enabled data-primary="" onClick={onFinished}>
              {t('nav.results')}
            </ActionButton>
          )
        }
      />
    );
  } else if (playback.failed) {
    card = (
      <DecisionCard
        kind="retry"
        heading={humanTurn ? phaseLabel(game.phase.kind) : t('turn.opponent')}
        lead={t('turn.opponentError')}
        alert
        actions={
          <ActionButton enabled data-primary="" onClick={playback.retry}>
            {t('turn.retry')}
          </ActionButton>
        }
      />
    );
  } else if (encounterOpen) {
    // The encounter card (e1) is what opened an encounter: no Wild square and Event card share a
    // turn. Any other card drawn this turn is not the encounter's source.
    const drawn = latestEvent(view.feed, view.observation);
    card = (
      <EncounterCard
        key={game.stateRevision}
        observation={view.observation}
        legalActions={view.legalActions}
        catchOdds={view.catchOdds}
        eventText={
          drawn?.eventId === 'e1' && drawn.turn === game.globalTurnNo ? drawn.text : undefined
        }
        onChoose={onChoose}
      />
    );
  } else if (sellOpen) {
    card = (
      <SellPanel
        key={game.stateRevision}
        observation={view.observation}
        feed={view.feed}
        quoteSale={quoteSale}
        onSell={onSell}
      />
    );
  } else if (battleOpen) {
    card = <BattlePanel view={view} onChoose={onChoose} />;
  } else if (socialOpen) {
    card = (
      <SocialPanel
        key={game.stateRevision}
        observation={view.observation}
        legalActions={view.legalActions}
        sent={sentThisTurn(view)}
        answer={answerThisTurn(view.feed, game.globalTurnNo)}
        reply={social}
        heading={phaseLabel('social')}
        lead={t(rivalOwesAnswer(view) ? 'turn.promiseBody' : 'turn.socialBody')}
        onChoose={onChoose}
      />
    );
  } else if (humanTurn && game.phase.kind === 'shop') {
    card = (
      <ShopPanel
        observation={view.observation}
        legalActions={view.legalActions}
        onChoose={onChoose}
      />
    );
  } else if (humanTurn && game.phase.kind === 'strategy') {
    card = (
      <StrategyPanel
        key={game.stateRevision}
        observation={view.observation}
        legalActions={view.legalActions}
        challenges={view.challenges}
        onChoose={onChoose}
      />
    );
  } else if (choiceOpen) {
    card = (
      <ChoicePanel
        key={game.stateRevision}
        observation={view.observation}
        legalActions={view.legalActions}
        pendingDie={view.pendingDie}
        onChoose={onChoose}
      />
    );
  } else if (battle !== null) {
    // A battle someone else decides: its terms, chances and dice as they stand.
    card = (
      <DecisionCard
        kind="battle-watch"
        heading={battle.heading}
        lead={battle.body}
        actions={<PaceButtons view={view} playback={playback} />}
      >
        {view.battle && (
          <BattleTerms
            terms={view.battle}
            viewerSeat={view.seatIndex}
            frozen={view.battle.frozen}
            forced={
              game.phase.kind === 'pvp' && game.phase.battle.forced ? forcedSource(view) : undefined
            }
          />
        )}
      </DecisionCard>
    );
  } else if (rivalTurn) {
    const rival = game.players.find((player) => player.seatIndex === game.activeSeatIndex)!;
    const name = className(rival.classId);
    card = (
      <DecisionCard
        kind="rival"
        heading={t('board.turn', { name })}
        lead={playback.paused ? t('pace.paused') : t('ai.playing', { name })}
        actions={<PaceButtons view={view} playback={playback} />}
      />
    );
  } else {
    card = <OwnTurnCard view={view} playback={playback} />;
  }
  return <CardFrameProvider value={frame}>{card}</CardFrameProvider>;
}

/**
 * The player's own turn between decisions: the step the game is taking for them and the result
 * it holds (the die and the square, a catch), with Next at Step pace.
 */
function OwnTurnCard({ view, playback }: { view: SeatView; playback: TurnPlayback }) {
  const game = view.observation.public;
  const own = view.feed.filter(({ before }) => before.activeSeatIndex === view.seatIndex);
  const result = own
    .flatMap((entry) => turnMessages(entry, view.seatIndex))
    .findLast((message) =>
      ['encounter.caught', 'encounter.escaped', 'encounter.released'].includes(message.key),
    );
  const automatic = view.feed.at(-1);
  const automaticMessage =
    automatic &&
    turnMessages(automatic, view.seatIndex).find((message) => message.key === 'turn.automatic');
  const lastMove = own.findLast(
    ({ before, record }) => before.phase.kind === 'move' && record.action.kind === 'dice_result',
  );
  const roll = lastMove?.record.events.find(
    (event) => event.kind === 'random_result' && event.purpose.startsWith('move:'),
  );
  const you = game.players.find((player) => player.seatIndex === view.seatIndex)!;
  const lead =
    game.phase.kind === 'end'
      ? t('turn.end')
      : game.phase.kind === 'move'
        ? t('turn.moving')
        : t('turn.onlyLegalAction');
  return (
    <DecisionCard
      kind="own"
      heading={phaseLabel(game.phase.kind)}
      lead={lead}
      actions={<PaceButtons view={view} playback={playback} />}
    >
      {automaticMessage && (
        <p className="turn-banner" role="status">
          {automaticMessage.text}
        </p>
      )}
      {roll?.kind === 'random_result' && typeof roll.result === 'number' && (
        <p className="move-summary">
          <DieFace value={roll.result} />
          <span>{t('turn.lastMove', { roll: roll.result, position: you.position })}</span>
        </p>
      )}
      {result && (
        <p className="catch-result" role="status" data-message-key={result.key}>
          {result.text}
        </p>
      )}
    </DecisionCard>
  );
}
