// T14 research prototype: Clue turn logic written in the same shape as the
// existing GameNite GameLogic (pure update(state, move, seat) -> state | null,
// plus viewAs(state, seat)). Timers are NOT in here: the timer manager in
// server.js sends "system" moves (turnTimeout, disproveTimeout) through update.
// Movement/board is left out on purpose; this prototype is about turns,
// timers, private reveals, bots, and disconnects.

const SUSPECTS = ["scarlet", "mustard", "white", "green", "peacock", "plum"];
const WEAPONS = [
  "candlestick",
  "knife",
  "leadPipe",
  "revolver",
  "rope",
  "wrench",
];
const ROOMS = [
  "stetsonEast",
  "curry",
  "isec",
  "marino",
  "snell",
  "exp",
  "ell",
  "westVillageH",
  "internationalVillage",
];

const SYSTEM = -2; // "seat" used for moves sent by the timer manager

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pick(a) {
  return a[Math.floor(Math.random() * a.length)];
}

/** seats: [{ name, bot: null|'easy', connected }] in turn order (Scarlet first). */
function start(seats, forcedDeal) {
  let solution;
  let hands;
  if (forcedDeal) {
    ({ solution, hands } = forcedDeal);
  } else {
    solution = {
      suspect: pick(SUSPECTS),
      weapon: pick(WEAPONS),
      room: pick(ROOMS),
    };
    const rest = shuffle(
      [...SUSPECTS, ...WEAPONS, ...ROOMS].filter(
        (c) =>
          c !== solution.suspect &&
          c !== solution.weapon &&
          c !== solution.room,
      ),
    );
    hands = seats.map(() => []);
    rest.forEach((card, i) => hands[i % seats.length].push(card)); // sizes differ by at most 1
  }
  return {
    seats: seats.map((s) => ({ ...s, eliminated: false })),
    solution,
    hands,
    current: 0,
    turn: 1, // increases every time a new turn starts (the timer manager uses it)
    phase: "turn", // 'turn' | 'disproving' | 'afterAction'
    suggestion: null, // { by, cards: [s, w, r], disprover, shown }
    log: [],
    done: false,
    winner: null,
  };
}

function canAct(state, i) {
  const s = state.seats[i];
  return !s.eliminated && (s.bot || s.connected);
}

function nextTurn(state) {
  const n = state.seats.length;
  if (!state.seats.some((s) => !s.bot && s.connected)) {
    return {
      ...state,
      done: true,
      winner: null,
      phase: "turn",
      suggestion: null,
    };
  }
  for (let k = 1; k <= n; k++) {
    const i = (state.current + k) % n;
    if (canAct(state, i)) {
      return {
        ...state,
        current: i,
        phase: "turn",
        suggestion: null,
        turn: state.turn + 1,
      };
    }
  }
  return { ...state, done: true, winner: null };
}

function matching(state, seat, cards) {
  return state.hands[seat].filter((c) => cards.includes(c));
}

