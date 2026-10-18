import { Component, type ReactNode } from 'react';
import { t } from './i18n/th.ts';
import { Button } from './ui/Button.tsx';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/** No blank screens (spec §3.1): a render failure always shows what to do next. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-14 sm:py-20">
        <section role="alert" aria-labelledby="error-heading" className="max-w-prose">
          <h1 id="error-heading" className="text-3xl leading-snug font-bold text-balance">
            {t('error.heading')}
          </h1>
          <p className="mt-5 text-lg text-pretty text-ink-soft">{t('error.body')}</p>
          <Button
            variant="primary"
            className="mt-10"
            onClick={() => this.setState({ failed: false })}
          >
            {t('error.retry')}
          </Button>
        </section>
      </main>
    );
  }
}
