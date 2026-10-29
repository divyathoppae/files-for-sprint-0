import { z } from "zod";
import { type SafeUserInfo } from "./user.types.ts";
import { type MessageInfo } from "./message.types.ts";

/**
 * Maximum length of a private message, in characters (COS 1.6).
 * Clue chat (COS 3.8) uses the same limit.
 */
export const DIRECT_MESSAGE_MAX_LENGTH = 1000;

/** Default and maximum number of messages returned in one history page */
export const CONVERSATION_PAGE_SIZE = 50;

/**
 * Error messages returned by the private messaging API, either as a REST
 * `{ error: <message> }` response or in a `dmError` socket event
 */
export const CONVERSATION_ERRORS = {
  userNotFound: "User not found",
  notFriends: "You can only message users on your friends list",
  conversationNotFound: "Conversation not found",
  emptyMessage: "Message can't be empty",
  messageTooLong: `Message must be ${DIRECT_MESSAGE_MAX_LENGTH} characters or fewer`,
} as const;

/**
 * Summary of a private conversation, shown in the Messages inbox
 * - `conversationId`: database key
 * - `otherUser`: the other participant (from the viewer's point of view)
 * - `lastMessage`: the most recent message, or null if none have been sent
 * - `unreadCount`: messages from the other user the viewer hasn't read yet
 */
export interface ConversationSummary {
  conversationId: string;
  otherUser: SafeUserInfo;
  lastMessage: MessageInfo | null;
  unreadCount: number;
}

/**
 * A private conversation as exposed to the client
 * - `conversationId`: database key
 * - `otherUser`: the other participant (from the viewer's point of view)
 * - `canSend`: false if the two users are no longer friends; the history is
 *   still visible, but new messages are rejected (COS 1.4)
 * - `messages`: the most recent page of messages, oldest first
 * - `hasMore`: true if older messages exist beyond this page
 * - `createdAt`: when the conversation was first opened
 */
export interface ConversationInfo {
  conversationId: string;
  otherUser: SafeUserInfo;
  canSend: boolean;
  messages: MessageInfo[];
  hasMore: boolean;
  createdAt: Date;
}

/**
 * One page of older messages from a conversation
 * - `messages`: messages oldest first
 * - `hasMore`: true if even older messages exist
 */
export interface ConversationHistoryPage {
  messages: MessageInfo[];
  hasMore: boolean;
}

/*** TYPES USED IN THE CONVERSATION API ***/

/**
 * Valid private message text: not empty or whitespace-only, and at most
 * DIRECT_MESSAGE_MAX_LENGTH characters (COS 1.6). The text is stored as sent;
 * it is not trimmed.
 */
export const zDirectMessageText = z
  .string()
  .max(DIRECT_MESSAGE_MAX_LENGTH, CONVERSATION_ERRORS.messageTooLong)
  .refine((text) => text.trim().length > 0, CONVERSATION_ERRORS.emptyMessage);

/**
 * Payload for opening (or creating) a conversation with a friend: the
 * friend's username
 */
export type OpenConversationRequest = z.infer<typeof zOpenConversationRequest>;
export const zOpenConversationRequest = z.string().min(1);

/**
 * Payload for loading older messages
 * - `conversationId`: which conversation
 * - `before`: load messages older than this message id; omit for the newest page
 * - `limit`: page size, 1 to CONVERSATION_PAGE_SIZE
 */
export type ConversationHistoryRequest = z.infer<typeof zConversationHistoryRequest>;
export const zConversationHistoryRequest = z.object({
  conversationId: z.string(),
  before: z.string().optional(),
  limit: z.number().int().min(1).max(CONVERSATION_PAGE_SIZE).optional(),
});

/**
 * Payload for sending a private message over the socket
 */
export type SendDirectMessagePayload = z.infer<typeof zSendDirectMessagePayload>;
export const zSendDirectMessagePayload = z.object({
  conversationId: z.string(),
  text: zDirectMessageText,
});

/**
 * Sent to both participants when a new private message is saved
 */
export interface DirectMessageNewPayload {
  conversationId: string;
  message: MessageInfo;
}

/**
 * Sent to every open tab of a user when their unread count for a
 * conversation changes, so counts stay in sync across tabs
 */
export interface DirectMessageReadPayload {
  conversationId: string;
  unreadCount: number;
}

/**
 * Sent only to the socket that made a request the server rejected, so the
 * client can show the error (existing socket handlers only log errors)
 */
export interface DirectMessageErrorPayload {
  conversationId?: string;
  error: string;
}
