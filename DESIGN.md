# Design — Social Media Studio

## Problem
A marketing team writes one blog post and wants it on several platforms, each with its own rules. Today this is copy-paste: posts break platform limits, unreviewed text goes out, and a flaky network causes double posts. We need a backend that turns one post into reviewed, rule-compliant variants and publishes each approved variant **exactly once** at its scheduled time.

## Constraint profiles
| Platform | Length | Hashtags | Tone |
|---|---|---|---|
| x | 40–280, URL = 23 chars | 1–2 | punchy: ≤1 "!", ≤2 emoji, ≤1 ALL-CAPS, banned: "click here", "buy now" |
| linkedin | 300–3000 | 3–5 | professional: ≤1 "!", 0 emoji, 0 ALL-CAPS, banned slang |
| telegram | 80–1024 | 0–3 | friendly: ≤3 "!", ≤4 emoji, banned jargon |
Every platform must link to the source post when it has a URL.

## SocialPublisher interface
```js
publish({ text, idempotencyKey, platform, signal }) -> { externalId, url }   // throws PublishError{ambiguous}
reconcile(idempotencyKey) -> { status: 'found'|'not_found'|'unknown', ... }
```
`ambiguous` = "the platform may have accepted it" (timeout, 5xx). Configuration (`ADAPTERS=platform=adapter`) picks the adapter; only `adapters/registry.js` knows concrete classes.

## Data model
- **posts** (id, source_type, source_url, title, body_markdown, tags, content_hash UNIQUE)
- **variants** (id, post_id, platform, text, status draft|approved|rejected|published, origin)
- **slots** (id, variant_id, scheduled_at, next_attempt_at, status scheduled|claimed|published|failed|needs_attention|cancelled, idempotency_key UNIQUE, attempts, lease_owner, lease_until) — the durable job store; partial unique index = one live slot per variant
- **publications** (idempotency_key UNIQUE, adapter, status sending|succeeded|failed, external_id, external_url) — at most one post per key
- **publish_attempts** — append-only history
- **mock_posts** — what mock adapters "posted" (no dedupe on purpose)

## Publish algorithm
1. Claim slot atomically with a lease (expired leases can be taken over).
2. Safety gate: variant must be approved.
3. If publication `succeeded` → skip (duplicate). If `sending` → `reconcile`: found → record; not_found → send; unknown → `needs_attention`.
4. Write `sending` row, call adapter, then mark `succeeded` in one transaction.
5. Definite failure → retry with backoff up to max attempts; ambiguous → retry goes through reconcile.

## API surface
`POST /posts`, `POST /posts/:id/variants`, `POST /posts/:id/variants/manual`, `PATCH /variants/:id`, `POST /variants/:id/approve|reject|schedule`, `GET /slots`, `POST /slots/:id/publish-now|resolve`, `GET /history`.

## Non-goal
No real Instagram, X or LinkedIn accounts, no image generation, no analytics or engagement tracking. Mocks plus one real free platform prove the architecture.
