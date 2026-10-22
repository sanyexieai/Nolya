/** Select a complete copy set, uniformly, without storing or tracking visitors. */
export function selectHomeHero<T>(
  variants: readonly T[],
  random: () => number = Math.random,
): T {
  if (variants.length === 0) throw new Error("Home hero variants are required");
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new RangeError("Random sample must be in [0, 1)");
  return variants[Math.floor(sample * variants.length)];
}
