import { readdirSync, readFileSync } from 'node:fs';
import { parseContent, type ParsedContent } from '../content/schema.ts';

/**
 * Node loader: reads every `content/*.json` (the engine never reads files) and validates it.
 * A browser app imports the same JSON files and calls `parseContent` itself.
 */
export function loadContent(dir = new URL('../content/', import.meta.url)): ParsedContent {
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  return parseContent(
    Object.fromEntries(
      files.map((name) => [
        name.slice(0, -'.json'.length),
        JSON.parse(readFileSync(new URL(name, dir), 'utf8')),
      ]),
    ),
  );
}
