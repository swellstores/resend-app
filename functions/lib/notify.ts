import { parseAddressList, sendEmail, type ResendSettings } from './resend';
import { recordLocale, renderNotification, type NotificationConfig } from './render';
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

// Render a Swell notification template for one mapping and deliver it via Resend.
// `event` is the raw event payload; `idempotencyKey` makes a redelivered event
// resolve to the same Resend email instead of a second one.
export async function sendForMapping(
  swell: SwellAPI,
  reqStore: SwellStore,
  settings: ResendSettings,
  mapping: Mapping,
  recordId: string,
  event: SwellData,
  idempotencyKey: string,
): Promise<void> {
  const config = await fetchNotificationConfig(swell, mapping.templateName, mapping.templateModel);
  if (!config) {
    console.error(
      `Resend: template "${mapping.templateName}" (${mapping.templateModel}) not found in store`,
    );
    return;
  }

  // Swell skips a notification whose `enabled` is false and sends it otherwise
  // (null means "default", which is on). While native is on, it already sends
  // this email, so sending it here too would give the customer two copies.
  // Some notifications have a different native switch (see registry.ts).
  if (mapping.replacesNative) {
    const nativeOn = mapping.nativeEnabled
      ? await mapping.nativeEnabled(swell, config)
      : config.enabled !== false;
    if (nativeOn) {
      console.log(
        `Resend: ${mapping.label} skipped: Swell's native "${config.label ?? mapping.templateName}" email is still on. ` +
          (mapping.nativeOffHint ??
            'Turn it off in Settings > Notifications to send it through Resend instead.'),
      );
      return;
    }
  }

  // Load the record with exactly the expansions the template was built for
  const expand = config.query?.expand ?? [];
  const recordPath = `/${mapping.recordModel}/{id}`;
  let record = await swell.get(recordPath, { id: recordId, expand });
  if (!record) {
    console.error(`Resend: ${mapping.recordModel} ${recordId} not found`);
    return;
  }

  // Swell returns translations only when a request names a locale. The
  // customer's locale is on the record, so read the notification and the
  // record again with `$locale`, as native does: the subject, the fields and
  // the product, variant and plan names then come back translated, with the
  // store's own locale fallback applied.
  const locale = recordLocale(record, config.contact);
  let localizedConfig = config;
  if (locale) {
    const [configInLocale, recordInLocale] = await Promise.all([
      config.id ? swell.get('/:notifications/{id}', { id: config.id, $locale: locale }) : null,
      swell.get(recordPath, { id: recordId, expand, $locale: locale }),
    ]);
    localizedConfig = configInLocale ?? config;
    record = recordInLocale ?? record;
  }

  const ctx = { swell, event, record, locale };
  const skipReason = mapping.skip ? await mapping.skip(ctx) : null;
  if (skipReason) {
    console.log(`Resend: ${mapping.label} skipped: ${skipReason}`);
    return;
  }
  const extra = mapping.extraData ? await mapping.extraData(ctx) : {};

  const email = await renderNotification(swell, reqStore, settings, localizedConfig, { ...record, ...extra }, locale);
  if (!email) {
    return;
  }
  if (!email.to) {
    console.error(`Resend: no recipient from "${config.contact}" for ${mapping.templateName}`);
    return;
  }

  await sendEmail(settings, {
    to: [email.to],
    subject: email.subject,
    html: email.html,
    // The notification's own From email and BCC/CC emails, as native uses them
    notificationFrom: config.from || config.replyto,
    cc: parseAddressList(config.cc),
    bcc: parseAddressList(config.bcc),
    idempotencyKey,
  });
  console.log(`Resend: ${mapping.label} -> ${email.to}`);
}
