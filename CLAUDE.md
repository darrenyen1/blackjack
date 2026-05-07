# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

Open `BlackJack.html` directly in a browser — no build step, no server required.

```
start "" "BlackJack.html"      # Windows
open BlackJack.html             # macOS
```

## Git workflow

After every meaningful change, commit and push to GitHub (`darrenyen1/blackjack`) immediately — do not batch up multiple features into one commit. This ensures work is never lost and the repo always reflects the current state.

- Commit as soon as a discrete piece of work is complete (a feature, a fix, a tweak)
- Always push after committing — local-only commits are not acceptable
- Use conventional commit prefixes: `feat:`, `fix:`, `style:`, `refactor:`, `docs:`
- Write messages that describe what changed and why, not just "update files"

## Architecture

Plain HTML/CSS/JS — no frameworks, no dependencies, no bundler.

| File | Role |
|---|---|
| `BlackJack.html` | Static DOM shell; no logic |
| `style.css` | Casino-green theme; card styles, slot states, overlay |
| `game.js` | All game state and logic |

### State model (`game.js`)

A single `state` object is the source of truth:

```
state.phase          'betting' | 'playing' | 'dealer' | 'payout' | 'gameover'
state.balance        player's current chip count
state.slots[0..2]    each slot: { originalBet, subHands[], active }
state.dealer         { cards[] }
state.dealerHidden   the face-down card object (null after dealer reveals)
state.playQueue      [{slotIdx, subIdx}] — ordered list of sub-hands to play
state.playPos        index into playQueue for the currently active sub-hand
```

Each `subHand` is `{ cards[], bet, status, isNatural, splitAces, result }`.

### Game flow

```
BETTING → dealAll() → PLAYING → advanceQueue() loop → dealerTurn() → payout() → PAYOUT
                                                                                     ↓
                                                                               newRound()
```

- `render()` / `renderSlot(i)` are called after every state mutation; they do a full DOM rewrite from `state` — there is no partial update pattern.
- `playQueue` is built after dealing and grows dynamically when the player splits (new `{slotIdx, subIdx}` entries are spliced in after the current position; existing indices for that slot are shifted).
- `dealerTurn()` always runs even if all player hands busted (dealer reveals for transparency).

### Key rules encoded

- Natural Blackjack (first 2 cards) pays 3:2 (`bet * 2.5`); split hands cannot earn the natural bonus.
- Dealer stands on all 17s (hard and soft).
- Split Aces receive one card each and auto-stand (`splitAces = true`).
- Max 4 sub-hands per slot (`MAX_SPLIT`).
- Deck reshuffles automatically when fewer than 15 cards remain.
- Previous round bets are restored on `newRound()` if the balance allows.
