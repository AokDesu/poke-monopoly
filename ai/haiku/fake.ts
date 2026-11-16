import type { HaikuClient, HaikuRequest, HaikuResult } from './client.ts';

export interface FakeHaikuClient extends HaikuClient {
  /** Every request that reached the fake, in order. */
  readonly requests: HaikuRequest[];
}

/** A `HaikuClient` for tests that answers from `respond` without a key or the network. */
export const createFakeHaikuClient = (
  respond: (request: HaikuRequest) => HaikuResult | Promise<HaikuResult>,
): FakeHaikuClient => {
  const requests: HaikuRequest[] = [];
  return {
    requests,
    async write(request) {
      requests.push(request);
      return respond(request);
    },
  };
};
