// HTTP helper shared by provider adapters: timeouts, error classification and
// a per-provider rate limiter. Errors never include request URLs, because
// provider URLs can carry API keys.

export class ProviderError extends Error {
  constructor(kind, message, { status, retryAfterSec } = {}) {
    super(message);
    this.kind = kind; // auth | rate_limit | not_found | bad_response | network | server | not_supported
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export class RateLimiter {
  constructor({ perMinute, perDay }) {
    this.perMinute = perMinute;
    this.perDay = perDay;
    this.minute = [];
    this.dayKey = '';
    this.dayCount = 0;
    this.blockedUntil = 0;
  }
  // cost = number of credits the call consumes (Twelve Data counts per symbol)
  async take(cost = 1, { wait = true } = {}) {
    const now = Date.now();
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.dayKey) { this.dayKey = day; this.dayCount = 0; }
    if (this.perDay && this.dayCount + cost > this.perDay) {
      throw new ProviderError('rate_limit', `Daily request allowance (${this.perDay}) used up; data will resume tomorrow`);
    }
    if (now < this.blockedUntil) {
      if (!wait) throw new ProviderError('rate_limit', 'Provider asked us to slow down');
      await sleep(this.blockedUntil - now);
    }
    if (this.perMinute) {
      this.minute = this.minute.filter((t) => now - t.at < 60000);
      let used = this.minute.reduce((s, t) => s + t.cost, 0);
      if (cost > this.perMinute) throw new ProviderError('rate_limit', `Request needs ${cost} credits; plan allows ${this.perMinute}/minute`);
      while (used + cost > this.perMinute) {
        if (!wait) throw new ProviderError('rate_limit', 'Per-minute allowance reached');
        const waitMs = 60000 - (Date.now() - this.minute[0].at) + 50;
        await sleep(waitMs);
        this.minute = this.minute.filter((t) => Date.now() - t.at < 60000);
        used = this.minute.reduce((s, t) => s + t.cost, 0);
      }
    }
    this.minute.push({ at: Date.now(), cost });
    this.dayCount += cost;
  }
  backoff(seconds) {
    this.blockedUntil = Date.now() + seconds * 1000;
  }
  usage() {
    return { today: this.dayCount, perDay: this.perDay, perMinute: this.perMinute };
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getJson(url, { headers = {}, timeoutMs = 15000, fetchImpl = globalThis.fetch, label = 'provider' } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw new ProviderError('network', `${label}: ${timeout ? 'request timed out' : 'could not connect'} (${e?.cause?.code || e?.name || 'error'})`);
  }
  const retryAfter = Number(res.headers?.get?.('retry-after')) || undefined;
  if (res.status === 401 || res.status === 403) throw new ProviderError('auth', `${label}: access denied (HTTP ${res.status}). Check the API key or plan.`, { status: res.status });
  if (res.status === 429) throw new ProviderError('rate_limit', `${label}: rate limit reached`, { status: 429, retryAfterSec: retryAfter || 60 });
  if (res.status === 404) throw new ProviderError('not_found', `${label}: not found (HTTP 404)`, { status: 404 });
  if (res.status >= 500) throw new ProviderError('server', `${label}: provider error (HTTP ${res.status})`, { status: res.status });
  if (!res.ok) throw new ProviderError('bad_response', `${label}: unexpected HTTP ${res.status}`, { status: res.status });
  try {
    return await res.json();
  } catch {
    throw new ProviderError('bad_response', `${label}: response was not valid JSON`);
  }
}

export function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
