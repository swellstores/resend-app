# Resend Integration App

A Swell integration that sends your store's transactional emails through your own
[Resend](https://resend.com) account, **reusing the notification templates you already designed**
in Settings → Notifications.

## How it works

The app subscribes to store business events (order / shipment / payment / account / cart /
subscription) and, when one fires, sends the matching email itself. Instead of inventing new
templates it fetches the store's live notification template and renders it, so the emails match
what the merchant already designed — with no separate template to maintain.

```
a subscribed event fires (order / shipment / payment / account / cart / subscription)
   → match it to notification template(s) via the registry + custom mappings
   → fetch the matching notification config from /:notifications (live)
   → load the record with the config's expansions
   → render the Liquid template + labels with liquidjs
   → send the HTML via the Resend API
```

## Coverage

Mappings are data-driven in `functions/lib/registry.ts`. Each standard Swell notification that
maps cleanly to a single model **event** is covered, gated by its own settings toggle:

| Event | Template | Toggle | Default |
| --- | --- | --- | --- |
| `order.submitted` | `receipt.v2` | `send_order_receipt` | on |
| `order.canceled` | `canceled.v2` (orders) | `send_order_canceled` | off |
| `payment.refund.succeeded` | `refund.v2` | `send_order_refund` | off |
| `shipment.created` | `shipped.v2` | `send_order_shipped` | on |
| `shipment.updated` | `shipped-update.v2` | `send_order_shipped_update` | off |
| `account.created` | `welcome.v2` | `send_account_welcome` | off |
| `cart.abandoned` | `recovery.v2` | `send_cart_recovery` | off |
| `subscription.created` (active only) | `new.v2` | `send_subscription_new` | on |
| `subscription.canceled` | `canceled.v2` (subs) | `send_subscription_canceled` | off |
| `subscription.paused` | `paused.v2` | `send_subscription_paused` | off |
| `subscription.resumed` | `resumed.v2` | `send_subscription_resumed` | off |
| `subscription.invoiced` | `invoice.v2` (subs) | `send_subscription_invoice` | off |

Shipment/refund emails are modeled on the order; those events carry `order_id` and the record is
loaded from `orders`.

Each built-in mapping also carries the native send rules its event alone doesn't express, and the
data native hands the template through `$notify.data` (both read from schema-api-server's
`api/com/notifications/**.json` and the features that raise `$notify`):

| Template | Extra rule / data |
| --- | --- |
| `receipt.v2` | skipped for drafts and orders with `notify: false` |
| `refund.v2` | `refunds` — every refund on the order (`amount`, `reason`, `reason_message`) |
| `shipped.v2`, `shipped-update.v2` | `shipment` — the shipment that raised the event, items expanded; skipped for draft shipments |
| `shipped-update.v2` | sent only when the update set a tracking number (`tracking_code` in the event's changed `data`) |
| `recovery.v2` | skipped for carts with no `account_id` or no items |
| `welcome.v2` | skipped for guest accounts (queried with `password: {$exists: true}`) |
| `new.v2` | sent on `subscription.created` when the subscription is active — native's `new: true` never re-sends on reactivation |
| `paused.v2`, `resumed.v2` | skipped when the subscription is canceled |
| `invoice.v2` | skipped when `grand_total` is 0; `invoice` — the subscription's latest invoice |

Template names are **not unique across models** (e.g. `canceled.v2`,
`invoice.v2`), so configs are always looked up by **name + model**.

### Not auto-mapped

Some standard notifications have no corresponding model event — they fire from manual actions,
record conditions, schedules, or go to admins/another app: password reset, customer invite,
draft-order invoice, gift-card fulfillment, the dunning series (payment-failed / unpaid /
payment-finally-*), payment-expiring, the abandoned-cart **follow-up** series (recovery-1/2, which
rely on delays), and admin/print/app-owned templates. Leave these on Swell's native delivery, or
add a custom mapping if a suitable event exists.

## Custom notifications

Add rows under **Custom notifications** (the `custom_mappings` collection setting) to route your
own templates through Resend without code changes:

- **Trigger event** — one of the events the app subscribes to (the select lists them)
- **Notification name** — the template's `name` (e.g. `invoice.v2`)
- **Record ID field** — path on the event payload to the record id (default `id`)
- **Enabled**

Custom rows assume the template lives on the **same model** as the event (cross-model routing —
like shipment→order — is handled by the built-in registry). To trigger on an event not in the
list, add it to the relevant handler's `model.events` in `functions/*-emails.ts`.

## Templates and rendering

- Templates are fetched **live** at send time from `/:notifications` (`content.html` on the CDN),
  so they always match the dashboard — no drift, and merchant label edits are respected.
- Rendering uses [`liquidjs`](https://liquidjs.com) (the browser ESM build — the Node build
  references `require`, which the function isolate doesn't provide).
- Two Swell-specific Liquid filters are reimplemented in `functions/lib/render.ts`:
  - `currency` — formats a number as money via `Intl.NumberFormat` using the record's `currency`
  - `img_url` — resolves an image-bearing value to a CDN URL and appends transform params
- The render context is `{ ...order, store, content }`, where `store` merges `/settings/store`
  with notification branding (`/settings/notifications`: `logo`, `logo_width`, `footer`, and
  `color` from `store_color`, defaulting to native's `#614ed0`) and `content` holds the rendered
  notification labels (`config.fields`).
- `store.name` and `store.support_email` live on the store (client) record, not in
  `/settings/store`, so the app reads `/:clients/:self` for them. If that can't be read, `name`
  falls back to the app's `from_name` and `support_email` to `reply_to`, so a subject like
  `Welcome to {{ store.name }}` never renders blank.

## Sender, Reply-To and BCC

Each notification's own **From email** and **BCC emails** (Settings → Notifications → the
email; fields `from` (or the deprecated `replyto`) and `bcc` on the `:notifications` record) are
honoured, as are `cc` addresses set through the API:

- A notification **From email on the same domain** as the app's `from_email` becomes the sender
  (with `from_name` as its display name). Resend only sends from verified domains, and that's the
  domain the merchant verified.
- A notification **From email on any other domain** becomes the **Reply-To** instead, and the
  app's `from_email` stays the sender. That's what Swell's default delivery does with it too:
  native sends from its own address and puts the notification's From in Reply-To.
- Otherwise the app's `from_email` and `reply_to` settings apply.
- `bcc` / `cc` (comma separated) are sent as Resend `bcc` / `cc`.

## Code layout

| File | Responsibility |
| --- | --- |
| `functions/{order,shipment,payment,account,cart,subscription}-emails.ts` | Thin handlers; each declares its events and delegates to `handleEvent` |
| `functions/lib/dispatch.ts` | `handleEvent` + `dispatch`: match event → mappings (registry + custom), gate, route |
| `functions/lib/registry.ts` | Default event→template mappings and event→model derivation |
| `functions/lib/notify.ts` | Per-mapping send: config fetch (name + model) → record fetch → render → send |
| `functions/lib/render.ts` | liquidjs engine, custom filters, context assembly (`store`) |
| `functions/lib/resend.ts` | Resend API client, sender / Reply-To resolution |
| `settings/resend.json` | Dashboard settings schema |

Adding a model means adding one thin `*-emails.ts` handler and registry rows — the dispatch,
render, and send pipeline is shared.

## Settings (Apps → Resend)

`api_key` (required), `from_email` (required), `from_name`, `reply_to`, one toggle per mapping in
the table above (`send_*`), and the **Custom notifications** collection (`custom_mappings`).

## Avoiding duplicate emails

A built-in mapping only sends while the matching native notification is **disabled**. Swell
skips a notification whose `enabled` is `false` and sends it otherwise (`null` is the default,
which is on; schema-api-server `api/admin/features/notifications/index.js`), so the app checks
the same field at send time and logs `skipped: Swell's native "<label>" email is still on`
instead of sending a second copy. Custom mappings aren't checked — they name the merchant's own
templates.

For most emails, switching over is one step: turn the native one off in **Settings →
Notifications**. Two kinds of email work differently:

- **Abandoned cart recovery.** Native sends `recovery.v2` only while the dashboard's
  **Abandoned cart** switch is on, and that switch is `abandoned_cart.enabled` in
  `/settings/notifications`, not the notification's own `enabled` (schema-api-server
  `api/com/features/carts/abandoned.js`). The app treats native as on while that switch is on
  and the notification isn't disabled, so the merchant turns off **Abandoned cart**. The
  follow-up series hangs off the same switch, so it stops too.
- **Shipping confirmation and Shipping update.** The dashboard has no switch for
  `orders.shipped` or `orders.shipped-update` (swell-admin hardcodes `enabled: true` for them),
  but native still honours `enabled: false` on the notification. Until it's set through the API,
  the app skips both and says so in the log:

  ```bash
  # find the notification's id, then turn native off
  GET /:notifications?where[model]=orders&where[name]=shipped.v2
  PUT /:notifications/{id}   {"enabled": false}
  ```

  The dashboard keeps the value: saving Settings → Notifications writes back the `enabled`
  value it read.

Each send carries a Resend `Idempotency-Key` derived from the event, so a redelivered event returns
the original email instead of sending another.

## Limitations

These are inherent to the approach, not bugs — they're documented here so anyone building on this
version knows exactly where the edges are.

- **The admin's per-shipment "notify customer" checkbox isn't visible to apps.** Native passes it
  as `$notify` on the write, which never reaches the event payload. Once native `shipped.v2` is
  off, the app sends a shipping confirmation for every confirmed (non-draft) shipment.
- **Shipping update follows the tracking number, not the checkbox.** Native sends
  `shipped-update.v2` only when the admin ticks "Send email confirmation to customer" while
  editing a fulfillment (unticked by default). The app can't see that, so it sends when an update
  sets a tracking number, which is what the dashboard says the email is for.
- **Turning native shipping emails off takes an API call.** See *Avoiding duplicate emails*.
- **Welcome covers account creation only.** Native also welcomes a guest who later sets a
  password; the app subscribes to `account.created`, not updates.
- **Only event-backed notifications are covered.** Notifications triggered by manual actions, record
  conditions, schedules, or delays have no business event to subscribe to — password reset, customer
  invite, draft-order invoice, the dunning series, payment-expiring, and the abandoned-cart
  *follow-up* series (recovery-1/2). These stay on Swell's native delivery. See *Not auto-mapped*.
- **Some subscribed events have no default mapping.** The order and subscription handlers subscribe
  to a few extra events (`order.paid`, `order.delivered`, `subscription.activated`,
  `subscription.paid`, `subscription.trial_will_end`, `subscription.trial_ended`) so they can be
  targeted via **Custom notifications** without a code change. By default they fire and no-op.
- **De-duplication lasts 24 hours.** That is how long Resend keeps an idempotency key. Swell
  retries a failed event for up to four days, so a retry after a day could send again.
- **Custom mappings are same-model only.** A custom row assumes the template lives on the same model
  as its event. Cross-model routing (like shipment→order) requires a registry entry in code.
- **Inline rendering; Swell does the retrying.** Emails render and send inside the event handler.
  A network error, 429 or 5xx is rethrown so Swell redelivers the event; any other Resend 4xx (bad
  key, unverified domain) is thrown with `retry: false`, so it's recorded as failed and not retried.
- **Liquid parity is partial.** Only the `currency` and `img_url` Swell filters are reimplemented
  (`functions/lib/render.ts`). Templates relying on other Swell-specific filters may not render
  identically — add the filter there if you hit one.

## Local development

Credentials are **never** stored in the repo. The Resend API key and sender address live in the
store's app settings (**Apps → Resend**); any `.env*` files are git-ignored. `.swellrc` is
committed on purpose: it pins the repo to the official app record (see `.gitignore`).

```bash
npm install
npm run typecheck
swell app push          # pushes to the store's test environment
```

## License & contributing

Open source — fork it, extend the registry, add filters, or wire up new custom mappings. The
dispatch → render → send pipeline is shared, so most additions are a registry row plus (optionally)
a thin `*-emails.ts` handler.

Built with the [**swell-apps** plugin](https://github.com/swellstores) and
[**Claude Code**](https://claude.com/claude-code).
