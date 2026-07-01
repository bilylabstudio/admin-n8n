import { describe, expect, it } from 'vitest';
import { computeWordDiff } from './reply-diff';

function types(iaDraft: string, sent: string) {
  return computeWordDiff(iaDraft, sent).map((s) => s.type);
}

function textOf(iaDraft: string, sent: string, type: 'added' | 'removed') {
  return computeWordDiff(iaDraft, sent)
    .filter((s) => s.type === type)
    .map((s) => s.text)
    .join('');
}

describe('computeWordDiff', () => {
  it('marks identical texts as a single equal segment', () => {
    expect(computeWordDiff('hola mundo', 'hola mundo')).toEqual([{ type: 'equal', text: 'hola mundo' }]);
  });

  it('reconstructs the sent text from equal + added segments', () => {
    const segments = computeWordDiff('hola', 'hola mundo');
    expect(segments.map((s) => s.type)).toContain('added');
    // equal + added debe reproducir el texto enviado
    const rebuilt = segments.filter((s) => s.type !== 'removed').map((s) => s.text).join('');
    expect(rebuilt).toBe('hola mundo');
  });

  it('detects words removed from the AI draft', () => {
    expect(textOf('hola mundo cruel', 'hola mundo', 'removed').trim()).toBe('cruel');
    expect(types('hola mundo cruel', 'hola mundo')).not.toContain('added');
  });

  it('detects a mixed edit (one word replaced) keeping order', () => {
    const segments = computeWordDiff('el gato negro', 'el perro negro');
    expect(textOf('el gato negro', 'el perro negro', 'removed').trim()).toBe('gato');
    expect(textOf('el gato negro', 'el perro negro', 'added').trim()).toBe('perro');
    // el segmento "removed" (IA) va antes que el "added" (humano)
    const removedIdx = segments.findIndex((s) => s.type === 'removed');
    const addedIdx = segments.findIndex((s) => s.type === 'added');
    expect(removedIdx).toBeLessThan(addedIdx);
  });

  it('treats an empty AI draft as everything added', () => {
    expect(computeWordDiff('', 'texto nuevo')).toEqual([{ type: 'added', text: 'texto nuevo' }]);
  });

  it('treats an empty sent text as everything removed', () => {
    expect(computeWordDiff('borrador ia', '')).toEqual([{ type: 'removed', text: 'borrador ia' }]);
  });

  it('preserves newlines as equal whitespace', () => {
    const segments = computeWordDiff('linea uno\nlinea dos', 'linea uno\nlinea DOS');
    const rebuiltSent = segments.filter((s) => s.type !== 'removed').map((s) => s.text).join('');
    expect(rebuiltSent).toBe('linea uno\nlinea DOS');
  });
});
