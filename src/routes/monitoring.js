import express from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { Op } from 'sequelize';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const LOGS_DIR   = path.join(__dirname, '..', 'logs');

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Map a category name to the log file prefix */
function logFilePrefix(category) {
  const map = {
    error:    'error',
    whatsapp: 'whatsapp',
    payment:  'payments',
    payments: 'payments',
    'api-calls': 'api-calls',
    combined: 'combined',
  };
  return map[category] || 'combined';
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

/** Read a log file line-by-line and return parsed JSON objects */
async function readLogFile(filePath, { level, search, limit }) {
  if (!fs.existsSync(filePath)) return [];

  const results = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (level && entry.level !== level) continue;
    if (search) {
      const hay = JSON.stringify(entry).toLowerCase();
      if (!hay.includes(search.toLowerCase())) continue;
    }
    results.push(entry);
  }

  // newest first; honour limit
  return results.reverse().slice(0, limit);
}

// ─── GET /api/outreach/monitoring/health ────────────────────────────────────

router.get('/health', async (req, res) => {
  const startTime = Date.now();

  // 1. Database connectivity
  let dbStatus = 'connected';
  let dbResponseTime = null;
  let dbError = null;
  try {
    const t0 = Date.now();
    await dbConfig.db.sequelize.authenticate();
    dbResponseTime = `${Date.now() - t0}ms`;
  } catch (err) {
    dbStatus = 'disconnected';
    dbError  = err.message;
  }

  // 2. DB stats (parallel queries, non-fatal)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [totalClients, activeSessions, pendingBookings, confirmedToday, todayMessages] =
    await Promise.allSettled([
      dbConfig.db.Client.count(),
      dbConfig.db.UserSession.count({ where: { lastAccess: { [Op.gte]: yesterday } } }),
      dbConfig.db.ServiceRequest.count({ where: { status: 'pending_payment' } }),
      dbConfig.db.ServiceRequest.count({ where: { status: 'confirmed', createdAt: { [Op.gte]: yesterday } } }),
      dbConfig.db.ProcessedMessage.count({ where: { processedAt: { [Op.gte]: yesterday } } }),
    ]).then(results => results.map(r => (r.status === 'fulfilled' ? r.value : null)));

  // 3. Recent errors from error log file
  let recentErrors = 0;
  try {
    const errorLog = path.join(LOGS_DIR, `error-${todayString()}.log`);
    if (fs.existsSync(errorLog)) {
      const content = fs.readFileSync(errorLog, 'utf8');
      recentErrors  = content.split('\n').filter(l => l.trim()).length;
    }
  } catch { /* non-fatal */ }

  // 4. Memory
  const mem = process.memoryUsage();

  const healthy = dbStatus === 'connected';

  res.status(healthy ? 200 : 503).json({
    status:   healthy ? 'healthy' : 'degraded',
    uptime:   formatUptime(process.uptime()),
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    responseTime: `${Date.now() - startTime}ms`,

    database: {
      status:       dbStatus,
      responseTime: dbResponseTime,
      error:        dbError || undefined,
    },

    memory: {
      heapUsed:  formatBytes(mem.heapUsed),
      heapTotal: formatBytes(mem.heapTotal),
      rss:       formatBytes(mem.rss),
      external:  formatBytes(mem.external),
      heapUsedBytes:  mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      usagePercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    },

    stats: {
      totalClients,
      activeSessionsLast24h: activeSessions,
      pendingBookings,
      confirmedBookingsToday: confirmedToday,
      messagesProcessedLast24h: todayMessages,
    },

    logs: {
      errorsToday: recentErrors,
      logsDirectory: LOGS_DIR,
    },

    process: {
      nodeVersion: process.version,
      pid:         process.pid,
      env:         process.env.NODE_ENV || 'development',
    },
  });
});

// ─── GET /api/outreach/monitoring/logs ──────────────────────────────────────
// Query params:
//   category  : error | whatsapp | payment | api-calls | combined  (default: combined)
//   level     : error | warn | info | debug
//   date      : YYYY-MM-DD  (default: today)
//   limit     : number  (default: 200, max: 1000)
//   search    : string  (full-text search inside log entry)
//   summary   : true    (return only level-count summary, no entries)

router.get('/logs', async (req, res) => {
  try {
    const category = (req.query.category || 'combined').toLowerCase();
    const level    = req.query.level   ? req.query.level.toLowerCase()   : null;
    const date     = req.query.date    || todayString();
    const limit    = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const search   = req.query.search  || null;
    const summary  = req.query.summary === 'true';

    const prefix   = logFilePrefix(category);
    const fileName = `${prefix}-${date}.log`;
    const filePath = path.join(LOGS_DIR, fileName);

    // List available log files for the selected category
    let availableDates = [];
    try {
      availableDates = fs.readdirSync(LOGS_DIR)
        .filter(f => f.startsWith(prefix) && f.endsWith('.log') && !f.includes('.gz'))
        .map(f => f.replace(`${prefix}-`, '').replace('.log', ''))
        .sort()
        .reverse()
        .slice(0, 30);
    } catch { /* non-fatal */ }

    if (!fs.existsSync(filePath)) {
      return res.json({
        logs:           [],
        total:          0,
        file:           fileName,
        date,
        category,
        availableDates,
        message:        `No log file found for ${date}`,
      });
    }

    const entries = await readLogFile(filePath, { level, search, limit });

    // Level summary counts (before slicing)
    const levelCounts = { error: 0, warn: 0, info: 0, debug: 0 };
    entries.forEach(e => {
      const l = (e.level || '').toLowerCase();
      if (l in levelCounts) levelCounts[l]++;
    });

    const fileStats = fs.statSync(filePath);

    if (summary) {
      return res.json({
        file:          fileName,
        date,
        category,
        fileSizeBytes: fileStats.size,
        fileSize:      formatBytes(fileStats.size),
        levelCounts,
        availableDates,
      });
    }

    res.json({
      logs:           entries,
      total:          entries.length,
      file:           fileName,
      date,
      category,
      level:          level || 'all',
      search:         search || null,
      limit,
      fileSizeBytes:  fileStats.size,
      fileSize:       formatBytes(fileStats.size),
      levelCounts,
      availableDates,
    });

  } catch (err) {
    logger.error('Monitoring logs endpoint error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/outreach/monitoring/logs/files ────────────────────────────────
// List all log files with their sizes and dates

router.get('/logs/files', (req, res) => {
  try {
    if (!fs.existsSync(LOGS_DIR)) return res.json({ files: [] });

    const files = fs.readdirSync(LOGS_DIR)
      .filter(f => f.endsWith('.log') && !f.includes('.gz'))
      .map(f => {
        const filePath = path.join(LOGS_DIR, f);
        const stat     = fs.statSync(filePath);
        const [prefix, date] = f.replace('.log', '').split(/-(\d{4}-\d{2}-\d{2})$/);
        return {
          name:     f,
          category: prefix,
          date:     date || null,
          size:     formatBytes(stat.size),
          sizeBytes: stat.size,
          modified: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json({ files, logsDirectory: LOGS_DIR });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
