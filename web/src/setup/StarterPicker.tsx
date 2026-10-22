import { speciesType } from '../game/content.ts';
import { speciesName } from '../i18n/names.ts';
import { TypeOrb } from '../ui/TypeOrb.tsx';

interface StarterPickerProps {
  /** Groups the radios; one picker per seat. */
  name: string;
  legend: string;
  speciesIds: readonly string[];
  chosen: string;
  onChoose: (speciesId: string) => void;
}

/** The Starter of a class that offers several (spec §4.1); preset to the first. */
export function StarterPicker({ name, legend, speciesIds, chosen, onChoose }: StarterPickerProps) {
  return (
    <fieldset className="panel mt-8 p-5 sm:p-6">
      <legend className="sr-only">{legend}</legend>
      <p aria-hidden="true" className="font-display text-xl font-semibold">
        {legend}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {speciesIds.map((speciesId) => {
          const checked = chosen === speciesId;
          return (
            <label
              key={speciesId}
              className={`flex cursor-pointer items-center gap-3 rounded-full py-2 ps-2 pe-5 font-display text-lg transition-[box-shadow,background-color] duration-150 has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ink ${
                checked
                  ? 'bg-reward shadow-[0_4px_0_var(--color-reward-lip)]'
                  : 'bg-panel-tint shadow-[inset_0_0_0_2px_var(--color-line)] hover:shadow-[inset_0_0_0_2px_var(--color-reward)]'
              }`}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                value={speciesId}
                checked={checked}
                onChange={() => onChoose(speciesId)}
              />
              <TypeOrb type={speciesType(speciesId)} className="size-10" />
              {speciesName(speciesId)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
