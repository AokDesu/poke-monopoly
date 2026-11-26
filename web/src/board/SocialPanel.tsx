import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatMessage, ChatTopic, LegalActions, Observation } from '../../../engine/index.ts';
import { CHAT_TOPICS, chatChoices, type ChatChoice } from '../game/chat.ts';
import {
  pendingOffer,
  promiseOffers,
  unavailableReason,
  type PendingOffer,
  type PromiseAnswer,
  type PromiseDirection,
  type PromiseOffer,
} from '../game/promises.ts';
import { dealCardOpen, dealOptions } from '../game/deals.ts';
import type { ConfirmDealResult, SeatFeedEntry } from '../game/store.ts';
import type { DealTerms } from '../../../engine/index.ts';
import { en, t, type MessageKey } from '../i18n/en.ts';
import { className, itemName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { voiceReasonText } from '../game/tableTalk.ts';
import { backupReasonText } from './AiTurn.tsx';
import { possessive, seatLabel } from './labels.ts';
import type { ChatReplyControls } from './useChatReply.ts';
import { DecisionCard } from './DecisionCard.tsx';
import { DealCard } from './DealCard.tsx';
import './social-panel.css';

export interface SocialPanelProps {
  observation: Observation;
  legalActions: LegalActions;
  /** The message already sent in this turn's window, if any. */
  sent: ChatMessage | undefined;
  reply: ChatReplyControls;
  /** The rival's answer to this turn's promise offer, from the engine's own events. */
  answer?: PromiseAnswer | null;
  /** The card's heading and its one line; the window's own words when absent. */
  heading?: string;
  lead?: string;
  onChoose: (id: string) => void;
  /** The seat's feed and the final Confirm; with both, the window offers the Deal Card (spec §4.8). */
  feed?: readonly SeatFeedEntry[];
  onConfirmDeal?: (shown: { revision: number; terms: DealTerms }) => ConfirmDealResult;
}

const unique = <T,>(values: readonly T[]) => [...new Set(values)];

/**
 * The Social window (spec §3, §4.2, §4.8): five topic buttons, one rival, one message and its reply,
 * a promise offer, or Skip. Every choice is one the engine lists, so a message names only seats and
 * content item IDs and never depends on what a rival holds, and a promise offer is greyed out
 * exactly when the engine does not list it. The "only words" notice is always on screen; nothing
 * here moves a number, and Skip or Continue is reachable in every state except while a rival owes
 * the answer to a promise offer, which the game waits for (§4.8).
 */
export function SocialPanel({
  observation,
  legalActions,
  sent,
  reply,
  answer = null,
  heading = t('social.panel'),
  lead,
  onChoose,
  feed,
  onConfirmDeal,
}: SocialPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [dealing, setDealing] = useState(false);
  const ownSeat = observation.own.seatIndex;
  const players = observation.public.players;
  const chats = chatChoices(legalActions);
  const offers = promiseOffers(legalActions);
  const pending = pendingOffer(observation);
  const skip = legalActions.enabled.find((action) => action.kind === 'skip');
  const rivalName = (seatIndex: number) =>
    t('social.rival', {
      seat: seatLabel(seatIndex, ownSeat),
      class: className(players.find((player) => player.seatIndex === seatIndex)?.classId ?? ''),
    });
  const notices = (topic?: ChatTopic) => (
    <div className="social-notice" role="note">
      <p>
        <strong>{t('social.onlyWords')}</strong>
      </p>
      {topic === 'trade' && <p>{t('social.noticeTrade')}</p>}
      {topic === 'truce' && <p>{t('social.noticeTruce')}</p>}
    </div>
  );
  const deals = feed && onConfirmDeal ? dealOptions(legalActions) : [];
  const done = chats.length === 0 && offers.length === 0 && deals.length === 0;
  // Send remounts this window (its key is the state revision) and drops the pressed button, so focus
  // would fall to the page body. Keep a keyboard or screen-reader player's place on Continue; the
  // reply is announced by its live region. Focus that is anywhere else is left alone.
  const keepPlace = done && (sent !== undefined || answer !== null);
  useEffect(() => {
    const active = document.activeElement;
    if (!keepPlace || (active && active !== document.body)) return;
    panelRef.current
      ?.closest('.decision-card')
      ?.querySelector<HTMLElement>('[data-social-continue]')
      ?.focus();
  }, [keepPlace]);
  // Skip (or Continue once the window is used) sits in the card's footer, always in view, and
  // Enter presses it; while a rival owes a promise answer there is none (§4.8).
  const continueButton = skip && !pending && (
    <ActionButton
      enabled
      variant={sent || answer ? 'primary' : 'secondary'}
      data-social-continue=""
      data-primary=""
      onClick={() => onChoose(skip.id)}
    >
      {t(done ? 'social.continue' : 'social.skip')}
    </ActionButton>
  );
  // Make a deal sits beside Skip in the footer, always in view, while the window is open (spec §4.8).
  const dealButton = feed && onConfirmDeal && deals.length > 0 && !pending && !done && (
    <ActionButton enabled variant="secondary" data-deal-open="" onClick={() => setDealing(true)}>
      {t('deal.open')}
    </ActionButton>
  );
  if (feed && onConfirmDeal && (dealing || dealCardOpen({ observation, feed }))) {
    return (
      <DealCard
        observation={observation}
        legalActions={legalActions}
        feed={feed}
        rivalName={(seat) =>
          className(players.find((player) => player.seatIndex === seat)?.classId ?? '')
        }
        onBack={() => setDealing(false)}
        onChoose={onChoose}
        onConfirm={onConfirmDeal}
      />
    );
  }
  return (
    <DecisionCard
      kind="social"
      heading={heading}
      lead={lead}
      actions={
        <>
          {dealButton}
          {continueButton}
        </>
      }
    >
      {pending ? (
        <PendingPromise pending={pending} rivalName={rivalName}>
          {notices()}
        </PendingPromise>
      ) : done ? (
        <div
          ref={panelRef}
          className="decision-panel social-panel"
          aria-label={t('social.panel')}
          role="group"
        >
          {answer ? (
            <PromiseResult answer={answer} ownSeat={ownSeat} rivalName={rivalName} />
          ) : sent ? (
            <>
              <p className="social-sent">
                {t('social.sent', {
                  rival: rivalName(sent.toSeatIndex),
                  summary: summaryOf(sent),
                })}
              </p>
              <Reply
                observation={observation}
                toSeat={sent.toSeatIndex}
                reply={reply}
                rivalName={rivalName}
              />
              <p className="panel-note">{t('social.spent')}</p>
            </>
          ) : (
            <p className="social-sent">{t('social.spentOther')}</p>
          )}
          {notices(sent?.topic)}
        </div>
      ) : (
        <OpenWindow
          observation={observation}
          chats={chats}
          offers={offers}
          rivalName={rivalName}
          notices={notices}
          onSend={onChoose}
        />
      )}
    </DecisionCard>
  );
}

/** The question is out and the rival owes the answer: nothing is active, and the window waits for it. */
function PendingPromise({
  pending,
  rivalName,
  children,
}: {
  pending: PendingOffer;
  rivalName: (seatIndex: number) => string;
  children: ReactNode;
}) {
  const rival = rivalName(pending.rivalSeatIndex);
  return (
    <div
      className="decision-panel social-panel"
      aria-label={t('social.panel')}
      role="group"
      data-promise="pending"
    >
      <p className="social-sent">{t(`promise.pending.${pending.direction}`, { rival })}</p>
      <p className="social-reply-status" role="status">
        {t('promise.pending.waiting', { rival })}
      </p>
      {children}
    </div>
  );
}

/** The rival's explicit answer and, when accepted, the expiry the engine recorded. */
function PromiseResult({
  answer,
  ownSeat,
  rivalName,
}: {
  answer: PromiseAnswer;
  ownSeat: number;
  rivalName: (seatIndex: number) => string;
}) {
  const rival = rivalName(
    answer.promiserSeatIndex === ownSeat ? answer.recipientSeatIndex : answer.promiserSeatIndex,
  );
  return (
    <div role="status" data-promise-answer={answer.kind}>
      <p className="social-sent">{t(`promise.answer.${answer.kind}`, { rival })}</p>
      {answer.kind === 'accepted' && (
        <p className="panel-note">
          {t('promise.expires', {
            whose: possessive(answer.promiserSeatIndex, ownSeat),
            turn: answer.closesOwnTurnNo!,
          })}
        </p>
      )}
    </div>
  );
}

function summaryOf(message: ChatMessage): string {
  switch (message.topic) {
    case 'point_leader':
      return t('social.summary.point_leader', {
        leader: t('board.rivalLabel', { seat: message.leaderSeatIndex ?? '' }),
      });
    case 'use_item':
    case 'hold_item':
      return t(`social.summary.${message.topic}`, { item: itemName(message.itemId ?? '') });
    default:
      return t(`social.summary.${message.topic}`);
  }
}

function OpenWindow({
  observation,
  chats,
  offers,
  rivalName,
  notices,
  onSend,
}: {
  observation: Observation;
  chats: ChatChoice[];
  offers: PromiseOffer[];
  rivalName: (seatIndex: number) => string;
  notices: (topic?: ChatTopic) => ReactNode;
  onSend: (id: string) => void;
}) {
  const ownSeat = observation.own.seatIndex;
  const rivals = unique(chats.map((chat) => chat.payload.targetSeatIndex)).toSorted(
    (a, b) => a - b,
  );
  const [rivalPick, setRivalPick] = useState<number>();
  const [topic, setTopic] = useState<ChatTopic>();
  const [leaderPick, setLeaderPick] = useState<number>();
  const [itemPick, setItemPick] = useState<string>();
  const recipient = rivals.length === 1 ? rivals[0] : rivalPick;

  const leaders =
    recipient === undefined
      ? []
      : unique(
          chats
            .filter(
              (chat) =>
                chat.payload.topic === 'point_leader' && chat.payload.targetSeatIndex === recipient,
            )
            .map((chat) => chat.payload.leaderSeatIndex!),
        );
  const items =
    topic === 'use_item' || topic === 'hold_item'
      ? unique(
          chats.filter((chat) => chat.payload.topic === topic).map((chat) => chat.payload.itemId!),
        )
      : [];
  const leader = leaderPick !== undefined && leaders.includes(leaderPick) ? leaderPick : undefined;
  const item = itemPick !== undefined && items.includes(itemPick) ? itemPick : undefined;

  const chosen =
    recipient === undefined || topic === undefined
      ? undefined
      : chats.find(
          ({ payload }) =>
            payload.targetSeatIndex === recipient &&
            payload.topic === topic &&
            payload.leaderSeatIndex === (topic === 'point_leader' ? leader : undefined) &&
            payload.itemId === (topic === 'use_item' || topic === 'hold_item' ? item : undefined),
        );
  const missing: MessageKey | undefined =
    recipient === undefined
      ? 'social.reason.chooseRival'
      : topic === undefined
        ? 'social.reason.chooseTopic'
        : topic === 'point_leader' && leader === undefined
          ? 'social.reason.chooseLeader'
          : (topic === 'use_item' || topic === 'hold_item') && item === undefined
            ? 'social.reason.chooseItem'
            : chosen
              ? undefined
              : 'social.reason.unavailable';

  const preview =
    chosen &&
    t('social.preview', {
      rival: rivalName(chosen.payload.targetSeatIndex),
      summary: summaryOf({
        fromSeatIndex: ownSeat,
        toSeatIndex: chosen.payload.targetSeatIndex,
        topic: chosen.payload.topic,
        ...(chosen.payload.leaderSeatIndex !== undefined && {
          leaderSeatIndex: chosen.payload.leaderSeatIndex,
        }),
        ...(chosen.payload.itemId !== undefined && { itemId: chosen.payload.itemId }),
        globalTurnNo: observation.public.globalTurnNo,
      }),
    });

  return (
    <div className="decision-panel social-panel" aria-label={t('social.panel')} role="group">
      <p className="social-open">{t('social.open')}</p>
      {notices(topic)}
      {rivals.length > 1 ? (
        <fieldset className="social-group">
          <legend>{t('social.recipients')}</legend>
          <div className="social-choices">
            {rivals.map((seat) => (
              <ActionButton
                key={seat}
                enabled
                variant={recipient === seat ? 'reward' : 'secondary'}
                aria-pressed={recipient === seat}
                onClick={() => setRivalPick(seat)}
              >
                {rivalName(seat)}
              </ActionButton>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="social-to">
          <strong>{t('social.recipients')}</strong>
          <span>{rivalName(rivals[0]!)}</span>
        </p>
      )}
      <fieldset className="social-group">
        <legend>{t('social.topics')}</legend>
        <div className="social-choices social-topics">
          {CHAT_TOPICS.map((entry) => {
            const offered = chats.some((chat) => chat.payload.topic === entry);
            const label = t(`social.topic.${entry}`);
            return offered ? (
              <ActionButton
                key={entry}
                enabled
                variant={topic === entry ? 'reward' : 'secondary'}
                aria-pressed={topic === entry}
                onClick={() => setTopic(entry)}
              >
                {label}
              </ActionButton>
            ) : (
              <ActionButton
                key={entry}
                enabled={false}
                variant="secondary"
                reasonText={t(
                  entry === 'point_leader'
                    ? 'social.reason.noThirdSeat'
                    : 'social.reason.unavailable',
                )}
              >
                {label}
              </ActionButton>
            );
          })}
        </div>
      </fieldset>
      {topic === 'point_leader' && (
        <fieldset className="social-group">
          <legend>{t('social.leaders')}</legend>
          {recipient === undefined ? (
            <p className="target-prompt">{t('social.reason.chooseRival')}</p>
          ) : (
            <div className="social-choices">
              {leaders.map((seat) => (
                <ActionButton
                  key={seat}
                  enabled
                  variant={leader === seat ? 'reward' : 'secondary'}
                  aria-pressed={leader === seat}
                  onClick={() => setLeaderPick(seat)}
                >
                  {rivalName(seat)}
                </ActionButton>
              ))}
            </div>
          )}
        </fieldset>
      )}
      {items.length > 0 && (
        <fieldset className="social-group">
          <legend>{t('social.items')}</legend>
          <div className="social-choices">
            {items.map((id) => (
              <ActionButton
                key={id}
                enabled
                variant={item === id ? 'reward' : 'secondary'}
                aria-pressed={item === id}
                onClick={() => setItemPick(id)}
              >
                {itemName(id)}
              </ActionButton>
            ))}
          </div>
        </fieldset>
      )}
      {preview && (
        <p className="social-preview" role="status">
          {preview}
        </p>
      )}
      {chosen ? (
        <ActionButton enabled data-primary="" onClick={() => onSend(chosen.id)}>
          {t('social.send', { rival: rivalName(chosen.payload.targetSeatIndex) })}
        </ActionButton>
      ) : (
        <ActionButton enabled={false} reasonText={t(missing!)}>
          {t('social.sendNone')}
        </ActionButton>
      )}
      <PromiseOffers
        observation={observation}
        offers={offers}
        rivalName={rivalName}
        onSend={onSend}
      />
    </div>
  );
}

const DIRECTIONS: readonly PromiseDirection[] = ['offer', 'ask'];

/**
 * The promise offers (spec §4.8): for each rival, "I won't attack them" and "Ask them to promise
 * not to attack me". Only the engine's listed offers can be sent; one it does not list is greyed
 * out with the reason, which never depends on what any seat holds. The offer is a question, so
 * nothing is active until the rival's answer.
 */
function PromiseOffers({
  observation,
  offers,
  rivalName,
  onSend,
}: {
  observation: Observation;
  offers: PromiseOffer[];
  rivalName: (seatIndex: number) => string;
  onSend: (id: string) => void;
}) {
  const ownSeat = observation.own.seatIndex;
  const [pick, setPick] = useState<string>();
  const rivals = observation.public.players
    .map((player) => player.seatIndex)
    .filter((seat) => seat !== ownSeat)
    .toSorted((a, b) => a - b);
  const chosen = offers.find((offer) => offer.id === pick);
  return (
    <fieldset className="social-group promise-offers" data-promise="offers">
      <legend>{t('promise.offers')}</legend>
      <p className="panel-note">{t('promise.offerNote')}</p>
      {rivals.map((seat) => (
        <fieldset className="social-group promise-offer-rival" key={seat}>
          <legend>{rivalName(seat)}</legend>
          <div className="social-choices">
            {DIRECTIONS.map((direction) => {
              const offer = offers.find(
                (entry) =>
                  entry.payload.targetSeatIndex === seat && entry.payload.direction === direction,
              );
              const label = t(`promise.direction.${direction}`);
              return offer ? (
                <ActionButton
                  key={direction}
                  enabled
                  variant={pick === offer.id ? 'reward' : 'secondary'}
                  aria-pressed={pick === offer.id}
                  onClick={() => setPick(offer.id)}
                >
                  {label}
                </ActionButton>
              ) : (
                <ActionButton
                  key={direction}
                  enabled={false}
                  variant="secondary"
                  reasonText={t(
                    `promise.reason.${unavailableReason(observation, seat, direction)}`,
                  )}
                >
                  {label}
                </ActionButton>
              );
            })}
          </div>
        </fieldset>
      ))}
      {chosen && (
        <p className="social-preview" role="status">
          {t(`promise.preview.${chosen.payload.direction}`, {
            rival: rivalName(chosen.payload.targetSeatIndex),
          })}
        </p>
      )}
      {chosen ? (
        <ActionButton enabled data-primary="" onClick={() => onSend(chosen.id)}>
          {t('promise.send', { rival: rivalName(chosen.payload.targetSeatIndex) })}
        </ActionButton>
      ) : (
        <ActionButton enabled={false} reasonText={t('promise.reason.choose')}>
          {t('promise.sendNone')}
        </ActionButton>
      )}
    </fieldset>
  );
}

function Reply({
  observation,
  toSeat,
  reply,
  rivalName,
}: {
  observation: Observation;
  toSeat: number;
  reply: ChatReplyControls;
  rivalName: (seatIndex: number) => string;
}) {
  const { state } = reply;
  if (state.status === 'none') return null;
  // One live region for every state, so the reply that replaces "waiting" is announced.
  return (
    <div role="status">
      <ReplyBody observation={observation} toSeat={toSeat} reply={reply} rivalName={rivalName} />
    </div>
  );
}

function ReplyBody({
  observation,
  toSeat,
  reply,
  rivalName,
}: {
  observation: Observation;
  toSeat: number;
  reply: ChatReplyControls;
  rivalName: (seatIndex: number) => string;
}) {
  const rival = rivalName(toSeat);
  const { state } = reply;
  if (state.status === 'none') return null;
  if (state.status === 'waiting') {
    return <p className="social-reply-status">{t('social.waiting', { rival })}</p>;
  }
  if (state.status === 'failed') {
    return (
      <div className="social-reply-status" data-reply="failed">
        <p>
          {t(`social.failed.${state.reason === 'stale' ? 'invalid' : state.reason}`, { rival })}
        </p>
        <ActionButton enabled variant="secondary" onClick={reply.retry}>
          {t('social.retry', { rival })}
        </ActionButton>
      </div>
    );
  }
  const you = observation.public.players.find(
    (player) => player.seatIndex === observation.own.seatIndex,
  );
  const key = `ai.line.${state.reply.lineId}` as MessageKey;
  const bank = Object.hasOwn(en, key) ? t(key, { target: className(you?.classId ?? '') }) : '';
  // The rival's own words, when they came in time. Otherwise the bank line; a line ID the catalog
  // does not know, or one with an unfilled slot, is never shown as dialogue.
  const words = state.words;
  const text = words ?? bank;
  const usable = text !== '' && !/[{}]/.test(text);
  const backup = backupReasonText(state.reply);
  return (
    <div
      className="social-reply"
      data-reply="ready"
      data-source={words ? 'haiku' : state.reply.source}
    >
      <span className="seat-disc" data-seat={toSeat} aria-hidden="true">
        {toSeat}
      </span>
      <div>
        <p className="social-reply-who">
          <strong>{rival}</strong>
        </p>
        {usable ? (
          <>
            <p className="social-reply-text">{text}</p>
            <p className="social-reply-label">{t(words ? 'talk.aiWritten' : 'talk.bank')}</p>
          </>
        ) : (
          <p className="social-reply-text">{t('social.replyNoLine', { rival })}</p>
        )}
        {state.reply.refused && <p className="panel-note">{t('social.refused', { rival })}</p>}
        {!words && state.voiceOff && (
          <p className="social-reply-backup" data-voice-reason={state.voiceOff}>
            <strong className="ai-backup-badge">{t('talk.voiceOff')}</strong>{' '}
            <span>{voiceReasonText(state.voiceOff)}</span>
          </p>
        )}
        {backup && (
          <p className="social-reply-backup">
            <strong className="ai-backup-badge">{t('ai.backupBadge')}</strong> <span>{backup}</span>
          </p>
        )}
      </div>
    </div>
  );
}
