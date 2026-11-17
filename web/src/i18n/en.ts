import chatReply from '../../../content/lines/en/chat_reply.json';
import catchFail from '../../../content/lines/en/catch_fail.json';
import catchSuccess from '../../../content/lines/en/catch_success.json';
import dealAccept from '../../../content/lines/en/deal_accept.json';
import dealReject from '../../../content/lines/en/deal_reject.json';
import fallbackNotice from '../../../content/lines/en/fallback_notice.json';
import gameStart from '../../../content/lines/en/game_start.json';
import gymWin from '../../../content/lines/en/gym_win.json';
import manipulationRefused from '../../../content/lines/en/manipulation_refused.json';
import promiseBroken from '../../../content/lines/en/promise_broken.json';
import promiseKept from '../../../content/lines/en/promise_kept.json';
import soldPokemon from '../../../content/lines/en/sold_pokemon.json';
import tauntLeader from '../../../content/lines/en/taunt_leader.json';

const dialogue = Object.fromEntries(
  [
    ...catchFail,
    ...chatReply,
    ...catchSuccess,
    ...dealAccept,
    ...dealReject,
    ...fallbackNotice,
    ...gameStart,
    ...gymWin,
    ...manipulationRefused,
    ...promiseBroken,
    ...promiseKept,
    ...soldPokemon,
    ...tauntLeader,
  ].map((line) => [`ai.line.${line.id}`, line.text]),
) as Record<`ai.line.${string}`, string>;

/**
 * Every player-facing string in the web app (spec §3: the UI is in English).
 * Components never type UI text inline; they call `t(key)`. Numbers are not
 * written here: they come from the engine (spec §3.1). Class, Pokémon and item
 * names come from the content tables (`content/*.json`).
 */
