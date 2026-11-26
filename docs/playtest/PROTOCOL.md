# Playtest protocol

Spec: §1, §3, §8 (Human layer and playtest), §9 (no personal data), §10 C2 (gate G1) and C5 (the cycle 5 round).

This protocol is for one facilitator running one session with one participant. It serves two rounds: the gate G1 round (code `G1`, cycle 2, finished) and the cycle 5 Human-layer round (code `P5`). Each step below was checked on 18 November 2026 against `main` at commit `5f608f1`, by installing from a clean checkout, building, serving and playing the first turns of a game in Chrome, and the step names what it was checked against. Where a step depends on a screen that is in an open pull request and not on `main`, it says "if the build has it", so this file needs no edit when that pull request merges. The numbers (session length, 5-second pause) are experimental baselines like the game numbers: change them in a pull request after the first sessions, not in the middle of a round.

## 1. What a session measures

Players play without every button explained (spec §8), then answer four questions. The facilitator records, per session: game length, drop-off, number of meaningful choices, and the keep-or-sell and Ball hesitations (section 6 defines every term). AI turn latency p50 and p95 is not recorded by the facilitator; it comes from the build's usage log (spec §1, §9). For gate G1 it goes in `docs/playtest/g1/ai-latency.md`. For `P5`, copy `logs/jev-usage.jsonl` aside after each live-Jev session and read the copy with `npm run usage -- --log <file>` (`ai/jev/usage-cli.ts`), so decision time is read per session.

