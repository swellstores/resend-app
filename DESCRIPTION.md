Resend sends your store’s transactional emails through your own Resend account, reusing the notification templates you already designed in Settings → Notifications. There is no second set of templates to build or keep in sync.

When an event fires — an order is submitted, a shipment is created, a subscription starts — the app fetches your live notification template, renders it with that record’s data, and delivers it through the Resend API. Because the template is read at send time, any edit you make in the dashboard shows up in the next email automatically.

Twelve standard notifications are supported out of the box, each with its own on/off toggle: order confirmation, order canceled, refund, shipping confirmation, shipping update, customer welcome, abandoned cart recovery, and five subscription emails. Anything else can be routed with the Custom notifications setting — choose an event, name a template, and it sends, with no code change.

Setup is two fields: your Resend API key and a sender address on a domain you have verified in Resend. An optional display name and reply-to address are also supported.

Customers never get two copies: a notification only sends through Resend once you turn off Swell’s own version of it, so you can switch over one email at a time.
