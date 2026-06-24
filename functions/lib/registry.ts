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
}

// Standard Swell notifications that map cleanly to a single model event.
// (Action/condition/schedule-triggered ones — password reset, invite, draft
// invoice, dunning, payment-expiring, admin/print/app templates — have no
// corresponding event and are intentionally omitted; route them via custom
// mappings if a suitable event exists.)
export const DEFAULT_MAPPINGS: Mapping[] = [
  // Orders
  { event: 'order.submitted', templateName: 'receipt.v2', templateModel: 'orders', recordModel: 'orders', idFrom: 'id', settingKey: 'send_order_receipt', defaultOn: true, label: 'Order confirmation' },
  { event: 'order.canceled', templateName: 'canceled.v2', templateModel: 'orders', recordModel: 'orders', idFrom: 'id', settingKey: 'send_order_canceled', defaultOn: false, label: 'Order canceled' },
  { event: 'payment.refund.succeeded', templateName: 'refund.v2', templateModel: 'orders', recordModel: 'orders', idFrom: 'order_id', settingKey: 'send_order_refund', defaultOn: false, label: 'Order refund' },
  // Shipments (email is modeled on the order)
  { event: 'shipment.created', templateName: 'shipped.v2', templateModel: 'orders', recordModel: 'orders', idFrom: 'order_id', settingKey: 'send_order_shipped', defaultOn: true, label: 'Shipping confirmation' },
  { event: 'shipment.updated', templateName: 'shipped-update.v2', templateModel: 'orders', recordModel: 'orders', idFrom: 'order_id', settingKey: 'send_order_shipped_update', defaultOn: false, label: 'Shipping update' },
  // Accounts
  { event: 'account.created', templateName: 'welcome.v2', templateModel: 'accounts', recordModel: 'accounts', idFrom: 'id', settingKey: 'send_account_welcome', defaultOn: false, label: 'Customer welcome' },
  // Carts
  { event: 'cart.abandoned', templateName: 'recovery.v2', templateModel: 'carts', recordModel: 'carts', idFrom: 'id', settingKey: 'send_cart_recovery', defaultOn: false, label: 'Abandoned cart recovery' },
  // Subscriptions
  { event: 'subscription.activated', templateName: 'new.v2', templateModel: 'subscriptions', recordModel: 'subscriptions', idFrom: 'id', settingKey: 'send_subscription_new', defaultOn: true, label: 'New subscription' },
  { event: 'subscription.canceled', templateName: 'canceled.v2', templateModel: 'subscriptions', recordModel: 'subscriptions', idFrom: 'id', settingKey: 'send_subscription_canceled', defaultOn: false, label: 'Subscription canceled' },
  { event: 'subscription.paused', templateName: 'paused.v2', templateModel: 'subscriptions', recordModel: 'subscriptions', idFrom: 'id', settingKey: 'send_subscription_paused', defaultOn: false, label: 'Subscription paused' },
  { event: 'subscription.resumed', templateName: 'resumed.v2', templateModel: 'subscriptions', recordModel: 'subscriptions', idFrom: 'id', settingKey: 'send_subscription_resumed', defaultOn: false, label: 'Subscription resumed' },
  { event: 'subscription.invoiced', templateName: 'invoice.v2', templateModel: 'subscriptions', recordModel: 'subscriptions', idFrom: 'id', settingKey: 'send_subscription_invoice', defaultOn: false, label: 'Subscription invoice' },
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
