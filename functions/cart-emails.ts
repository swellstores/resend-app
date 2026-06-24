import { handleEvent } from './lib/dispatch';

export const config: SwellConfig = {
  description: 'Send cart recovery emails via Resend',
  model: {
    events: ['cart.abandoned'],
  },
};

export default handleEvent;
