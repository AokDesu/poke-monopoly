import { classOptions, content } from '../game/content.ts';
import { MODES } from '../game/store.ts';
import { t, type MessageKey } from '../i18n/en.ts';

/**
 * Every feature the walkthrough can describe. A feature is `true` only while its screen is on
 * main; the steps below are built from this list, so a step cannot appear without its screen.
 * Deal Cards and promises (#138, #139) have no screen yet, so they have no entry at all.
 */
export const FEATURE_IDS = [
  'turn',
  'events',
  'catch',
  'sell',
  'shop',
  'items',
  'battle',
  'abilities',
  'social',
  'ending',
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];
export type Features = Readonly<Record<FeatureId, boolean>>;

export const AVAILABLE_FEATURES: Features = {
  turn: true,
  events: true,
  catch: true,
  sell: true,
  shop: true,
  items: true,
  battle: true,
  abilities: true,
  social: true,
  ending: true,
};

/** Button names and messages a paragraph quotes: the catalogue's own words, never retyped. */
const WORDS = {
  release: 'encounter.release',
  noBall: 'action.reason.NO_BALL',
  sell: 'sell.confirm',
  keep: 'sell.keep',
  leaveShop: 'shop.skip',
  notEnough: 'action.reason.NOT_ENOUGH_COINS',
  skipItems: 'strategy.skip',
  skipTalking: 'social.skip',
} as const satisfies Record<string, MessageKey>;

type VisualId = 'kit' | 'wild' | 'starters' | 'income' | 'laps';

interface StepPart {
  /** The paragraph shows only while this feature's screen is on main. */
  readonly feature: FeatureId;
  readonly text: MessageKey;
  readonly words?: readonly (keyof typeof WORDS)[];
  readonly visuals?: readonly VisualId[];
}

interface StepDefinition {
  readonly id: string;
  readonly title: MessageKey;
  readonly parts: readonly StepPart[];
}

/** The walkthrough in order. Each step needs at least one part whose feature is available. */
const STEPS: readonly StepDefinition[] = [
  {
    id: 'move',
    title: 'howToPlay.move.title',
    parts: [
      { feature: 'turn', text: 'howToPlay.move.turn', visuals: ['kit'] },
      { feature: 'events', text: 'howToPlay.move.events' },
    ],
  },
  {
    id: 'catch',
    title: 'howToPlay.catch.title',
    parts: [
      {
        feature: 'catch',
        text: 'howToPlay.catch.catch',
        words: ['release', 'noBall'],
        visuals: ['wild'],
      },
    ],
  },
  {
    id: 'sell',
    title: 'howToPlay.sell.title',
    parts: [
      {
        feature: 'sell',
        text: 'howToPlay.sell.sell',
        words: ['sell', 'keep'],
        visuals: ['starters', 'income'],
      },
    ],
  },
  {
    id: 'shop',
    title: 'howToPlay.shop.title',
    parts: [
      { feature: 'shop', text: 'howToPlay.shop.shop', words: ['leaveShop', 'notEnough'] },
      { feature: 'items', text: 'howToPlay.shop.items', words: ['skipItems'] },
    ],
  },
  {
    id: 'battle',
    title: 'howToPlay.battle.title',
    parts: [
      { feature: 'battle', text: 'howToPlay.battle.battle' },
      { feature: 'abilities', text: 'howToPlay.battle.abilities' },
    ],
  },
  {
    id: 'talk',
    title: 'howToPlay.talk.title',
    parts: [{ feature: 'social', text: 'howToPlay.talk.social', words: ['skipTalking'] }],
  },
  {
    id: 'end',
    title: 'howToPlay.end.title',
    parts: [{ feature: 'ending', text: 'howToPlay.end.ending', visuals: ['laps'] }],
  },
];

/** One labelled number, read from the content or the engine when the step is built. */
export interface Fact {
  readonly id: string;
  readonly value: number;
  readonly label: string;
}

