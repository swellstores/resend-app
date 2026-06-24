import { handleEvent } from './lib/dispatch';

export const config: SwellConfig = {
  description: 'Send account emails via Resend',
  model: {
    events: ['account.created'],
  },
};

export default handleEvent;
