import { useEffect, useRef } from 'react';
import { t, type MessageKey } from './i18n/th.ts';
import type { Screen } from './screens.ts';
import { Button } from './ui/Button.tsx';

interface Placeholder {
  heading: MessageKey;
  body: MessageKey;
  next?: { screen: Screen; label: MessageKey };
}

// Real screens replace these in cycle 2; each one still tells the player where to go next.
const PLACEHOLDERS: Record<Screen, Placeholder> = {
  home: {
    heading: 'home.heading',
    body: 'home.body',
    next: { screen: 'setup', label: 'nav.setup' },
  },
  setup: {
    heading: 'setup.heading',
    body: 'setup.body',
    next: { screen: 'play', label: 'nav.play' },
  },
  play: {
    heading: 'play.heading',
    body: 'play.body',
    next: { screen: 'results', label: 'nav.results' },
  },
  results: { heading: 'results.heading', body: 'results.body' },
};

interface ScreenPlaceholderProps {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
}

export function ScreenPlaceholder({ screen, onNavigate }: ScreenPlaceholderProps) {
  const { heading, body, next } = PLACEHOLDERS[screen];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownScreen = useRef(screen);

  // On a screen change (not the first render), move focus to the new heading so keyboard
  // and screen-reader users land on it. Comparing screens keeps StrictMode's re-run quiet.
  useEffect(() => {
    if (shownScreen.current === screen) return;
    shownScreen.current = screen;
    headingRef.current?.focus();
  }, [screen]);

  return (
    <section aria-labelledby="screen-heading" className="max-w-prose">
      <h1
        id="screen-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-3xl leading-snug font-bold text-balance outline-none sm:text-4xl"
      >
        {t(heading)}
      </h1>
      <p className="mt-5 text-lg text-pretty text-ink-soft">{t(body)}</p>
      <div className="mt-10 flex flex-wrap gap-3">
        {next && (
          <Button variant="primary" onClick={() => onNavigate(next.screen)}>
            {t(next.label)}
          </Button>
        )}
        {screen !== 'home' && (
          <Button variant="secondary" onClick={() => onNavigate('home')}>
            {t('nav.home')}
          </Button>
        )}
      </div>
    </section>
  );
}
