# Playtest protocol

Spec: §8 (Human layer and playtest), §9 (no personal data), §10 C2 (gate G1).

This protocol is for one facilitator running one session with one participant. It is written before the playable build exists (it lands in cycle 2). Every step that depends on a screen, URL option or file the build does not have yet is marked **[confirm in cycle 2]** and listed in [To confirm when the cycle 2 build lands](#to-confirm-when-the-cycle-2-build-lands). The numbers (session length, 5-second pause) are experimental baselines like the game numbers: change them in a pull request after the first sessions, not in the middle of a round.

## 1. What a session measures

Players play without every button explained (spec §8), then answer four questions. The facilitator records, per session: game length, drop-off, number of meaningful choices, and the keep-or-sell and Ball hesitations (section 6 defines every term). AI turn latency p50 and p95 is not recorded by the facilitator; it comes from the build's usage log (spec §1, §9). For gate G1 it goes in `docs/playtest/g1/ai-latency.md`.

|File|What it is|
|---|---|
|`docs/playtest/PROTOCOL.md`|This file.|
|`docs/playtest/session-sheet.csv`|The empty template: a header row only. Never fill it in place.|
|`docs/playtest/g1/session-sheet-<host>.csv`|A filled copy for gate G1, one per facilitator (see [section 7](#7-after-the-session-where-the-data-goes)).|

## 2. Privacy rules (spec §9)

No personal data about players is stored. These rules apply to everything written down: paper, files, the sheet, issues, pull requests and chat messages.

1. **Participant code only.** The code is `<round>-<host><nn>`, for example `G1-A01`. `<round>` is `G1` for the gate G1 round. `<host>` is the facilitator's stream letter (A, B or C). `<nn>` counts that facilitator's sessions in the round, `01`, `02`, and so on. Assign the next free code when the participant agrees to take part. Never build a code from initials, a birth date, a handle or a seat number.
2. **No key between code and person.** Do not write down, anywhere, which person has which code. Tell the participant their code at the end of the session. It is their only way to ask us to delete their data.
3. **Notes name codes only.** Every note refers to a participant only by code: write `G1-A01 paused at the first Sell Phase`, never a name, nickname, age, school, job, relationship ("my cousin") or description ("the tall one"). This includes scratch notes, the `notes` column, issue titles and text, pull request text and chat messages.
4. **Never record** a name, email address, phone number, chat handle or any contact detail, and never make an audio, video or photo recording. A screenshot is allowed only to show a bug in an issue, and only of the game window: no desktop, browser tabs, profile picture or notifications.
5. **Quotes** from answers are allowed if they hold no name, contact detail or identifying detail. Replace such a part with `[removed]`.
6. **Consent is spoken, not signed.** A signature is a name. Read the consent paragraph in [section 4](#4-scripts-consent-and-briefing). If the participant does not say yes, there is no session and no row. A row in the sheet therefore means consent was given.
7. **In the game:** use the participant code wherever the build asks for a name. The setup in spec §3 asks for none **[confirm in cycle 2]**. Free-text chat arrives in cycle 3. When it is on, tell the participant not to type their real name or contact details. Exported game logs stay out of git unless a bug needs one, and then only after you read the file for typed text.
8. **Deletion.** If a participant gives you their code and asks for deletion, remove their row and notes from the current files in a pull request. History cannot be rewritten (`main` forbids force-push), but it holds nothing that identifies anyone.

## 3. Set-up (before the participant arrives)

Do one dry run of the whole protocol with a teammate before the first real session. Its row is not kept.

1. **Build.** Run the build from a checkout with a clean working tree (`git status --short` prints nothing), so the commit describes what the participant plays. Note the commit: `git rev-parse --short=7 HEAD`. Serve the game with the README commands `npm ci`, `npm run build` and `npm start` (the API and the built web app on port 8787) **[confirm in cycle 2]**.
2. **Seed.** The seed is `100 × host number + session number`, with A = 1, B = 2, C = 3. So `G1-A01` uses seed `101`, `G1-A02` uses `102`, `G1-B01` uses `201`, `G1-C02` uses `302`. Every participant in a round therefore sees a different game. Another round must pick its own range and write it here before it starts.
3. **Start URL.** Open `http://localhost:8787/?seed=<seed>` in Chrome. The planned setup flow reads an optional `?seed=` and does not show it to players (issue #36) **[confirm in cycle 2]**. If the build ignores the seed, do not change it mid-session: write what happened in the `notes` column. If you cannot get the seed into the game, the row's `seed` is the seed in the header of the exported log **[confirm in cycle 2]**.
4. **Jev.** For live Jev, run on a machine that holds the Jev key in its git-ignored `.env`. Never show, paste or type the key near the participant. With `JEV_ENABLED=false` every AI uses the fallback (spec §9). Say which one you used in `notes`. If the "Backup bot mode" badge (spec §3) appears during play, write that in `notes` too.
5. **Screen.** One Chrome window, game at 100% zoom, the Thai UI, notifications off, no other tabs.
6. **Room.** Quiet, one participant at a time. The participant sits at the keyboard. The facilitator sits to the side and a little behind, with a view of the screen.
7. **Tools.** A stopwatch (phone is fine; it is only a clock), and a scratch note laid out like this, with the code and nothing else that identifies anyone:

```text
code: G1-A01   date:        seed:        commit:
play starts (clock):        play ends (clock):
hesitations:  type (sell_keep | ball) | Lap/turn | pause or said | ...
confusion, bugs, restarts, Backup bot badge, jev live/off:
```

## 4. Scripts: consent and briefing

Read the scripts word for word, in the language the participant prefers. The Thai wording should be checked against the Thai glossary when it lands (issue #18).

### Session timeline

|Step|Minutes|Notes|
|---|---|---|
|Welcome, consent|3|Read the consent paragraph. Wait for a yes.|
|Briefing|2|Read the briefing. Start the stopwatch for play when the first-player roll starts.|
|Play|up to 25|Observe and tally. At 25 minutes let the current turn finish, then stop the game (`drop_off_reason` = `time_cap`).|
|Four questions|about 10|Ask in order, word for word.|
|Close|5|Give the participant their code. Thank them. Write the row the same day.|

The slot is 45 minutes in total.

### Consent (read aloud, then wait for a yes)

English:

> Thank you for helping us test a game. We are testing the game, not you, and there is no wrong way to play. You will play one short game while I watch, I will time some of your moves, and afterwards I will ask you four questions. I write down what you do and say under a participant code, such as G1-A01, and never your name, contact details or anything that identifies you; I make no audio, video or photo recordings. You may skip any question, stop at any time without giving a reason, and, if you tell us your code later, ask us to delete your data. Do you agree to take part?

Thai:

> ขอบคุณที่ช่วยทดสอบเกมให้เรา เราทดสอบตัวเกม ไม่ได้ทดสอบคุณ และไม่มีวิธีเล่นที่ผิด คุณจะเล่นเกมสั้น ๆ หนึ่งรอบ โดยมีผู้ดำเนินการนั่งดูและจับเวลาการตัดสินใจบางช่วง และเมื่อเล่นจบจะมีคำถามสี่ข้อ ผู้ดำเนินการจะจดสิ่งที่คุณทำและพูดโดยใช้รหัสผู้เข้าร่วม เช่น G1-A01 เท่านั้น ไม่จดชื่อ ข้อมูลติดต่อ หรือสิ่งที่ระบุตัวตนคุณได้ และไม่อัดเสียง วิดีโอ หรือถ่ายภาพ คุณข้ามคำถามข้อใดก็ได้ หยุดเล่นเมื่อไรก็ได้โดยไม่ต้องบอกเหตุผล และหากแจ้งรหัสของคุณกับเราภายหลัง เราจะลบข้อมูลของคุณให้ คุณยินดีเข้าร่วมหรือไม่

### Briefing (read aloud after the yes)

English:

> This is a board game against a computer opponent. You catch creatures with Balls, decide whether to keep or sell them, and the player with the most coins at the end wins. I will not explain the buttons or tell you what to do. Play as you would on your own. You may talk through your thinking, but you do not have to. If the game freezes or you cannot go on, tell me.

Thai:

> นี่คือเกมกระดานที่เล่นกับคู่แข่งที่เป็นคอมพิวเตอร์ คุณจะจับตัวต่าง ๆ ด้วยบอล แล้วเลือกว่าจะเก็บหรือขาย ใครมีเหรียญมากที่สุดเมื่อจบเกมเป็นผู้ชนะ เราจะไม่อธิบายปุ่มและไม่บอกว่าควรทำอะไร ให้เล่นเหมือนตอนที่เล่นคนเดียว จะพูดความคิดออกมาด้วยก็ได้ แต่ไม่ต้องก็ได้ ถ้าเกมค้างหรือเล่นต่อไม่ได้ ให้บอกเรา

## 5. What the facilitator may and may not say

**May:**

- Read the scripts in section 4 and the four questions in section 6, word for word.
- Answer logistics: where the restroom is, how long is left, whether they can stop.
- When the participant asks about the game, answer only with: "Do what you would do if I were not here." or "What do you think it does?"
- In the question step, ask only a neutral follow-up: "Can you tell me more?" or "Which moment was that?"
- When the build freezes, crashes or shows nothing to do, say "That looks like a problem with the game, not with you", reload the page, choose Continue so the game resumes from the last committed action (spec §3.1, issue #47), and write it in `notes`.
- After the four questions are answered and written down, explain any rule or button the participant asks about.

**May not:**

- Explain rules, buttons, odds, items, classes or strategy before the four questions are answered.
- Comment on a choice, in words or by reaction: no "good choice", "are you sure?", "maybe keep it", no sigh, nod or smile at a decision.
- Prompt or hurry a decision: no "do you want to sell?" and no "take your time". Stay silent while the participant thinks.
- Say that pauses are counted, mention hesitation, gate G1 or the hypotheses, or tell the participant which of their moments you wrote down.
- Describe the AI's personality or say what the AI "is like".
- Ask for or write a name, contact detail, age, school, job or how the participant knows the team.
- Touch the controls, change the seed, re-roll or restart a game that is running fine.
- Record audio, video or photos.
- Lead a question: not "you paused at the sell screen, why?" or "was it hard to choose?".

## 6. During play and the four questions

### Terms

A **decision** is one prompt: a screen or dialog that waits for the player to choose between at least two enabled options. A prompt with only one enabled option is applied automatically (spec §3.1), so it is not a decision.

A **meaningful choice** is one decision the human player made. Count it from the exported game log: every accepted human action that is not marked `auto: true` (engine contract, `advanceAutomatically`). If the build cannot export a log, write `n/a`. Dice rolls the engine applies automatically and one-option steps are never counted **[confirm in cycle 2]**.

A **counted decision type** is one of these two:

|Code|What the decision is|
|---|---|
|`sell_keep`|The Sell Phase at Start (spec §4.7): which Pokémon to sell and which to keep. The whole phase is one decision, however many Pokémon are on the screen. If the build shows one dialog per Pokémon, each dialog is one decision **[confirm in cycle 2]**.|
|`ball`|At an encounter, which Ball to spend, or whether to release instead (spec §4.2 step 6, §4.3). Also buying a Ball at the Shop (spec §4.6), but only when the player chose a Ball or says they were weighing Balls. A Shop pause about utility items does not count.|

A **genuine hesitation** is one decision of a counted type where, while the decision is open (from the options being fully on screen until the player's confirming click or tap), at least one of these happens:

- **Pause:** a stretch of at least 5 seconds with no click or tap. Start the stopwatch when the options and the engine's numbers are fully on screen, and restart it at every click or tap. Looking at a card or reading does not stop the clock.
- **Unsure:** the player says, in any words and in any language, that they are unsure or torn (for example "hmm, I don't know", "ไม่แน่ใจ", "should I keep it? no, wait"), or argues both options aloud.

A hesitation does not count when:

- The options are not fully on screen yet: the page is loading, an animation or an AI line is playing.
- The player is not looking at the game: talking to someone, using a phone, or answering you.
- The pause is the player looking for a control or not understanding it (for example "what does this do?"). Write it in `notes` as confusion.
- You cannot tell whether 5 seconds passed, or whether it was confusion or weighing. When in doubt, do not count it and write what you saw in `notes`. A gate must not pass on a guess.

Count **once per decision**, however long the pause is or however many times the player says they are unsure. Hesitation at any other decision (item use, Shop items, anything else) is not counted. Write it in `notes`.

A **drop-off** is the game ending before the results screen. `drop_off_point` is the stage where it ended. `drop_off_reason` is why.

**Game length** is whole minutes, by the stopwatch, from the start of the first-player roll to the results screen, or to the moment the game stopped. Do not count time the game was paused for you to reload it.

### While the participant plays

Say nothing except what section 5 allows. Watch the screen. For every decision of a counted type, run the stopwatch and listen. When a hesitation happens, add one line to the scratch note: type, Lap or turn, and whether it was a pause, a spoken "unsure" or both. Do not tell the participant. Jot down confusion and bugs as they happen.

### The four questions

After the game, or after the game stopped, ask these in order, word for word, and write the answer down. If the build lacks the feature a question is about (for example there is no chat in the cycle 2 slice, spec §10 C2 and C3), skip it and record `n/a`.

|#|English|Thai|
|---|---|---|
|1|Was there a moment you genuinely hesitated between selling and keeping?|มีช่วงไหนไหมที่คุณลังเลจริง ๆ ว่าจะขายหรือจะเก็บตัวที่จับได้ไว้|
|2|Could you tell an opponent's personality from what it did?|คุณดูออกไหมว่าคู่ต่อสู้ที่เป็น AI มีบุคลิกแบบไหน จากสิ่งที่มันทำ|
|3|Did any conversation change the game?|มีการพูดคุยครั้งไหนไหมที่ทำให้เกมเปลี่ยนไป|
|4|When did waiting or reading get boring?|ช่วงไหนที่คุณรู้สึกเบื่อ เพราะต้องรอหรือต้องอ่าน|

## 7. After the session: where the data goes

1. **Same day, write the row.** Copy the template once per round and facilitator, then add one row per session:

   ```bash
   mkdir -p docs/playtest/g1
   cp docs/playtest/session-sheet.csv docs/playtest/g1/session-sheet-A.csv
   ```

   Use your own stream letter in the file name. One file per facilitator means three people never edit one file at once. For a later round, use a new folder named for the round and say so in that round's issue.
2. **Destroy the scratch note** once the row is written: shred the paper or delete the file.
3. **File issues** for bugs or confusion, titled with the code only (for example `G1-A01: ...`), and list the issue numbers in the row's `notes`.
4. **Check the file** (see the end of section 8), then commit it on a branch and open a pull request that cites spec §8 and §9. A teammate reviews it before merge, as for every pull request (spec §7).
5. **Analysis** reads the committed sheets, nothing else: for G1, the report `docs/playtest/g1/G1-report.md` (issue #54).

## 8. The sheet columns

The file is UTF-8, comma separated, one row per session, one line per row. A cell with a comma or quote is wrapped in double quotes (a quote inside becomes two). Lists inside a cell use `|`. Keep each free-text cell to 200 characters or fewer. A row is complete when no cell is empty. Only `n/a` and `none` stand for "nothing here". No column exists for a name or any contact detail. The only free-text cells are the four answers and `notes`; the code-only rule in section 2 applies to them, and the check at the end of this section screens them.

|Column|Fill with|
|---|---|
|`participant_code`|The code from section 2, for example `G1-A01`.|
|`date`|The session day, `YYYY-MM-DD`.|
|`build_commit`|The 7-character commit from section 3.|
|`seed`|The integer seed from section 3.|
|`game_length_min`|Whole minutes, as defined in section 6.|
|`drop_off_point`|`none` if the game finished. Otherwise `setup` (before the first turn started), `lap1`, `lap2`, `lap3` (Standard only) for the Lap shown on screen when it ended, or `final_round` (after the Final Table Round was announced, spec §4.7).|
|`drop_off_reason`|`none` if the game finished. Otherwise `quit` (the participant stopped), `bug` (the build blocked or crashed), `time_cap` (the 25-minute cap) or `other` (explain in `notes`).|
|`meaningful_choices`|A whole number, as defined in section 6, or `n/a`.|
|`hesitation_count`|The number of genuine hesitations (section 6), `0` if none.|
|`hesitation_decisions`|One code per hesitation, `sell_keep` or `ball`, joined with `\|`, for example `sell_keep\|ball\|sell_keep`. `none` if the count is 0. The number of codes must equal `hesitation_count`.|
|`q1_hesitated_sell_keep`|Start with `yes`, `no` or `unsure`, then ` - ` and a short paraphrase or quote.|
|`q2_opponent_personality`|The same format as question 1, or `n/a`.|
|`q3_conversation_changed_game`|The same format as question 1, or `n/a`.|
|`q4_boring_moment`|`none`, or the moment or screen in a few words, then ` - ` and a short paraphrase or quote.|
|`notes`|Bugs and confusion with issue numbers, hesitations at decisions that did not count, restarts, Jev live or off, Backup bot badge seen. Codes only.|

Example row, invented to show the format only:

```csv
G1-A00,2026-10-29,0000000,100,17,none,none,31,2,sell_keep|ball,yes - unsure whether to sell at the first Start,n/a,n/a,waiting for the AI turn,"Pause at Shop (items), not counted; Jev live"
```

Before committing, read every cell yourself and run this check on your file. It catches the obvious (an `@`, a link, a phone-like number) and proves nothing, so the reviewer reads the file again:

```bash
grep -nEi '@|https?://|www\.|[0-9]{3}[- .][0-9]{3}[- .][0-9]{4}' docs/playtest/g1/session-sheet-A.csv
```

Any line it prints must be explained or fixed.

## 9. Gate G1 pass condition

Gate G1 (spec §10 C2, due 1 Nov) has two parts, and both must hold:

1. **Real keep-or-sell hesitation** (this protocol).
2. **AI decision time p95 of 2 s or less** from real play (spec §1, §10 C2). It is measured from the usage log, not by the facilitator.

**Cohort.** 3 to 5 distinct participant codes with complete rows, each with a commit and a seed. The playtest lead (stream C) stops scheduling at 5. If a sixth session already took place, keep its row, and the G1 report counts the first five by date (then by code) and lists the extra row separately.

**Found hesitation.** A participant found hesitation when both hold:

- Their row has at least one `sell_keep` in `hesitation_decisions`. That is, a genuine hesitation, as defined in section 6, at a Sell Phase.
- Their `q1_hesitated_sell_keep` starts with `yes` or `unsure`. A `no` means the participant does not call it real, so it does not count.

A `ball` hesitation, or a Q1 `yes` with no logged `sell_keep` hesitation, does not count for G1. The report lists both separately, by decision type, so a failure can be understood (the cycle 2 slice has no battles, evolution or Abilities, so hesitation may sit around selling timing and Balls).

**Part 1 passes** when at least 3 participants in the cohort found hesitation. With a cohort of 3, all three must.

**Part 1 fails** when the cohort has reached 5 participants and fewer than 3 found hesitation. With fewer than 5 participants, keep scheduling until either 3 have found hesitation or the cohort has 5. With fewer than 3 complete rows, G1 cannot be called yet.

The 3-of-up-to-5 rule is the G1 gate only. The Human layer playtest with 5 to 8 people in cycle 5 has no pass threshold (spec §8: report issues and findings). If G1 fails, cycle 3 goes to fixing the core loop (spec §10 C2).

## To confirm when the cycle 2 build lands

The owner of the cycle 2 build checks each item against the real build, and fixes this file in the same pull request when it differs.

1. `npm run build` and `npm start` serve the playable game on port 8787, and `?seed=<n>` is read (issue #36).
2. The setup asks for no player name (spec §3).
3. The Sell Phase is one prompt, the Ball decision at an encounter and the Shop Ball purchase look as section 6 describes, and the Lap is shown on screen (for `drop_off_point`).
4. The results screen exports a log (issue #47) that holds the seed and marks automatic steps `auto: true`, so `meaningful_choices` can be counted, and a reload offers Continue.
5. The Thai question wording matches the glossary (issue #18).
6. The 45-minute slot and the 25-minute play cap hold up in the first sessions.
