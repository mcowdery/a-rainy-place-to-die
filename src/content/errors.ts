/** Every content problem found while loading, collected rather than stopping at the first. */
export class ContentError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`Content has ${errors.length} error(s):\n${errors.join('\n')}`);
  }
}
