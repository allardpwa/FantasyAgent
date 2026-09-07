/** Collect every nested object satisfying `pred`. Yahoo nests unpredictably. */
export function deepCollect(node, pred, out = []) {
  if (Array.isArray(node)) {
    for (const v of node) deepCollect(v, pred, out);
  } else if (node && typeof node === 'object') {
    if (pred(node)) out.push(node);
    for (const v of Object.values(node)) deepCollect(v, pred, out);
  }
  return out;
}

/** First nested value for `key`, at any depth. */
export function deepGet(node, key) {
  const hit = deepCollect(node, (o) => key in o)[0];
  return hit ? hit[key] : undefined;
}

export const fmt = (n, d = 1) => (Number(n) || 0).toFixed(d);
export const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
