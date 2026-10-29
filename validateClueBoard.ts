/* eslint no-console: "off" */

/**
 * Validates the Clue at Northeastern board data (T12).
 *
 * Usage, from the `server` folder:
 *   node scripts/validateClueBoard.ts
 *   node scripts/validateClueBoard.ts path/to/otherBoard.json
 *
 * Exits with status 1 and lists every problem if the board is invalid.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The six classic suspects, each of whom needs exactly one starting square */
export const SUSPECTS = [
  "missScarlet",
  "colonelMustard",
  "mrsWhite",
  "mrGreen",
  "mrsPeacock",
  "professorPlum",
] as const;

const HALLWAY = ".";
const WALL = "#";
const CENTER = "X";
const ROOM_COUNT = 9;

interface Point {
  x: number;
  y: number;
}

export interface ClueBoard {
  version: number;
  width: number;
  height: number;
  grid: string[];
  rooms: { id: string; symbol: string; name: string; classicRoom: string }[];
  doors: { room: string; hallway: Point; roomSquare: Point }[];
  tunnels: { between: [string, string] }[];
  startingSquares: { suspect: string; x: number; y: number }[];
}

const key = (p: Point) => `${p.x},${p.y}`;
const show = (p: Point) => `(${p.x}, ${p.y})`;

/**
 * Checks a parsed board file
 *
 * @param board - the parsed JSON contents of a board file
 * @returns a list of problems; empty if the board is valid
 */
