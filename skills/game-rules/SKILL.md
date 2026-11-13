---
name: game-rules
description: 'Maps game-rule topics to spec sections. Read before implementing or changing any rule, engine behaviour, content number or invariant, and cite the section in the pull request.'
---

# Game rules

The rules live in `docs/SPEC-v1.0-PokeMonopoly.md`, not here. Find the topic, read that section, and cite it in the pull request (`Spec: §...`). A rule change updates the spec and its tests in the same pull request. Numbers live only in the engine.

| Topic                                                       | Spec section |
| ----------------------------------------------------------- | ------------ |
| Goal, hypotheses, success criteria, delivery scope          | §1           |
| Screens and flow; unspecified situations                    | §3, §3.1     |
| Setup, board, starting kit, Start income                    | §4.1         |
| Turn order, action budgets, social window                   | §4.2         |
| Catching and Balls                                          | §4.3         |
| Combat, PvP, Gym, Tired, Battle Reward                      | §4.4         |
| Encounters, Abilities, evolution, Starters, Rescue Starter  | §4.5         |
| Items, Shop, hostile items, slowing effects, Events         | §4.6         |
| Selling at Start, Laps, game end, winner                    | §4.7         |
| Chat, Deal Cards, concession budget, `no_attack` promise    | §4.8         |
| Division of labour: engine, Jev, line bank, fallback        | §5.2         |
| Difficulty, confidence floor, fallback, deadlines           | §5.6         |
| Movement and Laps, action records, counters, save, replay   | §6           |
| Tests, engine invariants, simulation, playtest              | §8           |
| Budgets, kill switch, safety                                | §9           |
| Board layout, classes, species, Abilities, items, evolution | Appendix A   |
| Example Jev request and response                            | Appendix B   |
| Ability primitive mapping, battle and Ability timing        | Appendix C   |
