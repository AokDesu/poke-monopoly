// Pip positions on a 3x3 grid (1-9, row by row) for each face of a d6.
const PIPS: Record<number, readonly number[]> = {
  1: [5],
  2: [3, 7],
  3: [3, 5, 7],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

/**
 * A white game die lit from above showing an engine roll; decorative, the number is also text
 * beside it. Stamps in when it first appears (CSS, off under reduced motion).
 */
export function DieFace({ value, order = 0 }: { value: number; order?: number }) {
  return (
    <span
      aria-hidden="true"
      className="die-stamp grid size-14 shrink-0 grid-cols-3 grid-rows-3 gap-0.5 rounded-xl bg-[linear-gradient(180deg,#ffffff,#e8eefb)] p-2 shadow-[inset_0_2px_0_#fff,0_5px_0_var(--color-panel-lip),0_10px_16px_-8px_rgb(16_38_84/0.45)]"
      style={{ animationDelay: `${order * 160}ms` }}
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span
          key={index}
          className={`m-auto size-2.5 rounded-full ${
            PIPS[value]?.includes(index + 1)
              ? value === 1
                ? 'bg-action'
                : 'bg-ink'
              : 'bg-transparent'
          }`}
        />
      ))}
    </span>
  );
}
