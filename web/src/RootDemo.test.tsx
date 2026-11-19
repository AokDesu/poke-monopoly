import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AppProps } from './App.tsx';
import { Root } from './Root.tsx';

const received: AppProps[] = [];
vi.mock('./App.tsx', () => ({
  App: (props: AppProps) => {
    received.push(props);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  received.length = 0;
});

// Demo mode is requested only by a bare `?demo`, `?demo=1` or `?demo=true`; `?demo=0`, `?demo=false`
// and every other address, a playtest session's included, is a normal game that never shows a
// rival's private options (spec §1, issues #220 and #247). A request is not yet the panel: that
// also needs the server's demo setting (see DemoGate.test.tsx).
test.each([
  ['?demo', true],
  ['?demo=1', true],
  ['?demo=true', true],
  ['?seed=3&demo', true],
  ['?demo=0', false],
  ['?demo=false', false],
  ['?seed=3&demo=0', false],
  ['', false],
  ['?seed=3', false],
  ['?P5-A01', false],
  ['?demonstration=1', false],
  ['?gallery', false],
])('%s opens demo mode: %s', (search, demo) => {
  render(<Root search={search} dev={false} />);
  expect(received.at(-1)!.demo).toBe(demo);
});
