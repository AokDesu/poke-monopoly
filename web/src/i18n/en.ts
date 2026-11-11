import fallbackNotice from '../../../content/lines/en/fallback_notice.json';
import gameStart from '../../../content/lines/en/game_start.json';
import catchSuccess from '../../../content/lines/en/catch_success.json';
import catchFail from '../../../content/lines/en/catch_fail.json';
import soldPokemon from '../../../content/lines/en/sold_pokemon.json';

const dialogue = Object.fromEntries(
  [...fallbackNotice, ...gameStart, ...catchSuccess, ...catchFail, ...soldPokemon].map((line) => [
    `ai.line.${line.id}`,
    line.text,
  ]),
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
  'home.newGameHint': 'Pick a mode, a class and your AI rival, step by step.',
  'home.randomAll': 'Random All',
  'home.randomAllHint': 'Pick everything at random, then check it before you start.',
  'home.notEnoughClasses':
    'The game data has too few playable classes for every player, so a game cannot start. Ask the team to check the class file.',
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
  'board.event.coins': '{source} paid {amount} coins to {destination}. {reason}',
  'board.event.bank': 'The bank',
  'board.event.player': 'A player',
  'board.event.reason.start_income': 'Start income.',
  'board.event.reason.pokemon_sale': 'Pokémon sold.',
  'board.event.reason.final_sale': 'Final sale.',
  'board.event.reason.shop_purchase': 'Shop purchase.',
  'board.event.reason.pickpocket': 'Pickpocket.',
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
  'setup.step.opponents': 'AI rival',
  'setup.step.review': 'Review',
  'setup.step.firstPlayer': 'First roll',

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

  'opponents.heading': 'Set up your AI rival',
  'opponents.body':
    'This test version has one AI rival. Choose its class, personality and difficulty. Personality does not depend on class.',
  'opponents.class': 'Rival class',
  'opponents.classTaken': 'You chose this class. Classes cannot repeat in one game.',
  'opponents.starter': "Rival's Starter",
  'opponents.personality': 'Personality',
  'opponents.personalityClosed': 'Coming later.',
  'opponents.difficulty': 'Difficulty',
  'opponents.difficultyHint': 'Every difficulty sees only what its seat may see.',
  'opponents.noFreeClass':
    'No class is left for the rival. Go back and choose a different class for yourself.',
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
  'seat.ai': 'AI rival',

  'review.heading': 'Review your setup',
  'review.body':
    'Seats follow this list. Everyone rolls a die; the highest roll goes first, then play follows seat order.',
  'review.mode': 'Mode',
  'review.seats': 'Players in seat order',
  'review.roll': 'Roll for first player',
  'review.startFailed':
    'A game could not be created from this setup. Go back, change your class or rival, and try again.',

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
  'firstPlayer.aiStarts': 'Your AI rival goes first',
  'firstPlayer.thenSeatOrder': 'Then play follows seat order.',
  'firstPlayer.toBoard': 'Go to the board',
  'firstPlayer.quit': 'Quit this game',
  'firstPlayer.noGame':
    'No game is waiting for its first roll. Go back to Home to start a new one.',

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

  'save.off': 'Saving is off. The game still plays.',
  'save.continueHeading': 'Continue this game?',
  'save.continueBody':
    'A saved game is on this browser. Continue picks up from the last saved action. No die is re-rolled and no new turn starts.',
  'save.continue': 'Continue',
  'save.newGame': 'New game',
  'save.pendingDecision': 'Open decision: {phase}. Waiting on {name}.',
  'save.pendingRoll': 'A die result is still waiting. It was not rolled before the save.',
  'save.pendingFinished': 'This game has already finished.',
  'save.mismatchHeading': 'This save cannot be loaded',
  'save.mismatchNext': 'New game starts a fresh game and removes this save from the browser.',
  'save.unreadable':
    'This save could not be read. New game starts a fresh game and removes it from the browser.',

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
  'turn.strategyBody': 'Use an item before moving, or keep your items and skip.',
  'turn.opponent': 'Opponent turn',
  'turn.opponentError':
    'The opponent could not complete this step. Check the server connection and retry.',
  'turn.retry': 'Retry opponent turn',
  'turn.actionError': 'That action is no longer available. Choose from the current turn controls.',
  'turn.automatic': 'Automatic: {phase} — only legal action.',
  'turn.moving': 'Rolling and moving automatically.',
  'turn.encounterBody': 'Choose a Ball or release the Pokémon.',
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

  'shop.notEnoughCoins': 'Not enough coins for this item. You can leave the Shop without buying.',
  'shop.itemsFull':
    'Items full: you cannot buy more items, but you can still buy Balls or leave the Shop.',
  'shop.skip': 'Leave the Shop',
  'shop.buy': 'Buy {item} · {price} coins',
  'shop.buyOne': 'Buy {item} · {price} coin',
  'shop.balance': 'You have {coins} coins',

  'strategy.targets': 'Choose an opponent',
  'strategy.preview': 'Effect preview',
  'strategy.effect': '{effect}',
  'strategy.target': 'Target: {target}',
  'strategy.targetCoins': 'Target holds {coins} coins.',
  'strategy.chooseTarget': 'Choose a target to preview this item.',
  'strategy.cost': 'Consumes this item and your tactical action.',
  'strategy.confirm': 'Confirm {item}',
  'strategy.skip': 'Skip item use',

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
  'ai.playing': 'The rival is playing. Its choices appear in the field log.',
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
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof en | keyof typeof dialogue;

export function t(key: MessageKey, values?: Readonly<Record<string, string | number>>): string {
  const message = (en as typeof en & typeof dialogue)[key]!;
  return values
    ? message.replace(/\{(\w+)\}/g, (slot, name: string) => String(values[name] ?? slot))
    : message;
}
