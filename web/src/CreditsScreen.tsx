import { MODEL_CREDITS } from './game/models.ts';
import { t } from './i18n/en.ts';
import { Button } from './ui/Button.tsx';
import { Screen } from './ui/Screen.tsx';

/** Attribution for the 3D models (CC BY requires it; CC0 is credited as a courtesy). */
export function CreditsScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen
      heading={t('credits.heading')}
      body={t('credits.body')}
      actions={
        <Button variant="secondary" onClick={onBack}>
          {t('nav.back')}
        </Button>
      }
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {MODEL_CREDITS.map((credit) => (
          <li key={credit.file} className="panel p-5">
            <p className="font-display text-lg font-semibold">
              <a className="underline underline-offset-4" href={credit.source}>
                {credit.title}
              </a>
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
              <dt className="text-ink-soft">{t('credits.author')}</dt>
              <dd>{credit.author}</dd>
              <dt className="text-ink-soft">{t('credits.licence')}</dt>
              <dd>{credit.licence}</dd>
            </dl>
          </li>
        ))}
      </ul>
      <p className="mt-6 max-w-[62ch] text-sm text-pretty text-ink-soft">
        {t('credits.trademark')}
      </p>
    </Screen>
  );
}
