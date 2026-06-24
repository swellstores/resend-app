import { sendForMapping } from './notify';
import { DEFAULT_MAPPINGS, modelFromEvent, type Mapping } from './registry';
import type { ResendSettings } from './resend';

// A merchant-defined custom mapping row from the `custom_mappings` setting
interface CustomMappingRow {
  event?: string;
  template?: string;
  id_field?: string;
  enabled?: boolean;
}

function getByPath(record: any, path: string): string | undefined {
  const value = path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), record);
  return value == null ? undefined : String(value);
}

// Turn merchant `custom_mappings` rows into Mapping objects. The template is
// assumed to live on the same model as the event (the common case); cross-model
// templates are handled by the built-in registry.
function parseCustomMappings(settings: ResendSettings): Mapping[] {
  const rows = (settings as any)?.custom_mappings;
  if (!Array.isArray(rows)) {
    return [];
  }

  const mappings: Mapping[] = [];
  for (const row of rows as CustomMappingRow[]) {
    if (row?.enabled === false || !row?.event || !row?.template) {
      continue;
    }
    const model = modelFromEvent(row.event);
    if (!model) {
      console.error(`Resend: custom mapping has unrecognized event "${row.event}"`);
      continue;
    }
    mappings.push({
      event: row.event,
      templateName: row.template,
      templateModel: model,
      recordModel: model,
      idFrom: row.id_field || 'id',
      settingKey: '', // custom rows are gated by their own `enabled` flag
      defaultOn: true,
      label: `custom:${row.template}`,
    });
  }
  return mappings;
}

// Is this mapping enabled, given the settings? Registry mappings honor their
// toggle (falling back to defaultOn when unset); custom mappings are always on
// here because disabled rows were already filtered out.
function isEnabled(mapping: Mapping, settings: ResendSettings): boolean {
  if (!mapping.settingKey) {
    return true;
  }
  const val = (settings as any)[mapping.settingKey];
  return val === undefined ? mapping.defaultOn : Boolean(val);
}

// Route a single event through every matching mapping
export async function dispatch(
  swell: SwellAPI,
  reqStore: SwellStore,
  settings: ResendSettings,
  eventType: string,
  data: SwellData,
): Promise<void> {
  if (!settings?.api_key || !settings?.from_email) {
    console.error('Resend: missing required settings (api_key, from_email)');
    return;
  }

  const mappings = [...DEFAULT_MAPPINGS, ...parseCustomMappings(settings)].filter(
    (m) => m.event === eventType,
  );

  for (const mapping of mappings) {
    if (!isEnabled(mapping, settings)) {
      continue;
    }
    const recordId = getByPath(data, mapping.idFrom);
    if (!recordId) {
      console.log(`Resend: ${eventType} has no "${mapping.idFrom}", skipping ${mapping.label}`);
      continue;
    }
    try {
      await sendForMapping(swell, reqStore, settings, mapping, recordId);
    } catch (err) {
      console.error(`Resend: failed sending "${mapping.label}":`, err);
    }
  }
}

// Shared entrypoint for every event-handler function in this app
export async function handleEvent(req: SwellRequest): Promise<void> {
  const { swell, data, store } = req;
  const eventType: string | undefined = data.$event?.type;
  if (!eventType) {
    return;
  }

  const settings = (await swell.settings())?.resend as ResendSettings;
  if (!settings) {
    console.error('Resend: app settings not found');
    return;
  }

  await dispatch(swell, store, settings, eventType, data);
}
