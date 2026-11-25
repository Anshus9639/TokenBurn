/**
 * Per-instance circuit breaker for provider calls.
 *
 * Keys are scoped per organization and provider so one tenant's bad credential or
 * provider outage cannot open the circuit for every other tenant on the instance.
 * State is in-memory by design: with multiple instances each keeps its own view.
 */

type CircuitState = {
  failures: number;
  openedAt: number | null;
  probeAt: number | null;
};

const globalCircuit = globalThis as unknown as { __tokenburnCircuits?: Map<string, CircuitState> };
const circuits = (globalCircuit.__tokenburnCircuits ??= new Map());

export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_OPEN_MS = 30_000;
const PROBE_TIMEOUT_MS = 60_000;

export type CircuitGate = "allow" | "probe" | "open";

export function circuitGate(key: string, now = Date.now()): CircuitGate {
  const state = circuits.get(key);
  if (!state || state.openedAt === null) return "allow";
  if (now - state.openedAt < CIRCUIT_OPEN_MS) return "open";
  if (state.probeAt !== null && now - state.probeAt < PROBE_TIMEOUT_MS) return "open";
  state.probeAt = now;
  return "probe";
}

export function circuitSuccess(key: string) {
  circuits.delete(key);
}

export function circuitFailure(key: string, now = Date.now()) {
  const state = circuits.get(key) ?? { failures: 0, openedAt: null, probeAt: null };
  state.probeAt = null;
  if (state.openedAt !== null) {
    // A failed half-open probe restarts the cooldown.
    state.openedAt = now;
    circuits.set(key, state);
    return;
  }
  state.failures += 1;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) state.openedAt = now;
  circuits.set(key, state);
}

export function circuitSnapshot(key: string): { failures: number; open: boolean; openedAt: number | null } | null {
  const state = circuits.get(key);
  if (!state) return null;
  return {
    failures: state.failures,
    open: state.openedAt !== null && Date.now() - state.openedAt < CIRCUIT_OPEN_MS,
    openedAt: state.openedAt,
  };
}

export function resetCircuits() {
  circuits.clear();
}

const AVAILABILITY_CODES = new Set([
  "provider_timeout",
  "provider_network_error",
  "provider_unavailable",
  "provider_rate_limited",
  "provider_stream_error",
]);

/** Deterministic request/credential errors do not count toward availability. */
export function isAvailabilityFailure(code: string): boolean {
  return AVAILABILITY_CODES.has(code);
}
