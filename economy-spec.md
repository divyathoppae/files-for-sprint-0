*CS4530 · Group 202 · Sprint 0*

# GameNite Economy Spec

Story 2 design work by Sriganesh: T07 XP and tier types, T08 item and trade types, T09 all-or-nothing update research. Built against the IP3 code (Keyv repos, `GameLogic`, zod request types), so it carries over to the team repo in Sprint 1.

## Status

| ID | Status |
|---|---|
| `T07` | Done. XP rules (10 / +15, half in bot games), 10 milestones plus 3 Clue milestones, 5 tier thresholds, and the wallet and ledger models are written as types. Found that the game framework has no winner yet, so T22 adds a `winners()` function. |
| `T08` | Done. Item, inventory, avatar, and trade offer types written; 24-item Northeastern catalog (8 free, 16 for sale across 5 rarities). |
| `T09` | Done. Go: one wallet record per user plus a per-user lock makes purchases a single write; trades use a pending-op record that finishes the trade on restart, with reversal entries as the last resort. T40 split into T40a/b/c (Medium, Medium, Small). |
| `T13` | Done. Six low-fi screens drafted (lobby, board, suggest and disprove, notebook, accusation, results); ready for team review. |

---

*T07 · Story 2 · Small*

## XP rules, milestones, tiers, and the ledger

### XP per game (COS 2.1)

| Result | Against people | Bot game |
|---|---|---|
| Finished | 10 | 5 |
| Won (finish + win bonus) | 25 | 12 |
| Left before the end | 0 | 0 |
| Bot seats | — | — |

- A game is a **bot game** if any seat was a bot. Half of the 15 XP win bonus rounds down to 7.
- "Finished" means the user is still in the game when `isDone` first becomes true. Eliminated Clue players who stay count as finished.
- **Winners:** `GameLogic` has no notion of a winner today, so T22 adds `winners(state): number[]`. Nim: the player who did *not* take the last object (the client says the last taker loses), which is `nextPlayer` once the game is done. Guess: everyone tied for closest to the secret. Clue: the correct accuser, or nobody.
- **Hook point:** `updateGame` in `server/src/services/game.service.ts`, at the moment `game.done` flips from false to true.
- **Paid once:** each award's ledger entry id is fixed (`{userId}:game:{gameId}`, `{userId}:milestone:{key}`). If that id is already in the wallet's ledger, the award is skipped, so retries and double events can't pay twice.

### Tiers (COS 2.3)

| Tier | Lifetime XP | About how many games |
|---|---|---|
| Bronze | 0 | Start |
| Silver | 500 | ~20 games plus the early milestones |
| Gold | 1,500 | ~70 games |
| Platinum | 3,000 | ~150 games |
| Diamond | 6,000 | ~320 games |

Game counts assume about 17 XP per game against people (half wins, half losses). The demo uses seeded wallets to show the higher tiers.

### Milestones (COS 2.2)

| Key | Name | Requirement | Category | XP |
|---|---|---|---|---|
| `first-game` | First Game | Finish 1 game | gameplay | 10 |
| `first-win` | First Win | Win 1 game | gameplay | 25 |
| `regular` | Regular | Finish 25 games | gameplay | 100 |
| `win-10` | Win 10 Games | Win 10 games | gameplay | 100 |
| `win-50` | Win 50 Games | Win 50 games | gameplay | 300 |
| `every-type` | Win a Game of Every Type | Win at least one Nim, Guess, and Clue game | gameplay | 150 |
| `first-purchase` | First Purchase | Buy 1 store item | economy | 20 |
| `first-trade` | First Trade | Complete 1 trade | economy | 30 |
| `first-thread` | First Forum Thread | Post 1 forum thread | community | 20 |
| `commenter` | Join the Conversation | Post 10 forum comments | community | 50 |
| `solve-a-case` | Solve a Case (3.12) | Win a Clue game | clue | 50 |
| `beat-hard-bot` | Beat a Hard Bot (3.12) | Win a Clue game that had a Hard bot | clue | 75 |
| `quick-study` | Quick Study (3.12) | Win a Clue game within 8 of your own turns | clue | 75 |

The 10 core milestones pay 805 XP in total. The Clue rows belong to Desirable 3.12 (T67). Quick Study replaces "Win Without a Wrong Accusation"; see the team decisions at the end.

**`shared/src/xp.types.ts`**

