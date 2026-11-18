# Advisor notice: opponent dialogue in Poke Monopoly

Sent: not yet

Reply: no reply yet

The original proposal said AI opponents would “generate brief dialogue.” Specification
v1.0 changed how that dialogue is produced, and the 15 Nov 2026 revision (§0, “Changes
in v1.1”) adds a second, optional source of words. This notice says what the game does
now, what is unchanged and what is optional. It is sent once the speech route and its
leak tests have merged, so it can report what was built and tested.

## What changed and why

- **Decisions (unchanged since v1.0).** Jev, the decision model that drives the AI
  opponents, answers structured multiple-choice and yes/no questions and returns
  probabilities and confidence. It cannot generate text, so it never writes dialogue.
- **Line bank (now the fallback).** The team writes short English lines in a line bank,
  matched to each opponent's personality, the game situation and their trust in the
  player. Jev selects a line ID from the bank; if Jev is unavailable, a seeded random
  fallback does. These lines react to the game, such as accepting or rejecting a deal,
  a kept or broken promise or a Gym win, and they stay the source of every after-action
  line.
- **Haiku-written speech (new, 15 Nov 2026).** The words of table talk and chat replies are
  written by a separate generative model (Anthropic Haiku), in the voice of the seat's
  class, personality and difficulty and one fixed, team-written world card. AIs may also
  talk to each other in a public Table talk panel: at most one exchange per round and 10
  per game, none at Fast or Instant speed.
- **Watch mode (new, 15 Nov 2026).** The player may set up 2–4 AI opponents and watch them
  play each other, seeing only the public view of the game.

## What Haiku can and cannot do

- It decides nothing. Code and Jev choose the speaker, the addressed seat, the topic
  and the decision the words must match; Haiku only writes the words. Its text is words
  only: it is not a game action, spends no budget and never changes a coin, a deal, a
  die roll, legality or any later decision.
- It sees only a public speech brief: public facts, the speaker's own setup and the
  world card. It never gets a hand, a Ball count, a peek result, a private chat, the
  seed or the deck order, and never a number it could state or compare.
- It writes one plain-text line of at most 140 characters. An output screen rejects a
  line with a digit, a link, a non-public item name, an offer or promise, or an echo of
  the instruction. A rejected, late (3,000 ms) or missing line is replaced by a
  line-bank line, or by silence. The game never waits for Haiku.
- The player is told: generated lines are labelled “AI-written · only words”, and a
  “Voice off” badge shows why when Haiku is off.
- It must pass the leak tests (the adversarial set now includes at least 30 speech
  items) before it is enabled.

## What is optional

Haiku speech is off unless `HAIKU_ENABLED=true`, and the game plays the same without it:
every line then comes from the line bank. Haiku spend is capped at THB 150 in total,
and at 150 calls and 200,000 input tokens per game, inside the THB 1,500 cap for all AI
spend. Past a cap the line bank takes over. Table talk between AIs and watch mode are
additions; neither changes the rules or the AI's decisions.

Reference: the specification, 15 Nov 2026 revision, §0 (changes from v0.8, and changes in v1.1), §3, §4.2,
§4.8, §5.2, §5.4, §5.7 (dialogue), §9 (control) and §12 (risks and open decisions).
