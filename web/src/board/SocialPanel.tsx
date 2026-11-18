import { useState, type ReactNode } from 'react';
import type { ChatMessage, ChatTopic, LegalActions, Observation } from '../../../engine/index.ts';
import { CHAT_TOPICS, chatChoices, type ChatChoice } from '../game/chat.ts';
import { en, t, type MessageKey } from '../i18n/en.ts';
import { className, itemName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { backupReasonText } from './AiTurn.tsx';
import { seatLabel } from './labels.ts';
import type { ChatReplyControls } from './useChatReply.ts';
import './social-panel.css';

export interface SocialPanelProps {
  observation: Observation;
  legalActions: LegalActions;
  /** The message already sent in this turn's window, if any. */
  sent: ChatMessage | undefined;
  reply: ChatReplyControls;
  onChoose: (id: string) => void;
}

const unique = <T,>(values: readonly T[]) => [...new Set(values)];

/**
 * The Social window (spec §3, §4.2, §4.8): five topic buttons, one rival, one message and its reply,
 * or Skip. Every choice is one the engine lists, so a message names only seats and content item IDs
 * and never depends on what a rival holds. The "only words" notice is always on screen; nothing
 * here moves a number, and Skip or Continue is reachable in every state.
 */
export function SocialPanel({
  observation,
  legalActions,
  sent,
  reply,
  onChoose,
}: SocialPanelProps) {
  const ownSeat = observation.own.seatIndex;
  const players = observation.public.players;
  const chats = chatChoices(legalActions);
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
  const done = chats.length === 0;
  const continueButton = skip && (
    <ActionButton
      enabled
      variant={sent ? 'primary' : 'secondary'}
      onClick={() => onChoose(skip.id)}
    >
      {t(done ? 'social.continue' : 'social.skip')}
    </ActionButton>
  );

  if (done) {
    return (
      <div className="decision-panel social-panel" aria-label={t('social.panel')} role="group">
        {sent ? (
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
        {continueButton}
      </div>
    );
  }
  return (
    <OpenWindow
      observation={observation}
      chats={chats}
      rivalName={rivalName}
      notices={notices}
      onSend={onChoose}
      skip={continueButton}
    />
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
  rivalName,
  notices,
  onSend,
  skip,
}: {
  observation: Observation;
  chats: ChatChoice[];
  rivalName: (seatIndex: number) => string;
  notices: (topic?: ChatTopic) => ReactNode;
  onSend: (id: string) => void;
  skip: ReactNode;
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
        <ActionButton enabled onClick={() => onSend(chosen.id)}>
          {t('social.send', { rival: rivalName(chosen.payload.targetSeatIndex) })}
        </ActionButton>
      ) : (
        <ActionButton enabled={false} reasonText={t(missing!)}>
          {t('social.sendNone')}
        </ActionButton>
      )}
      {skip}
    </div>
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
  const rival = rivalName(toSeat);
  const { state } = reply;
  if (state.status === 'none') return null;
  if (state.status === 'waiting') {
    return (
      <p className="social-reply-status" role="status">
        {t('social.waiting', { rival })}
      </p>
    );
  }
  if (state.status === 'failed') {
    return (
      <div className="social-reply-status" role="status" data-reply="failed">
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
  const text = Object.hasOwn(en, key) ? t(key, { target: className(you?.classId ?? '') }) : '';
  // A line ID the catalog does not know, or one with an unfilled slot, is never shown as dialogue.
  const usable = text !== '' && !/[{}]/.test(text);
  const backup = backupReasonText(state.reply);
  return (
    <div className="social-reply" data-reply="ready" data-source={state.reply.source}>
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
            <p className="social-reply-label">{t('talk.bank')}</p>
          </>
        ) : (
          <p className="social-reply-text">{t('social.replyNoLine', { rival })}</p>
        )}
        {state.reply.refused && <p className="panel-note">{t('social.refused', { rival })}</p>}
        {backup && (
          <p className="social-reply-backup">
            <strong className="ai-backup-badge">{t('ai.backupBadge')}</strong> <span>{backup}</span>
          </p>
        )}
      </div>
    </div>
  );
}
