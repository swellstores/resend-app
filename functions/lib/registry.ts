// A single event-to-notification mapping. The app subscribes to `event`, then
// renders the Swell notification template (`templateName` on `templateModel`)
// using a record loaded from `recordModel` at the id found at `idFrom`.
export interface Mapping {
  event: string;
  templateName: string;
  templateModel: string;
  recordModel: string;
  // Dot path on the event payload to the record id (usually "id", but e.g.
  // "order_id" for shipment/payment events whose email is about the order).
  idFrom: string;
  // App settings toggle that gates this email.
  settingKey: string;
  // Whether this email sends when the toggle has never been set.
  defaultOn: boolean;
  label: string;
  // Built-in mappings stand in for a native Swell notification, so they only
  // send while that native notification is disabled. Custom mappings don't.
  replacesNative: boolean;
  // Native send rules that an event alone doesn't express. Returns a reason to
  // skip, or null to send.
  skip?: (ctx: MappingContext) => Promise<string | null> | string | null;
  // Data native passes to the template through `$notify.data` (refunds,
  // invoice, shipment), merged over the record in the render context.
  extraData?: (ctx: MappingContext) => Promise<Record<string, unknown>>;
}

export interface MappingContext {
  swell: SwellAPI;
  event: SwellData;
  record: any;
}

// Refunds as schema-api-server passes them to refund.v2 (payments feature,
// updateOrderRefundTotals): every refund on the order, not just this one.
async function orderRefunds({ swell, record }: MappingContext) {
  const res = await swell.get('/payments:refunds', { order_id: record.id, limit: 100 });
  const refunds = (res?.results ?? []).map((refund: any) => ({
    amount: refund.amount,
    reason: refund.reason,
    reason_message: refund.reason_message || humanize(refund.reason),
  }));
  return { refunds };
}

// shipped-update.v2 reads a top-level `shipment`; native passes the shipment
// that triggered the email (orders feature, items.js).
async function eventShipment({ swell, event }: MappingContext) {
  if (!event?.id) return {};
  const shipment = await swell.get('/shipments/{id}', {
    id: event.id,
    expand: ['items.product', 'items.variant'],
  });
  return shipment ? { shipment } : {};
}

// invoice.v2 reads a top-level `invoice`; native passes the invoice it just
// created (subscriptions feature, sendPaymentNotification).
async function latestInvoice({ swell, record }: MappingContext) {
  const res = await swell.get('/invoices', {
    subscription_id: record.id,
    sort: 'date_created desc',
    limit: 1,
    expand: ['items.product', 'items.variant'],
  });
  const invoice = res?.results?.[0];
  return invoice ? { invoice } : {};
}

