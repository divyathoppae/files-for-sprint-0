# Clue timer prototype (T14 research task)

Throwaway prototype answering: can GameNite run Clue's 60s turn timer and 30s
disprove timer for 3–6 players plus bot seats, and how does that fit the
existing game framework?

- `logic.js`: pure turn logic in the same shape as GameNite's `GameLogic`
  (`update(state, move, seat)` returns a new state or `null`; `viewAs(state, seat)`).
- `server.js`: a timer manager outside the logic. It owns the timers, pauses the
  turn timer during disproving, runs bots, and handles disconnects. Timer and
  bot actions are sent through `update()` as moves, like a player's.
- `test.js`: 3 simulated players + 1 Easy bot with short timers (17 checks).

Run: `npm install`, then `node test.js`. The board and movement are left out on purpose.
