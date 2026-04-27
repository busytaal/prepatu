// ── Localhost detection + signup hint ─────────────────────────────────────────

const SIGNUP_URL = 'https://prepatu.io/signup';

/**
 * Returns true when running in a browser on localhost / 127.0.0.1 / ::1,
 * or in a Node.js environment (no window).
 */
export function isLocalhost(): boolean {
  if (typeof window === 'undefined') return true; // Node / SSR
  const host = window.location.hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('192.168.') ||
    host.startsWith('10.')
  );
}

/**
 * Prints a one-time signup hint to the browser / Node console.
 * Called automatically by Prepatu.createAgent() when no apiKey is present.
 */
export function printSignupHint(): void {
  const styles =
    typeof window !== 'undefined'
      ? [
          'background:#0A0A14;color:#4A90E2;padding:6px 12px;border-radius:4px;font-size:13px',
          'color:inherit',
        ]
      : [];

  if (styles.length) {
    console.log(
      `%c prepatu %c  No API key detected. Sign up for a free managed account:\n  ${SIGNUP_URL}`,
      styles[0],
      styles[1]
    );
  } else {
    console.log(
      `[prepatu] No API key detected. Sign up for a free managed account:\n  ${SIGNUP_URL}`
    );
  }
}
