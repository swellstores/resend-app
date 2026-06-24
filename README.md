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
| `subscription.activated` | `new.v2` | `send_subscription_new` | on |
| `subscription.canceled` | `canceled.v2` (subs) | `send_subscription_canceled` | off |
| `subscription.paused` | `paused.v2` | `send_subscription_paused` | off |
| `subscription.resumed` | `resumed.v2` | `send_subscription_resumed` | off |
| `subscription.invoiced` | `invoice.v2` (subs) | `send_subscription_invoice` | off |

Shipment/refund emails are modeled on the order; those events carry `order_id` and the record is
loaded from `orders`. Template names are **not unique across models** (e.g. `canceled.v2`,
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
  with notification branding (`/settings/notifications`) and `content` holds the rendered
  notification labels (`config.fields`).

## Code layout

| File | Responsibility |
| --- | --- |
| `functions/{order,shipment,payment,account,cart,subscription}-emails.ts` | Thin handlers; each declares its events and delegates to `handleEvent` |
| `functions/lib/dispatch.ts` | `handleEvent` + `dispatch`: match event → mappings (registry + custom), gate, route |
| `functions/lib/registry.ts` | Default event→template mappings and event→model derivation |
| `functions/lib/notify.ts` | Per-mapping send: config fetch (name + model) → record fetch → render → send |
| `functions/lib/render.ts` | liquidjs engine, custom filters, context assembly |
| `functions/lib/resend.ts` | Resend API client |
| `settings/resend.json` | Dashboard settings schema |

Adding a model means adding one thin `*-emails.ts` handler and registry rows — the dispatch,
render, and send pipeline is shared.

## Settings (Integrations → Resend)

`api_key` (required), `from_email` (required), `from_name`, `reply_to`, one toggle per mapping in
the table above (`send_*`), and the **Custom notifications** collection (`custom_mappings`).

## Avoiding duplicate emails

This app sends **in addition to** Swell's native notifications. For each event you enable here,
disable the corresponding notification in **Settings → Notifications** (or turn off Swell's default
email delivery) so customers don't receive two copies.

## Limitations

These are inherent to the approach, not bugs — they're documented here so anyone building on this
version knows exactly where the edges are.

- **Runs alongside native delivery.** The app sends its own emails in addition to Swell's; it
  doesn't intercept Swell's own notifications, so you must disable the matching native ones
  yourself (see above) to avoid duplicate emails.
- **Only event-backed notifications are covered.** Notifications triggered by manual actions, record
  conditions, schedules, or delays have no business event to subscribe to — password reset, customer
  invite, draft-order invoice, the dunning series, payment-expiring, and the abandoned-cart
  *follow-up* series (recovery-1/2). These stay on Swell's native delivery. See *Not auto-mapped*.
- **Some subscribed events have no default mapping.** The order and subscription handlers subscribe
  to a few extra events (`order.paid`, `order.delivered`, `subscription.created`,
  `subscription.paid`, `subscription.trial_will_end`, `subscription.trial_ended`) so they can be
  targeted via **Custom notifications** without a code change. By default they fire and no-op.
- **No de-duplication.** If Swell delivers the same event more than once, the customer receives more
  than one email — there's no idempotency key or send log. In practice events fire once per record
  transition, but a retry will resend.
- **Custom mappings are same-model only.** A custom row assumes the template lives on the same model
  as its event. Cross-model routing (like shipment→order) requires a registry entry in code.
- **Inline rendering, no queue/retry.** Emails render and send synchronously inside the event
  handler. A Resend outage means that send is lost (the error is logged, not retried).
- **Liquid parity is partial.** Only the `currency` and `img_url` Swell filters are reimplemented
  (`functions/lib/render.ts`). Templates relying on other Swell-specific filters may not render
  identically — add the filter there if you hit one.

## Local development

Credentials are **never** stored in the repo. The Resend API key and sender address live in the
store's app settings (**Integrations → Resend**); `.swellrc` (the local store binding) and any
`.env*` files are git-ignored. After cloning, link the app to your own store with the Swell CLI.

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
