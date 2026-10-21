// Create a backup of the real workspace from the command line: npm run backup
import { loadConfig } from '../server/config.js';
import { initLog } from '../server/log.js';
import { createContext } from '../server/context.js';
import { createBackup } from '../server/backup.js';

const cfg = loadConfig();
initLog(cfg);
const ctx = createContext(cfg, 'real');
const b = createBackup(ctx, { reason: 'manual' });
console.log(`Backup written: ${cfg.dataDir}/backups/${b.name} (${Math.round(b.size / 1024)} KB)`);
ctx.db.close();
