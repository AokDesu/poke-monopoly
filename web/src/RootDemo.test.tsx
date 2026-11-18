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

// Demo mode is opened only by `?demo`; every other address, a playtest session's included, is a
// normal game that never shows a rival's private options (spec §1, issue #220).
test.each([
  ['?demo', true],
  ['?seed=3&demo', true],
  ['', false],
  ['?seed=3', false],
  ['?P5-A01', false],
  ['?P5-A01&demo', false],
  ['?demo&G1-C12', false],
  ['?demo&p5-b03&seed=4', false],
  ['?demonstration=1', false],
  ['?gallery', false],
])('%s opens demo mode: %s', (search, demo) => {
  render(<Root search={search} dev={false} />);
  expect(received.at(-1)!.demo).toBe(demo);
});