```ts
import { z } from "zod";

/*** XP RULES ***/

/**
 * XP for finishing and winning a game (COS 2.1). A game counts as a bot game
 * if any seat was filled by a bot; bot games pay half, rounded down.
 */
export const XP_RULES = {
  finish: 10,
  winBonus: 15,
  botFinish: 5,
  botWinBonus: 7,
} as const;

/*** TIERS ***/

export type TierKey = z.infer<typeof zTierKey>;
export const zTierKey = z.enum(["bronze", "silver", "gold", "platinum", "diamond"]);

/**
 * Lifetime XP needed for each tier (COS 2.3). Lifetime XP never goes down, so
 * a user's tier never goes down either.
 */
export const TIER_THRESHOLDS: Record<TierKey, number> = {
  bronze: 0,
  silver: 500,
  gold: 1500,
  platinum: 3000,
  diamond: 6000,
};

/**
 * @param lifetimeXp - a user's lifetime XP
 * @returns the highest tier the user has reached
 */
export function tierFor(lifetimeXp: number): TierKey {
  return zTierKey.options.findLast((tier) => lifetimeXp >= TIER_THRESHOLDS[tier]) ?? "bronze";
}

/*** MILESTONES ***/

/**
 * Counters that milestones measure. Only the server changes them, when the
 * matching event happens.
 * - `gameTypesWon`: how many different games the user has won at least once
 */
export type StatKey = z.infer<typeof zStatKey>;
export const zStatKey = z.enum([
  "gamesFinished",
  "gamesWon",
  "gameTypesWon",
  "purchases",
  "trades",
  "threadsPosted",
  "commentsPosted",
  "clueWins",
  "clueHardBotWins",
  "clueQuickWins",
]);

/**
 * A one-time XP milestone (COS 2.2)
 * - `key`: stable id, also used as the ledger ref so each milestone pays once
 * - `stat`, `goal`: the milestone completes when the user's stat reaches goal
 * - `xp`: added to both lifetime XP and the spendable balance
 */
export interface Milestone {
  key: string;
  name: string;
  description: string;
  category: "gameplay" | "economy" | "community" | "clue";
  stat: StatKey;
  goal: number;
  xp: number;
}

/**
 * One user's progress toward one milestone (COS 2.3, 2.10)
 */
export interface MilestoneProgress {
  milestone: Milestone;
  current: number;
  completedAt: Date | null;
}

/**
 * Everything the profile and milestones page need about a user's XP
 * - `nextTier`: null once the user is Diamond
 */
export interface XpSummary {
  lifetimeXp: number;
  balance: number;
  tier: TierKey;
  nextTier: { tier: TierKey; lifetimeXp: number } | null;
  milestones: MilestoneProgress[];
}

/*** SOCKET PAYLOADS ***/

/**
 * Sent to a user whenever they earn XP (COS 2.10)
 * - `label`: what it was for, like "Won Nim" or a milestone name
 * - `newTier`: set only when this award moved the user up a tier
 */
export interface XpAwardedPayload {
  amount: number;
  reason: "game" | "milestone";
  label: string;
  lifetimeXp: number;
  balance: number;
  newTier: TierKey | null;
}
```

**`shared/src/data/milestones.ts`**

```ts
import type { Milestone } from "../xp.types.ts";

export const MILESTONES: Milestone[] = [
  { key: "first-game", name: "First Game", description: "Finish your first game", category: "gameplay", stat: "gamesFinished", goal: 1, xp: 10 },
  { key: "first-win", name: "First Win", description: "Win your first game", category: "gameplay", stat: "gamesWon", goal: 1, xp: 25 },
  { key: "regular", name: "Regular", description: "Finish 25 games", category: "gameplay", stat: "gamesFinished", goal: 25, xp: 100 },
  { key: "win-10", name: "Win 10 Games", description: "Win 10 games", category: "gameplay", stat: "gamesWon", goal: 10, xp: 100 },
  { key: "win-50", name: "Win 50 Games", description: "Win 50 games", category: "gameplay", stat: "gamesWon", goal: 50, xp: 300 },
  { key: "every-type", name: "Win a Game of Every Type", description: "Win at least one Nim, Guess, and Clue game", category: "gameplay", stat: "gameTypesWon", goal: 3, xp: 150 },
  { key: "first-purchase", name: "First Purchase", description: "Buy your first store item", category: "economy", stat: "purchases", goal: 1, xp: 20 },
  { key: "first-trade", name: "First Trade", description: "Complete your first trade", category: "economy", stat: "trades", goal: 1, xp: 30 },
  { key: "first-thread", name: "First Forum Thread", description: "Post your first forum thread", category: "community", stat: "threadsPosted", goal: 1, xp: 20 },
  { key: "commenter", name: "Join the Conversation", description: "Post 10 forum comments", category: "community", stat: "commentsPosted", goal: 10, xp: 50 },
  // Desirable 3.12 (T67)
  { key: "solve-a-case", name: "Solve a Case", description: "Win a Clue game", category: "clue", stat: "clueWins", goal: 1, xp: 50 },
  { key: "beat-hard-bot", name: "Beat a Hard Bot", description: "Win a Clue game that had a Hard bot", category: "clue", stat: "clueHardBotWins", goal: 1, xp: 75 },
  { key: "quick-study", name: "Quick Study", description: "Win a Clue game within 8 of your own turns", category: "clue", stat: "clueQuickWins", goal: 1, xp: 75 },
];
```

