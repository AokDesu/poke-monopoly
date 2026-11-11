import type { Content } from './contract/schema.ts';

export type EffectiveForm = Content['species'][number];

/**
 * Current form ID is stored in PokemonInstance.speciesId. Explicit definitions win;
 * undefined forms inherit from the previous stage, rounding Base Sale at each step (§4.5).
 * Returns detached data and never changes a snapshot or draws randomness.
 */
export function effectiveForm(content: Content, formId: string): EffectiveForm {
  function resolve(id: string, visiting: Set<string>): EffectiveForm {
    const defined = content.species.find((entry) => entry.id === id);
    if (defined) return structuredClone(defined);
    if (visiting.has(id)) throw new RangeError(`Cyclic evolution form: ${id}`);
    visiting.add(id);
    const form = content.evolutions?.forms.find((entry) => entry.id === id);
    if (!form) throw new RangeError(`Unknown form: ${id}`);
    const matches = content.evolutions!.lines.flatMap((line) =>
      line.stages.flatMap((stage, index) => (stage.forms.includes(id) ? [{ line, index }] : [])),
    );
    if (matches.length !== 1) throw new RangeError(`Ambiguous or missing evolution line: ${id}`);
    const { line, index } = matches[0]!;
    const previous = index === 0 ? [line.speciesId] : line.stages[index - 1]!.forms;
    if (previous.length !== 1) throw new RangeError(`Ambiguous previous form: ${id}`);
    const current = resolve(previous[0]!, visiting);
    return {
      ...current,
      id: form.id,
      name: form.name,
      battle: current.battle + 2,
      base: Math.round(current.base * 1.5),
    };
  }
  return resolve(formId, new Set());
}

/** Legal next IDs only: branches remain explicit player choices, with no automatic selection. */
export function nextEvolutionForms(content: Content, formId: string): string[] {
  effectiveForm(content, formId); // Unknown forms are errors, rather than final forms.
  const matches = (content.evolutions?.lines ?? []).flatMap((line) => {
    if (line.speciesId === formId) return [line.stages[0]!.forms];
    const at = line.stages.findIndex((stage) => stage.forms.includes(formId));
    return at < 0 ? [] : [line.stages[at + 1]?.forms ?? []];
  });
  if (matches.length > 1) throw new RangeError(`Ambiguous evolution branch: ${formId}`);
  return [...(matches[0] ?? [])];
}

/** Resolve only a legal one-stage branch; no instance, status or cooldown is changed here. */
export function evolvedForm(
  content: Content,
  currentFormId: string,
  nextFormId: string,
): EffectiveForm {
  if (!nextEvolutionForms(content, currentFormId).includes(nextFormId)) {
    throw new RangeError(`Invalid evolution branch: ${currentFormId} -> ${nextFormId}`);
  }
  return effectiveForm(content, nextFormId);
}
