import { t } from './i18n/en.ts';
import { Button } from './ui/Button.tsx';
import { Screen } from './ui/Screen.tsx';

interface ScreenPlaceholderProps {
  onNavigate: (screen: 'home') => void;
}

export function ScreenPlaceholder({ onNavigate }: ScreenPlaceholderProps) {
  return (
    <Screen
      heading={t('results.heading')}
      body={t('results.body')}
      actions={
        <Button variant="secondary" onClick={() => onNavigate('home')}>
          {t('nav.home')}
        </Button>
      }
    />
  );
}