### Wallet and ledger (COS 2.1, 2.9)

Each user has one **wallet** record holding their balance, lifetime XP, milestone counters, inventory, and equipped avatar. Keeping it in one record means any change that touches only one user is a single write (see T09). The **ledger** stores one row per change. The wallet keeps the list of its ledger ids, so `balance` always equals the sum of those entries' `balanceDelta`, and the two are updated in the same write.

**`server/src/models.ts (additions)`**

```ts
/**
 * Represents one change to a user's XP or inventory (COS 2.9). Entries are
 * never edited or deleted; a mistake is undone with a "reversal" entry.
 * - `userId`: whose wallet changed
 * - `kind`: what caused the change
 * - `balanceDelta`: change to the spendable balance (negative when spending)
 * - `lifetimeDelta`: change to lifetime XP; nonzero only for "game" and "milestone"
 * - `ref`: the game id, milestone key, item id, or trade id behind the change
 * - `itemId`: the item bought, returned, or traded, if any
 * - `reverses`: on a reversal, the id of the entry being undone
 * - `createdAt`: when the change happened
 */
export interface LedgerEntryRecord {
  userId: RecordId; // References User records
  kind: "game" | "milestone" | "purchase" | "return" | "tradeGive" | "tradeGet" | "reversal";
  balanceDelta: number;
  lifetimeDelta: number;
  ref: string;
  itemId?: string;
  reverses?: RecordId; // References LedgerEntry records
  createdAt: DateISO;
}

/**
 * Represents a user's XP, items, and progress, keyed by user id. Everything
 * is in one record so that a change to one user is a single write.
 * - `balance`: spendable XP; always the sum of the `ledger` entries' balanceDelta
 * - `lifetimeXp`: all XP ever earned; never goes down
 * - `stats`: milestone counters
 * - `gameTypesWon`: games the user has won at least once
 * - `milestones`: completed milestone key, mapped to when it was completed
 * - `inventory`: items bought or received in trades (free items aren't
 *   listed, since everyone owns them)
 * - `equipped`: the item worn on each avatar layer
 * - `returns`: when each store return happened, for the 3-per-7-days limit
 * - `ledger`: ledger entry ids, oldest first
 * - `version`: goes up by 1 on every write; trade recovery uses it (T09)
 */
export interface WalletRecord {
  balance: number;
  lifetimeXp: number;
  stats: Partial<Record<StatKey, number>>;
  gameTypesWon: GameKey[];
  milestones: Record<string, DateISO>;
  inventory: InventoryEntry[];
  equipped: AvatarLayers;
  returns: DateISO[];
  ledger: RecordId[]; // References LedgerEntry records
  version: number;
}
```

**`server/src/games/gameLogic.ts (addition for T22)`**

```ts
  /**
   * Once `isDone` is true, the indexes of the winning players (empty if
   * nobody won). Used to award win XP (COS 2.1).
   */
  winners: (state: GameState) => number[];

// nim.ts:   winners: ({ nextPlayer }) => [nextPlayer],  // the last taker loses
// guess.ts: winners: everyone tied for the smallest |guess - secret|
```

---

*T08 · Story 2 · Small*

## Items, avatars, trades, and the starter catalog

- An avatar has four layers: **base** (shape and color), **face**, **accessory**, and **background**. Each layer shows exactly one item.
- **Free items** are owned by everyone and are never stored in an inventory, so they can't be bought, returned, or traded (COS 2.6, 2.8).
- A user owns at most one copy of an item. This matches the 2.5 rule that you can't buy what you already own, and it means a trade can't give you an item you already have.
- A trade's sender side is items and/or up to 500 XP. The recipient side must include at least one item. That means no gifts and no asking the other person for XP.

**`shared/src/store.types.ts`**

