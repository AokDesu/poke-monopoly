import { t } from '../i18n/th.ts';

type SpaceKind = 'start' | 'wild' | 'event' | 'shop' | 'gym';

const KIND_FILL: Record<SpaceKind, string> = {
  start: 'bg-serial border-serial',
  wild: 'bg-kind-wild border-line-strong/40',
  event: 'bg-kind-event border-line-strong/40',
  shop: 'bg-kind-shop border-line-strong/40',
  gym: 'bg-kind-gym border-line-strong/40',
};
const LEGEND: readonly SpaceKind[] = ['start', 'wild', 'event', 'shop', 'gym'];

/**
 * Grid cell of a board square on a square loop: Start in the bottom-right corner, play running
 * left along the bottom, up, across the top and back down, one quarter of the board per side.
 */
function cellOf(position: number, length: number): { row: number; column: number } {
  const side = length / 4;
  const step = position % side;
  switch (Math.floor(position / side)) {
    case 0:
      return { row: side + 1, column: side + 1 - step };
    case 1:
      return { row: side + 1 - step, column: 1 };
    case 2:
      return { row: 1, column: 1 + step };
    default:
      return { row: 1 + step, column: side + 1 };
  }
}

/** The content board as a loop of squares coloured by kind, with a legend in the middle. */
export function BoardRing({ board }: { board: readonly { position: number; kind: SpaceKind }[] }) {
  const size = board.length / 4 + 1;
  return (
    <figure
      className="grid aspect-square w-full max-w-[26rem] gap-1.5"
      style={{
        gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`,
      }}
    >
      {board.map(({ position, kind }) => {
        const { row, column } = cellOf(position, board.length);
        return (
          <span
            key={position}
            aria-hidden="true"
            className={`flex items-center justify-center rounded-md border ${KIND_FILL[kind]}`}
            style={{ gridRow: row, gridColumn: column }}
          >
            {kind === 'start' && (
              <svg
                viewBox="0 0 16 16"
                className="size-1/2 text-on-accent"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13 8H3m4-4L3 8l4 4" />
              </svg>
            )}
          </span>
        );
      })}
      <figcaption
        className="flex flex-col justify-center gap-2 px-3 text-sm"
        style={{ gridRow: `2 / ${size}`, gridColumn: `2 / ${size}` }}
      >
        <span className="font-bold">{t('home.boardCaption')}</span>
        <ul className="grid gap-1.5">
          {LEGEND.map((kind) => (
            <li key={kind} className="flex items-center gap-2.5 text-ink-soft">
              <span className={`size-3.5 shrink-0 rounded-[4px] border ${KIND_FILL[kind]}`} />
              {t(`board.kind.${kind}`)}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
