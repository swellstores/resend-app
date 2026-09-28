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
  // Resend returns the original email for a repeated key (kept for 24 hours),
  // so a redelivered Swell event can't send a second copy.
  idempotencyKey?: string;
}

// Format a sender as "Name <email>" when a display name is configured
export function formatSender(email: string, name?: string | null): string {
  return name ? `${name} <${email}>` : email;
}

// Send a rendered email through the Resend API
export async function sendEmail(
  settings: ResendSettings,
  email: ResendEmail,
): Promise<void> {
  const payload: Record<string, unknown> = {
    from: formatSender(settings.from_email!, settings.from_name),
    to: email.to,
    subject: email.subject,
    html: email.html,
  };
  if (settings.reply_to) {
    payload.reply_to = [settings.reply_to];
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
