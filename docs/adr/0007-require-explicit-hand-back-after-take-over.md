# Require explicit hand-back after take-over

The owner may be midway through entering credentials when a controlling tab disconnects. Expire that tab’s input rights, keep the task waiting across restarts, and let the signed-in owner reclaim control from another device. Only an explicit hand-back restores bot control.

Before signalling that take-over is ready, finish or suspend all bot-operated work capable of observing or changing the screen, including shell processes from other bots on the shared computer. Suppress bot screenshots and chat screenshot cards during take-over. Model-only work can continue.

On hand-back, discard refused input and have the bot inspect the current screen before choosing its next action. A click intended for the login page could otherwise land on a different control.