```ts
import { z } from "zod";
import { type SafeUserInfo } from "./user.types.ts";
import { type TierKey } from "./xp.types.ts";

/*** ITEMS AND AVATARS ***/

export type AvatarLayer = z.infer<typeof zAvatarLayer>;
export const zAvatarLayer = z.enum(["base", "face", "accessory", "background"]);

export type Rarity = z.infer<typeof zRarity>;
export const zRarity = z.enum(["common", "uncommon", "rare", "epic", "legendary"]);

/**
 * One item in the store catalog (COS 2.4, 2.5, 2.12)
 * - `itemId`: stable id, like "face-wink"
 * - `layer`: which part of the avatar it replaces
 * - `price`: XP cost; 0 for free items
 * - `free`: everyone owns it; it can't be bought, returned, or traded
 * - `tierRequired`: lowest tier allowed to buy it, if tier-locked
 * - `stock`: how many copies exist, if limited
 * - `art`: what the avatar renderer draws (a color, or an SVG file name)
 */
export interface StoreItem {
  itemId: string;
  name: string;
  description: string;
  layer: AvatarLayer;
  rarity: Rarity;
  price: number;
  free: boolean;
  tierRequired?: TierKey;
  stock?: number;
  art: string;
}

/**
 * The item equipped on each layer of an avatar
 */
export type AvatarLayers = Record<AvatarLayer, string>;

/**
 * What a brand-new account wears (COS 2.4)
 */
export const DEFAULT_AVATAR: AvatarLayers = {
  base: "base-gray",
  face: "face-smile",
  accessory: "acc-none",
  background: "bg-plain",
};

/**
 * A store item as one user sees it (COS 2.5)
 * - `owned`: the user already has it
 * - `blockedReason`: why the user can't buy it right now, if they can't
 * - `remaining`: copies left, for limited items
 */
export interface StoreListing {
  item: StoreItem;
  owned: boolean;
  blockedReason?: "owned" | "balance" | "tier" | "soldOut";
  remaining?: number;
}

/**
 * An item in a user's inventory (COS 2.6, 2.9)
 * - `returnableUntil`: 48 hours after a store purchase; null for traded items
 */
export interface InventoryItemInfo {
  item: StoreItem;
  source: "store" | "trade";
  acquiredAt: Date;
  returnableUntil: Date | null;
  equipped: boolean;
}

/*** RULES ***/

export const RETURN_RULES = { windowHours: 48, maxPerWeek: 3 } as const;

export const TRADE_RULES = {
  maxXp: 500,
  maxItemsPerSide: 6,
  expiresAfterHours: 24,
  minGamesFinished: 3,
  retradeCooldownHours: 24, // Desirable 2.13
} as const;

/*** TRADING ***/

export type TradeStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired" | "failed";

/**
 * A trade offer, as either user sees it (COS 2.7, 2.8)
 * - `giveItems`, `giveXp`: what the sender gives
 * - `getItems`: what the sender asks the recipient for
 * - `failureReason`: why accepting failed, shown to both users
 */
export interface TradeOfferInfo {
  tradeId: string;
  from: SafeUserInfo;
  to: SafeUserInfo;
  giveItems: StoreItem[];
  giveXp: number;
  getItems: StoreItem[];
  status: TradeStatus;
  createdAt: Date;
  expiresAt: Date;
  failureReason?: string;
}

/*** TYPES USED IN THE STORE AND TRADE API ***/

export type PurchaseRequest = z.infer<typeof zPurchaseRequest>;
export const zPurchaseRequest = z.object({ itemId: z.string() });

export type ReturnRequest = z.infer<typeof zReturnRequest>;
export const zReturnRequest = z.object({ itemId: z.string() });

export type AvatarSaveRequest = z.infer<typeof zAvatarSaveRequest>;
export const zAvatarSaveRequest = z.object({
  equipped: z.object({
    base: z.string(),
    face: z.string(),
    accessory: z.string(),
    background: z.string(),
  }),
});

export type TradeOfferRequest = z.infer<typeof zTradeOfferRequest>;
export const zTradeOfferRequest = z
  .object({
    to: z.string(), // recipient's username
    giveItems: z.array(z.string()).max(TRADE_RULES.maxItemsPerSide),
    giveXp: z.int().min(0).max(TRADE_RULES.maxXp),
    getItems: z.array(z.string()).min(1).max(TRADE_RULES.maxItemsPerSide),
  })
  .refine((offer) => offer.giveItems.length > 0 || offer.giveXp > 0, "The offer must give something");

export type TradeResponseRequest = z.infer<typeof zTradeResponseRequest>;
export const zTradeResponseRequest = z.object({
  tradeId: z.string(),
  action: z.enum(["accept", "decline", "cancel"]),
});
```

