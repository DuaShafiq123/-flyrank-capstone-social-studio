# Build log — AI usage

Honesty is graded, perfection is not. Every entry: what AI did, where it was wrong, what I changed.

## Entry 1 — initial scaffold
- **AI used:** Claude (Anthropic) generated the first full version of the codebase, tests and docs from the capstone brief.
- **What I checked:** I ran `npm test` (26 passing) and walked through every probe with curl / Postman.
- **Where AI was wrong / what I changed:** _fill this in as you review — e.g. anything you didn't understand, rewrote, or found broken._

## Entry 2 — Real publish target
- Tried Telegram first. web.telegram.org and api.telegram.org timed out on my network (Telegram is blocked/throttled in Pakistan).
- Switched to Discord: created my own server + webhook, set DISCORD_WEBHOOK_URL and DISCORD_GUILD_ID, and changed ADAPTERS to telegram=discord. No code changed.
- Also hit an install error: better-sqlite3 11.x had no prebuilt binary for Node 24 on Windows. Upgrading to 12.11.1 fixed it.

## Things I can now explain line by line
- [ ] Why the `sending` row is written BEFORE the network call
- [ ] Why Telegram returns `unknown` from `reconcile` and what `needs_attention` means
- [ ] How the lease lets a second worker take over from a dead one
- [ ] Why `services/` never imports an adapter
