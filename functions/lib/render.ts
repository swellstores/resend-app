// Use the browser ESM build — the default Node build references `require`/`fs`,
// which the Swell function isolate doesn't provide ("require is not defined").
import { Liquid } from 'liquidjs/dist/liquid.browser.mjs';

export interface NotificationConfig {
  name: string;
  subject?: string;
  contact?: string; // dot path to recipient, e.g. "account.email"
  fields?: Array<{ id: string; value?: string; default?: string }>;
  query?: { expand?: string[] };
  content?: { html?: { url?: string } };
}

export interface RenderedEmail {
  to: string | undefined;
  subject: string;
  html: string;
}

const engine = new Liquid();

// Swell's `currency` filter: format a number as money using the record's currency.
// `{{ item.price | currency }}` -> "$10.00"
engine.registerFilter('currency', function (this: any, value: unknown) {
  const num = Number(value);
  if (!isFinite(num)) {
    return value ?? '';
  }
  let code = 'USD';
  try {
    code = (this?.context?.getSync(['currency']) as string) || 'USD';
  } catch {
    // fall back to USD
  }
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(num);
  } catch {
    return `${code} ${num.toFixed(2)}`;
  }
});

// Resolve a usable image URL from the many shapes Swell passes to `img_url`
// (a file object, an image record, or a product/variant with an images array).
function resolveImageUrl(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value.url) return value.url;
  if (value.file?.url) return value.file.url;
  const img = Array.isArray(value.images) ? value.images[0] : undefined;
  if (img) return img.file?.url ?? img.url;
  return undefined;
}

// Swell's `img_url` filter: turn an image-bearing value into a CDN URL and
// append transform params. `{{ product | img_url: 'width=128&height=128' }}`
engine.registerFilter('img_url', (value: unknown, params?: string) => {
  const url = resolveImageUrl(value);
  if (!url) return '';
  if (!params) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${params}`;
});

// Traverse a dot path (e.g. "account.email") on a record
function getByPath(record: any, path?: string): string | undefined {
  if (!path) return undefined;
  const value = path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), record);
  return value == null ? undefined : String(value);
}

// Build the `store` object the templates expect (name/url/logo/footer/support_email),
// merging general store settings with the notification branding settings.
async function buildStore(swell: SwellAPI, reqStore: SwellStore): Promise<Record<string, unknown>> {
  const [storeSettings, notif] = await Promise.all([
    swell.get('/settings/store').catch(() => ({})),
    swell.get('/settings/notifications').catch(() => ({})),
  ]);

  return {
    ...(storeSettings || {}),
    url: (storeSettings as any)?.url ?? reqStore?.url,
    logo: (notif as any)?.store_logo,
    logo_width: (notif as any)?.store_logo_width,
    footer: (notif as any)?.store_footer,
  };
}

// Notification labels (config.fields) are themselves tiny Liquid snippets, e.g.
// order_label = "Order {{ number }}". Render each into a `content` object.
async function renderFields(
  fields: NotificationConfig['fields'],
  baseContext: Record<string, unknown>,
): Promise<Record<string, string>> {
  const content: Record<string, string> = {};
  if (!fields?.length) return content;

  for (const field of fields) {
    const template = field.value ?? field.default ?? '';
    try {
      content[field.id] = await engine.parseAndRender(template, baseContext);
    } catch (err) {
      console.error(`Resend: failed rendering field "${field.id}":`, err);
      content[field.id] = '';
    }
  }
  return content;
}

// Fetch the template HTML, assemble the render context, and produce the email
export async function renderNotification(
  swell: SwellAPI,
  reqStore: SwellStore,
  config: NotificationConfig,
  record: any,
): Promise<RenderedEmail | null> {
  const url = config.content?.html?.url;
  if (!url) {
    console.error(`Resend: notification "${config.name}" has no html content`);
    return null;
  }

  const tplRes = await fetch(url);
  if (!tplRes.ok) {
    console.error(`Resend: failed to fetch template "${config.name}" (${tplRes.status})`);
    return null;
  }
  const html = await tplRes.text();

  const store = await buildStore(swell, reqStore);
  const baseContext = { ...record, store };
  const content = await renderFields(config.fields, baseContext);
  const context = { ...baseContext, content };

  const [subject, body] = await Promise.all([
    engine.parseAndRender(config.subject ?? '', context),
    engine.parseAndRender(html, context),
  ]);

  return {
    to: getByPath(record, config.contact),
    subject,
    html: body,
  };
}
