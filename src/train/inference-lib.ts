// train inference pure functions: threshold application with an empty-label fallback.
// Shared by the evaluation path and the ONNX serving path — behaviour must not fork.
// No heavy dependencies so the light runtime can import it safely.

export function applyThreshold(
  probs: number[][],
  threshold: number,
): number[][] {
  // sigmoid probabilities -> 0/1 multi-label matrix: anything at/above the line hits.
  // If a row hits nothing, fall back to its highest-scoring class so we never emit an empty label set.
  return probs.map((row) => {
    const pred = row.map((p) => (p >= threshold ? 1 : 0));
    if (!pred.some((v) => v === 1)) {
      const argmax = row.indexOf(Math.max(...row));
      pred[argmax] = 1;
    }
    return pred;
  });
}