|File|What it is|
|---|---|
|`docs/playtest/PROTOCOL.md`|This file.|
|`docs/playtest/session-sheet.csv`|The empty template: a header row only. Never fill it in place.|
|`docs/playtest/g1/session-sheet-<host>.csv`|A filled copy for gate G1, one per facilitator (see [section 7](#7-after-the-session-where-the-data-goes)).|
|`docs/playtest/p5/`|The cycle 5 round's folder: its filled sheets, one per facilitator, and the round's build record (see [`p5/README.md`](p5/README.md)).|

## 2. Privacy rules (spec §9)

No personal data about players is stored. These rules apply to everything written down: paper, files, the sheet, issues, pull requests and chat messages.

1. **Participant code only.** The code is `<round>-<host><nn>`, for example `P5-A01`. `<round>` is `G1` for the gate G1 round and `P5` for the cycle 5 round. `<host>` is the facilitator's stream letter (A, B or C). `<nn>` counts that facilitator's sessions in the round, `01`, `02`, and so on. Assign the next free code when the participant agrees to take part. Never build a code from initials, a birth date, a handle or a seat number.
2. **No key between code and person.** Do not write down, anywhere, which person has which code. Tell the participant their code at the end of the session. It is their only way to ask us to delete their data.
3. **Notes name codes only.** Every note refers to a participant only by code: write `P5-A01 paused at the first Sell Phase`, never a name, nickname, age, school, job, relationship ("my cousin") or description ("the tall one"). This includes scratch notes, the `notes` column, issue titles and text, pull request text and chat messages.
4. **Never record** a name, email address, phone number, chat handle or any contact detail, and never make an audio, video or photo recording. A screenshot is allowed only to show a bug in an issue, and only of the game window: no desktop, browser tabs, profile picture or notifications.
5. **Quotes** from answers are allowed if they hold no name, contact detail or identifying detail. Replace such a part with `[removed]`.
6. **Consent is spoken, not signed.** A signature is a name. Read the consent paragraph in [section 4](#4-scripts-consent-and-briefing). If the participant does not say yes, there is no session and no row. A row in the sheet therefore means consent was given.
7. **In the game:** use the participant code wherever the build asks for a name. The setup in spec §3 asks for none: checked on `main` `5f608f1`, every setup screen is made of buttons and radio choices (`web/src/setup/`), and the game shows only "You" and "AI rival · seat N". The build has no free-text field: the only inputs in `web/src/` are radio buttons and check boxes, and the Social window, if the build has it (pull request #212), sends one of five topic messages (spec §4.8). If a later build adds a text field, tell the participant not to type their real name or contact details before they start. Exported game logs stay out of git unless a bug needs one, and then only after you read the file for typed text.
8. **Deletion.** If a participant gives you their code and asks for deletion, remove their row and notes from the current files in a pull request. History cannot be rewritten (`main` forbids force-push), but it holds nothing that identifies anyone.

## 3. Set-up (before the participant arrives)

Do one dry run of the whole protocol with a teammate before the first real session. Its row is not kept. Use the dry-run seed in step 2.

1. **Build.** Run the build from a checkout with a clean working tree (`git status --short` prints nothing), on Node 24 (`.node-version`), so the commit describes what the participant plays. Note the commit: `git rev-parse --short=7 HEAD`. Serve the game with `npm ci`, `npm run build` and `npm start`. Checked on `5f608f1`: `npm start` prints `API listening on http://127.0.0.1:8787` and serves the built web app and the API on that port (`ai/server.ts`). The port is fixed. If the port is already taken, `npm start` stops with `EADDRINUSE`: stop whatever holds it first, and never run a session on a page served by someone else's process. Find the holder in Git Bash on Windows with `netstat -ano | findstr LISTENING | findstr :8787`: the last column is the process ID, and `tasklist //FI "PID eq <pid>"` names the program (the doubled slash stops Git Bash from rewriting `/FI` as a path). On Linux or macOS use `ss -ltnp | grep 8787`. If nothing is listed, the port is free.
2. **Seed.** The seed is `<base> + 100 × host number + session number`, with A = 1, B = 2, C = 3 and the session number equal to the `<nn>` of the code. A round writes its own base here before it starts, so no two rounds clash:

   |Round|Base|Seeds|Example|
   |---|---|---|---|
   |`G1` (finished)|0|101 to 399|`G1-A01` uses `101`, `G1-B01` uses `201`, `G1-C02` uses `302`|
   |`P5`|5000|5101 to 5399|`P5-A01` uses `5101`, `P5-A02` uses `5102`, `P5-B01` uses `5201`, `P5-C02` uses `5302`|
   |Dry run (any round, host number 0)|5000|5001 to 5099|`5001`|

   Every participant therefore sees a different game, and a host can run at most 99 sessions in a round. The ranges do not overlap. The simulation uses other seeds: the CI runs start at seed 1 (about 1 to 100), the C4 report used 1,000,002 to 1,000,101 (`docs/c4-300-game-report.md`), and `docs/sim.md` calls any seed below 1,000,000 the tuning set, which contains 5,001 to 5,399 only in name. No committed simulation run uses 5,001 to 5,399, and none may: a simulation seed there would repeat a participant's game.
3. **Start URL.** Open `http://localhost:8787/?seed=<seed>` in Chrome. Checked on `5f608f1`: the page opens Home, the seed is shown nowhere on screen (`seedFromSearch` in `web/src/game/setup.ts`, read in `web/src/Root.tsx`), and the game's save holds it. The page keeps the seed from its address, so "Play again" or a second game in the same page would repeat it: open a new address with the next seed for every session, and never start a second session in the same page. After the session, confirm the seed from the exported log (section 6): run `npm run playtest:row -- ~/poke-monopoly-log.json --code <code>` (the file and code as in section 7, step 1) and read the line `<code>: seed <n>, ...` on standard error: it must show the seed you typed, and the command prints `WARNING:` when the log's seed is not the one the code implies. Run it without `>>`, so no row is appended yet. It needs no `jq` and works the same in Git Bash on Windows. A mistyped value is not refused (`?seed=51O1` runs as the text `51O1`). If the log's seed differs from the one you meant, the row's `seed` is the log's and `notes` says so. If the build ignores the seed, do not change it mid-session. The browser keeps the last game of this Chrome profile: if Home shows "Continue this game?" before the participant arrives, it is a left-over, so choose New game (this removes that save), and open the Start URL again if needed.
4. **Setup used (round `P5`).** Every `P5` session uses this one setup, so results compare, and question 2 needs two rivals the participant can tell apart:

   |Seat|Class|Starter|Personality|Difficulty|
   |---|---|---|---|---|
   |You (seat 0)|Researcher|Porygon|n/a|n/a|
   |AI rival · seat 1|Main Character|Charmander|Greedy|Normal|
   |AI rival · seat 2|Bug Catcher|Caterpie|Cautious|Normal|

   Mode is Quick (2 Laps). Standard 3 Laps is greyed ("Standard opens after the playtest.") and stays closed. Normal is chosen because Easy picks at random, weighted by how much the AI likes each option, and Normal always picks its top option (the screen's own words), which shows a personality more clearly. Greedy and Cautious are the two personalities the round uses; they differ in their weights and line style (`content/personalities/`). **The round needs issue #226 merged:** on `main` at `5f608f1` only Greedy can be chosen and Cautious is greyed with "Coming later." (`PERSONALITIES` in `web/src/game/setup.ts`). Do not start a `P5` session on a build where Cautious is greyed. A dry run on such a build is fine, with two Greedy rivals, and its row is not kept. The preset "Two rivals, normal" (pull request #213) names two Greedy rivals, so it does not match this table: use it only if its card lists exactly the seats above, otherwise set the seats in the per-seat editor. Whichever way you set it, read the Review screen against this table before going on; it lists every seat's class, Starter, personality and difficulty. For another round, write its own setup in this section before it starts.
5. **Set up and stop before the participant sits down.** The Review screen and the "Continue this game?" screen both name each rival's personality, which question 2 asks the participant to work out. So do the whole setup yourself first: click through to "Roll for first player" (the roll is applied automatically, with no choice, and the screen "Who goes first?" appears), check the seats against the table in step 4, and leave the page on "Who goes first?" with "Go to the board" showing. The participant then makes their first click on "Go to the board". If you must reload after play has begun, see section 5: the Continue screen names the personalities.
6. **Jev and Voice.** For live Jev, run on a machine that holds the Jev key in its git-ignored `.env`. Never show, paste or type the key near the participant. With `JEV_ENABLED=false` every AI uses the fallback (spec §9). AI-written speech ("Voice") is Haiku: it is on only with `HAIKU_ENABLED=true` and the Haiku key in `.env`, and the default in `.env.example` is off. Before each session read `http://localhost:8787/api/ai/status`. Checked on `5f608f1` with `JEV_ENABLED=false HAIKU_ENABLED=false`: it printed `{"jevEnabled":false,"backupOnly":true,"reason":"disabled","speech":{"enabled":false,"reason":"disabled"}}`. Jev is live when `backupOnly` is `false`, and Voice is on when `speech.enabled` is `true`. Write both in `notes` (section 8). If the "Backup bot mode" badge (spec §3) appears during play, or a "Voice off" badge appears next to a line, write that in `notes` too.
7. **Screen.** One Chrome window, game at 100% zoom, the English UI, notifications off, no other tabs. Do not open the developer tools until the participant has left.
8. **Room.** Quiet, one participant at a time. The participant sits at the keyboard. The facilitator sits to the side and a little behind, with a view of the screen.
9. **Tools.** A stopwatch (phone is fine; it is only a clock), and a scratch note laid out like this, with the code and nothing else that identifies anyone:

```text
code: P5-A01   date:        seed:        commit:
setup: fixed | other        jev: live | off        voice: on | off
play starts (clock):        play ends (clock):        finished inside 25 min: yes | no
hesitations:  type (sell_keep | ball) | Lap/turn | pause or said | ...
confusion, bugs, restarts, reload, Backup bot badge, Voice off badge:
```

## 4. Scripts: consent and briefing

Read the scripts word for word, in the language the participant prefers. The player-facing UI is English (spec §3), so the Thai text in this file is spoken wording only. Checked on 18 November 2026: the repository holds no Thai glossary to compare it with (`docs/` has none, and issue #18 is closed), so a Thai-speaking teammate reads the Thai wording in the pull request review.

### Session timeline

|Step|Minutes|Notes|
|---|---|---|
|Welcome, consent|3|Read the consent paragraph. Wait for a yes.|
|Briefing|2|Read the briefing. The game is already set up and waiting on "Who goes first?" (section 3, step 5). Start the stopwatch for play when the participant clicks "Go to the board".|
|Play|up to 25|Observe and tally. At 25 minutes let the current turn finish, then stop the game (`drop_off_reason` = `time_cap`).|
|Four questions|about 10|Ask in order, word for word.|
|Close|5|Give the participant their code. Thank them. Write the row the same day.|

The slot is 45 minutes in total.

### Consent (read aloud, then wait for a yes)

English:

> Thank you for helping us test a game. We are testing the game, not you, and there is no wrong way to play. You will play one short game while I watch, I will time some of your moves, and afterwards I will ask you four questions. I write down what you do and say under a participant code, such as P5-A01, and never your name, contact details or anything that identifies you; I make no audio, video or photo recordings. You may skip any question, stop at any time without giving a reason, and, if you tell us your code later, ask us to delete your data. Do you agree to take part?

Thai:

> ขอบคุณที่ช่วยทดสอบเกมให้เรา เราทดสอบตัวเกม ไม่ได้ทดสอบคุณ และไม่มีวิธีเล่นที่ผิด คุณจะเล่นเกมสั้น ๆ หนึ่งรอบ โดยมีผู้ดำเนินการนั่งดูและจับเวลาการตัดสินใจบางช่วง และเมื่อเล่นจบจะมีคำถามสี่ข้อ ผู้ดำเนินการจะจดสิ่งที่คุณทำและพูดโดยใช้รหัสผู้เข้าร่วม เช่น P5-A01 เท่านั้น ไม่จดชื่อ ข้อมูลติดต่อ หรือสิ่งที่ระบุตัวตนคุณได้ และไม่อัดเสียง วิดีโอ หรือถ่ายภาพ คุณข้ามคำถามข้อใดก็ได้ หยุดเล่นเมื่อไรก็ได้โดยไม่ต้องบอกเหตุผล และหากแจ้งรหัสของคุณกับเราภายหลัง เราจะลบข้อมูลของคุณให้ คุณยินดีเข้าร่วมหรือไม่

### Briefing (read aloud after the yes)

English:

> This is a board game against computer opponents. You catch creatures with Balls, decide whether to keep or sell them, and the player with the most coins at the end wins. I will not explain the buttons or tell you what to do. Play as you would on your own. You may talk through your thinking, but you do not have to. The game may let you send a short message to an opponent; use it or skip it as you like. What the AI opponents say is only words and never changes the game. Some lines come from a bank of written lines and some are written by a computer program, and a label tells you which. A notice may say that an opponent is using a backup, or that the computer-written lines are off. Both are normal. If the game freezes or you cannot go on, tell me.

Thai:

> นี่คือเกมกระดานที่เล่นกับคู่แข่งที่เป็นคอมพิวเตอร์ คุณจะจับตัวต่าง ๆ ด้วยบอล แล้วเลือกว่าจะเก็บหรือขาย ใครมีเหรียญมากที่สุดเมื่อจบเกมเป็นผู้ชนะ เราจะไม่อธิบายปุ่มและไม่บอกว่าควรทำอะไร ให้เล่นเหมือนตอนที่เล่นคนเดียว จะพูดความคิดออกมาด้วยก็ได้ แต่ไม่ต้องก็ได้ เกมอาจให้คุณส่งข้อความสั้น ๆ ถึงคู่แข่ง จะใช้หรือข้ามก็ได้ สิ่งที่คู่แข่ง AI พูดเป็นเพียงคำพูดและไม่เปลี่ยนเกม บางประโยคมาจากคลังประโยคที่เขียนไว้ล่วงหน้า บางประโยคเขียนโดยโปรแกรมคอมพิวเตอร์ และจะมีป้ายบอกว่าเป็นแบบไหน อาจมีข้อความแจ้งว่าคู่แข่งใช้ระบบสำรอง หรือว่าประโยคที่คอมพิวเตอร์เขียนถูกปิดอยู่ ทั้งสองอย่างเป็นเรื่องปกติ ถ้าเกมค้างหรือเล่นต่อไม่ได้ ให้บอกเรา

## 5. What the facilitator may and may not say

**May:**

- Read the scripts in section 4 and the four questions in section 6, word for word.
- Answer logistics: where the restroom is, how long is left, whether they can stop.
- When the participant asks about the game, answer only with: "Do what you would do if I were not here." or "What do you think it does?"
- In the question step, ask only a neutral follow-up: "Can you tell me more?" or "Which moment was that?"
- When the build freezes, crashes or shows nothing to do, say "That looks like a problem with the game, not with you", reload the page, choose Continue so the game resumes from the last committed action (spec §3.1, issue #47), and write it in `notes`. Checked on `5f608f1`: after a reload Home shows "Continue this game?", with "Open decision: <phase>. Waiting on You." and the list "AI rivals in this game", and Continue returns to the same decision. Never choose New game there: it removes the save. That list names each rival's personality, so turn the screen away, or ask the participant to look away, while you reload and press Continue. If they may have read it, write `Q2 prompt showed personalities` in `notes` and record question 2 as `n/a - Continue prompt showed personalities`.
- After the four questions are answered and written down, explain any rule or button the participant asks about, including the Social topic buttons, the "AI-written · only words" label and the "Backup bot mode" and "Voice off" badges.

**May not:**

- Explain rules, buttons, odds, items, classes or strategy before the four questions are answered.
- Beyond the briefing, point at, open or mention a screen or control the participant has not found: the Social topic buttons, the "AI-written · only words" label, the "Backup bot mode" and "Voice off" badges, and any "How to play" page. `main` at `5f608f1` has no How to play page (searched `web/` and `content/` for help or tutorial text and found none); if a later build adds one, it is never opened, mentioned or pointed at before the four questions are answered.
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

A **meaningful choice** is one decision the human player made. Count it from the exported game log: every accepted human action that is not marked `auto: true` (engine contract, `advanceAutomatically`). Checked on `5f608f1`: in a dry-run game the log's first steps (the first-player roll, the engine's dice results, the AI rolls and two human skips that had no other option) all carry `auto: true`, and the human's "Skip item use" at Strategy carries none, so it is the one counted choice. A reload and Continue added no action. `npm run playtest:row -- ~/poke-monopoly-log.json --code <code>` makes this count from the exported file: it prints the `meaningful_choices` cell in the row and the same number on the line `meaningful_choices <n>` on standard error (section 7, step 1). It needs no `jq`, so it works in Git Bash on Windows. If you cannot get a log, write `n/a`. Dice rolls the engine applies automatically and one-option steps are never counted.

A **counted decision type** is one of these two:

|Code|What the decision is|
|---|---|
|`sell_keep`|The Sell Phase at Start (spec §4.7): which Pokémon to sell and which to keep. The whole phase is one decision, however many Pokémon are on the screen. Checked in `web/src/board/SellPanel.tsx` on `5f608f1`: one "Sell Phase" screen lists the whole team with check boxes and a sale total, and ends in one choice between "Sell selected" and "Keep all", so the whole phase is one decision.|
|`ball`|At an encounter, which Ball to spend, or whether to release instead (spec §4.2 step 6, §4.3). Checked in the catalogue (`web/src/i18n/en.ts`) on `5f608f1`: the encounter dialog offers "Catch" with one choice per Ball, each shown as "<Ball> · <percent>%", and "Release". Also buying a Ball at the Shop (spec §4.6), but only when the player chose a Ball or says they were weighing Balls. A Shop pause about utility items does not count.|

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

**Game length** is whole minutes, by the stopwatch, from the participant's click on "Go to the board" (section 3, step 5; the first-player roll before it is automatic and takes no choice) to the results screen, or to the moment the game stopped. Do not count time the game was paused for you to reload it. **Not comparable with G1:** the protocol in force for the gate G1 sheets timed from the start of the first-player roll, so a `G1` length includes the setup and the roll, and a `P5` length does not (the facilitator does both before the participant sits down, section 3, step 5). Never compare or pool a `G1` and a `P5` `game_length_min` (see [`p5/README.md`](p5/README.md)). At 25 minutes of play let the current turn finish, then tell the participant the game is over. The build has no control that ends a running game for a human player (only a watched game has "End game"), so there is nothing to press: leave the page as it is.

### While the participant plays

Say nothing except what section 5 allows. Watch the screen. For every decision of a counted type, run the stopwatch and listen. When a hesitation happens, add one line to the scratch note: type, Lap or turn, and whether it was a pause, a spoken "unsure" or both. Do not tell the participant. Jot down confusion and bugs as they happen.

### After play: get the log

After the four questions and after the participant has gone, get the game log for the row. Keep it outside the repository, never commit it (section 2, rule 7), and delete it once the row is written and checked.

- **A game that finished.** The results screen has an "Export log" button. Checked in `web/src/ResultsScreen.tsx` and `downloadSave` in `web/src/game/save.ts` on `5f608f1`: it downloads `poke-monopoly-log.json`, the engine's save, which holds the seed (`.log.seed`) and every action (`.log.actions[]`, with `auto: true` on automatic ones).
- **A game that stopped early** (`time_cap`, `quit`, `bug`). No results screen appears, so there is no button. The browser keeps the same text under the key `poke-monopoly.save` (`serialize` is used for both, `web/src/game/save.ts`). Checked in Chrome on `5f608f1`: `localStorage.getItem('poke-monopoly.save')` returns it, with `log.seed` and `log.actions`. In the developer tools console on the game tab run `copy(localStorage.getItem('poke-monopoly.save'))`, then paste into a new text file named `poke-monopoly-log.json`. Do not choose New game before you have done this: it removes the save.

### The four questions

After the game, or after the game stopped, ask these in order, word for word, and write the answer down. If the build lacks the feature a question is about, skip it and record `n/a`. In the `P5` round on a build that meets section 3, step 4, question 2 is asked (two rivals with different personalities) and is never `n/a` for that reason. Question 3 is asked whenever the build has the Social window with its topic buttons (pull request #212); on a build without any way to talk, record `n/a - no chat in this build`. Ask question 3 even if the participant never opened the Social window; write what they say. If the build also has Deal Card or promise screens, they follow the same rule: nothing about them is explained before the four questions are answered.

|#|English|Thai|
|---|---|---|
|1|Was there a moment you genuinely hesitated between selling and keeping?|มีช่วงไหนไหมที่คุณลังเลจริง ๆ ว่าจะขายหรือจะเก็บตัวที่จับได้ไว้|
|2|Could you tell an opponent's personality from what it did?|คุณดูออกไหมว่าคู่ต่อสู้ที่เป็น AI มีบุคลิกแบบไหน จากสิ่งที่มันทำ|
|3|Did any conversation change the game?|มีการพูดคุยครั้งไหนไหมที่ทำให้เกมเปลี่ยนไป|
|4|When did waiting or reading get boring?|ช่วงไหนที่คุณรู้สึกเบื่อ เพราะต้องรอหรือต้องอ่าน|

Question 3 counts the participant's own messages (the Social topic buttons) and the conversation that followed them. Words never change a game number (spec §4.8), so record the participant's answer as they give it and write in `notes` what they pointed at. AI table talk never changes a decision (spec §4.2, §5.7), so it is not "a conversation that changed the game": if the participant names it, write that in `notes` and leave it out of `q3_conversation_changed_game`. A line labelled "AI-written · only words" and a line from the bank are treated the same way.

## 7. After the session: where the data goes

1. **Same day, write the row.** Copy the template once per round and facilitator, then add one row per session (shown for round `P5`, host A; use your own stream letter and the round's folder):

   ```bash
   mkdir -p docs/playtest/p5
   cp docs/playtest/session-sheet.csv docs/playtest/p5/session-sheet-A.csv
   ```

   Use your own stream letter in the file name. One file per facilitator means three people never edit one file at once. For a later round, use a new folder named for the round, write the round's code, seed base and setup in section 2 and section 3 first, and say so in that round's issue.

   **Draft the cells the log can count.** Get the game log as section 6 describes ("After play: get the log"), keep it outside the repository (section 2, rule 7), then run the row command with the participant code:

   ```bash
   npm run playtest:row -- ~/poke-monopoly-log.json --code P5-A01 >> docs/playtest/p5/session-sheet-A.csv
   ```

   It reads the file only. It prints one CSV row on standard output, so `>>` appends only the row, and a few lines on standard error:

   - **Filled for you:** `participant_code`; `seed`, from the log header; `meaningful_choices`, counted as section 6 defines it; and `drop_off_point`, which is `none` for a finished game, otherwise a candidate from the saved state: `setup` (the first-player roll was not finished), `final_round` (the Final Table Round was announced), or `lap1` to `lap3`, the Lap being played, one more than the paid Laps the board shows (`0 / 2` is `lap1`). `drop_off_reason` is `none` for a finished game. Confirm the point against what you saw.
   - **Printed to cross-check your scratch note:** the number of Sell Phase decisions (`sell_keep`) and Ball decisions at encounters (`ball`) the human seat made. The log has no clock and cannot tell a pause from a quick choice, so it never fills `hesitation_count` or `hesitation_decisions`. Shop Ball purchases are not counted here, because section 6 counts them only when the player weighed Balls.
   - **Warned about:** a log seed that is not the seed the code implies by section 3, step 2 (`P5-A02` implies `5102`; the command knows the rounds `G1` and `P5`, and for another round says it could not check). The row keeps the log's seed, as section 3, step 3 says. Find out why they differ before you keep the row.
   - **Left as `<<fill: ...>>` for you:** date, build commit, game length, `drop_off_reason` for an unfinished game, both hesitation cells, the four answers and `notes`. The checker refuses every one until you replace it.

   The command refuses, and prints no row, for a file that is not a game log, a log from another engine, content or RNG version, a log whose saved state does not replay, a game with no human seat (a watched game) or with more than one, and a code that is not `<round>-<host><nn>`.
2. **Destroy the scratch note** once the row is written: shred the paper or delete the file.
3. **File issues** for bugs or confusion, titled with the code only (for example `P5-A01: ...`), and list the issue numbers in the row's `notes`.
4. **Check the file** (see the end of section 8), then commit it on a branch and open a pull request that cites spec §8 and §9. A teammate reviews it before merge, as for every pull request (spec §7).
5. **Analysis** reads the committed sheets, nothing else: for G1, the report `docs/playtest/g1/G1-report.md` (issue #54); for `P5`, the Human-layer result tables with n (spec §8, §10 C5) built from `docs/playtest/p5/`.

## 8. The sheet columns

The file is UTF-8, comma separated, one row per session, one line per row. A cell with a comma or quote is wrapped in double quotes (a quote inside becomes two). Lists inside a cell use `|`. Keep each free-text cell to 200 characters or fewer. A row is complete when no cell is empty. Only `n/a` and `none` stand for "nothing here". No column exists for a name or any contact detail. The only free-text cells are the four answers and `notes`; the code-only rule in section 2 applies to them, and the check at the end of this section screens them.

**`n/a` means unobserved.** In `game_length_min`, `drop_off_point`, `drop_off_reason`, `meaningful_choices`, `hesitation_count` and `hesitation_decisions`, `n/a` says the number or fact was not recorded and cannot be recovered. It is not zero and not `none`: write `0` only when you watched for hesitations and saw none, and `none` only for a game that finished. The cells go together: `drop_off_point` and `drop_off_reason` are both `n/a` or neither, and `hesitation_count` and `hesitation_decisions` are both `n/a` or neither. Any other column takes no `n/a`, except the question cells (below). The report reads an `n/a` cell as unobserved and leaves it out of its counts. The rule lives in one place in code, `playtest/sheet.ts` (`UNOBSERVED`, `isUnobserved`), which the checker and the report both use.

|Column|Fill with|
|---|---|
|`participant_code`|The code from section 2, for example `P5-A01`.|
|`date`|The session day, `YYYY-MM-DD`.|
|`build_commit`|The 7-character commit from section 3, step 1. It is also the record of which features the participant could meet: the round's build record (`docs/playtest/p5/README.md`) says what that commit had.|
|`seed`|The integer seed from section 3, step 2, confirmed from the log (section 3, step 3).|
|`game_length_min`|Whole minutes, as defined in section 6, or `n/a` (unobserved).|
|`drop_off_point`|`none` if the game finished. Otherwise `setup` (before the first turn started), `lap1`, `lap2`, `lap3` (Standard only) for the Lap shown on screen when it ended, or `final_round` (after the Final Table Round was announced, spec §4.7). `n/a` if unobserved.|
|`drop_off_reason`|`none` if the game finished. Otherwise `quit` (the participant stopped), `bug` (the build blocked or crashed), `time_cap` (the 25-minute cap) or `other` (explain in `notes`). `n/a` if unobserved.|
|`meaningful_choices`|A whole number, as defined in section 6, or `n/a` (unobserved).|
|`hesitation_count`|The number of genuine hesitations (section 6): `0` if you watched and saw none, `n/a` if hesitations were not recorded.|
|`hesitation_decisions`|One code per hesitation, `sell_keep` or `ball`, joined with `\|`, for example `sell_keep\|ball\|sell_keep`. `none` if the count is 0. `n/a` if the count is `n/a`. The number of codes must equal `hesitation_count`.|
|`q1_hesitated_sell_keep`|Start with `yes`, `no` or `unsure`, then ` - ` and a short paraphrase or quote. A bare `yes` is refused. `n/a - <reason>` only if the participant skipped the question.|
|`q2_opponent_personality`|The same format as question 1, or `n/a` (then ` - ` and the reason).|
|`q3_conversation_changed_game`|The same format as question 1, or `n/a` (then ` - ` and the reason).|
|`q4_boring_moment`|`none`, or the moment or screen in a few words, then ` - ` and a short paraphrase or quote.|
|`notes`|Start with these four tags, in this order, separated by `; `: `jev=live` or `jev=off` (section 3, step 6), `voice=on` or `voice=off`, `setup=fixed` (the table in section 3, step 4) or `setup=other` (then say what), and `finished_in_cap=yes` (the game reached the results screen within 25 minutes of play) or `finished_in_cap=no`. These feed the decision on opening Standard 3 Laps (`GAME_PRESETS.standard.enabled` is `false` in `engine/game-end.ts`). Then bugs and confusion with issue numbers, hesitations at decisions that did not count, restarts, a reload, the Backup bot badge and the Voice off badge if seen. Codes only. The cell is 200 characters or fewer, so the four tags take about 55 of them.|

Example row, invented to show the format only:

```csv
P5-A00,2026-11-30,0000000,5100,17,none,none,31,2,sell_keep|ball,yes - unsure whether to sell at the first Start,yes - one rival kept its coins and one fought more,no - the topic buttons changed nothing,waiting for the AI turn,"jev=live; voice=off; setup=fixed; finished_in_cap=yes; Pause at Shop (items), not counted; Voice off badge seen"
```

Before committing, run the checker on your file, then read every cell yourself:

```bash
npm run playtest:check -- docs/playtest/p5/session-sheet-A.csv
```

It reads each file you name and prints `file:line: column: problem` for every cell that is missing, inconsistent or looks like personal data, then exits with a non-zero status if there was any. It checks that the header equals `docs/playtest/session-sheet.csv`; one line per row; no empty cell and no `<<fill: ...>>` placeholder; the code matches `<round>-<host><nn>`; the date, commit, seed, game length, drop-off cells and counts have the form this section gives, with `n/a` only where the rule above allows it; `hesitation_decisions` holds only `sell_keep` or `ball`, as many as `hesitation_count`, and `none` only when the count is `0`; `drop_off_point` and `drop_off_reason` are both `none`, both `n/a` or neither; each question cell starts with `yes`, `no`, `unsure` or `n/a` and then ` - ` and some text, so a bare `yes` or `n/a` is reported; the four answers and `notes` are 200 characters or fewer; and no cell holds an `@`, a link or a phone-like number. The check proves nothing about names, so the reviewer reads the file again.

The `@`, link and phone-like check is part of `npm run playtest:check` (`PRIVACY_PATTERN` in `playtest/sheet.ts`): the command above prints `looks like personal data` with the file, line and column, so no separate `grep` is needed, and it runs the same in Git Bash on Windows. Any line it reports must be explained or fixed.

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

The 3-of-up-to-5 rule is the G1 gate only. The Human layer playtest with 5 to 8 people in cycle 5 (round `P5`) has no pass threshold (spec §8: report issues and findings). If G1 fails, cycle 3 goes to fixing the core loop (spec §10 C2).
