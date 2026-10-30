/** Dependency failures must not be mistaken for invalid identity or a missing record. */
export class DependencyError extends Error {
  readonly status = 503;
  readonly code = "DEPENDENCY_UNAVAILABLE";
  constructor(message = "The service is temporarily unavailable. Please try again.") { super(message); this.name = "DependencyError"; }
}

export function authDependencyFailure(error: unknown): boolean {
  const value = error as { status?: number; code?: string; name?: string } | null;
  if (!value) return false;
  const status = Number(value.status);
  if (status === 408 || status === 429 || status >= 500) return true;
  if (/RetryableFetch|Abort|Timeout|FetchError/.test(value.name || "")) return true;
  // Unknown errors fail closed as unavailable, not as an accusation of bad credentials.
  return ![400, 401, 403, 422].includes(status) && ![
    "invalid_credentials", "bad_jwt", "session_not_found", "refresh_token_not_found",
    "refresh_token_already_used", "otp_expired", "email_not_confirmed",
    "user_not_found", "validation_failed", "weak_password",
  ].includes(value.code || "");
}

/** The signal deadline remains active through response-body consumption. No retries on writes. */
export const dependencyFetch: typeof fetch = (input, init) => {
  const deadline = AbortSignal.timeout(8_000);
  const inherited = init?.signal ?? (typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined);
  const signal = inherited ? AbortSignal.any([inherited, deadline]) : deadline;
  return fetch(input, { ...init, signal }).catch(error => {
    if (inherited?.aborted) throw error;
    throw new DependencyError("The upstream service did not respond. Please try again.");
  });
};