/** Pure move handler. Returns a new state, or null if the move is invalid. */
function update(state, move, seat) {
  if (state.done || !move || typeof move.kind !== "string") return null;

  switch (move.kind) {
    case "suggest": {
      if (seat !== state.current || state.phase !== "turn") return null;
      const { suspect, weapon, room } = move;
      if (
        !SUSPECTS.includes(suspect) ||
        !WEAPONS.includes(weapon) ||
        !ROOMS.includes(room)
      )
        return null;
      const cards = [suspect, weapon, room];
      const n = state.seats.length;
      let disprover = null;
      for (let k = 1; k < n; k++) {
        const i = (seat + k) % n;
        if (matching(state, i, cards).length > 0) {
          disprover = i;
          break;
        }
      }
      const log = [
        ...state.log,
        `${state.seats[seat].name} suggested ${cards.join(", ")}`,
      ];
      if (disprover === null) {
        return {
          ...state,
          phase: "afterAction",
          suggestion: { by: seat, cards, disprover: null, shown: null },
          log: [...log, "No one could disprove"],
        };
      }
      return {
        ...state,
        phase: "disproving",
        suggestion: { by: seat, cards, disprover, shown: null },
        log,
      };
    }

    case "show": {
      const sg = state.suggestion;
      if (state.phase !== "disproving" || seat !== sg.disprover) return null;
      if (!matching(state, seat, sg.cards).includes(move.card)) return null; // must be a real match
      return {
        ...state,
        phase: "afterAction",
        suggestion: { ...sg, shown: move.card },
        log: [
          ...state.log,
          `${state.seats[seat].name} showed a card to ${state.seats[sg.by].name}`,
        ],
      };
    }

    case "disproveTimeout": {
      // Sent by the timer manager when the 30s choice runs out or the disprover is gone.
      if (seat !== SYSTEM || state.phase !== "disproving") return null;
      const sg = state.suggestion;
      const card = pick(matching(state, sg.disprover, sg.cards));
      return {
        ...state,
        phase: "afterAction",
        suggestion: { ...sg, shown: card },
        log: [
          ...state.log,
          `${state.seats[sg.disprover].name} showed a card to ${state.seats[sg.by].name} (auto)`,
        ],
      };
    }

    case "accuse": {
      if (seat !== state.current || state.phase === "disproving") return null;
      const { suspect, weapon, room } = move;
      const sol = state.solution;
      if (
        suspect === sol.suspect &&
        weapon === sol.weapon &&
        room === sol.room
      ) {
        return {
          ...state,
          done: true,
          winner: seat,
          log: [...state.log, `${state.seats[seat].name} solved the case`],
        };
      }
      const seats = state.seats.map((s, i) =>
        i === seat ? { ...s, eliminated: true } : s,
      );
      const after = {
        ...state,
        seats,
        log: [
          ...state.log,
          `${state.seats[seat].name} accused wrongly and is out`,
        ],
      };
      if (seats.every((s) => s.eliminated))
        return { ...after, done: true, winner: null };
      return nextTurn(after);
    }

    case "endTurn": {
      if (seat !== state.current || state.phase === "disproving") return null;
      return nextTurn(state);
    }

    case "turnTimeout": {
      if (seat !== SYSTEM || state.phase === "disproving") return null;
      return nextTurn({
        ...state,
        log: [
          ...state.log,
          `${state.seats[state.current].name} ran out of time`,
        ],
      });
    }

    case "setConnected": {
      if (seat !== SYSTEM) return null;
      const seats = state.seats.map((s, i) =>
        i === move.seat ? { ...s, connected: move.connected } : s,
      );
      const next = { ...state, seats };
      if (!seats.some((s) => !s.bot && s.connected))
        return { ...next, done: true, winner: null };
      // If the current player left on their turn (and nobody is mid-disprove), skip them.
      if (
        !move.connected &&
        move.seat === state.current &&
        state.phase !== "disproving"
      )
        return nextTurn(next);
      return next;
    }

    default:
      return null;
  }
}

/** What one seat is allowed to see (-1 = watcher). Never includes others' hands or the solution. */
function viewAs(state, seat) {
  const sg = state.suggestion;
  return {
    seats: state.seats.map((s, i) => ({
      name: s.name,
      isBot: !!s.bot,
      connected: s.connected,
      eliminated: s.eliminated,
      handSize: state.hands[i].length,
    })),
    mySeat: seat >= 0 ? seat : null,
    myHand: seat >= 0 ? state.hands[seat] : [],
    current: state.current,
    phase: state.phase,
    suggestion: sg
      ? { by: sg.by, cards: sg.cards, disprover: sg.disprover }
      : null,
    shownToMe: sg && sg.by === seat ? sg.shown : null,
    myMatchingCards:
      sg && state.phase === "disproving" && sg.disprover === seat
        ? matching(state, seat, sg.cards)
        : [],
    log: state.log,
    done: state.done,
    winner: state.winner,
    solution: state.done ? state.solution : null,
  };
}

module.exports = {
  SUSPECTS,
  WEAPONS,
  ROOMS,
  SYSTEM,
  start,
  update,
  viewAs,
  matching,
};
