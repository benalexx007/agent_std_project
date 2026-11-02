import path from 'node:path';
import { ROOT, readJSON, requireThat } from './util.mjs';

// Deliberately small, fail-closed subset used by this repository's JSON Schemas.
const supported = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'default',
  'type', 'required', 'properties', 'additionalProperties', 'enum', 'const', 'items',
  'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'oneOf']);
export function validate(schema, value, root = schema, at = '$') {
  for (const keyword of Object.keys(schema)) requireThat(supported.has(keyword), 'Unsupported schema keyword: ' + keyword);
  if (schema.$ref) {
    requireThat(schema.$ref.startsWith('#/'), 'Only local schema references are supported');
    const target = schema.$ref.slice(2).split('/').reduce((s, k) => s?.[k], root);
    requireThat(target, 'Unresolved schema reference');
    return validate(target, value, root, at);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((item) => { try { validate(item, value, root, at); return true; } catch { return false; } });
    requireThat(matches.length === 1, at + ' must match exactly one schema');
  }
  const typeOf = (type) => type === 'null' ? value === null :
    type === 'array' ? Array.isArray(value) :
    type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) :
    type === 'integer' ? Number.isSafeInteger(value) :
    type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
  if (schema.type) requireThat([schema.type].flat().some(typeOf), at + ' has invalid type');
  if (schema.enum) requireThat(schema.enum.includes(value), at + ' is not an allowed value');
  if ('const' in schema) requireThat(value === schema.const, at + ' has wrong constant');
  if (typeof value === 'string') {
    if ('minLength' in schema) requireThat(value.length >= schema.minLength, at + ' is too short');
    if ('maxLength' in schema) requireThat(value.length <= schema.maxLength, at + ' is too long');
    if (schema.pattern) requireThat(new RegExp(schema.pattern).test(value), at + ' has invalid format');
  }
  if (typeof value === 'number') {
    if ('minimum' in schema) requireThat(value >= schema.minimum, at + ' is below minimum');
    if ('maximum' in schema) requireThat(value <= schema.maximum, at + ' exceeds maximum');
  }
  if (Array.isArray(value)) {
    if ('minItems' in schema) requireThat(value.length >= schema.minItems, at + ' has too few items');
    if ('maxItems' in schema) requireThat(value.length <= schema.maxItems, at + ' has too many items');
    if (schema.items) value.forEach((item, i) => validate(schema.items, item, root, at + '[' + i + ']'));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) requireThat(Object.hasOwn(value, key), at + '.' + key + ' is required');
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) validate(schema.properties[key], item, root, at + '.' + key);
      else if (schema.additionalProperties === false) throw new Error(at + '.' + key + ' is unknown');
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validate(schema.additionalProperties, item, root, at + '.' + key);
    }
  }
  return value;
}
export function contract(name, value) {
  const schema = readJSON(path.join(ROOT, 'schemas', name + '.schema.json'));
  return validate(schema, value);
}
