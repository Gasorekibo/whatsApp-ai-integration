# Integration Changes to Existing Files

This document shows the EXACT changes needed to existing files to integrate the async refactoring.

---

## 1. `package.json` - Add Dependencies

### ADD these to `dependencies`:

```json
{
  "dependencies": {
    "redis": "^4.6.0",
    "bullmq": "^5.0.0"
  }
}
```

### ADD these npm scripts to `scripts`:

```json
{
  "scripts": {
    "start": "node src/index.js",
    "start:dev": "nodemon src/index.js",
    "worker": "node src/workers/worker-process.js",
    "worker:multi": "npm run worker -- --worker-id=1 & npm run worker -- --worker-id=2 & npm run worker -- --worker-id=3",
    "health": "curl http://localhost:3000/health | jq"
  }
}
```

---

## 2. `src/index.js` (or `app.js` - your entry point)

### CURRENT CODE:

```javascript
import app from './app.js';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### CHANGE TO:

```javascript
import dotenv from 'dotenv';
import app from './app.js';
import { 
  initializeAsyncInfrastructure, 
  shutdownAsyncInfrastructure 
} from './config/async-infrastructure.js';
import logger from './logger/logger.js';

dotenv.config();

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // Initialize async infrastructure BEFORE starting server
    await initializeAsyncInfrastructure();

    const server = app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info('Async infrastructure ready for incoming messages');
    });

    // Graceful shutdown on SIGTERM/SIGINT
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received - shutting down gracefully');
      server.close(async () => {
        await shutdownAsyncInfrastructure();
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received - shutting down gracefully');
      server.close(async () => {
        await shutdownAsyncInfrastructure();
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

start();
```

---

## 3. Routes File (likely `src/routes/webhook.js` or in `app.js`)

### CURRENT CODE:

```javascript
import { handleWebhook } from '../controllers/whatsappController.js';

router.post('/webhook', handleWebhook);
```

### CHANGE TO:

```javascript
import { handleWebhookAsync } from '../controllers/whatsappControllerAsync.js';
import { getSystemHealth } from '../config/async-infrastructure.js';

// Main webhook endpoint (async/queued)
router.post('/webhook', handleWebhookAsync);

// Health check endpoint
router.get('/health', async (req, res) => {
  const health = await getSystemHealth();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Optional: Stats endpoint
router.get('/api/queue-stats', async (req, res) => {
  const { getQueueMonitor } = await import('../services/queue-monitor.service.js');
  const monitor = getQueueMonitor();
  const health = await monitor.getHealth();
  res.json(health);
});
```

---

## 4. `.env` - Add Configuration

### ADD these environment variables:

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Gemini Rate Limiting (CRITICAL)
GEMINI_MAX_RPS=3                      # Max 3 requests/sec globally
GEMINI_MAX_BURST=5                    # Allow burst up to 5
GEMINI_BASE_DELAY=1000                # Start retry at 1s
GEMINI_MAX_DELAY=30000                # Cap retry at 30s
GEMINI_MAX_RETRIES=5                  # Retry up to 5 times

# Worker Configuration
CHAT_WORKER_CONCURRENCY=5             # Max 5 parallel chat workers
WHATSAPP_WORKER_CONCURRENCY=10        # Max 10 parallel sender workers

# Queue Monitoring
QUEUE_MONITOR_INTERVAL=30000          # Poll queue health every 30s

# Existing variables (keep)
DATABASE_URL=...
GEMINI_API_KEY=...
# ... etc
```

---

## 5. `src/logger/logger.js` - Optional Enhancement

If your logger doesn't have these methods, add them:

```javascript
// Add these methods to your logger singleton

logger.gemini = (level, message, data) => {
  logger[level](`[gemini] ${message}`, data);
};

logger.payment = (level, message, data) => {
  logger[level](`[payment] ${message}`, data);
};

logger.whatsapp = (level, message, data) => {
  logger[level](`[whatsapp] ${message}`, data);
};
```

---

## 6. Docker/Dockerfile - Optional Updates

### If using Docker, update your Dockerfile:

```dockerfile
# Add to existing Dockerfile

# Install Redis CLI for health checks (optional)
RUN apk add --no-cache redis

# Or for Ubuntu:
# RUN apt-get update && apt-get install -y redis-tools

# Expose port for Redis (if running Redis in same container)
# EXPOSE 6379
```

### Or use Docker Compose (provided):

```bash
docker-compose -f docker-compose-async.yml up
```

---

## 7. CI/CD Pipeline - Optional

### GitHub Actions Example

```yaml
# .github/workflows/deploy.yml

name: Deploy with Async Infrastructure

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Run tests
        run: npm test
      
      - name: Deploy
        run: |
          # Deploy main app with async infrastructure
          npm run start &
          
          # Deploy workers
          npm run worker -- --worker-id=1 &
          npm run worker -- --worker-id=2 &
```

---

## Deployment Order

### Step-by-step execution:

1. **Install dependencies**
   ```bash
   npm install redis bullmq
   ```

2. **Update `.env`** with Redis and Gemini config

3. **Update `src/index.js`** with async initialization

4. **Update webhook route** to use async controller

5. **Copy new files**:
   - `src/config/redis.config.js`
   - `src/config/async-infrastructure.js`
   - `src/queues/bullmq.config.js`
   - `src/utils/global-rate-limiter.js`
   - `src/utils/gemini-retry-handler.js`
   - `src/workers/*.js`
   - `src/services/queue-monitor.service.js`
   - `src/controllers/whatsappControllerAsync.js`

6. **Test locally**
   ```bash
   docker-compose -f docker-compose-async.yml up
   curl http://localhost:3000/health
   ```

7. **Deploy to staging** and test for 1-2 hours

8. **Deploy to production** with blue-green or canary deployment

---

## Verification Checklist

After implementation, verify:

- [ ] Server starts without errors
- [ ] `/health` endpoint returns 200 with worker stats
- [ ] Redis connection established in logs
- [ ] BullMQ queues initialized
- [ ] Workers started and waiting for jobs
- [ ] Send test WhatsApp message
- [ ] Message appears in queue
- [ ] Worker processes message (check logs)
- [ ] Response sent back to user
- [ ] No duplicate messages sent
- [ ] Queue depth visible in monitoring

---

## Rollback Plan

If issues occur:

1. **Keep old controller running** (rename routes)
2. **Switch webhook back** to old controller
3. **Stop workers** gracefully
4. **Drain queues** (let remaining jobs complete)
5. **Analyze failure** in logs
6. **Fix and retry**

---

## Performance Testing

After deployment:

```bash
# Load test with 10 concurrent users
wrk -t4 -c10 -d30s http://localhost:3000/webhook

# Monitor queue health
while true; do curl http://localhost:3000/health | jq '.workers'; sleep 5; done

# Check Redis queue size
redis-cli XLEN chat-processing-queue
```

---

**All set! Follow this guide to integrate the async refactoring into your existing application.**
