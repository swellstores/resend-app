import { handleEvent } from './lib/dispatch';

// Default mappings exist only for activated/paused/resumed/canceled/invoiced
// (see registry.ts). The rest — created, paid, trial_will_end, trial_ended —
// are subscribed so merchants can target them via custom_mappings without a code
// change; by default they fire handleEvent and no-op. Keep them listed to
// surface them in the settings event dropdown.
export const config: SwellConfig = {
  description: 'Send subscription emails via Resend',
  model: {
    events: [
      'subscription.created',
      'subscription.activated',
      'subscription.paused',
      'subscription.resumed',
      'subscription.canceled',
      'subscription.invoiced',
      'subscription.paid',
      'subscription.trial_will_end',
      'subscription.trial_ended',
    ],
  },
};

export default handleEvent;