export type Visual =
  | { readonly kind: 'facts'; readonly name: string; readonly facts: readonly Fact[] }
  | {
      readonly kind: 'pokemon';
      readonly name: string;
      readonly speciesIds: readonly string[];
    }
  | { readonly kind: 'starters'; readonly speciesIds: readonly string[] };

export interface HowToPlayStep {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly visuals: readonly Visual[];
}

/** The numbers the walkthrough shows, as the game itself reads them. */
export interface WalkthroughNumbers {
  readonly config: Pick<typeof content.config, 'startingKit' | 'startIncome'>;
  /** Spec §1: the presets setup offers, each with the Laps it takes. */
  readonly modes: Readonly<
    Record<string, { readonly lapTarget: number; readonly enabled: boolean }>
  >;
}

const RARITIES = ['common', 'uncommon', 'rare'] as const;

/** A few species a player can meet in the wild: the first of each rarity in the encounter pool. */
function wildSample(): string[] {
  const pool = content.species.filter((species) => species.inEncounterPool);
  return RARITIES.flatMap((rarity) => {
    const first = pool.find((species) => species.rarity === rarity);
    return first ? [first.id] : [];
  });
}

function visualFor(id: VisualId, numbers: WalkthroughNumbers): Visual | undefined {
  const { startingKit, startIncome } = numbers.config;
  switch (id) {
    case 'kit':
      return {
        kind: 'facts',
        name: t('howToPlay.fact.kit'),
        facts: [
          { id: 'coins', value: startingKit.coins, label: t('howToPlay.fact.coins') },
          { id: 'starters', value: startingKit.starters, label: t('howToPlay.fact.starters') },
          { id: 'balls', value: startingKit.pokeBalls, label: t('howToPlay.fact.balls') },
          { id: 'items', value: startingKit.classItems, label: t('howToPlay.fact.classItems') },
        ],
      };
    case 'income':
      return {
        kind: 'facts',
        name: t('howToPlay.fact.incomeName'),
        facts: [{ id: 'income', value: startIncome, label: t('howToPlay.fact.income') }],
      };
    case 'laps':
      return {
        kind: 'facts',
        name: t('howToPlay.fact.lapsName'),
        facts: Object.entries(numbers.modes)
          .filter(([, mode]) => mode.enabled)
          .map(([mode, { lapTarget }]) => ({
            id: mode,
            value: lapTarget,
            label: t('howToPlay.fact.laps', { mode: t(`mode.${mode as 'quick' | 'standard'}`) }),
          })),
      };
    case 'wild': {
      const speciesIds = wildSample();
      return speciesIds.length === 0
        ? undefined
        : { kind: 'pokemon', name: t('howToPlay.fact.wild'), speciesIds };
    }
    case 'starters': {
      const starter = classOptions.find((option) => option.playable);
      return starter ? { kind: 'starters', speciesIds: starter.starterSpeciesIds } : undefined;
    }
  }
}

/**
 * The walkthrough's steps for the features on main. A paragraph, its picture and its numbers
 * belong to one feature; a step with no available paragraph is left out, never "coming soon".
 */
export function buildSteps(
  features: Features = AVAILABLE_FEATURES,
  numbers: WalkthroughNumbers = { config: content.config, modes: MODES },
): HowToPlayStep[] {
  return STEPS.flatMap((step) => {
    const parts = step.parts.filter((part) => features[part.feature]);
    if (parts.length === 0) return [];
    const visuals = parts.flatMap((part) =>
      (part.visuals ?? []).flatMap((id) => visualFor(id, numbers) ?? []),
    );
    return [
      {
        id: step.id,
        title: t(step.title),
        paragraphs: parts.map((part) =>
          t(
            part.text,
            Object.fromEntries((part.words ?? []).map((word) => [word, t(WORDS[word])])),
          ),
        ),
        visuals,
      },
    ];
  });
}
