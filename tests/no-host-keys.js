// Tests must not pick up real credentials from the environment they run in
// (a cloud session or a shell with keys set): config.js reads process.env
// before the .env file, so every test config blanks them explicitly.
export const NO_HOST_KEYS = Object.freeze({
  ALPACA_API_KEY_ID: '', ALPACA_API_SECRET_KEY: '', LAB_HISTORY_SOURCE: '',
  TWELVEDATA_API_KEY: '', FINNHUB_API_KEY: '', ANTHROPIC_API_KEY: '',
});
