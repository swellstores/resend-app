import { handleEvent } from './lib/dispatch';

export const config: SwellConfig = {
  description: 'Send payment/refund emails via Resend',
  model: {
    events: ['payment.refund.succeeded'],
  },
};

export default handleEvent;
