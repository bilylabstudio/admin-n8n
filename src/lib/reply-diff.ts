// Diff por palabras entre el borrador de la IA y el mensaje enviado, para la vista de
// Enviados. Logica pura (sin React): tokeniza conservando espacios/saltos de linea,
// calcula la subsecuencia comun mas larga (LCS) y devuelve segmentos etiquetados.
//   - base   = iaDraft (aiReply): lo que propuso la IA
//   - objetivo = sent  (finalReply): lo que finalmente se envio
//   - added   = presente solo en sent  => lo añadio el humano
//   - removed = presente solo en iaDraft => el humano lo quito de la IA

export type DiffSegmentType = 'equal' | 'added' | 'removed';
export type DiffSegment = { type: DiffSegmentType; text: string };

// Divide en tokens de palabra y de espacio (ambos se conservan) para poder re-renderizar
// el texto legible, incluidos los saltos de linea.
function tokenize(text: string): string[] {
  return String(text ?? '')
    .split(/(\s+)/)
    .filter((token) => token.length > 0);
}

export function computeWordDiff(iaDraft: string, sent: string): DiffSegment[] {
  const a = tokenize(iaDraft);
  const b = tokenize(sent);
  const n = a.length;
  const m = b.length;

  // Tabla LCS: dp[i][j] = longitud de la subsecuencia comun de a[i..] y b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const raw: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ type: 'equal', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: 'removed', text: a[i] });
      i += 1;
    } else {
      raw.push({ type: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    raw.push({ type: 'removed', text: a[i] });
    i += 1;
  }
  while (j < m) {
    raw.push({ type: 'added', text: b[j] });
    j += 1;
  }

  // Une segmentos consecutivos del mismo tipo para un render mas limpio.
  const merged: DiffSegment[] = [];
  for (const segment of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === segment.type) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}
