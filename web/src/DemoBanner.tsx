import { t } from './i18n/en.ts';

/**
 * Announces a prepared scenario (`?demo`, spec §3, §11 step 2, issue #222). Shown on every screen
 * of a scenario's game, a reload included, and never anywhere else.
 */
export function DemoBanner() {
  return (
    <div className="scene-banner-row mx-auto w-full max-w-6xl px-5 pt-4 sm:px-8">
      <p role="note" className="scene-banner">
        {t('demo.scene.banner')}
      </p>
    </div>
  );
}
