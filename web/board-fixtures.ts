import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { projectBoardFixture } from './src/game/store.ts';

/** Transform fixtures in Node so private state is never served to a seat, even on the dev route. */
export function boardFixtures(): Plugin {
  const directory = new URL('../engine/fixtures/', import.meta.url);
  return {
    name: 'seat-safe-board-fixtures',
    resolveId(id) {
      if (id === 'virtual:board-fixtures') return '\0virtual:board-fixtures';
    },
    load(id) {
      if (id !== '\0virtual:board-fixtures') return;
      const fixtures = Object.fromEntries(
        readdirSync(directory)
          .filter((name) => name.endsWith('.json'))
          .sort()
          .map((file) => {
            const path = new URL(file, directory);
            this.addWatchFile(fileURLToPath(path));
            return [
              file.replace(/\.json$/, ''),
              projectBoardFixture(JSON.parse(readFileSync(path, 'utf8'))),
            ];
          }),
      );
      return `export default ${JSON.stringify(fixtures)};`;
    },
  };
}