// lodash's capitalize(words(reason)), which native uses for reason_message
function humanize(value?: string): string {
  if (!value) return '';
  const text = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Standard Swell notifications that map cleanly to a single model event.
// (Action/condition/schedule-triggered ones — password reset, invite, draft
// invoice, dunning, payment-expiring, admin/print/app templates — have no
// corresponding event and are intentionally omitted; route them via custom
// mappings if a suitable event exists.)
export const DEFAULT_MAPPINGS: Mapping[] = [
  // Orders
  {
    event: 'order.submitted', templateName: 'receipt.v2', templateModel: 'orders', recordModel: 'orders', idFrom: 'id',
    settingKey: 'send_order_receipt', defaultOn: true, label: 'Order confirmation', replacesNative: true,
    // receipt.v2 conditions: draft != true, notify != false
    skip: ({ record }) =>
      record.draft === true ? 'order is a draft' : record.notify === false ? 'order has notify: false' : null,
  },
  {
    event: 'order.canceled', templateName: 'canceled.v2', templateModel: 'orders', recordModel: 'orders', idFrom: 'id',
    settingKey: 'send_order_canceled', defaultOn: false, label: 'Order canceled', replacesNative: true,
  },
  {
    event: 'payment.refund.succeeded', templateName: 'refund.v2', templateModel: 'orders', recordModel: 'orders', idFrom: 'order_id',
    settingKey: 'send_order_refund', defaultOn: false, label: 'Order refund', replacesNative: true,
    extraData: orderRefunds,
  },
  // Shipments (email is modeled on the order)
  {
    event: 'shipment.created', templateName: 'shipped.v2', templateModel: 'orders', recordModel: 'orders', idFrom: 'order_id',
    settingKey: 'send_order_shipped', defaultOn: true, label: 'Shipping confirmation', replacesNative: true,
    extraData: eventShipment,
  },
  {
    event: 'shipment.updated', templateName: 'shipped-update.v2', templateModel: 'orders', recordModel: 'orders', idFrom: 'order_id',
    settingKey: 'send_order_shipped_update', defaultOn: false, label: 'Shipping update', replacesNative: true,
    extraData: eventShipment,
  },
  // Accounts
  {
    event: 'account.created', templateName: 'welcome.v2', templateModel: 'accounts', recordModel: 'accounts', idFrom: 'id',
    settingKey: 'send_account_welcome', defaultOn: false, label: 'Customer welcome', replacesNative: true,
    // welcome.v2 only sends to accounts with a password, never to checkout
    // guests. The password is never returned, but it can be queried on.
    skip: async ({ swell, record }) => {
      const res = await swell.get('/accounts', {
        id: record.id,
        password: { $exists: true },
        fields: 'id',
        limit: 1,
      });
      return res?.count > 0 ? null : 'guest account (no password)';
    },
  },
  // Carts
  {
    event: 'cart.abandoned', templateName: 'recovery.v2', templateModel: 'carts', recordModel: 'carts', idFrom: 'id',
    settingKey: 'send_cart_recovery', defaultOn: false, label: 'Abandoned cart recovery', replacesNative: true,
  },
  // Subscriptions
  {
    // new.v2 is `new: true` + active: native sends it only when the
    // subscription is created active, never on a later (re)activation.
    event: 'subscription.created', templateName: 'new.v2', templateModel: 'subscriptions', recordModel: 'subscriptions', idFrom: 'id',
    settingKey: 'send_subscription_new', defaultOn: true, label: 'New subscription', replacesNative: true,
    skip: ({ record }) => (record.active === true ? null : 'subscription is not active'),
  },
  {
    event: 'subscription.canceled', templateName: 'canceled.v2', templateModel: 'subscriptions', recordModel: 'subscriptions', idFrom: 'id',
    settingKey: 'send_subscription_canceled', defaultOn: false, label: 'Subscription canceled', replacesNative: true,
  },
  {
    event: 'subscription.paused', templateName: 'paused.v2', templateModel: 'subscriptions', recordModel: 'subscriptions', idFrom: 'id',
    settingKey: 'send_subscription_paused', defaultOn: false, label: 'Subscription paused', replacesNative: true,
    skip: ({ record }) => (record.canceled === true ? 'subscription is canceled' : null),
  },
  {
    event: 'subscription.resumed', templateName: 'resumed.v2', templateModel: 'subscriptions', recordModel: 'subscriptions', idFrom: 'id',
    settingKey: 'send_subscription_resumed', defaultOn: false, label: 'Subscription resumed', replacesNative: true,
    skip: ({ record }) => (record.canceled === true ? 'subscription is canceled' : null),
  },
  {
    event: 'subscription.invoiced', templateName: 'invoice.v2', templateModel: 'subscriptions', recordModel: 'subscriptions', idFrom: 'id',
    settingKey: 'send_subscription_invoice', defaultOn: false, label: 'Subscription invoice', replacesNative: true,
    // invoice.v2 conditions: grand_total > 0
    skip: ({ record }) => (Number(record.grand_total) > 0 ? null : 'nothing to invoice (grand_total is 0)'),
    extraData: latestInvoice,
  },
];

// Map an event name to its model collection, for deriving record/template model
// of custom mappings (e.g. "order.paid" -> "orders").
const MODEL_BY_PREFIX: Record<string, string> = {
  order: 'orders',
  subscription: 'subscriptions',
  cart: 'carts',
  account: 'accounts',
  shipment: 'shipments',
  payment: 'payments',
  invoice: 'invoices',
  coupon: 'coupons',
  promotion: 'promotions',
  product: 'products',
  products: 'products',
  category: 'categories',
  page: 'pages',
};

export function modelFromEvent(event: string): string | null {
  return MODEL_BY_PREFIX[event.split('.')[0]] ?? null;
}
