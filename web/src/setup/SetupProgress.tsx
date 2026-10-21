import { t } from '../i18n/th.ts';
import { SETUP_STEPS, type SetupStep } from '../screens.ts';

/** Where the player is in setup, as stops along a route; the order is the spec §3 order. */
export function SetupProgress({ step }: { step: SetupStep }) {
  const current = SETUP_STEPS.indexOf(step);
  return (
    <nav aria-label={t('setup.steps.label')} className="mb-8">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 font-display text-sm">
        {SETUP_STEPS.map((entry, index) => (
          <li key={entry} className="flex items-center gap-1">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={`h-1 w-4 rounded-full sm:w-6 ${index <= current ? 'bg-action' : 'bg-panel/70'}`}
              />
            )}
            <span
              aria-current={entry === step ? 'step' : undefined}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${
                entry === step
                  ? 'bg-action text-white shadow-[0_3px_0_var(--color-action-lip)]'
                  : index < current
                    ? 'bg-panel text-ink shadow-[0_3px_0_var(--color-panel-lip)]'
                    : 'bg-panel/60 text-ink-soft'
              }`}
            >
              {index < current && (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="size-3.5 text-type-grass"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 8.5 6.5 12 13 4.5" />
                </svg>
              )}
              {t(`setup.step.${entry}`)}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