**`server/src/models.ts (additions)`**

```ts
/**
 * Represents one item in a wallet's inventory.
 * - `source`: bought in the store or received in a trade
 * - `pricePaid`: the refund amount; store items only
 * - `tradeLockedUntil`: can't be traded again before this (Desirable 2.13)
 */
export interface InventoryEntry {
  itemId: string;
  source: "store" | "trade";
  acquiredAt: DateISO;
  pricePaid?: number;
  tradeLockedUntil?: DateISO;
}

/**
 * Represents a trade offer in the database.
 * - `status`: "committing" only while an accepted trade is being applied (T09)
 * - `commit`: while committing, each user's wallet version before the trade
 *   and the full wallet after it
 */
export interface TradeRecord {
  from: RecordId; // References User records
  to: RecordId; // References User records
  giveItems: string[];
  giveXp: number;
  getItems: string[];
  status: TradeStatus | "committing";
  createdAt: DateISO;
  expiresAt: DateISO;
  resolvedAt?: DateISO;
  failureReason?: string;
  commit?: Record<RecordId, { fromVersion: number; wallet: WalletRecord }>;
}

/**
 * Copies left of a limited item, keyed by item id (Desirable 2.12)
 */
export interface StockRecord {
  remaining: number;
}

// repository.ts
export const WalletRepo = createRepo<WalletRecord>("wallet");
export const LedgerRepo = createRepo<LedgerEntryRecord>("ledger");
export const TradeRepo = createRepo<TradeRecord>("trade");
export const StockRepo = createRepo<StockRecord>("stock");
```

### Starter catalog: 24 items

The catalog has 6 items per layer: 2 free and 4 for sale. Prices are set against about 17 XP per game, so a common item costs 3 to 5 games and the legendary item costs about 80. Two items are tier-locked and two are limited-stock, so Desirable 2.12 has real data to work with.

| ID | Name | Layer | Rarity | Price | Notes |
|---|---|---|---|---|---|
| `base-gray` | Classic Gray | base | common | 0 | (free · default) |
| `base-snow` | Snow Husky | base | common | 0 | (free) |
| `base-red` | Northeastern Red | base | common | 60 |  |
| `base-midnight` | Midnight Black | base | uncommon | 180 |  |
| `base-gold-paw` | Gold Paw Print | base | rare | 400 |  |
| `base-aurora` | Aurora | base | epic | 750 | Tier-locked: Gold |
| `face-smile` | Smile | face | common | 0 | (free · default) |
| `face-focused` | Focused | face | common | 0 | (free) |
| `face-wink` | Wink | face | common | 50 |  |
| `face-shades` | Shades | face | uncommon | 150 |  |
| `face-finals` | Finals Week Stare | face | rare | 350 |  |
| `face-monocle` | Detective Monocle | face | epic | 700 | Clue tie-in |
| `acc-none` | No Accessory | accessory | common | 0 | (free · default) |
| `acc-cap` | Ball Cap | accessory | common | 0 | (free) |
| `acc-lanyard` | Husky Card Lanyard | accessory | common | 75 |  |
| `acc-headphones` | Snell Study Headphones | accessory | uncommon | 200 |  |
| `acc-hardhat` | Co-op Hard Hat | accessory | rare | 450 |  |
| `acc-magnifier` | Magnifying Glass | accessory | legendary | 1,400 | Tier-locked: Gold · limited 10 |
| `bg-plain` | Plain | background | common | 0 | (free · default) |
| `bg-quad` | Centennial Common | background | common | 0 | (free) |
| `bg-snell` | Snell Library | background | common | 80 |  |
| `bg-isec` | ISEC Bridge | background | uncommon | 220 |  |
| `bg-fenway` | Fenway Lights | background | rare | 480 |  |
| `bg-huntington` | Huntington Ave at Night | background | epic | 850 | Limited 25 |

**`shared/src/data/storeCatalog.ts`**

