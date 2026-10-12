/**
 * A pause for the browser (a macrotask: input is handled and the page repaints before the code goes on). The boot's
 * long builds call it between their pieces so the start screen stays clickable while the city is built behind it.
 */
let sliceStart = performance.now();
export const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(() => { sliceStart = performance.now(); resolve(); }, 0));

/** A pause only if the code has gone `ms` without one: for loops and for the places between builds where a pause is cheap insurance. */
export async function breatheIfDue(ms = 40): Promise<void> {
  if (performance.now() - sliceStart > ms) await breathe();
}

/** Runs a generator that yields at its pause points (`yield` = breathe here; `yield promise` = wait for it) to the end, with a pause at each. */
export async function drive<T>(steps: Generator<void | Promise<unknown>, T>): Promise<T> {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    // (A step that yields a promise, a shader's background compile, waits for it instead of a pause.)
    await (r.value ?? breathe());
  }
}

/** The same generator, run straight through (for a caller that can't wait). */
export function driveSync<T>(steps: Generator<void | Promise<unknown>, T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}
