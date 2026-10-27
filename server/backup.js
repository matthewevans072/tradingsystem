// Backup & restore. Backups are consistent SQLite snapshots (VACUUM INTO) in
// data/backups. Restoring first takes a safety backup of the current state.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, nowIso } from './db.js';
import { createCatalog } from './catalog.js';
import { log } from './log.js';
import { labDbFile, backupLabDb } from './strategy/store.js';
import { hxrDbFile, guardHxrFile } from './hxr/store.js';
import { rtDbFile, guardRtFile } from './rangetrend/store.js';

const KEEP_AUTO = 30;

export function backupDir(cfg) {
  const d = path.join(cfg.dataDir, 'backups');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export function createBackup(ctx, { reason = 'manual' } = {}) {
  const dir = backupDir(ctx.cfg);
  const st = stamp();
  const name = `signal-desk-${ctx.mode}-${st}-${reason}.sqlite`;
  const file = path.join(dir, name);
  ctx.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  log.info('backup', `created ${name}`);
  pruneAuto(ctx.cfg, ctx.mode);
  const lab = backupLab(ctx, st, reason);
  const hxr = backupHxr(ctx, st, reason);
  const rangeTrend = backupRangeTrend(ctx, st, reason);
  return { name, size: fs.statSync(file).size, createdAt: nowIso(), ...(lab ? { lab } : {}), ...(hxr ? { hxr } : {}), ...(rangeTrend ? { rangeTrend } : {}) };
}

// The Strategy Lab database is copied into its own folder (backups/strategy-lab),
// so the portfolio backup list, pruning and restore never see it. A failure
// here never fails the portfolio backup.
export function labBackupDir(cfg) {
  return path.join(backupDir(cfg), 'strategy-lab');
}

function backupLab(ctx, st, reason) {
  const src = labDbFile(ctx.cfg, ctx.mode);
  if (!fs.existsSync(src)) return null;
  try {
    const dir = labBackupDir(ctx.cfg);
    fs.mkdirSync(dir, { recursive: true });
    const name = `strategy-lab-${ctx.mode}-${st}-${reason}.sqlite`;
    backupLabDb(src, path.join(dir, name));
    const auto = fs.readdirSync(dir).filter((f) => f.startsWith(`strategy-lab-${ctx.mode}-`) && f.endsWith('-auto.sqlite')).sort().reverse();
    for (const f of auto.slice(KEEP_AUTO)) fs.rmSync(path.join(dir, f), { force: true });
    log.info('backup', `created ${name}`);
    return { name, size: fs.statSync(path.join(dir, name)).size };
  } catch (e) {
    log.warn('backup', `Strategy Lab backup failed: ${e.message}`);
    return { error: e.message };
  }
}

// The HXR simulation database (real workspace only) goes into backups/hxr the
// same way: never listed for restore, and a failure never fails the portfolio backup.
export function hxrBackupDir(cfg) {
  return path.join(backupDir(cfg), 'hxr');
}

function backupHxr(ctx, st, reason) {
  if (ctx.mode !== 'real') return null;
  const src = hxrDbFile(ctx.cfg);
  if (!fs.existsSync(src)) return null;
  try {
    const dir = hxrBackupDir(ctx.cfg);
    fs.mkdirSync(dir, { recursive: true });
    const name = `hxr-sim-${st}-${reason}.sqlite`;
    const dest = path.join(dir, name);
    const db = new DatabaseSync(guardHxrFile(src), { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout = 5000;');
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
    const auto = fs.readdirSync(dir).filter((f) => f.startsWith('hxr-sim-') && f.endsWith('-auto.sqlite')).sort().reverse();
    for (const f of auto.slice(KEEP_AUTO)) fs.rmSync(path.join(dir, f), { force: true });
    log.info('backup', `created ${name}`);
    return { name, size: fs.statSync(dest).size };
  } catch (e) {
    log.warn('backup', `HXR backup failed: ${e.message}`);
    return { error: e.message };
  }
}

// The range-trend results database goes into backups/range-trend the same way: a consistent copy taken
// from a read-only handle, never listed for restore, and a failure never fails the portfolio backup.
export function rangeTrendBackupDir(cfg) {
  return path.join(backupDir(cfg), 'range-trend');
}

function backupRangeTrend(ctx, st, reason) {
  if (ctx.mode !== 'real') return null;
  const src = rtDbFile(ctx.cfg.dataDir);
  if (!fs.existsSync(src)) return null;
  try {
    const dir = rangeTrendBackupDir(ctx.cfg);
    fs.mkdirSync(dir, { recursive: true });
    const name = `range-trend-sim-${st}-${reason}.sqlite`;
    const dest = path.join(dir, name);
    const db = new DatabaseSync(guardRtFile(src), { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout = 5000;');
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
    const auto = fs.readdirSync(dir).filter((f) => f.startsWith('range-trend-sim-') && f.endsWith('-auto.sqlite')).sort().reverse();
    for (const f of auto.slice(KEEP_AUTO)) fs.rmSync(path.join(dir, f), { force: true });
    log.info('backup', `created ${name}`);
    return { name, size: fs.statSync(dest).size };
  } catch (e) {
    log.warn('backup', `Range-trend backup failed: ${e.message}`);
    return { error: e.message };
  }
}

function pruneAuto(cfg, mode) {
  const auto = listBackups(cfg).filter((b) => b.name.includes(`-${mode}-`) && b.name.endsWith('-auto.sqlite'));
  for (const b of auto.slice(KEEP_AUTO)) fs.rmSync(path.join(backupDir(cfg), b.name), { force: true });
}

export function listBackups(cfg) {
  const dir = backupDir(cfg);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite'))
    .map((f) => { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, createdAt: st.mtime.toISOString() }; })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function safeBackupPath(cfg, name) {
  if (!/^[\w.-]+\.sqlite$/.test(name)) throw new Error('Invalid backup name');
  const p = path.join(backupDir(cfg), name);
  if (!fs.existsSync(p)) throw new Error('Backup not found');
  return p;
}

export function validateBackupFile(file) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    for (const t of ['transactions', 'instruments', 'accounts', 'briefings', 'schema_version']) {
      if (!tables.has(t)) throw new Error(`Not a Signal Desk backup (missing ${t} table)`);
    }
    const n = db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(integrity)[0] !== 'ok') throw new Error('Backup failed the SQLite integrity check');
    return { transactions: n };
  } finally {
    db?.close();
  }
}

// Replace the live database with a backup file. The context object is updated
// in place so the scheduler keeps working against the restored data.
export function restoreBackup(ctx, sourceFile, liveFile) {
  const info = validateBackupFile(sourceFile);
  const safety = createBackup(ctx, { reason: 'pre-restore' });
  ctx.db.close();
  for (const ext of ['-wal', '-shm']) fs.rmSync(liveFile + ext, { force: true });
  fs.copyFileSync(sourceFile, liveFile);
  ctx.db = openDb(liveFile);
  ctx.catalog = createCatalog(ctx.db);
  ctx.rebuildProviders?.();
  log.info('backup', `restored from ${path.basename(sourceFile)} (${info.transactions} transactions); safety copy ${safety.name}`);
  return { restored: path.basename(sourceFile), safetyBackup: safety.name, ...info };
}

export function autoBackupIfDue(ctx) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const has = listBackups(ctx.cfg).some((b) => b.name.includes(`-${ctx.mode}-${today}`) && b.name.endsWith('-auto.sqlite'));
  if (!has && ctx.db.prepare('SELECT COUNT(*) n FROM transactions').get().n > 0) return createBackup(ctx, { reason: 'auto' });
  return null;
}