```ts
import type { StoreItem } from "../store.types.ts";

export const STORE_CATALOG: StoreItem[] = [
  { itemId: "base-gray", name: "Classic Gray", description: "The starting look", layer: "base", rarity: "common", price: 0, free: true, art: "#9a9a9a" },
  { itemId: "base-snow", name: "Snow Husky", description: "Bright white fur", layer: "base", rarity: "common", price: 0, free: true, art: "#f4f4f4" },
  { itemId: "base-red", name: "Northeastern Red", description: "School colors", layer: "base", rarity: "common", price: 60, free: false, art: "#c8102e" },
  { itemId: "base-midnight", name: "Midnight Black", description: "For late-night games", layer: "base", rarity: "uncommon", price: 180, free: false, art: "#1c1c1c" },
  { itemId: "base-gold-paw", name: "Gold Paw Print", description: "Gold with a paw pattern", layer: "base", rarity: "rare", price: 400, free: false, art: "base-gold-paw.svg" },
  { itemId: "base-aurora", name: "Aurora", description: "Shifting northern lights", layer: "base", rarity: "epic", price: 750, free: false, tierRequired: "gold", art: "base-aurora.svg" },
  { itemId: "face-smile", name: "Smile", description: "The starting face", layer: "face", rarity: "common", price: 0, free: true, art: "face-smile.svg" },
  { itemId: "face-focused", name: "Focused", description: "Game face on", layer: "face", rarity: "common", price: 0, free: true, art: "face-focused.svg" },
  { itemId: "face-wink", name: "Wink", description: "You know something", layer: "face", rarity: "common", price: 50, free: false, art: "face-wink.svg" },
  { itemId: "face-shades", name: "Shades", description: "Too cool to lose", layer: "face", rarity: "uncommon", price: 150, free: false, art: "face-shades.svg" },
  { itemId: "face-finals", name: "Finals Week Stare", description: "Three exams, no sleep", layer: "face", rarity: "rare", price: 350, free: false, art: "face-finals.svg" },
  { itemId: "face-monocle", name: "Detective Monocle", description: "For solving cases", layer: "face", rarity: "epic", price: 700, free: false, art: "face-monocle.svg" },
  { itemId: "acc-none", name: "No Accessory", description: "Keep it simple", layer: "accessory", rarity: "common", price: 0, free: true, art: "none" },
  { itemId: "acc-cap", name: "Ball Cap", description: "A plain cap", layer: "accessory", rarity: "common", price: 0, free: true, art: "acc-cap.svg" },
  { itemId: "acc-lanyard", name: "Husky Card Lanyard", description: "Never locked out", layer: "accessory", rarity: "common", price: 75, free: false, art: "acc-lanyard.svg" },
  { itemId: "acc-headphones", name: "Snell Study Headphones", description: "Quiet floor approved", layer: "accessory", rarity: "uncommon", price: 200, free: false, art: "acc-headphones.svg" },
  { itemId: "acc-hardhat", name: "Co-op Hard Hat", description: "Back from co-op", layer: "accessory", rarity: "rare", price: 450, free: false, art: "acc-hardhat.svg" },
  { itemId: "acc-magnifier", name: "Magnifying Glass", description: "Only for top detectives", layer: "accessory", rarity: "legendary", price: 1400, free: false, tierRequired: "gold", stock: 10, art: "acc-magnifier.svg" },
  { itemId: "bg-plain", name: "Plain", description: "The starting background", layer: "background", rarity: "common", price: 0, free: true, art: "#e9e9e9" },
  { itemId: "bg-quad", name: "Centennial Common", description: "The quad on a sunny day", layer: "background", rarity: "common", price: 0, free: true, art: "bg-quad.svg" },
  { itemId: "bg-snell", name: "Snell Library", description: "Where the studying happens", layer: "background", rarity: "common", price: 80, free: false, art: "bg-snell.svg" },
  { itemId: "bg-isec", name: "ISEC Bridge", description: "The bridge over the tracks", layer: "background", rarity: "uncommon", price: 220, free: false, art: "bg-isec.svg" },
  { itemId: "bg-fenway", name: "Fenway Lights", description: "Game night down the street", layer: "background", rarity: "rare", price: 480, free: false, art: "bg-fenway.svg" },
  { itemId: "bg-huntington", name: "Huntington Ave at Night", description: "The E line after dark", layer: "background", rarity: "epic", price: 850, free: false, stock: 25, art: "bg-huntington.svg" },
];
```

---

*T09 · Story 2 · Medium · Research*

## All-or-nothing purchases and trades on Keyv

> **GO.** Use one wallet record per user and a lock for each user. A purchase, return, award, or equip is then a single write. A trade between two users uses a **pending-op record**: the trade saves both finished wallets first, then applies them, and if the server stops halfway, startup finishes the job. A reversal ledger entry is the last-resort fix if a wallet changed unexpectedly. No new database or library is needed.

### What the IP3 storage gives us