export const en = {
  ...dialogue,
  'app.title': 'Poke Monopoly',

  'nav.home': 'Back to Home',
  'nav.back': 'Back',
  'nav.next': 'Next',
  'nav.play': 'Go to the game',
  'nav.results': 'Go to results',

  'home.heading': 'Collect the most coins against AI rivals',
  'home.body':
    'Roll the dice around the board, catch Pokémon with Balls, then keep them or sell them at Start. Whoever has the most coins at the end wins.',
  'home.newGame': 'New game',
  'home.newGameHint': 'Pick a mode, a class and one to three AI rivals, step by step.',
  'home.randomAll': 'Random All',
  'home.randomAllHint': 'Pick everything at random, then check it before you start.',
  'home.notEnoughClasses':
    'The game data has too few playable classes for every player, so a game cannot start. Ask the team to check the class file.',
  'home.watch': 'Watch AIs play',
  'home.watchHint': 'Set up two to four AIs and watch them play each other. You take no seat.',
  'home.watchNotEnough':
    'Watching needs at least two playable classes, one for each AI. Ask the team to check the class file.',
  'home.boardCaption': 'Spaces on the board',

  'board.kind.start': 'Start',
  'board.kind.wild': 'Wild',
  'board.kind.event': 'Event',
  'board.kind.shop': 'Shop',
  'board.kind.gym': 'Gym',

  'board.loop': 'Board loop',
  'board.squareLabel': 'Square {position}: {kind}',
  'board.tokenLabel': '{name}, seat {seat}, square {position}',
  'board.seatLabel': 'Seat {seat}',
  'board.rivalLabel': 'AI rival · seat {seat}',
  'board.turnOrder': 'Turn order follows seat numbers',
  'board.direction': 'Follow the arrows around the board.',
  'board.turn': '{name}’s turn',
  'board.yourTurn': 'Your turn',
  'board.globalTurn': 'Turn',
  'board.lap': 'Laps completed',
  'board.position': 'Square',
  'board.coins': 'Coins',
  'board.team': 'Team',
  'board.yourTeam': 'Your team',
  'board.battle': 'Battle',
  'board.tired': 'Tired',
  'board.rescue': 'Rescue Starter',
  'board.emptyTeam': 'No Pokémon on this team.',
  'board.balls': 'Ball pouch',
  'board.ball.poke': 'Poké Ball',
  'board.ball.great': 'Great Ball',
  'board.ball.ultra': 'Ultra Ball',
  'board.items': 'Your items',
  'board.itemCount': 'Items held',
  'board.emptyItems': 'No utility items held.',
  'board.privateInventory': 'Only you can see your Ball pouch and secret items.',
  'board.hiddenInventory': 'Items are counted only. Ball pouches are private.',
  'board.readOnly': 'Board preview. Turn controls arrive in the next update.',
  'board.finalRound': 'Final table round',
  'board.finished': 'Game finished',
  'board.noGame': 'No game is open. Start a new game from Home.',
  'board.habitat': 'Starter meadow',
  'board.habitatNames': 'In the meadow: {names}',
  'board.phase.first_player_roll': 'First-player roll',
  'board.phase.start': 'Start of turn',
  'board.phase.social': 'Social',
  'board.phase.strategy': 'Strategy',
  'board.phase.move': 'Move',
  'board.phase.sell': 'Sell',
  'board.phase.resolve': 'Resolve square',
  'board.phase.encounter': 'Wild encounter',
  'board.phase.shop': 'Shop',
  'board.phase.combat': 'Battle',
  'board.phase.pvp': 'Battle',
  'board.phase.gym': 'Gym',
  'board.phase.end': 'End of turn',
  'board.phase.finished': 'Finished',
  'board.phase.other': 'Next phase',
  'board.tag.bug': 'Bug',
  'board.tag.cute': 'Cute',
  'board.tag.flying': 'Flying',
  'board.tag.water': 'Water',
  'board.tag.normal': 'Normal',
  'board.tag.fire': 'Fire',
  'board.tag.fighting': 'Fighting',
  'board.tag.dragon': 'Dragon',
  'board.tag.grass': 'Grass',
  'board.tag.electric': 'Electric',
  'board.tag.other': 'Other',
  'board.log': 'Field log',
  'board.logEmpty': 'No events yet. The next game event will appear here.',
  'board.event.randomRoll': 'The die rolled {result}.',
  'board.event.randomDraw': 'The game resolved a random draw.',
  'board.event.abilityUsed': '{user} used {ability} with {pokemon}.',
  'board.event.abilityUsedOn': '{user} used {ability} with {pokemon} on {target}.',
  'board.event.abilitiesReset': '{owner} passed Start: every Pokémon’s Ability is ready again.',
  'board.event.displaced': '{target} was pushed back to square {position}.',
  'board.event.ballGained': '{owner} gained a {ball}.',
  'board.event.coins': '{source} paid {amount} coins to {destination}. {reason}',
  'board.event.bank': 'The bank',
  'board.event.player': 'A player',
  'board.event.reason.start_income': 'Start income.',
  'board.event.reason.pokemon_sale': 'Pokémon sold.',
  'board.event.reason.final_sale': 'Final sale.',
  'board.event.reason.shop_purchase': 'Shop purchase.',
  'board.event.reason.pickpocket': 'Pickpocket.',
  'board.event.reason.pvp_reward': 'Battle reward.',
  'board.event.reason.gym_reward': 'Gym reward.',
  'board.event.reason.gym_loss': 'Gym loss.',
  'board.event.reason.other': '',
  'board.event.pokemonCreated': '{owner} received a Pokémon.',
  'board.event.itemCreated': '{owner} received an item.',
  'board.event.pokemonDestroyed': 'A Pokémon left a team.',
  'board.event.itemDestroyed': 'An item was removed.',
  'board.event.space': '{name} landed on square {position}: {kind}.',
  'board.event.noneYet': '{name} landed on square {position}: {kind}. Nothing happens here yet.',
  'board.event.phase': '{from} → {to}.',
  'board.event.hostileItem': '{user} used {item} on {target}.',
  'board.event.finalRound': '{name} triggered the final table round.',
  'board.fixture': 'Prepared engine fixture: {name}',
  'board.fixtureMissing': 'Fixture not found',
  'board.fixtureMissingBody':
    'This fixture name is not available. Check the name against engine/fixtures, or remove ?fixture= to start a game.',

  'setup.steps.label': 'Game setup steps',
  'setup.missingHeading': 'Setup is not complete',
  'setup.missingBody':
    'This step needs your answers from the earlier steps. Go back to Home and set up a new game.',
  'setup.step.mode': 'Mode',
  'setup.step.class': 'Class',
  'setup.step.opponents': 'AI rivals',
  'setup.step.review': 'Review',
  'setup.step.firstPlayer': 'First roll',
  'setup.step.ais': 'AIs',
  'setup.step.options': 'Table',

  'mode.heading': 'Choose a mode',
  'mode.body': 'The mode sets how many Laps of the board it takes to end the game.',
  'mode.lapsUnit': 'Laps',
  'mode.quick': 'Quick',
  'mode.quickHint': 'A short game, good for your first time.',
  'mode.standard': 'Standard',
  'mode.standardHint': 'A longer game with more time to collect Pokémon and coins.',
  'mode.standardClosed': 'Standard opens after the playtest.',

  'class.heading': 'Choose your class',
  'class.body':
    'Your class sets your Starter Pokémon, a passive ability and a class item. Each class can be taken by one player per game.',
  'class.passive': 'Passive ability',
  'class.item': 'Class item',
  'class.starter': 'Starter',
  'class.chooseStarter': 'Choose your Starter',
  'class.chooseFirst': 'Choose a class first to go on.',
  'class.closedHeading': 'Not available yet',
  'class.comingLater': 'Coming later.',
  'class.passive.main-character': 'A bonus on your first catch roll each Lap.',
  'class.passive.researcher': 'A bonus on the first Pokémon you sell at Start each Lap.',
  'class.passive.fisherman': 'A bonus on catch rolls against Water Pokémon.',
  'class.passive.bug-catcher':
    'A bonus on catch rolls against Bug Pokémon, and a bonus when you sell Bug Pokémon at Start.',
  'class.passive.nurse-joy':
    'You lose no coins when you lose a PvP battle, and your team recovers from Tired at the start of your turn.',
  'class.closed.rival':
    'Coming later. Its once-per-Lap forced battle needs the PvP controls, which are not built yet.',
  'class.rivalHas':
    '{rival} already has {class}. You can keep it and change that rival on the next step.',

  'opponents.heading': 'Set up your AI rivals',
  'opponents.body':
    'Choose how many AI rivals you play against, then set each rival’s class, Starter, personality and difficulty. A choice changes only that rival. Personality does not depend on class.',
  'opponents.count': 'Number of AI rivals',
  'opponents.countOne': '1 AI rival',
  'opponents.countMany': '{n} AI rivals',
  'opponents.players': '{n} players in total.',
  'opponents.countClosed':
    'Only {open} classes are open and every player needs a different one, so a game has at most {max} AI rivals.',
  'opponents.editing': 'Rival to set up',
  'opponents.needsClass': 'Needs a different class',
  'opponents.class': 'Rival class',
  'opponents.classTaken': '{holder} has this class. Classes cannot repeat in one game.',
  'opponents.fixClass':
    '{rival} has a class another player has. Choose a different class for it to go on.',
  'opponents.starter': "Rival's Starter",
  'opponents.personality': 'Personality',
  'opponents.personalityClosed': 'Coming later.',
  'opponents.difficulty': 'Difficulty',
  'opponents.difficultyHint': 'Every difficulty sees only what its seat may see.',
  'opponents.noFreeClass':
    'No class is left for a rival. Go back and choose a different class for yourself.',
  'opponents.next': 'Review setup',

  'personality.greedy': 'Greedy',
  'personality.aggressive': 'Aggressive',
  'personality.cautious': 'Cautious',
  'personality.opportunist': 'Opportunist',

  'difficulty.easy': 'Easy',
  'difficulty.easyHint': 'Picks at random, weighted by how much the AI likes each option.',
  'difficulty.normal': 'Normal',
  'difficulty.normalHint': 'Gets more game information and always picks its top option.',

  'seat.you': 'You',

  'review.heading': 'Review your setup',
  'review.body':
    'Seats follow this list. Everyone rolls a die; the highest roll goes first, then play follows seat order.',
  'review.mode': 'Mode',
  'review.seats': 'Players in seat order',
  'review.roll': 'Roll for first player',
  'review.startFailed':
    'A game could not be created from this setup. Go back, change your class or rival, and try again.',

  'watchReview.heading': 'Review the watch setup',
  'watchReview.body':
    'Seats follow this list and none of them is yours. Every AI rolls a die; the highest roll goes first, and the rolls, ties included, are the first entries in the log.',
  'watchReview.seats': 'AIs in seat order',
  'watchReview.settings': 'Table settings',
  'watchReview.start': 'Start watching',
  'watchReview.startFailed':
    'A game could not be created from this setup. Go back, change an AI, and try again.',
  'watchReview.talk': 'AI talk',
  'watchReview.speed': 'Starting speed',
  'watchReview.on': 'On',
  'watchReview.off': 'Off',

  'watchOptions.heading': 'Table settings',
  'watchOptions.body':
    'Choose whether the AIs talk at the table and how fast the game starts. You can change the speed while you watch.',
  'watchOptions.talk': 'AI talk',
  'watchOptions.talkOn': 'Talk on',
  'watchOptions.talkOnHint':
    'After a big moment one AI may say a short line to the table. Lines are only words.',
  'watchOptions.talkOff': 'Talk off',
  'watchOptions.talkOffHint': 'No lines are asked for and the table talk panel is not shown.',
  'watchOptions.speed': 'Starting speed',
  'watchOptions.normalHint': 'A readable pace. AI talk is spoken only at this speed.',
  'watchOptions.fastHint': 'Short pauses between moves. The AIs do not talk.',
  'watchOptions.instantHint': 'No pauses. The AIs do not talk.',
  'watchOptions.next': 'Review setup',

  'watchSetup.heading': 'Set up the AIs',
  'watchSetup.body':
    'Choose how many AIs play, then set each AI’s class, Starter, personality and difficulty. A choice changes only that AI. Nobody holds a seat: you watch.',
  'watchSetup.count': 'Number of AIs',
  'watchSetup.countMany': '{n} AIs',
  'watchSetup.seats': '{n} AIs play each other.',
  'watchSetup.countClosed':
    'Only {open} classes are open and every AI needs a different one, so a watched game has at most {max} AIs.',
  'watchSetup.editing': 'AI to set up',
  'watchSetup.class': 'AI class',
  'watchSetup.starter': 'AI’s Starter',
  'watchSetup.noFreeClass':
    'Fewer than two classes are open, so a watched game cannot start. Ask the team to check the class file.',
  'watchSetup.randomAll': 'Random All',
  'watchSetup.randomAllHint': 'Fill every AI at random. The number of AIs stays as it is.',
  'watchSetup.next': 'Table settings',

  'firstPlayer.heading': 'Who goes first?',
  'firstPlayer.body':
    'The highest roll goes first. If the top roll is a tie, only the tied players roll again.',
  'firstPlayer.attempt': 'Roll',
  'firstPlayer.rolled': 'Rolled',
  'firstPlayer.waiting': 'Waiting to roll',
  'firstPlayer.tie': 'The top roll was a tie, so only the tied players roll again.',
  'firstPlayer.yourTie': 'You tied for the top roll. Re-rolling to decide who goes first.',
  'firstPlayer.rollAgain': 'Roll again',
  'firstPlayer.youStart': 'You go first',
  'firstPlayer.aiStarts': '{name} goes first',
  'firstPlayer.thenSeatOrder': 'Then play follows seat order.',
  'firstPlayer.toBoard': 'Go to the board',
  'firstPlayer.quit': 'Quit this game',
  'firstPlayer.noGame':
    'No game is waiting for its first roll. Go back to Home to start a new one.',

  'team.details': 'Inspect {name}',
  'team.instance': 'Team ID: {id}',
  'team.ability': 'Ability',
  'team.noAbility': 'No Ability description.',
  'team.nextForms': 'Next forms',
  'team.finalForm': 'Final form — no further evolution.',
  'team.readOnly': 'Inspection only. Evolution is chosen as a battle reward.',
  'team.tiredReason': 'Cannot battle while Tired. Clears at the end of its owner’s next turn.',
  'team.rescueRestriction': 'Cannot be traded or receive a sale bonus, even after evolution.',
  'team.baseValue': 'Base value',
  'team.baseValueNote':
    'Base value is the listed worth of this form. The Sell Phase quotes what it actually sells for.',
  'team.nextFormStats': 'Battle {battle} · Base value {base}',
  'team.nextFormAbility': 'Ability: {ability}',
  'team.branchChoice': 'This line branches. You choose one of these forms when it evolves.',
  'team.branchChoiceWatched':
    'This line branches. Its trainer chooses one of these forms when it evolves.',
  'species.catchDc': 'Catch DC',
  'starter.facts': 'About your Starter, {name}',
  'starter.rivalFacts': 'About the rival’s Starter, {name}',

  'play.heading': 'Game board',
  'results.heading': 'Results',
  'results.body':
    'The winner has the most coins. If coins are tied, badges decide. If those are tied too, the tied players are co-winners.',
  'results.none': 'No finished game is open. Go back to Home to start one.',
  'results.standings': 'Coins and badges',
  'results.badges': 'Badges',
  'results.winnerMark': 'Winner',
  'results.winCoins': '{name} wins with the most coins.',
  'results.winCoinsYou': 'You win with the most coins.',
  'results.winBadges': 'Coins are tied. {name} wins with more badges.',
  'results.winBadgesYou': 'Coins are tied. You win with more badges.',
  'results.coWinners': 'Coins and badges are tied. {names} are co-winners.',
  'results.nameJoin': '{left} and {right}',
  'results.playAgain': 'Play again',
  'results.export': 'Export log',
  'results.watchAgain': 'Watch again',
  'results.watchAgainHint': 'Starts a new game with the same AIs and settings. The dice are new.',
  'results.home': 'Back to Home',
  'results.seatSetup': '{class} · {setup}',
  'results.decisionsHeading': 'Who decided each AI’s moves',
  'results.decisionsBody':
    'Jev is the AI service. The backup bot decides when Jev is off, slow or unavailable.',
  'results.decisionsCaption': 'Decisions by Jev and by the backup bot',
  'results.jev': 'Jev',
  'results.backup': 'Backup bot',
  'results.decisionsEarlier':
    '{count} earlier decisions were made before this game was resumed. Their source was not kept, so they are not counted here.',

  'save.off': 'Saving is off. The game still plays.',
  'save.continueHeading': 'Continue this game?',
  'save.continueBody':
    'A saved game is on this browser. Continue picks up from the last saved action. No die is re-rolled and no new turn starts.',
  'save.continue': 'Continue',
  'save.newGame': 'New game',
  'save.pendingDecision': 'Open decision: {phase}. Waiting on {name}.',
  'save.pendingRoll': 'A die result is still waiting. It was not rolled before the save.',
  'save.pendingFinished': 'This game has already finished.',
  'save.pendingWatched': 'A watched game is in progress, turn {turn}.',
  'save.rivals': 'AI rivals in this game',
  'save.rivalRow': '{name}: {class}, {personality}, {difficulty}.',
  'save.rivalSettingsMissing':
    '{name}: {class}. Its saved personality or difficulty is not available in this build, so it plays as Greedy on Normal.',
  'save.classClosed': '{class} is not open for new games in this build; this game keeps it.',
  'save.personalityClosed':
    '{personality} is not open for new games in this build; this game keeps it.',
  'save.mismatchHeading': 'This save cannot be loaded',
  'save.mismatchNext': 'New game starts a fresh game and removes this save from the browser.',
  'save.unreadable':
    'This save could not be read. New game starts a fresh game and removes it from the browser.',

  'watch.stepWhileRunning': 'Pause the game first. Step plays one action while paused.',
  'watch.stepBusy': 'Wait for the action in progress to finish.',
  'watch.stepFailed': 'The AI decision failed. Retry it before stepping.',
  'watch.stepFinished': 'The game has finished.',
  'watch.setup': '{personality} personality · {difficulty} difficulty',
  'watch.heading': 'AIs playing',
  'watch.playing': 'The AIs are playing. Each move appears under the board.',
  'watch.paused': 'Paused. Resume to keep playing, or Step to play one action.',
  'watch.controls': 'Watch controls',
  'watch.pause': 'Pause',
  'watch.resume': 'Resume',
  'watch.step': 'Step',
  'watch.skip': 'Skip to results',
  'watch.skipAsk': 'Skip to the results? The rest of the game plays out at once, with no pauses.',
  'watch.keepWatching': 'Keep watching',
  'watch.leave': 'Leave',
  'watch.leaveAsk': 'Leave this game? Save it to continue later, or end it.',
  'watch.leaveSave': 'Save and continue later',
  'watch.leaveEnd': 'End game',
  'watch.leaveSaveOff': 'Saving is off in this browser, so this game cannot be kept.',

  'credits.link': 'Credits',
  'credits.heading': '3D model credits',
  'credits.body':
    'The 3D models in this game come from these creators, under each model’s licence.',
  'credits.author': 'Creator',
  'credits.licence': 'Licence',
  'credits.trademark':
    'Pokémon names and designs are trademarks of Nintendo, Creatures and Game Freak. These are fan-made models; their licences cover the model files only.',

  'error.heading': 'This screen could not be shown',
  'error.body':
    'Something went wrong while drawing this screen. Press “Try again”. If you still see this message, reload the page.',
  'error.retry': 'Try again',

  // Spec §3.1: status messages and actions, not AI dialogue from the line bank.
  'turn.onlyLegalAction': 'There is only one thing you can do, so the game does it for you.',
  'turn.noAvailableOptions': 'There is nothing to choose in this step. The game moves on.',

  'turn.actions': 'Turn actions',
  'turn.strategyBody': 'Use an item or an Ability before moving, or skip.',
  'turn.reaction': 'Your answer',
  'turn.reactionBody': 'A battle is waiting for your answer. Choose one of the options below.',
  'turn.opponent': 'Opponent turn',
  'turn.opponentError':
    'The opponent could not complete this step. Check the server connection and retry.',
  'turn.retry': 'Retry opponent turn',
  'turn.actionError': 'That action is no longer available. Choose from the current turn controls.',
  'turn.automatic': 'Automatic: {phase} — only legal action.',
  'turn.moving': 'Rolling and moving automatically.',
  'turn.encounterBody': 'Choose a Ball or release the Pokémon.',
  'turn.choiceBody': 'Choose one of the options below.',
  'choice.challengeGym': 'Challenge the Gym',
  'choice.skipGym': 'Skip the Gym',
  'choice.acceptBattle': 'Accept the battle',
  'choice.declineBattle': 'Decline the battle',
  'choice.noAbility': 'Use no Ability',
  'choice.keepDie': 'Keep the die',
  'choice.skip': 'Continue',
  'choice.rewardCoins': 'Take the coins',
  'choice.rewardEvolve': 'Evolve {pokemon} into {form}',
  'turn.lastMove': 'Last move: rolled {roll}, arrived at square {position}.',
  'turn.end': 'Turn complete. Passing to the next trainer.',
  'turn.finished': 'The game is complete.',
  'turn.sellHeading': 'Sell Phase',
  'turn.sellBody': 'Start income has been paid. Sell any selection together, or keep your team.',
  'turn.shopHeading': 'Shop stop',
  'turn.shopBody': 'Buy one offer or leave without buying. The Shop does not refresh.',
  'action.reason.NO_BALL': 'No Ball',
  'action.reason.NOT_ENOUGH_COINS': 'Not enough coins',
  'action.reason.ITEMS_FULL': 'Items full',
  'action.reason.NOT_YOUR_TURN': 'Not your turn',
  'action.reason.ALREADY_USED_THIS_TURN': 'Already used this turn',
  'action.reason.NO_VALID_TARGET': 'No valid target',
  'action.reason.ABILITY_USED_THIS_LAP': 'Already used this Lap',
  'action.reason.ABILITY_USED_THIS_GLOBAL_TURN': 'You already used an Ability this turn',
  'action.reason.ABILITY_WRONG_TIMING': 'Not usable in this window',
  'action.engineReason': '{reason}',

  'encounter.catch': 'Catch',
  'encounter.heading': 'A wild {pokemon} appeared',
  'encounter.body':
    'Choose a Ball to attempt a catch, or release this Pokémon. An attempt spends the Ball even if it escapes.',
  'encounter.ballChoice': '{ball} · {percent}%',
  'encounter.caught': 'Caught! {pokemon} joined your team.',
  'encounter.escaped': '{pokemon} escaped. Your Ball was spent.',
  'encounter.released': '{pokemon} was released. No Ball was spent.',
  'encounter.release': 'Release',
  'encounter.noBall': 'No Ball, so you cannot catch. Release the Pokémon to go on.',
  'encounter.facts': 'About this Pokémon',

  'shop.notEnoughCoins': 'Not enough coins for this item. You can leave the Shop without buying.',
  'shop.itemsFull':
    'Items full: you cannot buy more items, but you can still buy Balls or leave the Shop.',
  'shop.skip': 'Leave the Shop',
  'shop.buy': 'Buy {item} · {price} coins',
  'shop.buyOne': 'Buy {item} · {price} coin',
  'shop.balance': 'You have {coins} coins',

  'item.kind.ball': 'Ball',
  'item.kind.utility': 'Utility item',
  'item.price': 'Price: {price} coins',
  'item.priceOne': 'Price: {price} coin',
  'item.ball.effect': 'Required to catch a Pokémon. Catch roll bonus: +{bonus}.',
  'item.effect.planned': 'Planned effect: {effect}',
  'item.status.partial':
    'Only part of this effect works in this build: it clears Tired. Combat debuffs are not tracked yet.',
  'item.status.planned': 'Not active yet: this build does not apply this effect.',

  'strategy.targets': 'Choose an opponent',
  'strategy.preview': 'Effect preview',
  'strategy.effect': '{effect}',
  'strategy.target': 'Target: {target}',
  'strategy.targetCoins': 'Target holds {coins} coins.',
  'strategy.chooseTarget': 'Choose a target to preview this item.',
  'strategy.cost': 'Consumes this item and your tactical action.',
  'strategy.confirm': 'Confirm {item}',
  'strategy.skip': 'Skip item use',
  'strategy.potion.targets': 'Choose a Pokémon to heal',
  'strategy.potion.member': '{pokemon} · {instanceId}',
  'strategy.potion.target': 'Heal: {pokemon} · {instanceId}',
  'strategy.potion.effect': 'Clears Tired from this Pokémon.',
  'strategy.potion.chooseTarget': 'Choose a Pokémon to preview its healing. Nothing is spent yet.',
  'strategy.potion.staleSelection':
    'The available actions changed. Choose your Potion and Pokémon again before confirming.',

  'ability.heading': 'Abilities',
  'ability.source': '{pokemon} · {instanceId}',
  'ability.planned': 'Not active yet: this build does not run this Ability.',
  'ability.targets': 'Choose an opponent',
  'ability.members': 'Choose a Pokémon to heal',
  'ability.scopes': 'Choose what to boost',
  'ability.scope.catch': 'Catch rolls',
  'ability.scope.combat': 'Battle rolls',
  'ability.member': '{pokemon} · {instanceId}',
  'ability.choosePrompt': 'Choose an Ability to preview it. Nothing is spent yet.',
  'ability.chooseOption': 'Choose an option to preview this Ability. Nothing is spent yet.',
  'ability.preview': 'Ability preview',
  'ability.previewSource': 'Source: {ability} · {pokemon} ({instanceId})',
  'ability.previewEffect': 'Effect: {effect}',
  'ability.previewTarget': 'Target: {target}',
  'ability.previewMember': 'Target: {member}',
  'ability.previewScope': 'Boosts: {scope}',
  'ability.cost': 'Spends this Pokémon’s Ability for the Lap and your Ability for this turn.',
  'ability.costTactical': 'Also spends your tactical action to start the battle.',
  'ability.hostile': 'Hostile: counts as an attack attempt, and an armed Price Shield blocks it.',
  'ability.confirm': 'Confirm {ability}',
  'ability.cancel': 'Cancel',
  'ability.stale':
    'The available actions changed. Nothing was spent. Choose your Ability again before confirming.',
  'ability.peek': 'Top Event card you looked at: {text}',

  'sell.coins': '{amount} coins',
  'sell.price': '{basePrice} coins',
  'sell.priceBonus': '{basePrice} + {classBonus} class bonus',
  'sell.tired': 'Tired price applied',
  'sell.soloPrice': 'If sold alone',
  'sell.selectedPrice': 'In this batch',
  'sell.total': 'Sale total',
  'sell.confirm': 'Sell selected',
  'sell.keep': 'Keep all',
  'sell.rescuePreview':
    'Your team will be empty. You receive a Rescue Starter worth {value} coins.',

  'ai.backupBadge': 'Backup bot mode',
  'ai.thinking': 'Thinking… If Jev takes too long, the backup bot decides.',
  'ai.playing': 'The rival is playing. Its next move appears under the board.',
  'ai.now': 'Now',
  'ai.statusUnavailable': 'AI status could not be checked. Each decision still reports its source.',
  'ai.speed': 'Turn speed',
  'ai.speed.normal': 'Normal',
  'ai.speed.fast': 'Fast',
  'ai.speed.instant': 'Instant',
  'ai.skipLine': 'Skip line',
  'ai.speech': '{name} says: {line}',
  'ai.reason.disabled': 'Jev is switched off.',
  'ai.reason.missing_key': 'Jev is not configured on this server.',
  'ai.reason.budget_exceeded': 'The AI spending limit has been reached.',
  'ai.reason.timeout': 'Jev did not answer in time.',
  'ai.reason.rate_limited': 'Jev is receiving too many requests.',
  'ai.reason.auth': 'The server could not connect to Jev with its current settings.',
  'talk.heading': 'Table talk',
  'talk.hide': 'Hide table talk',
  'talk.show': 'Show table talk',
  'talk.hidden': 'Table talk is hidden. No new lines are asked for while it is hidden.',
  'talk.empty':
    'No table talk yet. An AI may comment, or speak to another AI that answers, after a rare catch, a big sale, a Gym win, a change in the lead or the final round.',
  'talk.exchange': 'An exchange: {from} speaks to {to}, who answers',
  'talk.onlyWords': 'Only words: table talk never changes a game number or an AI’s choice.',
  'talk.aiWritten': 'AI-written · only words',
  'talk.bank': 'Line bank · only words',
  'talk.to': 'to {name}',
  'talk.toYou': 'to you',
  'talk.voiceOff': 'Voice off',
  'talk.reason.disabled':
    'AI-written speech is switched off on this server. Lines come from the line bank, or the table stays quiet.',
  'talk.reason.missing_key':
    'AI-written speech is not set up on this server. Lines come from the line bank, or the table stays quiet.',
  'talk.reason.budget_exceeded':
    'The AI-written speech spending limit has been reached. Lines come from the line bank, or the table stays quiet.',
  'ai.reason.stub': 'This decision uses the backup policy.',
  'ai.action.roll': '{name} rolled the die.',
  'ai.action.skip': '{name} continued past {phase}.',
  'ai.action.catch': '{name} chose to catch {pokemon} with a {ball}.',
  'ai.action.release': '{name} released {pokemon}.',
  'ai.action.buy': '{name} bought an offer from the Shop.',
  'ai.action.skip_shop': '{name} left the Shop without buying.',
  'ai.action.use_item': '{name} used an item.',
  'ai.action.sell': '{name} sold Pokémon at Start.',
  'ai.action.keep': '{name} kept the whole team.',
  'ai.action.move': '{name} rolled {result} on the die.',
  'ai.result.caught': '{name} caught {pokemon}.',
  'ai.result.escaped': '{pokemon} escaped from {name}. Its Ball was spent.',
  'ai.result.released': '{name} released {pokemon}. No Ball was spent.',
  'ai.backupUnavailable':
    'The AI decision service is unavailable. The backup bot decides instead, and the game goes on.',
  'deal.reconfirmAfterFallback':
    'Switched to the backup bot. No trade has happened yet: check the Deal Card and confirm again.',
  'deal.confirm': 'Confirm the deal',
  'ai.backupInvalidAnswer':
    'The AI’s answer was not one of the allowed options. The backup bot decides instead, and the game goes on.',
  'ai.backupRevisionMismatch':
    'The AI answered about an older game state. The backup bot decides from the current one.',
  'ai.backupLowConfidence':
    'The AI is not sure. The backup bot helps it choose, using its personality.',
  'ai.allBackupBanner':
    'Every AI rival is using the backup bot. The game goes on under the same rules.',

  'chat.unclassified':
    'That message could not be understood. Try a chat topic or write it more plainly. The AI’s plan has not changed.',
  'chat.manipulationRefused':
    'Send a new message that does not ask to break the rules or reveal secrets. The AI’s willingness and trust have not changed.',

  'game.resumedAiTurn': 'Picked up from the last saved action. The AI is deciding its turn again.',
  'sell.rescueStarter':
    'No Pokémon left after the Sell Phase. You got a Rescue Starter, so you can keep playing.',
  'event.deckReshuffled': 'The Event deck ran out. The used cards were shuffled back in.',

  // Dev gallery (issue #53). Row labels repeat the spec §3.1 "Situation" column word for word.
  'gallery.title': 'Screen states gallery',
  'gallery.intro':
    'Developer page, not part of the game. Each example is the real screen, shown with fixed test data and labelled with its row in the spec. Nothing here changes a game.',
  'gallery.specRow': 'Spec §3.1, row {row}',
  'gallery.specAiTurns': 'Spec §3, AI turns',
  'gallery.specAbilities': 'Spec §4.5, Abilities',
  'gallery.row.abilities':
    'Abilities that are ready, and Abilities that cannot be used, with the reason',
  'gallery.pendingHeading': 'Rows with no screen yet',
  'gallery.pendingIntro':
    'These rows have nothing a player can see in this build, so there is no example to show.',
  'gallery.pending.engine':
    'The engine or the AI settles this case; no screen is shown to the player.',
  'gallery.pending.deals': 'Needs the Deal screen, which is not built yet.',
  'gallery.pending.dealsBadge':
    'Needs the Deal screen, which is not built yet. The Backup bot mode badge already shows timeouts and rate limits on AI turns.',
  'gallery.pending.chat': 'Needs the chat panel, which is not built yet.',
  'gallery.pending.eventDeck':
    'The notice is in this catalog, but no screen shows it yet and the board has no Event deck.',
  'gallery.row.onlyLegalAction': 'Only one legal action (e.g. must roll)',
  'gallery.row.shortlistEmpty': 'Shortlist empty after personality filtering',
  'gallery.row.noBall': 'Pokémon found but no Ball',
  'gallery.row.shopNoCoins': 'Not enough coins for anything in the Shop',
  'gallery.row.itemsFull': 'Holding 4 utility items in the Shop',
  'gallery.row.jevTimeoutDeal': 'Jev times out, returns 429 or errors mid-deal',
  'gallery.row.invalidAnswer':
    "Jev's answer is not among the options, or the revision does not match",
  'gallery.row.lowConfidence': 'Confidence below the floor',
  'gallery.row.allBackup': 'Every AI is in backup mode',
  'gallery.row.chatUnclassified': 'The player types something unclassifiable (emoji, slang)',
  'gallery.row.chatManipulation':
    'A message tries to make the AI break rules or reveal hidden information',
  'gallery.row.browserClosed': 'The browser closes during an AI turn',
  'gallery.row.teamEmpty': 'Team is empty after the Sell Phase',
  'gallery.row.eventDeckOut': 'Event deck runs out',
  'gallery.row.haikuOff': 'Haiku is off, has no key, is out of budget or is slow',
  'gallery.row.haikuScreenFail':
    "Haiku's text fails the output screen (too long, a digit, a link, a non-public item name, an offer or promise)",
  'gallery.row.aiExchange': 'One AI speaks to another and the other answers (AI-to-AI table talk)',
  'gallery.row.watchBrowserClosed': "A watched game's browser closes",
  'gallery.row.watchAllBackup': 'Every AI in a watched game is on the backup bot',
  'gallery.row.backupBadge':
    'A "Backup bot mode" badge shows truthfully whenever an AI is using the fallback',
  'gallery.example.beforeAuto': 'Before the game applies it',
  'gallery.example.afterAuto': 'After the game applied it',
  'gallery.example.noBall': 'Encounter with no Ball in the pouch',
  'gallery.example.shopNoCoins': 'Shop with 0 coins',
  'gallery.example.itemsFull': 'Shop with 4 utility items held and coins to spend',
  'gallery.example.notAnOption': 'AI answered with something that was not an option',
  'gallery.example.revisionMismatch': 'AI answered about an older game state',
  'gallery.example.lowConfidence': 'AI was not confident enough',
  'gallery.example.everyRivalBackup': 'Every rival decided with the backup bot',
  'gallery.example.serverBackupOnly': 'The server reports backup only',
  'gallery.example.continuePrompt': 'Home screen offering Continue',
  'gallery.example.afterContinue': 'Board after Continue',
  'gallery.example.sellWholeTeam': 'Selling the whole team: preview',
  'gallery.example.afterWholeTeamSale': 'After the whole team was sold',
  'gallery.example.watchContinue': 'Home screen offering Continue for a watched game',
  'gallery.example.watchAfterContinue': 'Watch board after Continue, the AI deciding again',
  'gallery.example.watchAllBackup': 'Every AI in the watched game decided with the backup bot',
  'gallery.example.badgeOneOfTwo': 'One of two rivals timed out',
  'gallery.example.abilityStrategy':
    'Strategy: one Ability ready, one at the wrong timing, one used this Lap, one not run yet',
  'gallery.example.abilityReaction': 'Answering a battle outside your own turn',
  'gallery.example.voiceDisabled': 'Voice off: switched off on the server, a line from the bank',
  'gallery.example.voiceMissingKey': 'Voice off: no key on the server, a line from the bank',
  'gallery.example.voiceBudget': 'Voice off: spending limit reached, no line for this moment',
  'gallery.example.screenBank':
    'The text failed the screen: the bank line is shown, not labelled AI-written',
  'gallery.example.screenSilence':
    'The text failed the screen and the bank has no line: nothing is shown',
  'gallery.example.exchange':
    'An exchange: the opening line, then the answer set in beneath it, each labelled AI-written',
  'gallery.example.exchangeDropped':
    'An exchange the manipulation check refused or that ran out of time: nothing is shown or saved',
  'gallery.example.badgeRateLimited': 'One of two rivals was rate limited',
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof en | keyof typeof dialogue;

export function t(key: MessageKey, values?: Readonly<Record<string, string | number>>): string {
  const message = (en as typeof en & typeof dialogue)[key]!;
  return values
    ? message.replace(/\{(\w+)\}/g, (slot, name: string) => String(values[name] ?? slot))
    : message;
}
