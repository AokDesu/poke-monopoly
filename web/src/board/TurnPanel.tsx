import { inSocialWindow, sentThisTurn } from '../game/chat.ts';
import { answerThisTurn, rivalOwesAnswer } from '../game/promises.ts';
import type { SeatView } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { className } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { AiTurn, PaceControls } from './AiTurn.tsx';
import { BattlePanel } from './BattlePanel.tsx';
import { BattleResult } from './BattleResult.tsx';
import { BattleTerms } from './BattleTerms.tsx';
import { battleCopy, forcedSource } from './battle.ts';
import { JevChoicePanel } from './JevChoicePanel.tsx';
import { phaseLabel } from './labels.ts';
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
}

/** What the player may do now and what just happened, from the human seat's view only. */
export function TurnPanel({
  view,
  playback,
  notice,
  actionError,
  onChoose,
  onFinished,
  social = NO_REPLY,
}: TurnPanelProps) {
  const { public: game } = view.observation;
  const humanTurn = game.activeSeatIndex === view.seatIndex;
  // A PvP or Gym battle has its own panel for every decision, owned by the engine's pending seat
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
  const choiceOpen =
    battle === null &&
    view.legalActions.enabled.length > 1 &&
    !socialOpen &&
    !['shop', 'strategy', 'sell'].includes(game.phase.kind) &&
    !(game.phase.kind === 'encounter' && !game.phase.catchRoll);
  const decisionOpen =
    (humanTurn && ['shop', 'strategy', 'sell'].includes(game.phase.kind)) ||
    socialOpen ||
    choiceOpen ||
    battleOpen;
  const result = view.feed
    .filter(({ before }) => before.activeSeatIndex === view.seatIndex)
    .flatMap((entry) => turnMessages(entry, view.seatIndex))
    .findLast((message) =>
      ['encounter.caught', 'encounter.escaped', 'encounter.released'].includes(message.key),
    );
  const automatic = view.feed.at(-1);
  const automaticMessage =
    automatic &&
    turnMessages(automatic, view.seatIndex).find((message) => message.key === 'turn.automatic');
  const lastSale = view.feed.findLast(
    ({ before }) => before.activeSeatIndex === view.seatIndex && before.phase.kind === 'sell',
  );
  const receivedRescue = lastSale?.record.events.some(
    (event) => event.kind === 'uid_created' && event.entity === 'pokemon',
  );
  const lastMove = view.feed.findLast(
    ({ before, record }) =>
      before.activeSeatIndex === view.seatIndex &&
      before.phase.kind === 'move' &&
      record.action.kind === 'dice_result',
  );
  const roll = lastMove?.record.events.find(
    (event) => event.kind === 'random_result' && event.purpose.startsWith('move:'),
  );
  const you = game.players.find((player) => player.seatIndex === view.seatIndex)!;
  const opponentFailed = playback.failed;
  const rival = game.players.find((player) => player.seatIndex === game.activeSeatIndex)!;
  // The rival's moves are written in its seat row, so the panel only says who is playing.
  let body =
    game.phase.kind === 'finished'
      ? t('turn.finished')
      : battle
        ? battle.body
        : !humanTurn
          ? playback.paused
            ? t('pace.paused')
            : t('ai.playing', { name: className(rival.classId) })
          : game.phase.kind === 'sell'
            ? t('turn.sellBody')
            : game.phase.kind === 'shop'
              ? t('turn.shopBody')
              : game.phase.kind === 'strategy' && view.legalActions.enabled.length > 1
                ? t('turn.strategyBody')
                : game.phase.kind === 'end'
                  ? t('turn.end')
                  : game.phase.kind === 'move'
                    ? t('turn.moving')
                    : t('turn.onlyLegalAction');
  if (humanTurn && game.phase.kind === 'encounter' && view.legalActions.enabled.length > 1) {
    body = t('turn.encounterBody');
  }
  if (socialOpen) body = t(rivalOwesAnswer(view) ? 'turn.promiseBody' : 'turn.socialBody');
  if (choiceOpen) body = t('turn.choiceBody');
  if (opponentFailed) body = t('turn.opponentError');
  return (
    <section className="turn-panel panel" aria-label={t('turn.actions')}>
      <div className="turn-panel-copy">
        <h2>
          {battle
            ? battle.heading
            : humanTurn && game.phase.kind === 'sell'
              ? t('turn.sellHeading')
              : humanTurn && game.phase.kind === 'shop'
                ? t('turn.shopHeading')
                : game.phase.kind === 'finished'
                  ? t('board.finished')
                  : humanTurn
                    ? phaseLabel(game.phase.kind)
                    : t('turn.opponent')}
        </h2>
        <p role={opponentFailed ? 'alert' : 'status'}>{body}</p>
        {/* A rival's automatic steps are filler: its row tells what mattered. */}
        {humanTurn && automaticMessage && !decisionOpen && (
          <p className="turn-banner" role="status">
            {automaticMessage.text}
          </p>
        )}
        {humanTurn &&
          !decisionOpen &&
          roll?.kind === 'random_result' &&
          typeof roll.result === 'number' && (
            <p className="move-summary">
              {t('turn.lastMove', { roll: roll.result, position: you.position })}
            </p>
          )}
        {humanTurn && result && !decisionOpen && (
          <p className="catch-result" role="status" data-message-key={result.key}>
            {result.text}
          </p>
        )}
        {actionError && <p role="alert">{t('turn.actionError')}</p>}
        {notice && (
          <p className="turn-banner" role="status">
            {notice}
          </p>
        )}
      </div>
      <JevChoicePanel view={view} />
      <PaceControls view={view} playback={playback} />
      <AiTurn view={view} playback={playback} />
      <BattleResult view={view} />
      {receivedRescue && (
        <p className="rescue-preview" role="status">
          {t('sell.rescueStarter')}
        </p>
      )}
      {humanTurn && game.phase.kind === 'shop' && (
        <ShopPanel
          observation={view.observation}
          legalActions={view.legalActions}
          onChoose={onChoose}
        />
      )}
      {humanTurn && game.phase.kind === 'strategy' && (
        <StrategyPanel
          key={game.stateRevision}
          observation={view.observation}
          legalActions={view.legalActions}
          challenges={view.challenges}
          onChoose={onChoose}
        />
      )}
      {battleOpen && <BattlePanel view={view} onChoose={onChoose} />}
      {battle !== null && !battleOpen && view.battle && (
        <BattleTerms
          terms={view.battle}
          viewerSeat={view.seatIndex}
          frozen={view.battle.frozen}
          forced={
            game.phase.kind === 'pvp' && game.phase.battle.forced ? forcedSource(view) : undefined
          }
        />
      )}
      {socialOpen && (
        <SocialPanel
          key={game.stateRevision}
          observation={view.observation}
          legalActions={view.legalActions}
          sent={sentThisTurn(view)}
          answer={answerThisTurn(view.feed, game.globalTurnNo)}
          reply={social}
          onChoose={onChoose}
        />
      )}
      {choiceOpen && (
        <ChoicePanel
          key={game.stateRevision}
          observation={view.observation}
          legalActions={view.legalActions}
          pendingDie={view.pendingDie}
          onChoose={onChoose}
        />
      )}
      {opponentFailed && (
        <ActionButton enabled onClick={playback.retry}>
          {t('turn.retry')}
        </ActionButton>
      )}
      {game.phase.kind === 'finished' && onFinished && (
        <ActionButton enabled onClick={onFinished}>
          {t('nav.results')}
        </ActionButton>
      )}
    </section>
  );
}
