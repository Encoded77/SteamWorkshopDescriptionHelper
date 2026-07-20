import { parseDocument, isMap, isSeq, type Document } from 'yaml';

/**
 * Applies an edit to the parsed document tree rather than re-serializing an
 * object, so comments, key order and block scalars survive. Merging is
 * structural: maps recurse by key, sequences by index.
 */
export function writeYamlPreserving(original: string, next: unknown): string {
  // Document, not the narrower Document.Parsed: replacing `contents` assigns a
  // created node, which carries no source range.
  const doc: Document = parseDocument(original);
  applyValue(doc, [], next);
  // Folded scalars are re-serialized, so a wrapping width must be chosen.
  return doc.toString({ lineWidth: 80 });
}

/** Serializes a value to YAML from scratch, for files that do not exist yet. */
export function writeYamlNew(value: unknown): string {
  const doc: Document = parseDocument('');
  doc.contents = doc.createNode(value);
  return doc.toString({ lineWidth: 0 });
}

type Path = (string | number)[];

function getNode(doc: Document, path: Path): unknown {
  return path.length === 0 ? doc.contents : doc.getIn(path, true);
}

function setNode(doc: Document, path: Path, value: unknown): void {
  if (path.length === 0) {
    doc.contents = doc.createNode(value);
  } else {
    doc.setIn(path, value);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function applyValue(doc: Document, path: Path, value: unknown): void {
  if (isPlainObject(value)) {
    applyMap(doc, path, value);
    return;
  }
  if (Array.isArray(value)) {
    applySeq(doc, path, value);
    return;
  }

  // Only write when it differs, so unchanged values keep their quoting style.
  const current = path.length === 0 ? doc.toJS() : doc.getIn(path);
  if (current !== value) setNode(doc, path, value);
}

function applyMap(doc: Document, path: Path, value: Record<string, unknown>): void {
  const existing = getNode(doc, path);

  if (!isMap(existing)) {
    setNode(doc, path, value);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) {
      doc.deleteIn([...path, key]);
      continue;
    }
    applyValue(doc, [...path, key], child);
  }

  // Keys the edit removed. Collected first, because deleting while iterating
  // the node's own items would skip entries.
  const removed = existing.items
    .map((item) => String((item.key as { value?: unknown })?.value ?? ''))
    .filter((key) => !(key in value) || value[key] === undefined);

  for (const key of removed) doc.deleteIn([...path, key]);
}

function applySeq(doc: Document, path: Path, value: unknown[]): void {
  const existing = getNode(doc, path);

  if (!isSeq(existing)) {
    setNode(doc, path, value);
    return;
  }

  for (let i = 0; i < value.length; i++) {
    applyValue(doc, [...path, i], value[i]);
  }

  // Trim surplus entries from the end, so remaining items keep their comments.
  for (let i = existing.items.length - 1; i >= value.length; i--) {
    doc.deleteIn([...path, i]);
  }
}
