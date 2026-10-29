# Email verification: decision note (T05)

Story 1, COS 1.1. Owner: Divya. Status: decision made; test email still to be
sent from a teammate's machine (see "Still to do").

## The constraint that shapes the choice

Many free hosting tiers block outgoing SMTP. For example, Render's free web
services have blocked outbound traffic on SMTP ports 25, 465, and 587 since
September 2025. We don't yet know which host the course deployment uses (T16
confirms this), so the safe choice is a provider that sends over its **HTTPS
API** (port 443), not over SMTP. That rules out Nodemailer with Gmail or any
other SMTP relay for the deployed version.

## Options compared

| Option                               | Free limit           | Works without our own domain?                                                                                                                                                    | Notes                                                            |
| ------------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Brevo** (HTTPS API)                | 300 emails/day       | Partly: Brevo supports verifying a single sender address, but new accounts may need Brevo to activate transactional sending, and some guides say that requires a verified domain | Most generous free tier; plain REST call, no SDK needed          |
| **Resend** (HTTPS API)               | 100/day, 3,000/month | No: without a verified domain it can only send to the account owner's own address                                                                                                | Simplest API; best choice if anyone on the team has a domain     |
| SMTP (Nodemailer + Gmail or similar) | Varies               | Yes                                                                                                                                                                              | Blocked on hosts that block SMTP ports; also needs app passwords |

## Decision

1. **Use Brevo's transactional email API** for the deployed app, called with a
   plain `fetch` from the server.
2. **If Brevo won't activate transactional sending without a domain**, switch
   to Resend with a cheap domain (one teammate buys it), since Resend's setup
   is the simplest once a domain exists.
3. **In development and tests, never send real email.** A console mailer logs
   the verification link instead, and a development-only "outbox" page lists
   recent links. This is also the fallback in our plan if the deployment can't
   send email at all.

All three sit behind one small interface, so switching providers changes one
file:

```ts
interface Mailer {
  sendVerificationEmail(to: string, verifyUrl: string): Promise<void>;
}
```

The server picks the implementation from an environment variable
(`MAILER=brevo | resend | console`). API keys (`BREVO_API_KEY` or
`RESEND_API_KEY`), the sender address (`MAIL_FROM`), and the site address
(`APP_URL`) live in `server/.env`, which is already git-ignored. Nothing about
email is ever sent to the client.

## Verification link design

**Sign-up.** The existing sign-up form only asks for a username and password,
so T19 adds an email field. New accounts start with `emailVerified: false`.
Seeded test users are created as verified so existing tests keep working.

**Creating a link.**

- The server makes a random token: 32 bytes from `crypto.randomBytes`, encoded
  as base64url.
- The link is `${APP_URL}/verify-email?token=<token>`.
- Only a SHA-256 hash of the token is stored, so a database leak doesn't
  expose working links.

**Stored record.** `VerificationTokenRecord`, keyed by the token hash:

| Field       | Meaning                                      |
| ----------- | -------------------------------------------- |
| `userId`    | Whose email this verifies                    |
| `email`     | The address the link was sent to             |
| `createdAt` | When the link was made                       |
| `expiresAt` | `createdAt` + 24 hours (COS 1.1)             |
| `usedAt`    | Set once the link is used; absent until then |

The user record also stores the hash of their latest token. That's how a
resend cancels older links: only the latest token counts.

**Verifying.** The server hashes the token from the link, looks it up, and
checks four things: the record exists, it hasn't been used, it hasn't expired,
and it's the user's latest token. If all pass, it sets `emailVerified: true`
and records `usedAt`. A link works only once.

| Result                     | Message shown                                    |
| -------------------------- | ------------------------------------------------ |
| Success                    | "Your email is verified."                        |
| Expired                    | "This link has expired. Request a new one."      |
| Used, replaced, or unknown | "This link is invalid or has already been used." |

**Resending.** A logged-in, unverified user can request a new link. Each
request cancels the previous link. Resends are limited to one per minute and
five per day, so the free daily email limit can't be used up by one person.

**Blocking unverified users.** One shared check runs before sending friend
requests, sending messages, and creating private games (COS 1.1). It returns
the error "Verify your email to use this feature," and the client shows the
verify prompt.

## Testing plan

- **Unit tests** use the console mailer and read the link from it. They check
  success, reuse, expiry (using Vitest fake timers to move 24 hours ahead),
  replacement by a resend, and the resend limits.
- **The Story 1 Playwright test** reads the link from the development outbox
  page instead of a real inbox.

## Still to do

- [ ] Create the team Brevo account and verify the sender address.
- [ ] Send one test email with a `curl` call from a laptop, then once more
      from the deployed server after T16. Write down whether Brevo required a
      domain.
- [ ] Ask the TA whether the course recommends an email service (major unknown
      1).
