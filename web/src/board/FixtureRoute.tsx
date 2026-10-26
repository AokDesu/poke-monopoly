import fixtures from 'virtual:board-fixtures';
import { t } from '../i18n/en.ts';
import { FixtureScreen } from './FixtureScreen.tsx';

export default function FixtureRoute({ name }: { name: string }) {
  return (
    <div className="app-playing min-h-dvh">
      <main className="mx-auto w-full max-w-[1280px] px-5 py-6 sm:px-8">
        <FixtureScreen name={name} fixtures={fixtures} />
      </main>
      <footer className="mx-auto w-full max-w-[1280px] px-5 pb-6 text-sm sm:px-8">
        <a href="/models/CREDITS.md" className="font-bold underline underline-offset-4">
          {t('credits.link')}
        </a>
      </footer>
    </div>
  );
}
