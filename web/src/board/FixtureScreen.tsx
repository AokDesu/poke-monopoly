import type { BoardProps } from './Board.tsx';
import { Board } from './Board.tsx';
import { t } from '../i18n/en.ts';
import { Screen } from '../ui/Screen.tsx';

export function FixtureScreen({
  name,
  fixtures,
}: {
  name: string;
  fixtures: Readonly<Record<string, BoardProps>>;
}) {
  const fixture = Object.hasOwn(fixtures, name) ? fixtures[name] : undefined;
  return fixture ? (
    <>
      <p className="fixture-notice">{t('board.fixture', { name })}</p>
      <Board {...fixture} />
    </>
  ) : (
    <Screen heading={t('board.fixtureMissing')} body={t('board.fixtureMissingBody')} />
  );
}
