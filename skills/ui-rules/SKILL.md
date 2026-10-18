---
name: ui-rules
description: 'UI house rules and the spec §3.1 table of unspecified situations with their specified behaviour. Read before building or changing any screen, state, button or message in web/.'
---

# UI rules

Source: spec §3.1 (`docs/SPEC-v1.0-PokeMonopoly.md`). Every case needs a test that can actually reach it ("You cannot test what you cannot reach").

## Decisions you never made

| Situation                                                               | Specified behaviour                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Only one legal action (e.g. must roll)                                  | The engine applies it automatically without calling Jev                                                   |
| Shortlist empty after personality filtering                             | Include at least one option per legal action kind; if still empty, skip                                   |
| Pokémon found but no Ball                                               | The only option is to release; the catch button is greyed out with the reason "No Ball"                   |
| Not enough coins for anything in the Shop                               | Items are greyed out with "Not enough coins", plus a skip button                                          |
| Holding 4 utility items in the Shop                                     | Utility-item offers are greyed out with "Items full"; Balls stay buyable (approved 2026-10-07)            |
| Jev times out, returns 429 or errors mid-deal                           | The fallback policy decides under the same concession budget; the deal does not commit until re-confirmed |
| Jev's answer is not among the options, or the revision does not match   | Discard the answer, use the fallback, and log `fallbackReason`                                            |
| Confidence below the floor                                              | Apply the rule in §5.6                                                                                    |
| Every AI is in backup mode                                              | The game continues with a single banner                                                                   |
| The player types something unclassifiable (emoji, slang)                | intent = `other`; the AI replies with a neutral line and tactics are unchanged                            |
| A message tries to make the AI break rules or reveal hidden information | Reply with a "not falling for it" line; willingness and trust are unchanged                               |
| The browser closes during an AI turn                                    | Resume from the last committed action; cancel the pending request and ask again; never start a new turn   |
| Team is empty after the Sell Phase                                      | Create a Rescue Starter (§4.5)                                                                            |
| Event deck runs out                                                     | Reshuffle the discard pile                                                                                |

## UI house rules

- No blank screens: there is always a message.
- Say what to change, such as the budget or the target.
- An unusable button is greyed out and says why.
- Plain tone, no jokes.
- Every number comes from the engine.
