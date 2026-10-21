import { t, type MessageKey } from './i18n/en.ts';
import { Button } from './ui/Button.tsx';
import { Screen } from './ui/Screen.tsx';

type PlaceholderScreen = 'play' | 'results';

interface Placeholder {
  heading: MessageKey;
  body: MessageKey;
  next?: { screen: PlaceholderScreen; label: MessageKey };
}

// The board (#41) and results replace these; each one still tells the player where to go next.
const PLACEHOLDERS: Record<PlaceholderScreen, Placeholder> = {
  play: {
    heading: 'play.heading',
    body: 'play.body',
    next: { screen: 'results', label: 'nav.results' },
  },
  results: { heading: 'results.heading', body: 'results.body' },
};

interface ScreenPlaceholderProps {
  screen: PlaceholderScreen;
  onNavigate: (screen: PlaceholderScreen | 'home') => void;
}

export function ScreenPlaceholder({ screen, onNavigate }: ScreenPlaceholderProps) {
  const { heading, body, next } = PLACEHOLDERS[screen];
  return (
    <Screen
      heading={t(heading)}
      body={t(body)}
      actions={
        <>
          {next && (
            <Button variant="primary" onClick={() => onNavigate(next.screen)}>
              {t(next.label)}
            </Button>
          )}
          <Button variant="secondary" onClick={() => onNavigate('home')}>
            {t('nav.home')}
          </Button>
        </>
      }
    />
  );
}
