import { sendEmail, type ResendSettings } from './resend';
import { renderNotification, type NotificationConfig } from './render';
import type { Mapping } from './registry';

// Fetch the live notification config (template + fields + expansions) from the
// store. Notification names are NOT unique across models (e.g. "canceled.v2"
// and "invoice.v2" exist on several models), so always filter by name + model.
async function fetchNotificationConfig(
  swell: SwellAPI,
  name: string,
  model: string,
): Promise<NotificationConfig | null> {
  const res = await swell.get('/:notifications', {
    where: { name, model },
    limit: 1,
  });
  return res?.results?.[0] ?? null;
}

// Render a Swell notification template for one mapping and deliver it via Resend
export async function sendForMapping(
  swell: SwellAPI,
  reqStore: SwellStore,
  settings: ResendSettings,
  mapping: Mapping,
  recordId: string,
): Promise<void> {
  const config = await fetchNotificationConfig(swell, mapping.templateName, mapping.templateModel);
  if (!config) {
    console.error(
      `Resend: template "${mapping.templateName}" (${mapping.templateModel}) not found in store`,
    );
    return;
  }

  // Load the record with exactly the expansions the template was built for
  const expand = config.query?.expand ?? [];
  const record = await swell.get(`/${mapping.recordModel}/{id}`, { id: recordId, expand });
  if (!record) {
    console.error(`Resend: ${mapping.recordModel} ${recordId} not found`);
    return;
  }

  const email = await renderNotification(swell, reqStore, config, record);
  if (!email) {
    return;
  }
  if (!email.to) {
    console.error(`Resend: no recipient from "${config.contact}" for ${mapping.templateName}`);
    return;
  }

  await sendEmail(settings, { to: [email.to], subject: email.subject, html: email.html });
  console.log(`Resend: ${mapping.label} -> ${email.to}`);
}
