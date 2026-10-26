# Jev spike report

Live latency, token and cost measurements for `jev-1.13.0`, from `eval/jev/spike.ts` (issue #5). Spec: v1.0 §5.1, §5.6, §9, §12.

## Verdict

**The deadlines of 1,000 ms per request and 1,500 ms per decision (§5.6) are realistic.** p95 was 324 ms and 374 ms in the two runs of the 30-minute window, and 384 ms in an earlier run. Every run's p95 is below 400 ms, under half the request deadline. No request returned 429 or 5xx. One request in 300 timed out at the 1,000 ms deadline (22 Oct). §5.6 already handles that case: the AI falls back for that decision.

**Cost is higher than §9 estimates: about $0.019 per Standard 4-seat game, not $0.015**, because real requests average about 3,240 input tokens, not 2,500. This stays well inside §9's limits: 1,000 games cost about THB 629 of the THB 1,500 cap.

## Runs

All three runs used the same settings: 100 calls made one at a time, `model: "jev-1.13.0"` on every call, SDK 0.6.0, a 1,000 ms timeout and no retries.

| File                      | Started (UTC)    | Network   | City    | Role                         |
| ------------------------- | ---------------- | --------- | ------- | ---------------------------- |
| `spike-2026-10-26.json`   | 2026-10-26 08:45 | home Wi-Fi | Bangkok | Start of the 30-minute window |
| `spike-2026-10-26-2.json` | 2026-10-26 09:15 | home Wi-Fi | Bangkok | End of the 30-minute window   |
| `spike-2026-10-22.json`   | 2026-10-22 14:24 | not recorded | not recorded | Earlier trial run      |

The 26 Oct pair is the measurement the issue asks for. The 22 Oct run was made without `--network` and `--city`, so its file records neither; it is included as extra evidence.

## Latency

Client wall-clock time per call, from sending the request to the parsed body or the error. Percentiles use the nearest-rank method over all 100 calls, with a timeout counted as at least 1,000 ms.

| Run                    | p50 (ms) | p95 (ms) | Max (ms) | Calls over 500 ms | Timeouts |
| ---------------------- | -------: | -------: | -------: | ----------------: | -------: |
| 26 Oct 08:45           |      278 |      324 |      525 |                 2 |        0 |
| 26 Oct 09:15           |      284 |      374 |      488 |                 0 |        0 |
| 26 Oct pair (200 calls) |      281 |      364 |      525 |                 2 |        0 |
| 22 Oct                 |      305 |      384 |    1,011 |                 1 |        1 |

- The 22 Oct timeout was call 76 (8 strategy options, about 1,800 estimated tokens). It got no HTTP status or request ID. Without it, that run's max is 476 ms.
- Latency barely depends on request size. In the 08:45 run, requests under 2,000 real input tokens had p50 268 ms; requests of 3,500 tokens or more had p50 283 ms.
- Compared with §5.1 (123 to 348 ms, one outlier of 1,795 ms, network not recorded): the medians sit inside that range, and no call in 300 came near the old outlier.

## Errors and rate limits

| Run          | HTTP 200 | 429 | 5xx | Timeouts | Retry-after values |
| ------------ | -------: | --: | --: | -------: | ------------------ |
| 26 Oct 08:45 |      100 |   0 |   0 |        0 | none               |
| 26 Oct 09:15 |      100 |   0 |   0 |        0 | none               |
| 22 Oct       |       99 |   0 |   0 |        1 | none               |

Overall, 299 of 300 calls succeeded: the required 26 Oct pair 200 of 200, and the 22 Oct run 99 of 100. The one failure was the 22 Oct timeout (call 76, `APITimeoutError` at 1,011 ms, no status or request ID); §5.6 falls back on it. No 429 was seen, so there is no retry-after value to report. The calls ran one at a time (about 3.4 requests/s), far below the 40 requests/s limit in §5.1.

## Model pinning

- `client.models.list()` returned only `jev-latest` and `jev-preview` in all three runs. **It does not list `jev-1.13.0`.**
- Every call still requested `jev-1.13.0`. Every response reported `model: "jev-1.13.0"`, and every call that completed succeeded. The required 26 Oct pair succeeded 200 of 200; the only call that did not complete was the 22 Oct timeout above, which returned no body.
- So pinning works even though the listing does not show the pinned version. The production client should not use `models.list()` as a pre-flight check for the pin; it should check the `model` field of each response instead.

## Tokens

Means are over calls that returned a usable answer.

| Run          | Mean input tokens | Mean output tokens | Smallest | Largest |
| ------------ | ----------------: | -----------------: | -------: | ------: |
| 26 Oct 08:45 |           3,242.2 |              127.6 |    1,266 |   5,208 |
| 26 Oct 09:15 |           3,242.2 |              127.6 |    1,266 |   5,208 |
| 22 Oct       |           3,237.3 |              127.6 |    1,266 |   5,208 |

The request builder is deterministic, so all runs sent the same 100 request shapes. That is why input tokens match exactly between the 26 Oct runs.

**The rough estimate undercounts by about 2×.** The spike sizes its requests with a 4-characters-per-token estimate. Those estimates average 1,556 tokens per request, but Jev reported 3,242: 2.05 to 2.21 times more on every call. Requests the spike aimed at 2,500 estimated tokens really cost 5,148 to 5,208 tokens, and 31 of the 100 requests were over 4,000 real tokens.

This matters for §5.4, which limits state to about 4k tokens per request. If that limit is checked with a similar character-based estimate, real requests may be about twice as large. The limit should be checked against real token counts, or a measured ratio, before it is relied on. This report does not change the limit.

## Cost

§9 formula: requests per game × mean input tokens per request × $0.042 per million input tokens, at 33 THB per USD. Output tokens are free (§5.1). Requests per game is §9's ~140 per Standard 4-seat game, which `spike.ts` also uses (`REQUESTS_PER_GAME = 140`). Mean input tokens are 3,242.23, from the 26 Oct pair.

Per game: 140 × 3,242.23 = 453,912 input tokens; 453,912 × $0.042 / 1,000,000 = $0.019064; × 33 = THB 0.63.

| Games | Input tokens | USD     | THB    | §9 estimate (2,500 tokens/request) |
| ----: | -----------: | ------: | -----: | ---------------------------------- |
|     1 |      453,912 |  $0.019 |   0.63 | $0.015 (350k tokens)               |
|   300 |  136,173,660 |   $5.72 | 188.74 | ≈ $4.4, ≈ THB 150                  |
| 1,000 |  453,912,200 |  $19.06 | 629.12 | ≈ $15, ≈ THB 500                   |

The 22 Oct mean (3,237.3) gives the same cost to within 0.2%.

- That is about 1.3 times §9's estimate, because requests are about 1.3 times larger than its 2,500 tokens.
- One game at 454k tokens stays below §9's 600k input-token limit per game.
- 1,000 games at THB 629 stay below the THB 1,500 total cap.
- The spike's state is synthetic. Real game state could be larger or smaller, so the C2 usage log should confirm these numbers.

## What this means for the spec

Nothing in this report changes a spec number. Points for the team to decide separately:

- **§5.6 deadlines:** realistic from a Bangkok home network. A timed-out request leaves 500 ms of the 1,500 ms decision budget, which fits one retry at the measured p95 but not a second timeout. "Fall back immediately on a timeout" is the safer reading.
- **§5.1 latency row:** can now cite a Thai network measurement (p50 about 280 ms, p95 under 400 ms).
- **§9 money:** the estimate is about 1.3 times low; the caps still hold.
- **§5.4 size limit:** needs a real-token check, since rough estimates undercount about 2×.
- **§12 rate limits:** no 429 seen at about 3.4 requests/s; this does not test the 10 requests/s sim concurrency in §9.

## Method

Every number above was recomputed from the per-call records in the three files, not copied from their `summary` blocks, and the two agree. Latency uses `latencyMs`, status counts use `status`, and token means use `inputTokens` and `outputTokens` of calls whose `errorClass` is `null`. The files contain no API key and no state bodies, only the request shapes.
