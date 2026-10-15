// Minimal assertions so the test needs no remote modules.
export function assert(cond: unknown, msg = "assertion failed"): asserts cond { if (!cond) throw new Error(msg); }
export function assertEquals(a: unknown, b: unknown, msg?: string) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg ? msg + ": " : ""}expected ${sb}, got ${sa}`);
}
