// Analyze NIG distributions (signed values) and propose visualization hints

function flattenNig(values, type) {
  if (!values) return [];
  if (typeof values === 'object' && !Array.isArray(values)) {
    const out = [];
    for (const k in values) {
      if (!Object.prototype.hasOwnProperty.call(values, k)) continue;
      const v = values[k];
      if (Array.isArray(v)) out.push(...flattenNig(v, null));
    }
    return out;
  }
  if (type === 'FFN') {
    return values.flatMap((row) => row.map((x) => x));
  }
  if (type === 'ATTN') {
    const out = [];
    for (let h = 0; h < values.length; h++) {
      for (let i = 0; i < values[h].length; i++) {
        for (let j = 0; j < values[h][i].length; j++) {
          const v = values[h][i][j];
          if (v != null) out.push(v);
        }
      }
    }
    return out;
  }
  if (Array.isArray(values) && Array.isArray(values[0])) {
    if (Array.isArray(values[0][0])) {
      const out = [];
      for (const head of values) for (const row of head) for (const v of row) out.push(v);
      return out;
    }
    return values.flat();
  }
  return [];
}

function quantiles(sorted, ps) {
  const n = sorted.length;
  if (!n) return ps.map(() => NaN);
  return ps.map((p) => {
    const idx = Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))));
    return sorted[idx];
  });
}

export function analyzeNig(values, type) {
  const data = flattenNig(values, type).filter((x) => Number.isFinite(x));
  const n = data.length;
  if (!n) return { n: 0 };

  let min = Infinity, max = -Infinity, sum = 0;
  let pos = 0, neg = 0, zero = 0;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    if (v === 0) zero += 1; else if (v > 0) pos += 1; else neg += 1;
  }
  const mean = sum / n;
  let s2 = 0, m3 = 0, m4 = 0;
  for (const v of data) {
    const d = v - mean;
    s2 += d * d;
  }
  const varr = s2 / n;
  const std = Math.sqrt(varr) || 1e-12;
  for (const v of data) {
    const z = (v - mean) / std;
    m3 += z ** 3;
    m4 += z ** 4;
  }
  const skew = m3 / n;
  const kurt = m4 / n; // excess would be kurt-3

  const sorted = [...data].sort((a, b) => a - b);
  const [q0, q25, q50, q75, q90, q95, q99, q100] = quantiles(sorted, [0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1]);
  const iqr = q75 - q25;
  const fdWidth = (2 * iqr) / Math.cbrt(n) || (max - min) / Math.sqrt(n) || 1e-6;
  const fdBins = Math.max(10, Math.min(120, Math.ceil((max - min) / fdWidth)));

  const pPos = pos / n, pNeg = neg / n, pZero = zero / n;

  const symmetric = Math.abs(mean) < 0.1 * std && Math.abs(pPos - pNeg) < 0.1;
  const skewed = Math.abs(skew) > 1;

  let recommendation = [];
  recommendation.push(`Use linear x in [${min.toExponential(2)}, ${max.toExponential(2)}], ${fdBins} bins (FD).`);
  if (symmetric && pPos > 0.1 && pNeg > 0.1) recommendation.push('Mirror histogram (pos vs neg) or split violin.');
  if (skewed) recommendation.push('Show ECDF alongside to expose skew.');
  if (pZero > 0.05) recommendation.push('Add a zero spike marker.');
  if (kurt > 3.5) recommendation.push('Consider robust stats (median/MAD) and outlier caps in color scales.');

  return {
    n, min, max, mean, std, skew, kurt,
    quantiles: { q0, q25, q50, q75, q90, q95, q99, q100 },
    proportions: { pPos, pNeg, pZero },
    fd: { width: fdWidth, bins: fdBins },
    recommendation
  };
}
