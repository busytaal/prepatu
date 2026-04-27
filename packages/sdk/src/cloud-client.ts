// ── Prepatu Cloud API client ───────────────────────────────────────────────────
//
// Thin HTTP wrapper for the Prepatu managed cloud API.
// All SDK-managed sessions go through here to resolve the backend URL,
// validate the API key, and report usage.

export const DEFAULT_CLOUD_API = 'https://api.prepatu.io';

export interface SessionStartResponse {
  /** Temporary session token to pass to the managed backend */
  session_token: string;
  /** Full WebSocket URL to connect to (includes session token in path) */
  ws_url: string;
  /** Remaining credit balance in USD cents */
  credits_remaining: number;
}

export interface ProviderKeys {
  stt_provider:  string;
  stt_api_key?:  string;
  tts_provider:  string;
  tts_api_key?:  string;
  llm_provider:  string;
  llm_api_key?:  string;
}

export interface CreditBalance {
  balance_usd_cents: number;
  rate_per_minute_usd_cents: number;
}

export class CloudClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = DEFAULT_CLOUD_API) {
    this.apiKey  = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Prepatu-Key': this.apiKey,
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`[prepatu] Cloud API ${method} ${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /** Start a managed session — returns backend URL + session token. */
  startSession(flowId?: string, metadata?: Record<string, string>): Promise<SessionStartResponse> {
    return this.request<SessionStartResponse>('POST', '/v1/sessions', { flow_id: flowId, metadata });
  }

  /** Report session end with duration (seconds). Used for credit deduction. */
  endSession(sessionToken: string, durationSeconds: number): Promise<void> {
    return this.request<void>('POST', '/v1/sessions/end', {
      session_token: sessionToken,
      duration_seconds: durationSeconds,
    });
  }

  /** Get current credit balance and per-minute rate. */
  getBalance(): Promise<CreditBalance> {
    return this.request<CreditBalance>('GET', '/v1/credits/balance');
  }

  /** Get provider key configuration for this account. */
  getProviderKeys(): Promise<ProviderKeys> {
    return this.request<ProviderKeys>('GET', '/v1/providers');
  }

  /** Update provider key configuration. Pass only the keys you want to change. */
  setProviderKeys(keys: Partial<ProviderKeys>): Promise<ProviderKeys> {
    return this.request<ProviderKeys>('PATCH', '/v1/providers', keys);
  }
}
