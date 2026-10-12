import type { JevClient, JevRequest, JevResult } from './client.ts';

export interface FakeJevClient extends JevClient {
  /** Every request that reached the fake, in order. */
  readonly requests: JevRequest[];
}

/**
 * A `JevClient` for tests that answers from `respond` without the SDK, a key or the network.
 * Like the real client, it returns `timeout` once the decision signal has fired.
 */
export const createFakeJevClient = (
  respond: (request: JevRequest) => JevResult | Promise<JevResult>,
): FakeJevClient => {
  const requests: JevRequest[] = [];
  return {
    requests,
    async ask(request, { decisionSignal }) {
      if (decisionSignal.aborted)
        return { ok: false, fallbackReason: 'timeout', requestSent: false };
      requests.push(request);
      const result = await respond(request);
      return decisionSignal.aborted ? { ok: false, fallbackReason: 'timeout' } : result;
    },
  };
};
