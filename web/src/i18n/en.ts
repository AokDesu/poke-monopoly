/**
 * Every player-facing string in the web app (spec §3: the UI is in English).
 * Components never type UI text inline; they call `t(key)`. Numbers are not
 * written here: they come from the engine (spec §3.1). Class, Pokémon and item
 * names come from the content tables (`content/*.json`).
 */
export const en = {
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
  'firstPlayer.yourTie': 'You tied for the top roll. Roll again to decide who goes first.',
  'firstPlayer.rollAgain': 'Roll again',
  'firstPlayer.youStart': 'You go first',
  'firstPlayer.aiStarts': 'Your AI rival goes first',
  'firstPlayer.thenSeatOrder': 'Then play follows seat order.',
  'firstPlayer.toBoard': 'Go to the board',
  'firstPlayer.quit': 'Quit this game',
  'firstPlayer.noGame':
    'No game is waiting for its first roll. Go back to Home to start a new one.',

  'play.heading': 'Game board',
  'play.body':
    'This screen will show the board, teams, items, chat and the event log. It is not playable yet. Go on to results, or back to Home.',
  'results.heading': 'Results',
  'results.body':
    'This screen will show every player’s result when a game ends. There are no results yet. Go back to Home to start again.',

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

  'encounter.catch': 'Catch',
  'encounter.release': 'Release',
  'encounter.noBall': 'No Ball, so you cannot catch. Release the Pokémon to go on.',

  'shop.notEnoughCoins': 'Not enough coins for this item. You can leave the Shop without buying.',
  'shop.itemsFull':
    'Items full: you cannot buy more items, but you can still buy Balls or leave the Shop.',
  'shop.skip': 'Leave the Shop',

  'ai.backupBadge': 'Backup bot mode',
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

export type MessageKey = keyof typeof en;

export function t(key: MessageKey): string {
  return en[key];
}
