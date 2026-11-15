import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from './i18n/en.ts';
import { Root } from './Root.tsx';
import './index.css';

document.title = t('app.title');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root search={location.search} />
  </StrictMode>,
);
