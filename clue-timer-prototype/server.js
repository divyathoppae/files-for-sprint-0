// T14 research prototype: a timer manager that sits OUTSIDE the pure game
// logic. It owns the 60s turn timer and 30s disprove timer, pauses the turn
// timer during disproving, runs bot seats, and handles disconnects. Every
// timer or bot action goes through logic.update(), exactly like a player move.
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const L = require("./logic");

const TURN_MS = Number(process.env.TURN_MS || 60000);
const DISPROVE_MS = Number(process.env.DISPROVE_MS || 30000);
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS || 1500);
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.static(__dirname + "/public"));
const server = http.createServer(app);
const io = new Server(server);

const room = {
  lobby: [], // { name, bot, connected, socketId }
  state: null,
  forcedDeal: null, // test hook
  timers: { turn: null, disprove: null, bot: null },
  turnDeadline: null,
  turnRemaining: TURN_MS, // saved while the turn timer is paused
  disproveDeadline: null,
  timedTurn: null, // which state.turn the turn timer belongs to
  gen: 0, // invalidates stale timer callbacks
};

function seatOf(socketId) {
  return room.lobby.findIndex((s) => s.socketId === socketId);
}

function clearAll() {
  Object.values(room.timers).forEach((t) => clearTimeout(t));
  room.timers = { turn: null, disprove: null, bot: null };
}

function broadcast() {
  const extra = {
    turnDeadline: room.turnDeadline,
    turnPaused:
      room.state && room.state.phase === "disproving"
        ? room.turnRemaining
        : null,
    disproveDeadline: room.disproveDeadline,
    serverNow: Date.now(),
  };
  for (const [id, socket] of io.of("/").sockets) {
    const seat = seatOf(id);
    if (!room.state) {
      socket.emit("lobby", {
        seats: room.lobby.map((s) => ({ name: s.name, bot: s.bot })),
        mySeat: seat,
      });
    } else {
      socket.emit("state", { ...L.viewAs(room.state, seat), ...extra });
    }
  }
}

/** Every change goes through here: players, timers, and bots alike. */
function apply(move, seat) {
  const next = L.update(room.state, move, seat);
  if (!next) return false;
  room.state = next;
  reconcile();
  broadcast();
  return true;
}

function reconcile() {
  const st = room.state;
  room.gen += 1;
  const gen = room.gen;
  clearTimeout(room.timers.disprove);
  clearTimeout(room.timers.bot);
  room.disproveDeadline = null;

  if (st.done) {
    clearAll();
    room.turnDeadline = null;
    return;
  }

  // A brand-new turn gets a fresh 60s.
  if (room.timedTurn !== st.turn) {
    room.timedTurn = st.turn;
    room.turnRemaining = TURN_MS;
    clearTimeout(room.timers.turn);
    room.timers.turn = null;
  }

  if (st.phase === "disproving") {
    // Pause the turn timer and remember how much was left.
    if (room.timers.turn) {
      room.turnRemaining = Math.max(0, room.turnDeadline - Date.now());
      clearTimeout(room.timers.turn);
      room.timers.turn = null;
    }
    room.turnDeadline = null;

    const d = st.suggestion.disprover;
    const seat = st.seats[d];
    if (seat.bot) {
      room.timers.bot = setTimeout(() => {
        if (gen !== room.gen) return;
        const card = L.matching(room.state, d, room.state.suggestion.cards);
        apply(
          { kind: "show", card: card[Math.floor(Math.random() * card.length)] },
          d,
        );
      }, BOT_DELAY_MS);
    } else if (!seat.connected) {
      setImmediate(
        () => gen === room.gen && apply({ kind: "disproveTimeout" }, L.SYSTEM),
      );
    } else {
      room.disproveDeadline = Date.now() + DISPROVE_MS;
      room.timers.disprove = setTimeout(() => {
        if (gen === room.gen) apply({ kind: "disproveTimeout" }, L.SYSTEM);
      }, DISPROVE_MS);
    }
    return;
  }

  // phase is 'turn' or 'afterAction': make sure the turn timer is running.
  if (!room.timers.turn) {
    room.turnDeadline = Date.now() + room.turnRemaining;
    const turnAtStart = st.turn;
    room.timers.turn = setTimeout(() => {
      room.timers.turn = null;
      if (room.state.turn === turnAtStart)
        apply({ kind: "turnTimeout" }, L.SYSTEM);
    }, room.turnRemaining);
  }

  // Bot's own turn: suggest something it doesn't hold, then end the turn.
  const me = st.seats[st.current];
  if (me.bot) {
    room.timers.bot = setTimeout(() => {
      if (gen !== room.gen) return;
      if (room.state.phase === "turn") {
        const hand = room.state.hands[room.state.current];
        const choose = (list) => {
          const opts = list.filter((c) => !hand.includes(c));
          return (opts.length ? opts : list)[
            Math.floor(Math.random() * (opts.length || list.length))
          ];
        };
        apply(
          {
            kind: "suggest",
            suspect: choose(L.SUSPECTS),
            weapon: choose(L.WEAPONS),
            room: choose(L.ROOMS),
          },
          room.state.current,
        );
      } else {
        apply({ kind: "endTurn" }, room.state.current);
      }
    }, BOT_DELAY_MS);
  }
}

io.on("connection", (socket) => {
  socket.on("join", (name) => {
    if (room.state) return socket.emit("error_msg", "Game already started");
    if (room.lobby.length >= 6) return socket.emit("error_msg", "Room is full");
    room.lobby.push({
      name: String(name).slice(0, 20),
      bot: null,
      connected: true,
      socketId: socket.id,
    });
    broadcast();
  });

  socket.on("addBot", () => {
    if (room.state || seatOf(socket.id) !== 0)
      return socket.emit(
        "error_msg",
        "Only the host can add bots before the game",
      );
    if (room.lobby.length >= 6) return socket.emit("error_msg", "Room is full");
    room.lobby.push({
      name: `Bot ${room.lobby.length + 1}`,
      bot: "easy",
      connected: true,
      socketId: null,
    });
    broadcast();
  });

  socket.on("start", () => {
    if (room.state) return;
    if (seatOf(socket.id) !== 0)
      return socket.emit("error_msg", "Only the host can start");
    if (room.lobby.length < 3)
      return socket.emit("error_msg", "Need at least 3 seats");
    if (!room.lobby.some((s) => !s.bot))
      return socket.emit("error_msg", "Need at least one human");
    room.state = L.start(
      room.lobby.map(({ name, bot, connected }) => ({ name, bot, connected })),
      room.forcedDeal,
    );
    reconcile();
    broadcast();
  });

  socket.on("move", (move) => {
    const seat = seatOf(socket.id);
    if (!room.state || seat < 0 || !apply(move, seat))
      socket.emit("error_msg", "Invalid move");
  });

  socket.on("disconnect", () => {
    const seat = seatOf(socket.id);
    if (seat < 0) return;
    if (!room.state) {
      room.lobby.splice(seat, 1);
      return broadcast();
    }
    room.lobby[seat].connected = false;
    apply({ kind: "setConnected", seat, connected: false }, L.SYSTEM);
  });
});

if (require.main === module) {
  server.listen(PORT, () =>
    console.log(
      `Clue timer prototype on http://localhost:${PORT} (turn ${TURN_MS} ms, disprove ${DISPROVE_MS} ms)`,
    ),
  );
}

module.exports = { server, room };
