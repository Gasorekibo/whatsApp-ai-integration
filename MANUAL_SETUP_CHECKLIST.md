# MANUAL SETUP GUIDE - Async Refactoring Implementation

## ⚠️ READ THIS FIRST

This guide tells you EXACTLY what YOU NEED TO DO MANUALLY. Everything is marked as either:
- **🟢 MANUAL** = You must do this step
- **🔵 AUTOMATIC** = Already created, just copy the file
- **📝 EDIT FILE** = Open and modify an existing file

---

# PHASE 1: PREREQUISITES & DOWNLOADS

## Step 1.1: Download & Install Redis

### 🟢 MANUAL - Choose Your Option:

**Option A: Docker (Easiest - No Installation)**
```bash
# Just need Docker installed
docker run -d -p 6379:6379 --name redis redis:7-alpine
```

**Option B: Windows Local Install**
1. Go to: https://github.com/microsoftarchive/redis/releases
2. Download: `Redis-x64-7.x.msi` (latest version)
3. Run installer with default settings
4. Redis will start on `localhost:6379`

**Option C: macOS**
```bash
brew install redis
brew services start redis
```

**Option D: Linux (Ubuntu/Debian)**
```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis-server
```

### ✅ Verify Redis is Running:
```bash
redis-cli ping
# Should return: PONG
```

---

## Step 1.2: Install Node Packages

### 🟢 MANUAL

```bash
cd c:\Users\gasor\OneDrive\Desktop\Moyo-tech\Nodejs\whatsapp-ai

npm install redis bullmq
```

### Expected output:
```
+ redis@4.x.x
+ bullmq@5.x.x
added X packages in Xs
```

---

# PHASE 2: COPY NEW FILES (Automatic Files)

## Step 2.1: Copy Infrastructure Files

### 🔵 AUTOMATIC - Files Already Created

Copy these 11 files from the chat (they were created for you):

**Directory: `src/config/`**
```
✓ redis.config.js          (already created)
✓ async-infrastructure.js  (already created)
```

**Directory: `src/queues/`**
```
✓ bullmq.config.js         (already created)
```

**Directory: `src/workers/`**
```
✓ chat-message.worker.js   (already created)
✓ whatsapp-sender.worker.js (already created)
✓ manager.js               (already created)
✓ worker-process.js        (already created)
```

**Directory: `src/services/`**
```
✓ queue-monitor.service.js (already created)
```

**Directory: `src/controllers/`**
```
✓ whatsappControllerAsync.js (already created)
```

**Directory: `src/utils/`**
```
✓ global-rate-limiter.js   (already created)
✓ gemini-retry-handler.js  (already created)
```

**Root Directory:**
```
✓ ASYNC_REFACTORING_GUIDE.md (already created)
✓ ASYNC_REFACTORING_SUMMARY.md (already created)
✓ INTEGRATION_CHANGES.md   (already created)
✓ docker-compose-async.yml (already created)
```

### 🟢 MANUAL - Create Directories if Missing:

```bash
cd src
mkdir -p config queues workers services controllers utils
cd ..
```

---

# PHASE 3: UPDATE EXISTING FILES (Manual Edits)

## Step 3.1: Update `.env` File

### 🟢 MANUAL - Edit Your `.env` File

**Location:** `c:\Users\gasor\OneDrive\Desktop\Moyo-tech\Nodejs\whatsapp-ai\.env`

**ADD these lines to the END of your `.env`:**

```bash
# ===== REDIS CONFIGURATION =====
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# ===== GEMINI RATE LIMITING (CRITICAL FOR PRODUCTION) =====
GEMINI_MAX_RPS=3
GEMINI_MAX_BURST=5
GEMINI_BASE_DELAY=1000
GEMINI_MAX_DELAY=30000
GEMINI_MAX_RETRIES=5

# ===== WORKER CONFIGURATION =====
CHAT_WORKER_CONCURRENCY=5
WHATSAPP_WORKER_CONCURRENCY=10

# ===== QUEUE MONITORING =====
QUEUE_MONITOR_INTERVAL=30000
```

### ⚠️ Important Notes:

- **Keep all existing variables** (DATABASE_URL, GEMINI_API_KEY, etc.)
- **Don't remove anything** - just ADD the above lines
- **Use localhost** for local development (change in production)

### ✅ Verify `.env` looks like:

```
# ... existing variables ...
DATABASE_URL=postgresql://...
GEMINI_API_KEY=AIza...
COMPANY_NAME=...

# ... NEW variables added below ...
REDIS_HOST=localhost
REDIS_PORT=6379
# ... etc
```

---

## Step 3.2: Update Main Entry File

### 📝 EDIT FILE: `src/index.js` (or `app.js`)

**Find your current entry point** and REPLACE the entire file:

**BEFORE (Current code):**
```javascript
import app from './app.js';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

**AFTER (New code):**
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

### ⚠️ Save the file!

---

## Step 3.3: Update Webhook Routes

### 📝 EDIT FILE: Your Routes File

**Find where the webhook is defined:**

Usually in `src/routes/webhook.js` or directly in `src/app.js`

**BEFORE (Current):**
```javascript
import { handleWebhook } from '../controllers/whatsappController.js';

router.post('/webhook', handleWebhook);
```

**AFTER (New):**
```javascript
import { handleWebhookAsync } from '../controllers/whatsappControllerAsync.js';
import { getSystemHealth } from '../config/async-infrastructure.js';

// Main webhook endpoint (async/queued version)
router.post('/webhook', handleWebhookAsync);

// Health check endpoint (ADD THIS)
router.get('/health', async (req, res) => {
  const health = await getSystemHealth();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

### ⚠️ Save the file!

---

## Step 3.4: Update `package.json` Scripts

### 📝 EDIT FILE: `package.json`

**Find the `"scripts"` section:**

**BEFORE (Current scripts):**
```json
{
  "scripts": {
    "start": "node src/index.js",
    "start:dev": "nodemon src/index.js"
  }
}
```

**AFTER (Add these new scripts):**
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

### ⚠️ Save the file!

---

# PHASE 4: VERIFY SETUP

## Step 4.1: Verify File Structure

### 🟢 MANUAL - Check all files exist:

```bash
cd c:\Users\gasor\OneDrive\Desktop\Moyo-tech\Nodejs\whatsapp-ai

# Check config files
dir src\config\redis.config.js
dir src\config\async-infrastructure.js

# Check queue files
dir src\queues\bullmq.config.js

# Check worker files
dir src\workers\chat-message.worker.js
dir src\workers\whatsapp-sender.worker.js
dir src\workers\manager.js
dir src\workers\worker-process.js

# Check service files
dir src\services\queue-monitor.service.js

# Check controller files
dir src\controllers\whatsappControllerAsync.js

# Check utility files
dir src\utils\global-rate-limiter.js
dir src\utils\gemini-retry-handler.js
```

**All should show "File found" in PowerShell**

---

## Step 4.2: Verify Dependencies Installed

### 🟢 MANUAL

```bash
npm list redis bullmq
```

**Should show:**
```
├── bullmq@5.x.x
└── redis@4.x.x
```

---

## Step 4.3: Verify Redis Running

### 🟢 MANUAL

```bash
redis-cli ping
```

**Should return:** `PONG`

If not:
- If using Docker: `docker ps` (should show redis container running)
- If local install: Start Redis manually

---

# PHASE 5: TEST LOCALLY

## Step 5.1: Start Your Server

### 🟢 MANUAL

```bash
npm start
```

### Expected logs (should see all this):

```
[info] === Initializing Async Infrastructure ===
[info] Step 1: Initializing Redis...
[info] Redis connected successfully
[info] Step 2: Initializing BullMQ queues...
[info] All BullMQ queues initialized successfully
[info] Step 3: Initializing global rate limiter...
[info] Global Gemini rate limiter initialized
[info] Step 4: Initializing retry handler...
[info] Gemini retry handler initialized
[info] Step 5: Starting worker processes...
[info] Chat message worker started
[info] WhatsApp sender worker started
[info] All workers started successfully
[info] Step 6: Starting queue monitoring...
[info] Queue monitor started
[info] === Async Infrastructure Initialized Successfully ===
[info] Server running on port 3000
[info] Async infrastructure ready for incoming messages
```

### ⚠️ If you see errors:
1. Check `.env` has REDIS_HOST and REDIS_PORT
2. Check Redis is running (`redis-cli ping`)
3. Check all files exist (Step 4.1)
4. Check npm packages installed (Step 4.2)

---

## Step 5.2: Check Health Endpoint

### 🟢 MANUAL - In a NEW terminal:

```bash
curl http://localhost:3000/health
```

**Should return something like:**
```json
{
  "status": "healthy",
  "timestamp": "2026-04-28T12:00:00Z",
  "workers": {
    "chatWorker": {
      "active": 0,
      "waiting": 0,
      "completed": 0,
      "failed": 0
    },
    "whatsappWorker": {
      "active": 0,
      "waiting": 0,
      "completed": 0,
      "failed": 0
    }
  },
  "infrastructure": {
    "redis": "connected",
    "queues": "operational",
    "rateLimiter": "active"
  }
}
```

---

## Step 5.3: Send Test Message

### 🟢 MANUAL - Test via WhatsApp:

1. Open WhatsApp on your phone
2. Send a message to your WhatsApp Business number
3. Go back to terminal where server is running
4. **Look for these logs:**

```
[info] Queuing WhatsApp message
[info] Chat processing job queued { jobId: "...", phoneNumber: "***9698" }
[info] Chat job completed { jobId: "...", duration: "1234ms" }
[info] WhatsApp message sent { phoneNumber: "***9698" }
```

### If message not received:
1. Check logs for errors
2. Check Redis connection: `redis-cli KEYS *`
3. Check queue status: `redis-cli XLEN chat-processing-queue`

---

# PHASE 6: CONFIGURATION TUNING

## Step 6.1: Understand Configuration Values

### 📝 EDIT FILE: `.env`

**What each setting does:**

```bash
# Redis connection
REDIS_HOST=localhost          # Where Redis is running (localhost for dev)
REDIS_PORT=6379              # Default Redis port (don't change)
REDIS_PASSWORD=              # Leave blank for local dev

# Gemini Rate Limiting
GEMINI_MAX_RPS=3              # Max 3 API calls per second (GLOBAL)
                              # Prevents Gemini 503 errors
                              # Production: Can be 5-10 depending on API key

GEMINI_MAX_BURST=5            # Allow burst of 5 calls
                              # For handling traffic spikes
                              # Production: Can be 10-20

GEMINI_BASE_DELAY=1000        # Start retry at 1 second delay
GEMINI_MAX_DELAY=30000        # Cap retry at 30 seconds
GEMINI_MAX_RETRIES=5          # Retry failed calls 5 times

# Workers
CHAT_WORKER_CONCURRENCY=5     # Max 5 messages processing simultaneously
                              # Increase for more throughput
                              # Decrease if server is slow

WHATSAPP_WORKER_CONCURRENCY=10 # Max 10 messages being sent simultaneously
                               # Can be higher than chat workers

# Monitoring
QUEUE_MONITOR_INTERVAL=30000  # Check queue health every 30 seconds
```

---

## Step 6.2: Adjust for Your Load

### For **Small Test (1-5 users):**
```bash
GEMINI_MAX_RPS=2
GEMINI_MAX_BURST=3
CHAT_WORKER_CONCURRENCY=3
WHATSAPP_WORKER_CONCURRENCY=5
```

### For **Medium Load (10-50 users):**
```bash
GEMINI_MAX_RPS=4
GEMINI_MAX_BURST=8
CHAT_WORKER_CONCURRENCY=8
WHATSAPP_WORKER_CONCURRENCY=15
```

### For **Production (100+ users):**
```bash
GEMINI_MAX_RPS=5
GEMINI_MAX_BURST=10
CHAT_WORKER_CONCURRENCY=15
WHATSAPP_WORKER_CONCURRENCY=25
QUEUE_MONITOR_INTERVAL=15000
```

---

# PHASE 7: DOCKER SETUP (Optional but Recommended)

## Step 7.1: Install Docker

### 🟢 MANUAL

**Windows:**
1. Download: https://www.docker.com/products/docker-desktop
2. Install Docker Desktop
3. Run: `docker --version` to verify

**Mac:**
```bash
brew install docker
# or download Docker Desktop
```

**Linux:**
```bash
sudo apt-get install docker.io
sudo systemctl start docker
```

---

## Step 7.2: Run Full Stack with Docker Compose

### 🟢 MANUAL

```bash
cd c:\Users\gasor\OneDrive\Desktop\Moyo-tech\Nodejs\whatsapp-ai

# Start all services (Redis, Postgres, App, Worker, Redis UI)
docker-compose -f docker-compose-async.yml up -d

# Check services running
docker-compose -f docker-compose-async.yml ps
```

### Services started:
- **Redis**: `localhost:6379` (for queues)
- **Postgres**: `localhost:5432` (for data)
- **App**: `localhost:3000` (main server)
- **Redis UI**: `localhost:8081` (visualize queues)
- **Worker 1**: Background processing

### To stop:
```bash
docker-compose -f docker-compose-async.yml down
```

---

# PHASE 8: PRODUCTION DEPLOYMENT

## Step 8.1: Before Deploying to Production

### 🟢 MANUAL Checklist:

```
[ ] All files copied and exist
[ ] .env updated with production Redis host
[ ] .env has production GEMINI_API_KEY
[ ] Local testing passed (messages send/receive)
[ ] Health endpoint returns healthy status
[ ] Queue monitor shows 0 errors
[ ] No "Gemini 503" errors in logs (or <1%)
[ ] Tested with 5-10 concurrent users
[ ] Increased worker concurrency if needed
[ ] Set REDIS_HOST to production Redis server
[ ] Set REDIS_PASSWORD if needed
```

---

## Step 8.2: Deploy Steps

### 🟢 MANUAL - Production Deployment

**1. Connect to Production Server:**
```bash
ssh your-user@your-server.com
cd /app/whatsapp-ai
```

**2. Update Environment:**
```bash
# Edit .env for production
nano .env

# Change these:
REDIS_HOST=redis.production.internal
REDIS_PASSWORD=<secure-password>
GEMINI_MAX_RPS=5  # Higher for production
NODE_ENV=production
```

**3. Install & Start:**
```bash
npm install
npm start

# In another terminal, start workers:
npm run worker -- --worker-id=1
npm run worker -- --worker-id=2
npm run worker -- --worker-id=3
```

**4. Verify:**
```bash
curl http://localhost:3000/health
```

---

# TROUBLESHOOTING CHECKLIST

## Problem: "Cannot connect to Redis"

### 🟢 MANUAL Fix:

```bash
# 1. Check Redis is running
redis-cli ping

# 2. Check your .env
grep REDIS_HOST .env
grep REDIS_PORT .env

# 3. If using Docker:
docker ps | grep redis

# 4. Try connecting directly:
redis-cli -h localhost -p 6379 ping
```

---

## Problem: "Workers not starting"

### 🟢 MANUAL Fix:

```bash
# 1. Check logs for errors
npm start

# 2. Check all files exist:
ls src/workers/chat-message.worker.js
ls src/services/queue-monitor.service.js

# 3. Check packages installed:
npm list bullmq redis

# 4. Reinstall if needed:
npm install redis bullmq --force
```

---

## Problem: "Webhook still blocking"

### 🟢 MANUAL Fix:

```bash
# 1. Check you updated the route:
grep "whatsappControllerAsync" src/routes/*.js

# 2. Check webhook not pointing to old controller:
grep "handleWebhook[^A]" src/routes/*.js

# 3. Restart server:
npm start
```

---

## Problem: "Rate limiting too strict"

### 🟢 MANUAL Fix:

Edit `.env`:
```bash
# Current (too strict)
GEMINI_MAX_RPS=3

# Try higher:
GEMINI_MAX_RPS=5
```

Then restart:
```bash
npm start
```

---

# FINAL CHECKLIST - COMPLETE MANUAL SETUP

### Required Manual Actions:

- [ ] **Downloaded & installed Redis** (Step 1.1)
- [ ] **Ran `npm install redis bullmq`** (Step 1.2)
- [ ] **Added environment variables to `.env`** (Step 3.1)
- [ ] **Updated `src/index.js` entry point** (Step 3.2)
- [ ] **Updated webhook route to async controller** (Step 3.3)
- [ ] **Updated `package.json` scripts** (Step 3.4)
- [ ] **Verified all files exist** (Step 4.1)
- [ ] **Verified Redis running** (Step 4.3)
- [ ] **Started server with `npm start`** (Step 5.1)
- [ ] **Health endpoint returns 200** (Step 5.2)
- [ ] **Test message sent and received** (Step 5.3)

### Files Created Automatically (Just Copy):

- ✅ 11 infrastructure/worker/utility files
- ✅ 4 documentation files
- ✅ Docker Compose file

### Files You Must Edit:

- ✅ `.env` - Add Redis & Gemini config
- ✅ `src/index.js` - Update entry point
- ✅ Routes file - Change webhook controller
- ✅ `package.json` - Add npm scripts

---

**Once you complete all "🟢 MANUAL" steps, your async system is ready!**

Start with **Phase 1** and work through each phase in order.

Need help on any step? Let me know which step you're on.
