# Advisor notice: opponent dialogue in Poke Monopoly

Sent: not yet

Reply: no reply yet

The original proposal said AI opponents would “generate brief dialogue.” The
final v1.0 specification changes how that dialogue is produced: the team writes
short English lines in a line bank, and Jev, the decision model that now drives the
AI opponents and does not generate text, selects a line ID from that bank.

This change is necessary because Jev answers structured multiple-choice and
yes/no questions and returns probabilities and confidence; it cannot generate
text. The line bank provides dialogue suited to each opponent’s personality, the
game situation and their trust in the player. If Jev is unavailable, the game
selects a line using a seeded random fallback.

Players still see short English lines that react to the game, such as accepting or
rejecting a deal, reacting to a kept or broken promise, or responding to a Gym
win. These lines are written by the team rather than generated during play.

An optional later step could use a separate generative language model to
rephrase the prepared lines. This is a stretch feature, off by default. It must
pass the leak tests to prevent disclosure of hidden game information and stay
off the critical path, so game decisions and progress do not depend on it.

Reference: specification v1.0 §0 (changes from v0.8), §5.7 (dialogue) and §12
(risks and open decisions).
