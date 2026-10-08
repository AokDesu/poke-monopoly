import { expect, test } from 'vitest';
import { App } from './App.tsx';

test('web app entry component is a function', () => {
  expect(typeof App).toBe('function');
});
