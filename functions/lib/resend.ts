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

  try {
    const res = await fetch(`${API_BASE}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.api_key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status}: ${body}`);
    }

    const result = (await res.json()) as { id?: string };
    console.log(`Resend: sent "${email.subject}" to ${email.to.join(', ')} (id: ${result.id})`);
  } catch (err) {
    console.error('Resend send error:', err);
    throw err;
  }
}
