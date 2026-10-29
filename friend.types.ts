import { z } from "zod";
import { type SafeUserInfo } from "./user.types.ts";

/**
 * Error messages returned by the friends API. The server sends these as
 * `{ error: <message> }`, and tests and the client can compare against them
 * directly instead of repeating the strings.
 */
export const FRIEND_ERRORS = {
  userNotFound: "User not found",
  selfRequest: "You can't send a friend request to yourself",
  alreadyFriends: "You're already friends with this user",
  pendingRequestExists: "You already have a pending request with this user",
  noIncomingRequest: "No pending friend request from this user",
  noOutgoingRequest: "No pending friend request to this user",
  notFriends: "This user isn't on your friends list",
} as const;

/**
 * How the viewing user is related to another user. Used in search results so
 * the client can show the right button (Send Request, Accept, Pending, etc.).
 * - `self`: the other user is the viewer
 * - `friend`: the two users are friends
 * - `incoming`: the other user has sent the viewer a pending request
 * - `outgoing`: the viewer has sent the other user a pending request
 * - `none`: no relationship
 */
export type FriendRelationship = "self" | "friend" | "incoming" | "outgoing" | "none";

/**
 * A friend as exposed to the client
 * - `user`: the friend
 * - `friendsSince`: when the friend request was accepted
 */
export interface FriendInfo {
  user: SafeUserInfo;
  friendsSince: Date;
}

/**
 * A pending friend request as exposed to the client. Requests are identified
 * by the usernames involved rather than by an id, matching how the rest of
 * the API refers to users.
 * - `from`: the user who sent the request
 * - `to`: the user who received the request
 * - `createdAt`: when the request was sent
 */
export interface FriendRequestInfo {
  from: SafeUserInfo;
  to: SafeUserInfo;
  createdAt: Date;
}

/**
 * Everything the Friends page needs in one response
 * - `friends`: the viewer's friends, sorted by display name
 * - `incoming`: pending requests sent to the viewer, newest first
 * - `outgoing`: pending requests the viewer has sent, newest first
 */
export interface FriendsOverview {
  friends: FriendInfo[];
  incoming: FriendRequestInfo[];
  outgoing: FriendRequestInfo[];
}

/**
 * A single user search result
 * - `user`: the matching user
 * - `relationship`: how the viewer is related to that user
 */
export interface UserSearchResult {
  user: SafeUserInfo;
  relationship: FriendRelationship;
}

/*** TYPES USED IN THE FRIENDS API ***/

/** Maximum number of results returned by a user search */
export const USER_SEARCH_LIMIT = 20;

/**
 * Payload for searching users by username: a non-empty search string, matched
 * case-insensitively against the start of usernames
 */
export type UserSearchRequest = z.infer<typeof zUserSearchRequest>;
export const zUserSearchRequest = z.string().trim().min(1).max(100);

/**
 * Payload for every friend-request and friend action: the username of the
 * other user involved (the recipient for send/cancel/remove, the sender for
 * accept/decline)
 */
export type FriendTargetRequest = z.infer<typeof zFriendTargetRequest>;
export const zFriendTargetRequest = z.string().min(1);

/**
 * Payload for requests that need authentication but no other data. Clients
 * send `{ auth, payload: null }`.
 */
export const zEmptyPayload = z.null();
