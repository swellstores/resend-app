import { handleEvent } from './lib/dispatch';

export const config: SwellConfig = {
  description: 'Send shipping emails via Resend',
  model: {
    events: ['shipment.created', 'shipment.updated'],
  },
};

export default handleEvent;