- `createRepo` in `server/src/keyv.ts` supports `get`, `set`, `getMany`, and `getAllKeys`, all on one key at a time. Writing one key is all-or-nothing, both in memory and in MongoDB (a single-document write).
- There are **no transactions**, no multi-key writes, and no compare-and-set.
- Node runs one request at a time but switches at every `await`. Two purchases for the same user can both read a balance of 100, both pass the check, and both spend it. This race exists today with no crash involved.

### Options considered

| Option | How it works | Verdict |
|---|---|---|
| One record for the whole economy | Every wallet lives in one key, so every change is one write | No. Every purchase rewrites every user's data, and all requests line up on one key. |
| Database transactions | Use MongoDB transactions under `@keyv/mongo` | No. Keyv doesn't expose them, and the in-memory store used in tests has none. |
| Version check before writing | Re-read the version just before `set` and give up if it changed | Not enough alone. Without compare-and-set, another request can still slip in between the check and the write. |
| **Wallet + lock + pending-op record** | One wallet per user; a per-user lock serializes changes; trades save a plan before writing | **Chosen.** Single-user changes are one write, and trades can always be finished or undone. |

### Sketch: lock each user

**`server/src/services/walletLock.ts (sketch)`**

```ts
const tails = new Map<string, Promise<void>>();

async function lock(userId: string): Promise<() => void> {
  const previous = tails.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.then(() => mine);
  tails.set(userId, tail);
  await previous;
  return () => {
    release();
    if (tails.get(userId) === tail) tails.delete(userId);
  };
}

/**
 * Runs `fn` while no other wallet change for these users can run. Locks are
 * taken in sorted order so two trades between the same users can't deadlock.
 */
export async function withWallets<T>(userIds: string[], fn: () => Promise<T>): Promise<T> {
  const releases: (() => void)[] = [];
  try {
    for (const id of [...new Set(userIds)].sort()) releases.push(await lock(id));
    return await fn();
  } finally {
    releases.reverse().forEach((release) => release());
  }
}
```

### Sketch: purchase (one user, one write)

**`server/src/services/store.service.ts (sketch)`**

```ts
export async function purchase(userId: string, itemId: string) {
  return withWallets([userId], async () => {
    const wallet = await WalletRepo.get(userId);
    const item = catalogItem(itemId);
    if (!item || item.free) throw new Error("That item isn't for sale");
    if (owns(wallet, itemId)) throw new Error("You already own this item");
    if (wallet.balance < item.price) {
      throw new Error(`You need ${item.price - wallet.balance} more XP to buy ${item.name}`);
    }

    const now = new Date().toISOString();
    const entryId = await LedgerRepo.add({
      userId, kind: "purchase", balanceDelta: -item.price, lifetimeDelta: 0,
      ref: itemId, itemId, createdAt: now,
    });

    // This write is the commit point. If the server stops before it, the
    // entry above is never referenced and the purchase never happened.
    await WalletRepo.set(userId, {
      ...wallet,
      balance: wallet.balance - item.price,
      inventory: [...wallet.inventory, { itemId, source: "store", acquiredAt: now, pricePaid: item.price }],
      ledger: [...wallet.ledger, entryId],
      version: wallet.version + 1,
    });
  });
}
```

Returns, equips, and XP awards follow the same shape. Limited stock (Desirable 2.12) adds a second key. Take the stock first, inside the same lock; if the wallet write then fails, one copy is lost but nothing is ever oversold.

### Sketch: accept a trade (two users)

**`server/src/services/trade.service.ts (sketch)`**

