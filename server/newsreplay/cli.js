// The news-replay commands behind scripts/newsreplay.mjs (everything but the download). Simulation only.
import { createNewsReplay } from './campaign.js';
import { writeReport, writeReport2 } from './reportfile.js';
import { createCampaign2 } from './campaign2.js';

export async function runCommand(cmd, { has, val, out, cfg }) {
  const nr = createNewsReplay({ dataDir: cfg.dataDir });
  try {
    if (cmd === 'check') {
      const g = nr.gateStatus();
      for (const c of g.conditions) out(`${c.ok ? 'OK  ' : 'NO  '} ${c.name}: ${c.detail}`);
      out(g.ok ? 'The gate is open.' : 'The gate is closed.');
      process.exitCode = g.ok ? 0 : 2;
    } else if (cmd === 'inventory') {
      const t = Date.now();
      const c = nr.counts();
      const m = nr.manifest();
      out(`assembled and counted in ${((Date.now() - t) / 1000).toFixed(1)} s; manifest ${m.hash}`);
      process.stdout.write(`${nr.countsMarkdown(c)}\n`);
      process.stdout.write(`${JSON.stringify({ bars: m.bars, news: m.news, filings: m.filings, fomc: m.fomc })}\n`);
      if (has('--record')) { const r = nr.recordCounts(); out(`appended log entry ${r.number}`); }
    } else if (cmd === 'freeze') {
      if (!has('--record')) { out('add --record'); process.exitCode = 2; return; }
      const r = nr.freeze(); out(`appended log entry ${r.number}`); process.stdout.write(`${r.text}\n`);
    } else if (cmd === 'run') {
      if (!has('--confirm')) { out('add --confirm: this runs the deterministic and price-only arms (or one phase with --phase A or --phase B1), the evaluation pass and, once every base run exists, the placebo'); process.exitCode = 2; return; }
      const phase = val('--phase');
      const r = nr.runAll({ log: out, phase });
      out(`runs ${r.runs}; placebo comparisons ${r.placebo.length}; execution ${(r.elapsedMs / 60000).toFixed(1)} min`);
      const file = writeReport(nr);
      out(`report ${file}`);
    } else if (cmd === 'ai-estimate') {
      const e = nr.aiEstimate();
      process.stdout.write(`${JSON.stringify(e, null, 1)}\n`);
    } else if (cmd === 'status') {
      const s = nr.status();
      for (const r of s.runs) out(`run ${r.id} ${r.configId} ${r.variant}: ${r.status}${r.net != null ? ` net ${r.net}, T ${r.T}, trades ${r.trades}` : ''}${r.error ? ` (${r.error})` : ''}`);
      for (const [k, v] of Object.entries(s.holm)) out(`${k}: ${v.status}; statistic ${v.statistic}; p ${v.p}; Holm ${v.holmP}`);
    } else if (cmd === 'report') {
      out(`written ${writeReport(nr)}`);
    } else if (cmd === 'check2') {
      const g = createCampaign2(nr).gateStatus();
      for (const c of g.conditions) out(`${c.ok ? 'OK  ' : 'NO  '} ${c.name}: ${c.detail}`);
      out(g.ok ? 'The campaign 2 gate is open.' : 'The campaign 2 gate is closed.');
      process.exitCode = g.ok ? 0 : 2;
    } else if (cmd === 'freeze2') {
      if (!has('--record')) { out('add --record'); process.exitCode = 2; return; }
      const r = createCampaign2(nr).freeze(); out(`appended log entry ${r.number}`); process.stdout.write(`${r.text}
`);
    } else if (cmd === 'run2') {
      if (!has('--confirm')) { out('add --confirm: this runs X1 (which must reproduce D-C), X2 to X4 with their sensitivities, then the placebo'); process.exitCode = 2; return; }
      const c2 = createCampaign2(nr);
      try { const r = c2.runAll({ log: out }); out(`campaign 2 runs ${r.runs}; placebo comparisons ${r.placebo.length}; execution ${(r.elapsedMs / 60000).toFixed(1)} min`); }
      finally { out(`report ${writeReport2(nr, c2)}`); }
    } else if (cmd === 'report2') {
      out(`written ${writeReport2(nr, createCampaign2(nr))}`);
    } else { out(`unknown command ${cmd}`); process.exitCode = 2; }
  } finally { nr.close(); }
}
