import { t } from '../i18n/en.ts';
import { speciesName } from '../i18n/names.ts';
import { SpeciesFacts } from '../ui/SpeciesFacts.tsx';

/** Tags, battle, base value and Ability of the Starter a seat would begin with (§4.1, §4.5). */
export function StarterFacts({ speciesId, rival = false }: { speciesId: string; rival?: boolean }) {
  const name = speciesName(speciesId);
  const heading = rival ? t('starter.rivalFacts', { name }) : t('starter.facts', { name });
  return (
    <section className="panel mt-6 p-5 sm:p-6" aria-label={heading}>
      <h2 className="text-xl">{heading}</h2>
      <SpeciesFacts speciesId={speciesId} />
    </section>
  );
}
