// Loads configuration from environment and the local .env file.
// Secrets live only on the server; nothing here is ever sent to the browser
// except the boolean "configured" status produced by publicConfigStatus().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(' #');
      if (hash >= 0) val = val.slice(0, hash).trim();
    }
    out[key] = val;
  }
  return out;
}

export function loadConfig(overrides = {}) {
  const envFile = overrides.ENV_FILE || path.join(ROOT, '.env');
  let fileVars = {};
  if (fs.existsSync(envFile)) fileVars = parseEnv(fs.readFileSync(envFile, 'utf8'));
  const get = (k, d = '') => (overrides[k] ?? process.env[k] ?? fileVars[k] ?? d);

  const cfg = {
    host: get('SIGNAL_DESK_HOST', '127.0.0.1'),
    port: Number(get('SIGNAL_DESK_PORT', '4317')),
    dataDir: path.resolve(ROOT, get('SIGNAL_DESK_DATA_DIR', 'data')),
    // Remote exposure requires an access token; see START-HERE.md.
    accessToken: get('SIGNAL_DESK_ACCESS_TOKEN', ''),
    allowRemote: get('SIGNAL_DESK_ALLOW_REMOTE', 'false') === 'true',
    schedulerEnabled: get('SIGNAL_DESK_SCHEDULER', 'true') !== 'false',
    marketProvider: get('MARKET_DATA_PROVIDER', 'none'),
    newsProvider: get('NEWS_PROVIDER', 'none'),
    secrets: {
      TWELVEDATA_API_KEY: get('TWELVEDATA_API_KEY'),
      FINNHUB_API_KEY: get('FINNHUB_API_KEY'),
      ANTHROPIC_API_KEY: get('ANTHROPIC_API_KEY'),
      SMTP_PASSWORD: get('SMTP_PASSWORD'),
      NTFY_TOKEN: get('NTFY_TOKEN'),
    },
    secContactEmail: get('SEC_CONTACT_EMAIL'),
    anthropicModel: get('ANTHROPIC_MODEL', 'claude-opus-5-5'),
    smtp: {
      host: get('SMTP_HOST'),
      port: Number(get('SMTP_PORT', '465')),
      user: get('SMTP_USER'),
      from: get('SMTP_FROM'),
      to: get('SMTP_TO'),
    },
    ntfy: {
      url: get('NTFY_URL'),
    },
  };
  return cfg;
}

// Values that must never appear in logs, API responses or error messages.
export function secretValues(cfg) {
  return Object.values(cfg.secrets).filter((v) => v && v.length >= 4);
}

export function redact(text, cfg) {
  if (text == null) return text;
  let s = String(text);
  for (const v of secretValues(cfg)) s = s.split(v).join('[REDACTED]');
  // Belt-and-braces: mask common key-bearing query parameters.
  s = s.replace(/([?&](?:apikey|api_key|token|key)=)[^&\s"']+/gi, '$1[REDACTED]');
  return s;
}

export function publicConfigStatus(cfg) {
  return {
    host: cfg.host,
    port: cfg.port,
    localOnly: ['127.0.0.1', '::1', 'localhost'].includes(cfg.host),
    scheduler: cfg.schedulerEnabled,
    marketProvider: cfg.marketProvider,
    newsProvider: cfg.newsProvider,
    configured: {
      twelvedata: !!cfg.secrets.TWELVEDATA_API_KEY,
      finnhub: !!cfg.secrets.FINNHUB_API_KEY,
      anthropic: !!cfg.secrets.ANTHROPIC_API_KEY,
      secEdgar: !!cfg.secContactEmail,
      email: !!(cfg.smtp.host && cfg.smtp.user && cfg.secrets.SMTP_PASSWORD && cfg.smtp.to),
      ntfy: !!cfg.ntfy.url,
    },
  };
}
