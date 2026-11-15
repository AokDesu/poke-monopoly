/// <reference types="vite/client" />

/** True only under the Vite dev server: the developer gallery's switch (`vite.config.ts`). */
declare const __UI_GALLERY__: boolean;

declare module 'virtual:board-fixtures' {
  const fixtures: Readonly<
    Record<
      string,
      {
        observation: import('../../engine/index.ts').Observation;
        events: import('../../engine/index.ts').EngineEvent[];
      }
    >
  >;
  export default fixtures;
}

declare module 'virtual:gallery-fixtures' {
  const fixtures: import('./gallery/scenes.ts').GalleryFixtures;
  export default fixtures;
}
