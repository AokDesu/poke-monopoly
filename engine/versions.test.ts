import { expect, test } from 'vitest';
import {
  createGameConfig,
  createLogHeader,
  gameConfigSchema,
  logHeaderSchema,
  ENGINE_VERSION,
  CONTENT_VERSION,
  RNG_VERSION,
} from './index.ts';

test('new configs and every log header stamp the engine, content and RNG versions (spec §6.8)', () => {
  const config = createGameConfig({
    seats: [
      { actorId: 'human', seatIndex: 0, classId: 'rival', controller: 'human' },
      { actorId: 'bot', seatIndex: 1, classId: 'rival', controller: 'ai' },
    ],
    seed: 1,
    lapTarget: 3,
  });
  const stamps = {
    engineVersion: ENGINE_VERSION,
    contentVersion: CONTENT_VERSION,
    rngVersion: RNG_VERSION,
  };
  expect(config).toMatchObject(stamps);
  expect(gameConfigSchema.parse(config)).toEqual(config);
  const header = createLogHeader(config);
  expect(header).toEqual({ initialConfig: config, seed: 1, ...stamps });
  expect(logHeaderSchema.parse(header)).toEqual(header);
  for (const field of ['engineVersion', 'contentVersion', 'rngVersion'] as const) {
    const missing = { ...header } as Partial<typeof header>;
    delete missing[field];
    expect(logHeaderSchema.safeParse(missing).success).toBe(false);
  }
});

test('headers preserve historical stamps and reject mismatches with their initial config', () => {
  const config = gameConfigSchema.parse({
    seats: [
      { actorId: 'human', seatIndex: 0, classId: 'rival', controller: 'human' },
      { actorId: 'bot', seatIndex: 1, classId: 'rival', controller: 'ai' },
    ],
    seed: 'old-game',
    lapTarget: 3,
    engineVersion: 'historical-engine',
    contentVersion: 'historical-content',
    rngVersion: 'historical-rng',
  });
  const header = createLogHeader(config);
  expect(header).toMatchObject({
    seed: 'old-game',
    engineVersion: 'historical-engine',
    contentVersion: 'historical-content',
    rngVersion: 'historical-rng',
  });
  for (const field of ['seed', 'engineVersion', 'contentVersion', 'rngVersion'] as const) {
    expect(logHeaderSchema.safeParse({ ...header, [field]: 'mismatch' }).success).toBe(false);
  }
  config.seats[0]!.actorId = 'changed';
  expect(header.initialConfig.seats[0]!.actorId).toBe('human');
});
