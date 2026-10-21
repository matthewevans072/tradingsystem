// Generate a briefing for the real workspace now and deliver it to the
// configured channels. Used for the end-to-end check after setup:
//   npm run briefing -- premarket
// It does not occupy the scheduled slot for today.
import { loadConfig } from '../server/config.js';
import { initLog } from '../server/log.js';
import { createContext } from '../server/context.js';
import { produceBriefing, KINDS } from '../server/briefings.js';
import { todayIn, NY } from '../server/time.js';

const kind = process.argv[2] && KINDS[process.argv[2]] ? process.argv[2] : 'manual';
const cfg = loadConfig();
initLog(cfg);
const ctx = createContext(cfg, 'real');
const r = await produceBriefing(ctx, { kind, tradingDate: todayIn(NY), deliverIt: true });
const row = ctx.db.prepare('SELECT title, status, text FROM briefings WHERE id = ?').get(r.id);
console.log(`\n${row.title}: ${row.status}`);
for (const d of r.delivery || []) console.log(`  delivery ${d.channel}: ${d.status}${d.error ? ' — ' + d.error : ''}`);
if (r.error) console.log(`  error: ${r.error}`);
console.log('\n' + (row.text || '').slice(0, 3000));
ctx.db.close();
