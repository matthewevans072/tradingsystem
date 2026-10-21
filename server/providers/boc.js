// Bank of Canada Valet API: official daily USD/CAD rate (free, no key).
// The rate is published once per business day (around 16:30 ET), so it is a
// dated reference rate, not a live quote, and the UI labels it that way.
import { getJson, ProviderError } from './http.js';

export function createBankOfCanada({ fetchImpl } = {}) {
  // Every observation in the response (the last 5 business days), oldest
  // first, so a refresh after a gap also stores the days in between.
  async function recent() {
    const d = await getJson('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=5', { fetchImpl, label: 'Bank of Canada' });
    const obs = (d.observations || []).filter((o) => o.FXUSDCAD?.v).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    if (!obs.length) throw new ProviderError('bad_response', 'Bank of Canada returned no USD/CAD observations');
    return obs.map((o) => {
      const rate = Number(o.FXUSDCAD.v);
      if (!(rate > 0.5 && rate < 3)) throw new ProviderError('bad_response', `Implausible USD/CAD rate ${o.FXUSDCAD.v}`);
      return { pair: 'USDCAD', rate, as_of: o.d, source: 'Bank of Canada daily rate' };
    });
  }
  return {
    id: 'boc',
    name: 'Bank of Canada',
    getUsdCadRecent: recent,
    async getUsdCad() {
      return (await recent()).at(-1);
    },
  };
}
