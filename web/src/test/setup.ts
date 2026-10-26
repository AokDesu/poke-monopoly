import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// Vitest globals are off, so Testing Library cannot register its own cleanup.
// Clear browser storage so a save written by one test is not a Continue prompt in the next.
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});
