// Bank of Canada Valet API: official daily USD/CAD rate (free, no key).
// The rate is published once per business day (around 16:30 ET), so it is a
// dated reference rate, not a live quote, and the UI labels it that way.
import { getJson, ProviderError } from './http.js';

export function createBankOfCanada({ fetchImpl } = {}) {
  return {
    id: 'boc',
    name: 'Bank of Canada',
    async getUsdCad() {
      const d = await getJson('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=5', { fetchImpl, label: 'Bank of Canada' });
      const obs = (d.observations || []).filter((o) => o.FXUSDCAD?.v);
      if (!obs.length) throw new ProviderError('bad_response', 'Bank of Canada returned no USD/CAD observations');
      const last = obs[obs.length - 1];
      const rate = Number(last.FXUSDCAD.v);
      if (!(rate > 0.5 && rate < 3)) throw new ProviderError('bad_response', `Implausible USD/CAD rate ${last.FXUSDCAD.v}`);
      return { pair: 'USDCAD', rate, as_of: last.d, source: 'Bank of Canada daily rate' };
    },
  };
}
