import type { Observation } from '../../../engine/index.ts';

type Kind = Observation['public']['board'][number]['kind'];
const PATHS: Record<Kind, string> = {
  start: 'M5 21V3m0 1h14l-3 4 3 4H5',
  wild: 'M12 21V10m0 6C4 17 3 10 4 5c5 0 8 3 8 8m0 1c0-6 4-10 9-11 1 7-2 13-9 13',
  event: 'm12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
  shop: 'M4 10v11h16V10M2 9l3-6h14l3 6c0 3-5 4-5 0 0 4-5 4-5 0 0 4-5 4-5 0 0 4-5 3-5 0m7 12v-7h6v7',
  gym: 'm12 2 9 5-9 5-9-5Zm-7 9v8m7-5v7m7-10v8M3 22h18',
};

/** Landmark silhouettes stay distinct in monochrome; labels are always adjacent. */
export function SpaceIcon({ kind }: { kind: Kind }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[kind]} />
    </svg>
  );
}

export function RouteArrow({ direction }: { direction: string }) {
  return (
    <svg
      className={`route-arrow route-arrow-${direction}`}
      viewBox="0 0 18 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 6h13m-4-4 4 4-4 4" />
    </svg>
  );
}
