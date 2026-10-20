import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';

// Every user-visible string comes from web/src/i18n/th.ts (spec §3, §3.1).
const SRC = join(import.meta.dirname, '..');
const CATALOG = 'i18n/th.ts';
const LETTER = /\p{L}/u;
const THAI = /[\u0E00-\u0E7F]/;
// JSX attributes the browser shows or reads aloud.
const VISIBLE_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title',
]);

/** Does this string literal end up as rendered text or a visible attribute? */
function rendersAsText(literal: ts.Node): boolean {
  let child = literal;
  let parent = literal.parent;
  // `{cond ? 'a' : 'b'}` and `{name ?? 'x'}` render their branch values.
  while (
    ts.isParenthesizedExpression(parent) ||
    (ts.isConditionalExpression(parent) && child !== parent.condition) ||
    (ts.isBinaryExpression(parent) &&
      child === parent.right &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(parent.operatorToken.kind))
  ) {
    child = parent;
    parent = parent.parent;
  }
  if (ts.isJsxExpression(parent)) parent = parent.parent;
  if (ts.isJsxAttribute(parent)) return VISIBLE_ATTRIBUTES.has(parent.name.getText());
  return ts.isJsxElement(parent) || ts.isJsxFragment(parent);
}

function findInlineText(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const findings: string[] = [];
  const visit = (node: ts.Node) => {
    let text: string | undefined;
    if (ts.isJsxText(node)) {
      text = LETTER.test(node.text) ? node.text : undefined;
    } else if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const value = ts.isTemplateExpression(node)
        ? node.head.text + node.templateSpans.map((span) => span.literal.text).join('')
        : node.text;
      text = THAI.test(value) || (LETTER.test(value) && rendersAsText(node)) ? value : undefined;
    }
    if (text !== undefined) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
      findings.push(`${fileName}:${line + 1}: ${text.trim()}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

test('the guard flags inline Thai or English UI text and ignores code strings', () => {
  const source = `
    export function Sample({ name, ok }: { name?: string; ok: boolean }) {
      const label = 'ข้อความไทย';
      return (
        <section className="mt-4 flex gap-2" data-screen="home">
          <h1>Welcome back</h1>
          <p>{'Press start to play'}</p>
          <p>{ok ? t('ok') : 'Something failed'}</p>
          <p>{name ?? \`Guest \${name}\`}</p>
          <button aria-label="Close dialog" type="button">{t('close')}</button>
          {ok === Boolean('home') && <Child screen="setup" />}
        </section>
      );
    }`;
  expect(findInlineText('Sample.tsx', source)).toEqual([
    'Sample.tsx:3: ข้อความไทย',
    'Sample.tsx:6: Welcome back',
    'Sample.tsx:7: Press start to play',
    'Sample.tsx:8: Something failed',
    'Sample.tsx:9: Guest',
    'Sample.tsx:10: Close dialog',
  ]);
});

test('no web/src source types UI text outside the catalog (§3, §3.1)', () => {
  const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && path !== CATALOG);
  expect(sources).toContain('App.tsx');
  const findings = sources.flatMap((path) =>
    findInlineText(relative(SRC, join(SRC, path)), readFileSync(join(SRC, path), 'utf8')),
  );
  expect(findings).toEqual([]);
});
