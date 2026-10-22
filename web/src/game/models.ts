/**
 * Licensed 3D models in `web/public/models/` (see CREDITS.md there for checksums and checks).
 * A species without a model here shows its type orb instead.
 */
export interface ModelCredit {
  readonly file: string;
  readonly title: string;
  readonly author: string;
  readonly licence: 'CC BY 3.0' | 'CC0 1.0';
  readonly source: string;
}

export const SPECIES_MODELS: Readonly<Record<string, ModelCredit>> = {
  bulbasaur: {
    file: '/models/bulbasaur.glb',
    title: 'Low Poly Bulbasaur',
    author: 'Tipatat Chennavasin',
    licence: 'CC BY 3.0',
    source: 'https://poly.pizza/m/aQA7Ls8Y79f',
  },
  charmander: {
    file: '/models/charmander.glb',
    title: 'Low Poly Charmander',
    author: 'Tipatat Chennavasin',
    licence: 'CC BY 3.0',
    source: 'https://poly.pizza/m/d6Ar6_NHbgS',
  },
  squirtle: {
    file: '/models/squirtle.glb',
    title: 'Low Poly Squirtle',
    author: 'Tipatat Chennavasin',
    licence: 'CC BY 3.0',
    source: 'https://poly.pizza/m/b9AHRGUN8jM',
  },
  porygon: {
    file: '/models/porygon.glb',
    title: 'Porygon',
    author: 'themasterswordmaster',
    licence: 'CC0 1.0',
    source: 'https://poly.pizza/m/IxUR1lE08q',
  },
};

export const BALL_MODEL: ModelCredit = {
  file: '/models/pokeball.glb',
  title: 'pokeball',
  author: 'Exceptional_3D',
  licence: 'CC0 1.0',
  source: 'https://poly.pizza/m/m8zAwR6eBA',
};

/** Attribution is required for CC BY; CC0 models are credited too, as a courtesy. */
export const MODEL_CREDITS: readonly ModelCredit[] = [...Object.values(SPECIES_MODELS), BALL_MODEL];
