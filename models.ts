import type { GameKey } from "@gamenite/shared";

/**
 * Record identifiers used to look up records in a database. This type
 * abbreviation is intended to suggest that the key should be a randomly
 * generated unique ID.
 */
export type RecordId = string;

/**
 * Actual JavaScript Date objects can't stored in a database that only accepts
 * JSON objects; this type indicates that the string should be the result of
 * taking a Date object and turning it to a string with the Date.toISOString()
 * method.
 */
export type DateISO = string;

/**
 * Represents a user's authorization record in the database.
 * - `userId`: the user ID of the corresponding User model
 * - `password`: the password for this user
 */
export interface AuthRecord {
  userId: RecordId; // References User models
  password: string;
}

/**
 * Represents a chat document in the database.
 * - `messages`: the ordered list of messages in the chat
 * - `createdAt`: when the chat was created
 */
export interface ChatRecord {
  messages: RecordId[]; // References Message models
  createdAt: DateISO;
}

/**
 * Represents a comment in the database.
 * - `text`: comment contents
 * - `createdBy`: user id of the commenter
 * - `createdAt`: when the comment was made
 * - `editedAt`: when the comment was last modified
 */
export interface CommentRecord {
  text: string;
  createdBy: RecordId; // References User records
  createdAt: DateISO;
  editedAt?: DateISO;
}

/**
 * Represents a private conversation between two friends in the database.
 * Messages reuse the existing Message model.
 * - `participants`: the two user ids in the conversation, sorted
 * - `messages`: the ordered list of messages, oldest first
 * - `createdAt`: when the conversation was first opened
 * - `lastMessageAt`: when the newest message was sent, absent if none have
 *   been sent (used to sort the inbox without loading every message)
 * - `lastReadAt`: for each participant, when they last read the conversation
 *   (used for unread counts, COS 1.12)
 */
export interface ConversationRecord {
  participants: [RecordId, RecordId]; // References User records
  messages: RecordId[]; // References Message records
  createdAt: DateISO;
  lastMessageAt?: DateISO;
  lastReadAt: { [userId: RecordId]: DateISO };
}

/**
 * Represents a friend request in the database. Requests are never deleted;
 * once answered, their status changes and they are removed from both users'
 * Social records.
 * - `from`: user id of the sender
 * - `to`: user id of the recipient
 * - `status`: whether the request is still pending or how it was resolved
 * - `createdAt`: when the request was sent
 * - `resolvedAt`: when the request was accepted, declined, or cancelled
 */
export interface FriendRequestRecord {
  from: RecordId; // References User records
  to: RecordId; // References User records
  status: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: DateISO;
  resolvedAt?: DateISO;
}

/**
 * Represents a game document in the database.
 * - `type`: picks which game this is
 * - `state`: absent if the game hasn't started, or the id for the game's state
 * - `chat`: id for the game's chat
 * - `players`: active players for the game
 * - `createdAt`: when the game was created
 * - `createdBy`: user id of the person who created the game
 */
export interface GameRecord {
  type: GameKey;
  state?: unknown;
  done: boolean;
  chat: RecordId; // References Chat records
  players: RecordId[]; // References User records
  createdAt: DateISO;
  createdBy: RecordId; // References User records
}

/**
 * Represents a message in the database.
 * - `text`: message contents
 * - `createdBy`: user id of message sender
 * - `createdAt`: when the message was sent
 */
export interface MessageRecord {
  text: string;
  createdBy: RecordId; // References User records
  createdAt: DateISO;
}

/**
 * Represents one user's social connections in the database, keyed by that
 * user's id. The key-value store can't query by field, so this record is the
 * index used to look up a user's friends, requests, and conversations. A user
 * with no Social record has no friends, requests, or conversations.
 *
 * Friendships are stored on both users' records (rather than as a separate
 * Friendship record) so "are A and B friends?" is a single lookup, and
 * removing a friend only means deleting a key from both records.
 *
 * - `friends`: friend's user id -> when the two became friends
 * - `incomingRequests`: ids of pending friend requests sent to this user
 * - `outgoingRequests`: ids of pending friend requests sent by this user
 * - `conversations`: other user's id -> id of the conversation with them
 */
export interface SocialRecord {
  friends: { [userId: RecordId]: DateISO };
  incomingRequests: RecordId[]; // References FriendRequest records
  outgoingRequests: RecordId[]; // References FriendRequest records
  conversations: { [userId: RecordId]: RecordId }; // References Conversation records
}

/**
 * Represents a forum post as it's stored in the database.
 * - `title`: post title
 * - `text`: post contents
 * - `createdAt`: when the thread was posted
 * - `createdBy`: user id of OP
 * - `comments`: replies to the post
 */
export interface ThreadRecord {
  title: string;
  text: string;
  createdAt: DateISO;
  createdBy: RecordId; // References User records
  comments: RecordId[]; // References Comment records
}

/**
 * Represents a user document in the database.
 * - `username`: Text username (a non-random key for looking up Auth records)
 * - `display`: A display name
 * - `createdAt`: when this user registered.
 * - `profileImageUrl`: URL of an externally-hosted profile image, absent if
 *   the user hasn't set one (only the URL is stored, never image data)
 */
export interface UserRecord {
  username: string; // References Auth records
  display: string;
  createdAt: DateISO;
  profileImageUrl?: string;
}
