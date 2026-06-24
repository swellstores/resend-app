import { handleEvent } from './lib/dispatch';

// Only `order.submitted` and `order.canceled` have default mappings (see
// registry.ts). `order.paid` and `order.delivered` are subscribed so merchants
// can target them via custom_mappings without a code change — by default they
// fire handleEvent and no-op. Keep them listed to surface them in the settings
// event dropdown.
export const config: SwellConfig = {
  description: 'Send order emails via Resend',
  model: {
    events: ['order.submitted', 'order.paid', 'order.canceled', 'order.delivered'],
  },
};

export default handleEvent;
