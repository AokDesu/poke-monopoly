import { t } from '../i18n/th.ts';
import { SETUP_STEPS, type SetupStep } from '../screens.ts';

/** Where the player is in setup; the list order is the spec §3 order. */
export function SetupProgress({ step }: { step: SetupStep }) {
  const current = SETUP_STEPS.indexOf(step);
  return (
    <nav aria-label={t('setup.steps.label')} className="mb-8">
      <ol className="flex flex-wrap gap-x-1 gap-y-2 text-sm">
        {SETUP_STEPS.map((entry, index) => (
          <li
            key={entry}
            aria-current={entry === step ? 'step' : undefined}
            className={`flex items-center gap-1 rounded-full px-3 py-1 ${
              entry === step
                ? 'bg-accent font-bold text-on-accent'
                : index < current
                  ? 'text-ink'
                  : 'text-ink-soft'
            }`}
          >
            {index < current && (
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="size-3.5 text-serial"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 8.5 6.5 12 13 4.5" />
              </svg>
            )}
            {t(`setup.step.${entry}`)}
          </li>
        ))}
      </ol>
    </nav>
  );
}
