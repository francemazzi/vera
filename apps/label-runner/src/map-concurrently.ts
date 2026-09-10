/** Bounded fan-out preserves input order and awaits every started task on failure. */
export async function mapConcurrently<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(values.length);
  let cursor: number = 0;
  let failure: unknown;
  let hasFailed: boolean = false;
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length) },
      async (): Promise<void> => {
        while (cursor < values.length && !hasFailed) {
          const index: number = cursor++;
          try {
            results[index] = await map(values[index]!);
          } catch (error: unknown) {
            failure = error;
            hasFailed = true;
          }
        }
      },
    ),
  );
  if (hasFailed) throw failure;
  return results;
}
