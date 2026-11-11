import { API_BASE, ResendSettings } from './lib/resend';

export const config: SwellConfig = {
  description: 'Check the Resend API key and that the From Address domain is verified',
  action: true,
};

interface ResendDomain {
  name?: string;
  status?: string;
}

// a thrown 400 shows in the admin as a red error popup, a returned message as a regular one
function fail(message: string): never {
  throw new SwellError(message, { status: 400 });
}

export default async function (req: SwellRequest) {
  const settings = ((await req.swell.settings())?.resend ?? {}) as ResendSettings;
  const apiKey = String(settings.api_key ?? '').trim();
  const fromEmail = String(settings.from_email ?? '').trim();

  const missing = [!apiKey && 'API Key', !fromEmail && 'From Address'].filter(Boolean);
  if (missing.length) {
    fail(`Add the ${missing.join(' and ')} and save the settings first.`);
  }
  const domain = fromEmail.slice(fromEmail.lastIndexOf('@') + 1).toLowerCase();
  if (!fromEmail.includes('@') || !domain) {
    fail(`The From Address ${fromEmail} isn't an email address.`);
  }

  // read-only: lists the account's domains, sends nothing
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/domains?limit=100`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    fail(`Couldn't reach Resend (${err instanceof Error ? err.message : String(err)}). Try again in a minute.`);
  }

  const body = (await res.json().catch(() => null)) as {
    name?: string;
    message?: string;
    data?: ResendDomain[];
  } | null;

  if (!res.ok) {
    // a key with Sending access only can send but not read domains; it is still a valid key
    if (body?.name === 'restricted_api_key') {
      return {
        message: `Resend accepted the API key. It has Sending access only, so the app can't check the ${domain} domain; make sure it shows as Verified in Resend → Domains.`,
      };
    }
    if (res.status === 401 || res.status === 403 || /api key/i.test(body?.message ?? '')) {
      fail("Resend didn't accept the API key. Copy it again from Resend → API Keys (it starts with re_).");
    }
    fail(`Resend returned ${res.status}: ${body?.message || res.statusText}`);
  }

  const domains = Array.isArray(body?.data) ? body.data : [];
  const match = domains.find((d) => String(d.name ?? '').toLowerCase() === domain);
  if (!match) {
    fail(
      `Connected to Resend, but ${domain} isn't one of its domains${
        domains.length ? ` (${domains.map((d) => d.name).join(', ')})` : ''
      }. Add and verify it in Resend → Domains, or use a From Address on a verified domain.`,
    );
  }
  if (match.status !== 'verified') {
    fail(
      `Connected to Resend, but the ${domain} domain isn't verified yet (status: ${match.status ?? 'unknown'}). Finish verifying it in Resend → Domains.`,
    );
  }

  return { message: `Connected to Resend. The ${domain} domain is verified, so emails can send from ${fromEmail}.` };
}
