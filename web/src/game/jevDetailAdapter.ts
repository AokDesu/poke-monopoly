import type { DecisionDetail } from '../../../engine/contract/decision.ts';

/**
 * THE one place that knows how a decision answer carries Jev's detail (issue #220).
 *
 * PROPOSED shape, not on the server yet: an optional `detail` object on the `/api/ai/decide`
 * answer, `{ questionId, confidence, options: [{ id, probability }] }` (`decisionDetailSchema` in
 * `engine/contract/decision.ts`, which the server will parse with). Stream B owns the real field
 * (epic #65). When it lands, change this function and that schema; the panel and the store read
 * only `DecisionDetail`.
 *
 * The browser may not run engine code outside its adapters (spec §6.1), so it checks the shape by
 * hand, as strictly as the schema: anything else is dropped as if it had never come, and a
 * malformed detail must never hold up or change a turn.
 */
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const isChance = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export function readJevDetail(answer: object): DecisionDetail | undefined {
  if (!('detail' in answer)) return undefined;
  const { detail } = answer;
  if (!isObject(detail) || !hasOnly(detail, ['questionId', 'confidence', 'options']))
    return undefined;
  const { questionId, confidence, options } = detail;
  if (!isId(questionId) || !isChance(confidence)) return undefined;
  if (!Array.isArray(options) || options.length < 1 || options.length > 255) return undefined;
  const read: DecisionDetail['options'] = [];
  for (const option of options as unknown[]) {
    if (!isObject(option) || !hasOnly(option, ['id', 'probability'])) return undefined;
    if (!isId(option.id) || !isChance(option.probability)) return undefined;
    read.push({ id: option.id, probability: option.probability });
  }
  return { questionId, confidence, options: read };
}
