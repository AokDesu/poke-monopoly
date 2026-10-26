/// <reference types="vite/client" />

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