export function validateClueBoard(board: ClueBoard): string[] {
  const problems: string[] = [];
  const { width, height, grid } = board;

  // 1. Grid shape and symbols
  if (!Array.isArray(grid) || grid.length !== height) {
    return [`Grid must have ${height} rows, found ${Array.isArray(grid) ? grid.length : "none"}`];
  }
  grid.forEach((row, y) => {
    if (row.length !== width)
      problems.push(`Row ${y} has ${row.length} squares, expected ${width}`);
  });
  if (problems.length > 0) return problems;

  const at = (p: Point) => grid[p.y]?.[p.x];
  const inBounds = (p: Point) => p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;

  // 2. Rooms
  const roomBySymbol = new Map<string, string>();
  const roomIds = new Set<string>();
  if (board.rooms.length !== ROOM_COUNT) {
    problems.push(`Expected ${ROOM_COUNT} rooms, found ${board.rooms.length}`);
  }
  for (const room of board.rooms) {
    if (roomIds.has(room.id)) problems.push(`Duplicate room id "${room.id}"`);
    if (roomBySymbol.has(room.symbol)) problems.push(`Duplicate room symbol "${room.symbol}"`);
    if ([HALLWAY, WALL, CENTER].includes(room.symbol) || room.symbol.length !== 1) {
      problems.push(`Room "${room.id}" has an invalid symbol "${room.symbol}"`);
    }
    roomIds.add(room.id);
    roomBySymbol.set(room.symbol, room.id);
    if (!grid.some((row) => row.includes(room.symbol))) {
      problems.push(`Room "${room.id}" has no squares on the grid`);
    }
  }
  const allowed = new Set([HALLWAY, WALL, CENTER, ...roomBySymbol.keys()]);
  grid.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (!allowed.has(ch)) problems.push(`Unknown symbol "${ch}" at ${show({ x, y })}`);
    }),
  );

  // 3. Doors: a hallway square orthogonally next to a square of its room
  const doorsPerRoom = new Map<string, number>();
  for (const door of board.doors) {
    const label = `Door into "${door.room}" at ${show(door.hallway)}`;
    if (!roomIds.has(door.room)) {
      problems.push(`${label}: unknown room`);
      continue;
    }
    if (!inBounds(door.hallway) || at(door.hallway) !== HALLWAY) {
      problems.push(`${label}: outside square is not a hallway`);
    }
    if (!inBounds(door.roomSquare) || roomBySymbol.get(at(door.roomSquare)) !== door.room) {
      problems.push(`${label}: inside square ${show(door.roomSquare)} is not part of that room`);
    }
    const distance =
      Math.abs(door.hallway.x - door.roomSquare.x) + Math.abs(door.hallway.y - door.roomSquare.y);
    if (distance !== 1) problems.push(`${label}: the two squares must be side by side`);
    doorsPerRoom.set(door.room, (doorsPerRoom.get(door.room) ?? 0) + 1);
  }
  for (const id of roomIds) {
    if (!doorsPerRoom.has(id)) problems.push(`Room "${id}" has no doors`);
  }

  // 4. Tunnels: two, each between two different rooms, no room in more than one
  const tunnelRooms = new Set<string>();
  if (board.tunnels.length !== 2)
    problems.push(`Expected 2 tunnels, found ${board.tunnels.length}`);
  for (const { between } of board.tunnels) {
    const [a, b] = between;
    if (!roomIds.has(a) || !roomIds.has(b)) problems.push(`Tunnel ${a} ↔ ${b}: unknown room`);
    if (a === b) problems.push(`Tunnel ${a} ↔ ${b}: must connect two different rooms`);
    for (const r of between) {
      if (tunnelRooms.has(r)) problems.push(`Room "${r}" is in more than one tunnel`);
      tunnelRooms.add(r);
    }
  }

  // 5. Starting squares: one per suspect, on a hallway square at the edge
  const seen = new Set<string>();
  for (const start of board.startingSquares) {
    if (!(SUSPECTS as readonly string[]).includes(start.suspect)) {
      problems.push(`Unknown suspect "${start.suspect}"`);
    }
    if (seen.has(start.suspect))
      problems.push(`"${start.suspect}" has more than one starting square`);
    seen.add(start.suspect);
    const onEdge =
      start.x === 0 || start.y === 0 || start.x === width - 1 || start.y === height - 1;
    if (!inBounds(start) || at(start) !== HALLWAY || !onEdge) {
      problems.push(
        `Starting square for "${start.suspect}" at ${show(start)} must be a hallway square on the edge`,
      );
    }
  }
  for (const s of SUSPECTS) if (!seen.has(s)) problems.push(`"${s}" has no starting square`);
  if (problems.length > 0) return problems;

  // 6. Reachability: from every starting square, walking only on hallway
  //    squares, every door (and so every room) must be reachable, and no
  //    hallway square may be cut off
  const hallwayCount = grid
    .join("")
    .split("")
    .filter((ch) => ch === HALLWAY).length;
  for (const start of board.startingSquares) {
    const reached = new Set<string>([key(start)]);
    const queue: Point[] = [start];
    while (queue.length > 0) {
      const p = queue.shift()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const q = { x: p.x + dx, y: p.y + dy };
        if (inBounds(q) && at(q) === HALLWAY && !reached.has(key(q))) {
          reached.add(key(q));
          queue.push(q);
        }
      }
    }
    for (const id of roomIds) {
      const reachable = board.doors.some((d) => d.room === id && reached.has(key(d.hallway)));
      if (!reachable) problems.push(`Room "${id}" can't be reached from ${start.suspect}'s start`);
    }
    if (reached.size !== hallwayCount) {
      problems.push(
        `${hallwayCount - reached.size} hallway square(s) can't be reached from ${start.suspect}'s start`,
      );
    }
  }

  return problems;
}

/** Runs the validator on a file and reports the result */
function main() {
  const defaultPath = fileURLToPath(new URL("../src/games/clueBoard.json", import.meta.url));
  const path = process.argv[2] ?? defaultPath;

  let board: ClueBoard;
  try {
    board = JSON.parse(readFileSync(path, "utf8")) as ClueBoard;
  } catch (err) {
    console.error(`Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const problems = validateClueBoard(board);
  if (problems.length > 0) {
    console.error(`Board ${path} has ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(
    `Board OK: ${board.width}x${board.height} grid, ${board.rooms.length} rooms, ` +
      `${board.doors.length} doors, ${board.tunnels.length} tunnels, ` +
      `${board.startingSquares.length} starting squares; every room reachable from every start`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
