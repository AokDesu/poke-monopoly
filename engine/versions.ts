import { CONTENT_VERSION } from '../content/index.ts';
import { RNG_VERSION } from './rng.ts';
import {
  gameConfigSchema,
  logHeaderSchema,
  type GameConfig,
  type LogHeader,
} from './contract/schema.ts';

export const ENGINE_VERSION = '0.5.0';
export { CONTENT_VERSION };

export function createGameConfig(
  input: Omit<GameConfig, 'engineVersion' | 'contentVersion' | 'rngVersion'>,
): GameConfig {
  return gameConfigSchema.parse({
    ...input,
    engineVersion: ENGINE_VERSION,
    contentVersion: CONTENT_VERSION,
    rngVersion: RNG_VERSION,
  });
}

/** Detached versioned header, shared by command logs and historical metadata. */
export function createLogHeader(config: GameConfig): LogHeader {
  return logHeaderSchema.parse({
    initialConfig: config,
    seed: config.seed,
    engineVersion: config.engineVersion,
    contentVersion: config.contentVersion,
    rngVersion: config.rngVersion,
  });
}
