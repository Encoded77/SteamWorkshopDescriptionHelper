import { z } from 'zod';
import { ContentSchema } from './content.js';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from './render.js';

/**
 * A machine-readable description of the content schema, so the editor does not
 * keep its own per-type tables. Those drifted every time a type gained a
 * capability: a new type would be missing from the form, the preview sizing or
 * the create dialog, and fail only when someone tried to use it.
 *
 * Asset-bearing fields are tagged in the schema with `.describe('asset:<kind>')`
 * rather than listed here, so the marker lives with the field it describes.
 */

export type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'other';

export interface FieldInfo {
  key: string;
  kind: FieldKind;
  optional: boolean;
  default?: unknown;
  /** Present for enums. */
  values?: string[];
  /** Set when the field holds a path to an asset. */
  asset?: string;
}

export interface TypeInfo {
  type: string;
  surface: 'description' | 'preview' | 'carousel';
  /** Fixed canvas, where the surface has one. */
  canvas?: { width: number; height: number };
  fields: FieldInfo[];
}

/** Peels ZodOptional and ZodDefault to reach the underlying type. */
function unwrap(schema: z.ZodTypeAny): {
  inner: z.ZodTypeAny;
  optional: boolean;
  def?: unknown;
  description?: string;
} {
  let inner = schema;
  let optional = false;
  let def: unknown;
  let description = schema.description;

  for (;;) {
    const name = (inner._def as { typeName?: string }).typeName;
    if (name === 'ZodOptional') {
      optional = true;
      inner = (inner._def as { innerType: z.ZodTypeAny }).innerType;
    } else if (name === 'ZodDefault') {
      optional = true;
      def = (inner._def as { defaultValue: () => unknown }).defaultValue();
      inner = (inner._def as { innerType: z.ZodTypeAny }).innerType;
    } else {
      break;
    }
    description ??= inner.description;
  }

  return { inner, optional, def, description };
}

function kindOf(schema: z.ZodTypeAny): FieldKind {
  switch ((schema._def as { typeName?: string }).typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodEnum':
      return 'enum';
    case 'ZodArray':
      return 'array';
    default:
      return 'other';
  }
}

function surfaceOf(type: string): TypeInfo['surface'] {
  if (type.startsWith('preview-')) return 'preview';
  if (type === 'carousel') return 'carousel';
  return 'description';
}

export function describeContentSchema(): TypeInfo[] {
  const options = ContentSchema.options as unknown as z.ZodObject<z.ZodRawShape>[];

  return options.map((option) => {
    const shape = option.shape;
    const discriminator = shape['type'];
    if (!discriminator) throw new Error('Content schema member has no `type` literal.');
    const type = (discriminator._def as { value: string }).value;

    const fields: FieldInfo[] = [];
    for (const [key, raw] of Object.entries(shape)) {
      if (key === 'type') continue;
      const { inner, optional, def, description } = unwrap(raw);

      const field: FieldInfo = { key, kind: kindOf(inner), optional };
      if (def !== undefined) field.default = def;
      if (field.kind === 'enum') {
        field.values = [...((inner._def as { values: readonly string[] }).values ?? [])];
      }
      if (description?.startsWith('asset:')) field.asset = description.slice('asset:'.length);
      fields.push(field);
    }

    const info: TypeInfo = { type, surface: surfaceOf(type), fields };

    if (info.surface === 'preview') {
      info.canvas = { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT };
    } else if (info.surface === 'carousel') {
      const width = fields.find((f) => f.key === 'width')?.default;
      const height = fields.find((f) => f.key === 'height')?.default;
      if (typeof width === 'number' && typeof height === 'number') {
        info.canvas = { width, height };
      }
    }

    return info;
  });
}

