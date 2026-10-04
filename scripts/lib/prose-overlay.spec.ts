import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The prose overlay, held TWO-SIDED against the document the Java gateway publishes.
 *
 * `openapi/prose-overlay.json` is about 480 strings keyed by what they describe, which
 * makes it the most rot-prone artifact of the document: a route renamed after cutover
 * leaves an entry that applies to nothing, and a route added after it ships with no
 * summary, and neither is visible in a diff. So both directions are failures:
 *
 *   - every entry lands on a real operation, parameter or property, and its text is
 *     what that target publishes (a dangling entry fails, it is not silently skipped);
 *   - every operation the document publishes has a summary in the overlay.
 *
 * And the one place two writers meet: a property whose description the constraint
 * customizer extends with a sentence must publish BOTH texts, the overlay's first.
 * Reads only committed JSON, so it outlives the Node gateway it was extracted from.
 */

const ROOT = join(__dirname, '..', '..');
const read = (path: string) =>
  JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Record<string, any>;

const overlay = read(
  'apps/api-gateway-java/src/main/resources/openapi/prose-overlay.json',
);
const document = read('docs/reference/openapi.json');

const operationAt = (key: string) => {
  const space = key.indexOf(' ');
  const method = key.slice(0, space).toLowerCase();

  return document.paths[key.slice(space + 1)]?.[method];
};

describe('the prose overlay, against the published document', () => {
  it('every operation entry lands on a real operation, and is what it publishes', () => {
    const dangling: string[] = [];
    for (const [key, entry] of Object.entries<any>(overlay.operations)) {
      const operation = operationAt(key);
      if (!operation) {
        dangling.push(key);
        continue;
      }
      expect({ key, summary: operation.summary }).toEqual({
        key,
        summary: entry.summary,
      });
      if (entry.description) {
        expect({ key, description: operation.description }).toEqual({
          key,
          description: entry.description,
        });
      }
    }
    expect(dangling).toEqual([]);
  });

  it('every parameter entry lands on a real parameter, and is what it publishes', () => {
    const dangling: string[] = [];
    for (const [key, text] of Object.entries<string>(overlay.parameters)) {
      const [operationKey, where] = [
        key.slice(0, key.lastIndexOf(' ')),
        key.slice(key.lastIndexOf(' ') + 1),
      ];
      const [location, name] = where.split(':');
      const parameter = operationAt(operationKey)?.parameters?.find(
        (candidate: any) =>
          candidate.in === location && candidate.name === name,
      );
      if (!parameter) {
        dangling.push(key);
        continue;
      }
      expect({ key, description: parameter.description }).toEqual({
        key,
        description: text,
      });
    }
    expect(dangling).toEqual([]);
  });

  it('every property entry lands on a real property, and its text is what it publishes first', () => {
    const dangling: string[] = [];
    for (const [key, entry] of Object.entries<any>(overlay.properties)) {
      const [schema, name] = [
        key.slice(0, key.indexOf('.')),
        key.slice(key.indexOf('.') + 1),
      ];
      const property = document.components.schemas[schema]?.properties?.[name];
      if (!property) {
        dangling.push(key);
        continue;
      }
      if (entry.description) {
        expect({
          key,
          starts: String(property.description ?? '').startsWith(
            entry.description,
          ),
        }).toEqual({ key, starts: true });
      }
      if ('example' in entry) {
        expect({ key, example: property.example }).toEqual({
          key,
          example: entry.example,
        });
      }
    }
    expect(dangling).toEqual([]);
  });

  it('every published operation has a summary in the overlay, so a new route cannot ship undescribed', () => {
    const undescribed: string[] = [];
    for (const [path, methods] of Object.entries<any>(document.paths)) {
      for (const method of Object.keys(methods)) {
        const key = `${method.toUpperCase()} ${path}`;
        if (!overlay.operations[key]?.summary) undescribed.push(key);
      }
    }
    expect(undescribed).toEqual([]);
  });

  it('where the constraint customizer extends a description, both texts are published, the overlay first', () => {
    const property =
      document.components.schemas.LockUserDto.properties.lockedUntil;
    const text = overlay.properties['LockUserDto.lockedUntil']?.description;

    expect(text).toBeTruthy();
    expect(property.description.startsWith(text)).toBe(true);
    expect(property.description).toContain('Must be a date in the future.');
  });

  it('every envelope wrapper publishes the envelope prose', () => {
    const wrappers = Object.entries<any>(document.components.schemas).filter(
      ([name, schema]) =>
        name.startsWith('ApiResponse') && schema.properties?.warning,
    );

    expect(wrappers.length).toBeGreaterThan(100);
    for (const [name, schema] of wrappers) {
      expect({ name, warning: schema.properties.warning.description }).toEqual({
        name,
        warning: overlay.envelope.warning,
      });
      for (const [field, example] of Object.entries(
        overlay.envelope.examples,
      )) {
        expect({
          name,
          field,
          example: schema.properties[field]?.example,
        }).toEqual({ name, field, example });
      }
    }
  });

  it('every success response publishes its own description from the overlay, or the default', () => {
    const dangling = Object.keys(overlay.responses).filter((key) => {
      if (key === 'default') return false;
      const [method, path, status] = key.split(' ');

      return !document.paths[path]?.[method.toLowerCase()]?.responses?.[status];
    });
    expect(dangling).toEqual([]);

    for (const [path, methods] of Object.entries<any>(document.paths)) {
      for (const [method, operation] of Object.entries<any>(methods)) {
        for (const [status, response] of Object.entries<any>(
          operation.responses ?? {},
        )) {
          if (!status.startsWith('2')) continue;
          const key = `${method.toUpperCase()} ${path} ${status}`;
          expect({ key, description: response.description }).toEqual({
            key,
            description: overlay.responses[key] ?? overlay.responses.default,
          });
        }
      }
    }
  });
});