```ts
export async function acceptTrade(tradeId: string, userId: string) {
  const { from, to } = await TradeRepo.get(tradeId);
  await withWallets([from, to], async () => {
    const trade = await TradeRepo.get(tradeId); // re-read inside the lock
    if (trade.to !== userId) throw new Error("Only the recipient can accept");
    if (trade.status !== "pending") throw new Error("This offer is no longer open");
    if (new Date(trade.expiresAt) < new Date()) {
      await TradeRepo.set(tradeId, { ...trade, status: "expired" });
      throw new Error("This offer expired");
    }

    // COS 2.8: both users must still own the items and have the XP
    const [a, b] = await WalletRepo.getMany([from, to]);
    const problem = checkTrade(trade, a, b);
    if (problem) {
      await TradeRepo.set(tradeId, { ...trade, status: "failed", failureReason: problem });
      throw new Error(problem);
    }

    const entries = await writeTradeEntries(trade); // ledger rows, not yet referenced
    const newA = applyTrade(a, trade, "from", entries.from); // version + 1
    const newB = applyTrade(b, trade, "to", entries.to);

    // 1. Save the plan. From here on, the trade will finish even after a restart.
    await TradeRepo.set(tradeId, {
      ...trade,
      status: "committing",
      commit: {
        [from]: { fromVersion: a.version, wallet: newA },
        [to]: { fromVersion: b.version, wallet: newB },
      },
    });
    // 2. Apply it
    await WalletRepo.set(from, newA);
    await WalletRepo.set(to, newB);
    // 3. Mark it done
    await TradeRepo.set(tradeId, { ...trade, status: "accepted", resolvedAt: new Date().toISOString() });
  });

  // Other offers with these items would fail their own re-check anyway;
  // cancelling them now just tells users sooner.
  await cancelOffersContaining(tradeId);
}

/**
 * Runs once at server start, before taking requests. Finishes any trade that
 * was interrupted between step 1 and step 3.
 */
export async function finishInterruptedTrades() {
  for (const tradeId of await TradeRepo.getAllKeys()) {
    const trade = await TradeRepo.get(tradeId);
    if (trade.status !== "committing" || !trade.commit) continue;
    for (const [userId, { fromVersion, wallet }] of Object.entries(trade.commit)) {
      const current = await WalletRepo.get(userId);
      if (current.version === fromVersion) {
        await WalletRepo.set(userId, wallet); // this side wasn't applied yet
      } else if (current.version !== wallet.version) {
        // Should be impossible, since nothing else runs before recovery.
        // Last resort: write reversal entries for the side that was applied
        // and mark the trade failed.
      }
    }
    await TradeRepo.set(tradeId, { ...trade, status: "accepted", commit: undefined });
  }
}
```

### What this changes in the plan

| ID | Task | Size | Justification | Depends on |
|---|---|---|---|---|
| `T40a` | Trade offers: create with the 2.7/2.8 rejection rules, list, decline, cancel, and 24-hour expiry checked when an offer is read | Medium | Several routes, each with validation cases | T38 |
| `T40b` | Accept: lock both wallets, re-check, commit with the pending-op record, and finish interrupted trades at startup | Medium | The approach is proven in T09; the sketch above is most of the logic | T40a, T09 |
| `T40c` | Cancel other offers that include traded items; add a test hook that stops after the first wallet write, so T44 can simulate a crash | Small | One query and one hook | T40b |

T40 is no longer Large. T38 (purchase) and T39 (returns) stay Medium and use `withWallets` as is.

### Cases for T44 (Story 2 tests)

- Two purchases started at the same time with only enough XP for one: exactly one succeeds.
- Two offers that include the same item, accepted at the same time: one succeeds and the other fails with "no longer owns".
- A trade stopped after the first wallet write: after `finishInterruptedTrades()`, both sides are applied.
- After every test, each wallet's `balance` equals the sum of its ledger entries (COS 2.9).
- Awarding the same game twice pays once.

### Risk to raise with the TA

The lock lives in server memory, so it only works if the deployment runs **one server process**. If the course deployment runs more than one, we'd need a lock record in the database with a timeout. We'd like to add this to "Major unknowns".

---

## Decisions for the team to confirm

These came up while writing the types. Each one has a proposed answer already built into the spec above.

1. *COS 2.1:* **What counts as a bot game?** Proposed: any game with at least one bot seat pays half, and 7.5 rounds down to 7.
2. *COS 2.1 · T22:* **Who wins Nim and Guess?** The framework has no winner yet. Proposed: in Nim, the player who didn't take the last object (matching the rules shown in the client); in Guess, everyone tied for closest.
3. *COS 2.1:* **"Left early" only exists in Clue.** Nim and Guess have no way to leave a started game, so for them every player finishes.
4. *COS 2.8:* **What if a trade would give you an item you already own?** The COS doesn't say. Proposed: reject when the offer is made, and check again on accept.
5. *COS 2.7:* **Can an offer be one-sided?** Proposed: no. The sender gives items or XP, and the recipient side must have at least one item. That rules out gifts, and nobody can ask for XP.
6. *COS 3.12:* **"Win Without a Wrong Accusation" can't fail.** A wrong accusation eliminates you, so every Clue winner already has none. Proposed replacement: Quick Study, win within 8 of your own turns. Anya and Divya should update 3.12.
7. *Problem statement:* **The intro mentions Connect Four and Checkers.** GameNite has Nim and Guess (`shared/src/game.types.ts`), plus Clue from Story 3.

