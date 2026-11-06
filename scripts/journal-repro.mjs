#!/usr/bin/env node
// The reproduction check (the owner's requirement of 2026-11-06): rr-mech-2 with no veto must reproduce rr-mech-1
// exactly on the stored development data for experiments 180 (B0), 190 (M0) and 191 (M1 n=3), to the cent.
// Read-only: the development inputs are built from data/hxr-sim.sqlite opened read-only (the research runner's own
// loader), the stored configs and figures are read from data/research-runner.sqlite opened read-only, and nothing
// is written anywhere: no campaign, no experiment, no run row. Prints the comparison and exits 0 only if every
// check holds.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig as loadAppConfig } from '../server/config.js';
import { loadDevelopmentInputs } from '../server/research/runner.js';
import { runMechanism } from '../server/research/mechanisms.js';
import { runMechanism2, withoutEngineLabels } from '../server/research/mechanisms-2.js';
import { halfSpreadFor } from '../server/hxr/config.js';
import { guardRrFile } from '../server/research/store.js';

export async function main({ log = console.log, dataDir = loadAppConfig().dataDir } = {}) {
  const rrFile = guardRrFile(path.join(dataDir, 'research-runner.sqlite'));
  const before = fs.statSync(rrFile).mtimeMs;
  const rr = new DatabaseSync(rrFile, { readOnly: true });
  const rows = [];
  let ok = true;
  try {
    const m = loadDevelopmentInputs({ dataDir, floorBps: 2 });
    log(`development inputs (read-only): ${m.inputs.sessions.length} sessions ${m.inputs.sessions[0]} to ${m.inputs.sessions.at(-1)}, data hash ${m.dataHash}, calibration hash ${m.calibrationHash}`);
    for (const id of [180, 190, 191]) {
      const r = rr.prepare('SELECT id, name, config_hash, config_json, summary_json, data_hash, calibration_hash FROM rr_experiments WHERE id = ?').get(id);
      const config = JSON.parse(r.config_json);
      const stored = JSON.parse(r.summary_json);
      const args = { config, symbols: m.inputs.symbols, sessions: m.inputs.sessions, days: m.inputs.days, halfSpreadBps: halfSpreadFor(config, m.calibrated), dataHash: m.inputs.dataHash };
      const a = runMechanism(args);
      const b = runMechanism2(args);
      const mid = m.inputs.sessions.find((d) => d >= '2019-11-01');
      const c = runMechanism2({ ...args, restoreAt: mid });
      const net = (o) => Math.round((o.equity.at(-1).equity - config.portfolio.startingCash) * 100) / 100;
      const same = JSON.stringify(withoutEngineLabels(a)) === JSON.stringify(withoutEngineLabels(b));
      const sameRestored = JSON.stringify(withoutEngineLabels(a)) === JSON.stringify(withoutEngineLabels(c));
      const row = {
        experiment: id, name: r.name, storedNet: stored.net, rrMech1Net: net(a), rrMech2Net: net(b), rrMech2RestoredNet: net(c),
        trades: [a.trades.length, b.trades.length], fills: [a.fills.length, b.fills.length], equityPoints: [a.equity.length, b.equity.length],
        identicalOutput: same, identicalAfterRestoreAt: sameRestored, restoreAt: mid,
        storedDataHash: r.data_hash === m.dataHash, storedCalibrationHash: r.calibration_hash === m.calibrationHash,
      };
      row.ok = same && sameRestored && row.storedDataHash && row.storedCalibrationHash && row.storedNet === row.rrMech1Net && row.storedNet === row.rrMech2Net && row.storedNet === row.rrMech2RestoredNet;
      ok = ok && row.ok;
      rows.push(row);
      log(`experiment ${id} ${r.name}: stored net ${stored.net.toFixed(2)}, rr-mech-1 ${row.rrMech1Net.toFixed(2)}, rr-mech-2 ${row.rrMech2Net.toFixed(2)}, rr-mech-2 restored at ${mid} ${row.rrMech2RestoredNet.toFixed(2)}; ${b.trades.length} trades, ${b.fills.length} fills, ${b.equity.length} equity points; output identical ${same}, after restore ${sameRestored}; data and calibration hashes match ${row.storedDataHash && row.storedCalibrationHash}: ${row.ok ? 'REPRODUCED' : 'NOT REPRODUCED'}`);
    }
  } finally { rr.close(); }
  const after = fs.statSync(rrFile).mtimeMs;
  log(`research-runner.sqlite modification time unchanged: ${before === after}`);
  log(ok ? 'reproduction check: every check holds' : 'reproduction check: FAILED');
  return { exitCode: ok && before === after ? 0 : 1, rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((r) => process.exit(r.exitCode));
