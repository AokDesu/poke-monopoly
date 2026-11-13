import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { projectBoardFixture } from './src/game/store.ts';

const BOARD = '\0virtual:board-fixtures';
const GALLERY = '\0virtual:gallery-fixtures';
/** The engine fixtures the dev gallery starts from (`src/gallery/scenes.ts`, `GalleryFixtures`). */
const GALLERY_FIXTURES = [
  'encounter-no-ball',
  'sell-phase-three-pokemon',
  'shop-low-coins',
  'shop-no-coins',
] as const;

/** Transform fixtures in Node so private state is never served to a seat, even on the dev route. */
export function boardFixtures(): Plugin {
  const directory = new URL('../engine/fixtures/', import.meta.url);
  let building = false;
  return {
    name: 'seat-safe-board-fixtures',
    configResolved(config) {
      building = config.command === 'build';
    },
    resolveId(id) {
      if (id === 'virtual:board-fixtures') return BOARD;
      if (id === 'virtual:gallery-fixtures') return GALLERY;
    },
    load(id) {
      if (id === GALLERY) {
        // The gallery starts from whole engine snapshots. They may reach the dev server only:
        // a production build that imports this module fails instead of shipping them.
        if (building) {
          throw new Error('virtual:gallery-fixtures is dev-only and must not enter a build');
        }
        const fixtures = Object.fromEntries(
          GALLERY_FIXTURES.map((name) => {
            const path = new URL(`${name}.json`, directory);
            this.addWatchFile(fileURLToPath(path));
            return [name, JSON.parse(readFileSync(path, 'utf8'))];
          }),
        );
        return `export default ${JSON.stringify(fixtures)};`;
      }
      if (id !== BOARD) return;
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
