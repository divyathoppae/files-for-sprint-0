// Automated check: 3 human clients + 1 Easy bot, with shortened timers.
process.env.TURN_MS = "800";
process.env.DISPROVE_MS = "400";
process.env.BOT_DELAY_MS = "50";
const assert = require("assert");
const { io: Client } = require("socket.io-client");
const { server, room } = require("./server");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const pass = (msg) => {
  passed++;
  console.log("PASS " + msg);
};

// Fixed deal so the test knows who must disprove.
room.forcedDeal = {
  solution: { suspect: "scarlet", weapon: "rope", room: "snell" },
  hands: [
    ["knife", "isec", "marino", "exp", "peacock"], // seat 0 Sam
    ["mustard", "candlestick", "westVillageH", "plum"], // seat 1 Leo
    ["white", "wrench", "ell", "internationalVillage"], // seat 2 Maya
    ["green", "leadPipe", "curry", "revolver", "stetsonEast"], // seat 3 bot
  ],
};

server.listen(0, async () => {
  const url = `http://localhost:${server.address().port}`;
  const names = ["Sam", "Leo", "Maya"];
  const c = names.map(() => Client(url));
  const v = names.map(() => null);
  const errors = names.map(() => []);
  const seenCurrent = new Set();
  c.forEach((s, i) => {
    s.on("state", (st) => {
      v[i] = st;
      if (i === 0) seenCurrent.add(st.current);
    });
    s.on("error_msg", (m) => errors[i].push(m));
  });
  await wait(150);
  for (let i = 0; i < 3; i++) {
    c[i].emit("join", names[i]);
    await wait(30);
  }

  // Lobby rules
  c[1].emit("addBot");
  await wait(50);
  assert.ok(errors[1].includes("Only the host can add bots before the game"));
  c[1].emit("start");
  await wait(50);
  assert.ok(errors[1].includes("Only the host can start"));
  pass("only the host can add bots and start");

  c[0].emit("addBot");
  await wait(50);
  c[0].emit("start");
  await wait(100);
  assert.strictEqual(v[0].current, 0);
  assert.ok(v.every((x) => x.turnDeadline === v[0].turnDeadline));
  pass("3 humans + 1 bot started; all clients got the identical turn deadline");

  // Privacy: views never include other hands or the solution
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(v[i].solution, null);
    assert.ok(!("hands" in v[i]));
    assert.deepStrictEqual(v[i].myHand, room.forcedDeal.hands[i]);
  }
  pass("each player sees only their own hand; no one sees the solution");

  // Wrong player can't act
  c[1].emit("move", {
    kind: "suggest",
    suspect: "white",
    weapon: "wrench",
    room: "isec",
  });
  await wait(50);
  assert.ok(errors[1].includes("Invalid move"));
  pass("a player can't act on someone else's turn");

  // Scenario A: Sam suggests; Leo has nothing; Maya must disprove (human)
  await wait(200); // let some turn time pass
  c[0].emit("move", {
    kind: "suggest",
    suspect: "white",
    weapon: "wrench",
    room: "isec",
  });
  await wait(50);
  assert.strictEqual(v[0].phase, "disproving");
  assert.strictEqual(v[0].suggestion.disprover, 2);
  assert.strictEqual(v[0].turnDeadline, null);
  assert.ok(v[0].turnPaused > 0);
  const remainingBefore = v[0].turnPaused; // exact time left when the server paused
  assert.deepStrictEqual(v[2].myMatchingCards.sort(), ["white", "wrench"]);
  assert.deepStrictEqual(v[1].myMatchingCards, []);
  pass(
    "suggestion skips players with no match; first holder clockwise must disprove",
  );
  pass("turn timer pauses while a card is being chosen");

  c[2].emit("move", { kind: "show", card: "ell" });
  await wait(50);
  assert.ok(errors[2].includes("Invalid move"));
  pass("disprover can't show a non-matching card");

  await wait(250); // spend time in disproving; this must NOT come off Sam's turn
  c[2].emit("move", { kind: "show", card: "wrench" });
  await wait(50);
  assert.strictEqual(v[0].shownToMe, "wrench");
  assert.strictEqual(v[1].shownToMe, null);
  assert.strictEqual(v[2].shownToMe, null);
  assert.ok(
    v[1].log.at(-1).includes("showed a card") &&
      !v[1].log.at(-1).includes("wrench"),
  );
  pass("only the suggester sees the shown card; the log hides which card");

  const remainingAfter = v[0].turnDeadline - v[0].serverNow;
  assert.ok(
    Math.abs(remainingAfter - remainingBefore) < 30,
    `resumed ${remainingAfter}ms vs paused ${remainingBefore}ms`,
  );
  pass(
    `turn timer resumed with its saved time (${remainingBefore} ms paused -> ${remainingAfter} ms after ~300 ms of disproving)`,
  );

  c[0].emit("move", { kind: "endTurn" });
  await wait(50);
  assert.strictEqual(v[0].current, 1);

  // Scenario B: Leo suggests; Maya disproves but goes idle -> auto-show after 400ms
  c[1].emit("move", {
    kind: "suggest",
    suspect: "white",
    weapon: "knife",
    room: "marino",
  });
  await wait(50);
  assert.strictEqual(v[1].suggestion.disprover, 2);
  assert.ok(v.every((x) => x.disproveDeadline === v[0].disproveDeadline));
  await wait(450);
  assert.strictEqual(v[1].phase, "afterAction");
  assert.strictEqual(v[1].shownToMe, "white");
  pass("disprove timer ran out; server auto-showed a matching card");

  // Leo goes idle -> turn timeout moves on to Maya
  await wait(850);
  assert.strictEqual(v[0].current, 2);
  pass("turn timer ran out; turn passed to the next player");

  // Scenario C: Maya suggests bot's cards -> bot disproves automatically
  c[2].emit("move", {
    kind: "suggest",
    suspect: "green",
    weapon: "leadPipe",
    room: "curry",
  });
  await wait(150);
  assert.strictEqual(v[2].phase, "afterAction");
  assert.ok(["green", "leadPipe", "curry"].includes(v[2].shownToMe));
  pass("bot disproved on its own with a matching card");

  c[2].emit("move", { kind: "endTurn" });
  await wait(50);
  assert.strictEqual(v[0].current, 3);
  // Bot takes its turn (any human disprover may need to time out: up to ~400ms)
  for (let t = 0; t < 30 && v[0].current !== 0; t++) await wait(50);
  assert.strictEqual(v[0].current, 0);
  pass("bot took its own turn and ended it");

  // Scenario D: Maya disconnects
  c[2].close();
  await wait(100);
  assert.strictEqual(v[0].seats[2].connected, false);
  const t0 = Date.now();
  c[0].emit("move", {
    kind: "suggest",
    suspect: "white",
    weapon: "wrench",
    room: "ell",
  });
  for (let t = 0; t < 20 && v[0].phase !== "afterAction"; t++) await wait(10);
  assert.strictEqual(v[0].phase, "afterAction");
  assert.ok(Date.now() - t0 < 200);
  assert.ok(["white", "wrench", "ell"].includes(v[0].shownToMe));
  pass("disconnected disprover: server showed a card for them immediately");

  seenCurrent.clear();
  c[0].emit("move", { kind: "endTurn" });
  await wait(50);
  c[1].emit("move", { kind: "endTurn" });
  await wait(50);
  for (let t = 0; t < 30 && v[0].current !== 0; t++) await wait(50);
  assert.ok(!seenCurrent.has(2));
  pass("disconnected player's turn was skipped");

  // Wrong accusation eliminates; right one ends the game
  c[0].emit("move", {
    kind: "accuse",
    suspect: "plum",
    weapon: "rope",
    room: "snell",
  });
  await wait(50);
  assert.ok(v[0].seats[0].eliminated);
  assert.strictEqual(v[0].solution, null);
  pass("wrong accusation eliminates the player");

  for (let t = 0; t < 40 && v[1].current !== 1; t++) await wait(50);
  c[1].emit("move", {
    kind: "accuse",
    suspect: "scarlet",
    weapon: "rope",
    room: "snell",
  });
  await wait(50);
  assert.ok(v[1].done && v[1].winner === 1);
  assert.deepStrictEqual(v[0].solution, room.forcedDeal.solution);
  pass("correct accusation ends the game and reveals the solution to everyone");

  c.forEach((s) => s.close());
  server.close();
  console.log(`\nAll ${passed} checks passed`);
  process.exit(0);
});
