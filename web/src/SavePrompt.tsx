import { t } from './i18n/en.ts';
import { Button } from './ui/Button.tsx';
import { Screen } from './ui/Screen.tsx';

export type SavePromptProps =
  | {
      kind: 'continue';
      pending: string;
      onContinue: () => void;
      onNewGame: () => void;
    }
  | { kind: 'mismatch'; message: string; onNewGame: () => void }
  | { kind: 'unreadable'; onNewGame: () => void };

export function SavePrompt(props: SavePromptProps) {
  const title = (
    <p className="title-3d mb-5 text-5xl leading-tight sm:text-6xl">{t('app.title')}</p>
  );
  const newGame = (
    <Button variant="secondary" onClick={props.onNewGame}>
      {t('save.newGame')}
    </Button>
  );
  if (props.kind === 'mismatch') {
    return (
      <Screen
        before={title}
        heading={t('save.mismatchHeading')}
        body={t('save.mismatchNext')}
        actions={newGame}
      >
        <p role="alert" className="panel max-w-xl p-5 text-pretty">
          {props.message}
        </p>
      </Screen>
    );
  }
  if (props.kind === 'unreadable') {
    return (
      <Screen
        before={title}
        heading={t('save.mismatchHeading')}
        body={t('save.unreadable')}
        actions={newGame}
      />
    );
  }
  return (
    <Screen before={title} heading={t('save.continueHeading')} body={t('save.continueBody')}>
      <div className="grid max-w-md gap-4">
        <p role="status" className="panel p-5 font-bold text-pretty">
          {props.pending}
        </p>
        <Button variant="primary" className="w-full !min-h-16 !text-2xl" onClick={props.onContinue}>
          {t('save.continue')}
        </Button>
        <Button variant="secondary" className="w-full" onClick={props.onNewGame}>
          {t('save.newGame')}
        </Button>
      </div>
    </Screen>
  );
}
