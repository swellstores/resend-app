// Use the browser ESM build — the default Node build references `require`/`fs`,
// which the Swell function isolate doesn't provide ("require is not defined").
import { Liquid } from 'liquidjs/dist/liquid.browser.mjs';

type LocaleValues<T> = Record<string, Partial<T> | undefined>;

export interface NotificationConfig {
  name: string;
  label?: string;
  // false = the merchant turned the native email off; null/undefined = on
  enabled?: boolean | null;
  subject?: string;
  contact?: string; // dot path to recipient, e.g. "account.email"
  fields?: Array<{
    id: string;
    value?: string;
    default?: string;
    $locale?: LocaleValues<{ value: string }>;
  }>;
  $locale?: LocaleValues<{ subject: string }>;
  query?: { expand?: string[] };
  content?: { html?: { url?: string } };
}

export interface RenderedEmail {
  to: string | undefined;
  subject: string;
  html: string;
}

const engine = new Liquid();

// Swell's `currency` filter: format a number as money in the record's currency
// and locale. `{{ item.price | currency }}` -> "$10.00"
engine.registerFilter('currency', function (this: any, value: unknown) {
  const num = Number(value);
  if (!isFinite(num)) {
    return value ?? '';
  }
  let code = 'USD';
  let locale = 'en-US';
  try {
    code = (this?.context?.getSync(['currency']) as string) || 'USD';
    locale = (this?.context?.getSync(['$locale']) as string) || 'en-US';
  } catch {
    // fall back to USD / en-US
  }
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(num);
  } catch {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(num);
    } catch {
      return `${code} ${num.toFixed(2)}`;
    }
  }
});

// The locale native picks for a notification: the contact's (the account on
// most templates), then the record's own. Same order as schema-api-server.
function recordLocale(record: any, contact?: string): string | undefined {
  const pointerPath = contact?.split('.').slice(0, -1).join('.');
  const pointer = pointerPath ? getPointer(record, pointerPath) : record;
  return (
    pointer?.locale ||
    pointer?.display_locale ||
    record?.locale ||
    record?.display_locale ||
    undefined
  );
}

function getPointer(record: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), record);
}

// Pick a merchant translation from a `$locale` map: exact locale, then language.
function localized<T>(values: LocaleValues<T> | undefined, locale: string | undefined, key: keyof T) {
  if (!values || !locale) return undefined;
  const hit = values[locale]?.[key] ?? values[locale.split('-')[0]]?.[key];
  return typeof hit === 'string' && hit.length > 0 ? hit : undefined;
}

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
  locale: string | undefined,
): Promise<Record<string, string>> {
  const content: Record<string, string> = {};
  if (!fields?.length) return content;

  for (const field of fields) {
    const template = localized(field.$locale, locale, 'value') ?? field.value ?? field.default ?? '';
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
  const locale = recordLocale(record, config.contact);
  const baseContext = {
    ...record,
    currency: record.currency ?? record.account?.currency,
    store,
    $locale: locale,
  };
  const content = await renderFields(config.fields, baseContext, locale);
  const context = { ...baseContext, content };
  const subjectTemplate = localized(config.$locale, locale, 'subject') ?? config.subject ?? '';

  const [subject, body] = await Promise.all([
    engine.parseAndRender(subjectTemplate, context),
    engine.parseAndRender(html, context),
  ]);

  return {
    to: getByPath(record, config.contact),
    subject,
    html: body,
  };
}
