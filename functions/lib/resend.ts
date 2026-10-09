const API_BASE = 'https://api.resend.com';

export interface ResendSettings {
  api_key?: string;
  from_email?: string;
  from_name?: string;
  reply_to?: string;
  // Per-notification toggles (keys match Mapping.settingKey in registry.ts) and
  // the `custom_mappings` collection are read dynamically in dispatch.ts, so
  // they're left as an index signature rather than enumerated here.
  [key: string]: unknown;
}

export interface ResendEmail {
  to: string[];
  subject: string;
  html: string;
  // The notification's "From email" (Settings > Notifications > the email).
  // See resolveSender for how it's used.
  notificationFrom?: string | null;
  cc?: string[];
  bcc?: string[];
  // Resend returns the original email for a repeated key (kept for 24 hours),
  // so a redelivered Swell event can't send a second copy.
  idempotencyKey?: string;
}

// Format a sender as "Name <email>" when a display name is configured
export function formatSender(email: string, name?: string | null): string {
  return name ? `${name} <${email}>` : email;
}

// Split a notification's comma-separated address field (`bcc`, `cc`)
export function parseAddressList(value?: string | null): string[] | undefined {
  const list = (value ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

// The bare address in "email" or "Name <email>"
function bareAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

// Pick From and Reply-To for one email. A notification's own From email is
// honoured as the sender when it's on the same domain as the app's From
// Address, which is the domain the merchant verified in Resend. Any other
// domain would be rejected by Resend (403), so it becomes the Reply-To
// instead, which is what Swell's default delivery does with it too: native
// sends from its own address and puts the notification's From in Reply-To.
export function resolveSender(
  settings: ResendSettings,
  notificationFrom?: string | null,
): { from: string; replyTo?: string } {
  const appFrom = settings.from_email!;
  const appReplyTo = settings.reply_to || undefined;
  const noteFrom = notificationFrom ? bareAddress(notificationFrom) : '';
  if (!noteFrom.includes('@') || noteFrom.toLowerCase() === appFrom.toLowerCase()) {
    return { from: formatSender(appFrom, settings.from_name), replyTo: appReplyTo };
  }
  if (domainOf(noteFrom) === domainOf(appFrom)) {
    return { from: formatSender(noteFrom, settings.from_name), replyTo: appReplyTo };
  }
  return { from: formatSender(appFrom, settings.from_name), replyTo: noteFrom };
}

// Send a rendered email through the Resend API
export async function sendEmail(
  settings: ResendSettings,
  email: ResendEmail,
): Promise<void> {
  const { from, replyTo } = resolveSender(settings, email.notificationFrom);
  const payload: Record<string, unknown> = {
    from,
    to: email.to,
    subject: email.subject,
    html: email.html,
  };
  if (replyTo) {
    payload.reply_to = [replyTo];
  }
  if (email.cc?.length) {
    payload.cc = email.cc;
  }
  if (email.bcc?.length) {
    payload.bcc = email.bcc;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.api_key}`,
        'content-type': 'application/json',
        ...(email.idempotencyKey ? { 'Idempotency-Key': email.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Network failure: let Swell redeliver the event
    throw new SwellError(`Resend unreachable: ${err instanceof Error ? err.message : String(err)}`, {
      status: 502,
    });
  }

  if (!res.ok) {
    const body = await res.text();
    // 429 and 5xx are transient, so Swell should retry. Any other 4xx (bad key,
    // unverified domain, invalid address) fails the same way on every retry.
    const retry = res.status === 429 || res.status >= 500;
    throw new SwellError(`Resend ${res.status}: ${body}`, { status: res.status, retry });
  }

  const result = (await res.json()) as { id?: string };
  console.log(`Resend: sent "${email.subject}" to ${email.to.join(', ')} (id: ${result.id})`);
}
