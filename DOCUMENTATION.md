# Resend

Send your store's transactional emails through your own Resend account, using
the notification templates you already designed in Swell.

---

## What this app does

Swell already sends transactional email — order confirmations, shipping
notices, subscription notices — and you already design those templates in
**Settings → Notifications**. This app sends those *same templates* through
your own [Resend](https://resend.com) account instead of relying solely on
Swell's delivery.

It does this without a second set of templates. When an event fires, the app
fetches your live notification template from the store, renders it with that
record's data, and posts it to the Resend API. Because the template is read at
send time, any edit you make in the dashboard appears in the next email
automatically — there is nothing to re-sync or re-publish.

**Why merchants use it:** emails go out from a domain you own and verify, and
every send lands in your Resend dashboard with its own delivery, bounce, and
open data. You get Resend's deliverability tooling and logs without rebuilding
your templates.

> **Important:** a notification only sends through Resend once Swell's own
> version of it is off. Until then, Swell keeps sending it and the app stays
> out of the way. Most are switched off in **Settings → Notifications**;
> abandoned cart and the two shipping emails work differently. See
> [Avoiding duplicate emails](#avoiding-duplicate-emails).

---

## Before you start

You need a Resend account and two things from it:

1. **A verified domain.** Resend only sends from domains you have verified.
   Add yours under **Domains** in Resend and complete the DNS records before
   configuring this app. A sender address on an unverified domain will be
   rejected by Resend and no email will arrive.
2. **An API key with Sending access.** Create it under **API Keys** in Resend.
   It begins with `re_`.

---

## Setup

Install the app, then open its settings and fill in:

| Setting | Required | What it does |
| --- | --- | --- |
| **API Key** | Yes | Your Resend API key (`re_…`). Needs Sending access. |
| **From Address** | Yes | The sender address, e.g. `orders@yourstore.com`. Must be on a domain verified in Resend. |
| **From Name** | No | Display name recipients see, e.g. `Acme Store`. Sent as `Acme Store <orders@yourstore.com>`. |
| **Reply-To Address** | No | Where customer replies go, if different from the sender. |

Until **both** API Key and From Address are set, the app does nothing at all —
every event is ignored and a single line is logged. It will not send partial
or misconfigured email.

Your API key is stored in the app's settings on your store. It is never in the
app's source code, and the app is open source so you can confirm that.

### Per-email sender and BCC

Each notification in **Settings → Notifications** has its own optional **From
email** and **BCC emails**. The app uses them:

- **From email on your verified domain** (the same domain as the app's From
  Address): the email is sent from that address, with your From Name.
- **From email on any other domain**: Resend would reject it, so the email is
  sent from the app's From Address and that address becomes the **Reply-To**,
  which is also what Swell does with it.
- **BCC emails**: every address gets a blind copy.

---

## What it sends

Twelve standard Swell notifications are supported out of the box. Each has its
own toggle, so you can move them over one at a time rather than all at once.

| Notification | Fires on | Swell template | Default |
| --- | --- | --- | --- |
| Order confirmation | `order.submitted` | `receipt.v2` | **On** |
| Shipping confirmation | `shipment.created` | `shipped.v2` | **On** |
| New subscription | `subscription.created` | `new.v2` | **On** |
| Shipping update | `shipment.updated`, when a tracking number is set | `shipped-update.v2` | Off |
| Order canceled | `order.canceled` | `canceled.v2` | Off |
| Order refund | `payment.refund.succeeded` | `refund.v2` | Off |
| Customer welcome | `account.created` | `welcome.v2` | Off |
| Abandoned cart recovery | `cart.abandoned` | `recovery.v2` | Off |
| Subscription canceled | `subscription.canceled` | `canceled.v2` | Off |
| Subscription paused | `subscription.paused` | `paused.v2` | Off |
| Subscription resumed | `subscription.resumed` | `resumed.v2` | Off |
| Subscription invoice | `subscription.invoiced` | `invoice.v2` | Off |

Shipping and refund emails are about the **order**, not the shipment or
payment. Those events carry an `order_id`, and the app loads the order and
renders the order-model template — which is what the stock Swell templates
expect.

### What is not covered

Some standard Swell notifications have no business event behind them. They
fire from a manual action, a record condition, a schedule, or a delay, so
there is nothing for this app to subscribe to:

- Password reset and customer invite
- Draft-order invoice and gift-card fulfillment
- The dunning series (payment failed, unpaid, payment finally succeeded/failed)
- Payment method expiring
- The abandoned-cart **follow-up** series (`recovery-1`, `recovery-2`), which
  depend on timed delays — the initial `recovery` is supported
- Admin-facing, print, and app-owned templates

**Leave these on Swell's native delivery.** They will keep working normally.

---

## Custom notifications

If you have your own notification templates, or you want to send on an event
that has no default mapping, add a row under **Custom notifications**. No code
change is needed.

Each row has:

| Field | What to enter |
| --- | --- |
| **Trigger event** | Pick from the list. Every event the app can hear is there. |
| **Notification name** | The template's `name` as it appears in Settings → Notifications, e.g. `invoice.v2` — not its display label. |
| **Record ID field** | Path on the event to the record id. Leave blank unless the email is about a different record than the event; defaults to `id`. |
| **Enabled** | Turn the row off without deleting it. |

These six events are listenable but have **no** default mapping, so they exist
specifically for custom rows: `order.paid`, `order.delivered`,
`subscription.activated`, `subscription.paid`, `subscription.trial_will_end`,
`subscription.trial_ended`.

### One rule that catches people out

A custom row assumes the template lives on the **same model as its event**. The
model is taken from the part of the event name before the dot:

| Event starts with | Template and record are looked up on |
| --- | --- |
| `order.` | orders |
| `subscription.` | subscriptions |
| `cart.` | carts |
| `account.` | accounts |
| `shipment.` | **shipments** |
| `payment.` | **payments** |

Note the last two. A custom row on `shipment.created` looks for a template on
the *shipments* model and loads a *shipment* record — it does **not** behave
like the built-in Shipping confirmation, which deliberately crosses over to the
order. The same applies to `payment.refund.succeeded`.

**So:** if you want an order-shaped email from a shipment or payment event, use
the built-in toggle. Custom rows are for same-model templates. Cross-model
routing requires a code change.

---

## How your templates are rendered

- **Templates are read live.** The app fetches the notification from your store
  each time it sends, so the email always matches what is in the dashboard.
  Edit a template and the next email reflects it.
- **The same record data.** The app loads the record using exactly the
  expansions the template was configured with, so fields like line items,
  customer, and addresses resolve as they do in Swell's own preview.
- **Liquid.** Templates render with Liquid, including your notification's
  content labels (the short snippets like `Order {{ number }}`).
- **Swell filters.** Two Swell-specific Liquid filters are reimplemented:
  `currency`, which formats a number using the record's own currency, and
  `img_url`, which resolves an image and appends transform parameters. Other
  Swell-specific filters are not implemented — see Limitations.

---

## Avoiding duplicate emails

The app never sends a notification that Swell is also sending. Before each
email, it checks whether Swell's own version is still on. If it is, the app
skips the email and logs why.

For most emails, switching to Resend is one step: **turn off Swell's version
of it in Settings → Notifications.** The app's toggle for it must also be on —
three are on by default: order confirmation, shipping confirmation and new
subscription.

Three emails are switched off differently:

- **Abandoned cart recovery.** Turn off the **Abandoned cart** switch in
  Settings → Notifications. That's the switch Swell checks before sending its
  recovery email. Swell's follow-up emails (`recovery-1`, `recovery-2`) depend
  on the same switch, so they stop too.
- **Shipping confirmation and Shipping update.** Settings → Notifications has
  no switch for these two, so Swell sends them whenever you tick "Send email
  confirmation to customer" on a fulfillment. Until Swell's version is turned
  off through the Swell API, the app skips them and logs why. To turn it off,
  look up the notification with
  `GET /:notifications?where[model]=orders&where[name]=shipped.v2` (or
  `shipped-update.v2`) and set it with `PUT /:notifications/{id}` and
  `{"enabled": false}`. Saving Settings → Notifications afterwards keeps it
  off.

**Recommended rollout:**

1. Enter your API key and From Address. Nothing changes yet — Swell is still
   sending every notification.
2. Turn off one native notification in **Settings → Notifications**, for
   example the order receipt.
3. Place a test order and confirm exactly one email arrives, and that it
   appears in your Resend dashboard.
4. Repeat for the next notification.

The same email is never sent twice for one event, even if Swell delivers the
event again: each send carries an idempotency key, which Resend honours for 24
hours.

Custom notifications are not checked this way. They route your own templates,
so turning Swell's copy off is up to you.

---

## Limitations

These are properties of how the app works, not defects. They are listed so you
can decide whether they matter for your store.

- **Shipping confirmations ignore the "notify customer" checkbox.** When you
  create a shipment in the dashboard, Swell doesn't pass that checkbox on to
  apps. Once Swell's own shipping confirmation is off, the app sends one for
  every shipment that isn't a draft.
- **Shipping updates follow the tracking number.** The app sends one when a
  shipment's tracking number is set or changed, not on other edits. Swell's
  own version sends when you tick the checkbox while editing a fulfillment,
  which the app can't see.
- **Abandoned cart recovery is the first email only.** Turning off Swell's
  Abandoned cart switch also stops its follow-up emails.
- **Welcome emails go out when an account is created.** A guest who later sets
  a password doesn't get one.
- **Only event-backed notifications can be covered.** Anything triggered by a
  manual action, a record condition, a schedule, or a delay is out of reach —
  see [What is not covered](#what-is-not-covered).
- **Duplicate protection lasts 24 hours.** If Swell redelivers an event more
  than a day after the first attempt, a second email can go out.
- **Retries depend on the failure.** If Resend is unreachable, rate-limited, or
  returns a server error, Swell tries the event again later. If Resend rejects
  the request (a bad key or an unverified domain), the failure is logged and
  not retried — fix the setting and later emails send normally.
- **Custom rows are same-model only.** See
  [the rule above](#one-rule-that-catches-people-out).
- **Partial Liquid filter coverage.** Only `currency` and `img_url` are
  reimplemented. A template relying on another Swell-specific filter may not
  render identically.
- **One customer per email.** The app sends to the single contact address the
  notification is configured for, plus the notification's BCC emails.

---

## Troubleshooting

Every outcome is logged. Check your store's logs and look for lines beginning
`Resend:`.

**A successful send logs two lines**, including the Resend message id:

```
Resend: sent "Order #1001 confirmed" to customer@example.com (id: 4ef6…)
Resend: Order confirmation -> customer@example.com
```

If no email arrived, find the matching line below.

| Log line | What it means | Fix |
| --- | --- | --- |
| `missing required settings (api_key, from_email)` | One of the two required fields is blank. Nothing was attempted. | Fill in both API Key and From Address. |
| `app settings not found` | The app's settings could not be read at all. | Confirm the app is installed and configured on this store. |
| `template "<name>" (<model>) not found in store` | No notification with that name exists on that model. | Check the template's `name` in Settings → Notifications — it is not the display label. For custom rows, confirm the template is on the model the event implies. |
| `notification "<name>" has no html content` | The template exists but has no HTML body. | Add HTML content to the notification in Swell. |
| `failed to fetch template "<name>" (404)` | The template's hosted content could not be retrieved. | Re-save the notification in Swell to regenerate it. |
| `no recipient from "<path>" for <template>` | The notification's contact field did not resolve to an address on this record. | Check the notification's contact setting; e.g. a guest order with no account will not resolve `account.email`. |
| `<model> <id> not found` | The record the event pointed at could not be loaded. | Usually a record deleted between the event firing and the send. Safe to ignore if isolated. |
| `<event> has no "<field>", skipping <label>` | The event payload had no id at the expected path. For custom rows this is usually a wrong **Record ID field**. | Leave Record ID field blank to use `id`, or set the correct path. |
| `custom mapping has unrecognized event "<event>"` | A custom row's event is not one the app knows. | Re-pick the event from the dropdown. |
| `failed rendering field "<id>"` | A content label contains invalid Liquid. That label renders empty; the email still sends. | Fix the label in the notification's content fields. |
| `skipped: Swell's native "<label>" email is still on` | Swell is still sending this notification itself, so the app didn't. | Turn it off as the rest of the line says: in Settings → Notifications, with the Abandoned cart switch, or through the API for the shipping emails. See [Avoiding duplicate emails](#avoiding-duplicate-emails). |
| `skipped: shipment is a draft` | Swell doesn't send shipping emails for draft shipments either. | Nothing to fix. |
| `skipped: tracking number did not change` | A shipment was edited without setting a tracking number, so there's no shipping update to send. | Nothing to fix. |
| `skipped: cart has no customer account` / `cart is empty` | Swell only sends cart recovery to customers with an account and items in the cart. | Nothing to fix. |
| `skipped: order is a draft` / `order has notify: false` | Swell wouldn't send a receipt for this order either. | Nothing to fix. |
| `skipped: guest account (no password)` | Welcome emails only go to customers who created an account. | Nothing to fix. |
| `skipped: subscription is not active` / `is canceled` | Swell's rules for this subscription email weren't met. | Nothing to fix. |
| `skipped: nothing to invoice (grand_total is 0)` | Free invoices don't get an email, in Swell or here. | Nothing to fix. |
| `Resend 401: …` | Resend received no API key. | Re-enter the API Key in the app settings. |
| `Resend 403: …` | Resend refused the email. The message says why: an invalid, inactive or suspended API key, a sender domain that isn't verified, or a sending restriction on the account. | For a key problem, create a new key with Sending access in Resend. For a domain problem, verify the From Address domain (and any notification From email on it) in Resend. |
| `Resend 422: …` | Resend rejected the payload, most often the `from` address. | Check the From Address is a valid address on a verified domain. |
| `Resend 429: …` / `Resend 5xx: …` / `Resend unreachable` | A temporary Resend problem. | Nothing to fix — Swell retries the event. |

**If nothing is logged at all** for an event, the notification's toggle is off,
or the event did not fire. Confirm the toggle, then confirm the event by
checking whether Swell's own notification for it went out.

A failure in one email never stops the others: each is attempted
independently, then the failure is reported to Swell so the event shows as
failed (and is retried when the failure is temporary).

---

## Support

- Email: support@swell.is
- Source: [github.com/swellstores/resend-app](https://github.com/swellstores/resend-app)

The app is open source. The full event-to-template mapping lives in
`functions/lib/registry.ts` if you want to read exactly what it does.
