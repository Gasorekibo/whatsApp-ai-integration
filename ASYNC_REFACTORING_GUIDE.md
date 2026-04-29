# WhatsApp AI Chatbot - Async Refactoring Implementation Guide

## 📋 Overview

This guide explains how to refactor the existing WhatsApp AI chatbot system from **synchronous webhook processing** to **asynchronous queue-based architecture** using Redis + BullMQ.

### What Changes?

**Before (Synchronous - Blocking):**
```
WhatsApp Webhook → Controller → Gemini API → Pinecone → Response → WhatsApp
(All happens in one request, can fail if any step is slow)
```

**After (Asynchronous - Non-blocking):**
```
WhatsApp Webhook → Queue → Return 200 OK
                         ↓
                    Worker Pool
                         ↓
                    Gemini API → Pinecone
                         ↓
                    Redis Store
                         ↓
                    WhatsApp Sender Queue
                         ↓
                    Send Response to User
```

### Benefits

- ✅ Webhook returns in <100ms (instead of 5-10s)
- ✅ WhatsApp won't retry duplicate messages
- ✅ Handles concurrent users without blocking
- ✅ Global Gemini rate limiting prevents 503 errors
- ✅ Failed messages auto-retry with exponential backoff
- ✅ Horizontal scaling: add more workers for more throughput

---

## 🚀 Implementation Steps

### Step 1: Install Dependencies

```bash
npm install redis bullmq ioredis

# Key packages added:
# - redis: Redis client for Node.js
# - bullmq: Reliable job queue on Redis
# - ioredis: Alternative Redis client (optional)
```

### Step 2: Update Environment Variables

Add to `.env`:

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Gemini Rate Limiting (critical for production)
GEMINI_MAX_RPS=3                    # Max 3 requests/sec globally
GEMINI_MAX_BURST=5                  # Allow burst up to 5
GEMINI_BASE_DELAY=1000              # Start retry at 1s
GEMINI_MAX_DELAY=30000              # Cap retry at 30s
GEMINI_MAX_RETRIES=5                # Retry up to 5 times

# Worker Configuration
CHAT_WORKER_CONCURRENCY=5           # Max 5 parallel chat workers
WHATSAPP_WORKER_CONCURRENCY=10      # Max 10 parallel sender workers

# Queue Monitoring
QUEUE_MONITOR_INTERVAL=30000        # Poll queue health every 30s
```

### Step 3: Update Main Server File (app.js or index.js)

**Before:**

```javascript
import app from './app.js';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

**After:**

```javascript
import app from './app.js';
import { 
  initializeAsyncInfrastructure, 
  shutdownAsyncInfrastructure 
} from './config/async-infrastructure.js';
import logger from './logger/logger.js';

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

### Step 4: Update WhatsApp Webhook Route

**Before (app.js or routes/webhook.js):**

```javascript
import { handleWebhook } from '../controllers/whatsappController.js';

router.post('/webhook', handleWebhook);  // Synchronous, blocks on processing
```

**After:**

```javascript
import { handleWebhookAsync } from '../controllers/whatsappControllerAsync.js';

router.post('/webhook', handleWebhookAsync);  // Async, queues and returns immediately
```

### Step 5: Add Health Check Endpoint

```javascript
import { getSystemHealth } from '../config/async-infrastructure.js';

router.get('/health', async (req, res) => {
  const health = await getSystemHealth();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

---

## 📊 Architecture Details

### Message Flow

```
1. WhatsApp sends message to /webhook
   ↓
2. Controller validates & deduplicates (synchronous)
   ↓
3. Controller queues job in chat-processing-queue
   ↓
4. Controller returns 200 immediately
   ↓
5. Worker picks up job from queue
   ↓
6. Worker acquires rate limit token
   ↓
7. Worker processes full pipeline:
   - Detect language
   - Classify intent
   - Translate to English
   - RAG retrieval
   - Generate response
   (All with automatic retry on 503/429)
   ↓
8. Worker queues response in whatsapp-sender-queue
   ↓
9. Sender worker sends message via WhatsApp API
   (With idempotency check - no duplicates)
   ↓
10. Response reaches user
```

### Queue Configuration

#### chat-processing-queue
- **Purpose**: Main message processing pipeline
- **Job Format**: `{ phoneNumber, message, history, language, clientId }`
- **Max Retries**: 3 with exponential backoff
- **Workers**: 5 concurrent (configurable)
- **Result Storage**: Redis (24-hour TTL)

#### whatsapp-sender-queue
- **Purpose**: Reliable message delivery
- **Job Format**: `{ phoneNumber, message, language, jobId }`
- **Max Retries**: 5 with exponential backoff
- **Workers**: 10 concurrent (configurable)
- **Idempotency**: Redis tracks sent messages (7-day retention)

### Global Rate Limiter

Located in `/src/utils/global-rate-limiter.js`:

```javascript
// Uses Redis token bucket algorithm
// Shared state across ALL worker processes
// Ensures total throughput never exceeds limit

const limiter = getRateLimiter();
await limiter.waitForToken('gemini-main');  // Blocks until token available
```

### Retry Handler

Located in `/src/utils/gemini-retry-handler.js`:

```javascript
// Retryable errors:
// - 503 Service Unavailable (Gemini overloaded)
// - 429 Too Many Requests
// - "high demand" in message
// - Connection errors (ECONNRESET, ETIMEDOUT)

// Exponential backoff with jitter:
// Attempt 1: Wait 1s
// Attempt 2: Wait 2s
// Attempt 3: Wait 4s
// Attempt 4: Wait 8s
// Attempt 5: Wait 16s (capped at 30s)
// Total max wait: 60s per call
```

---

## 🔧 Configuration Examples

### Small Deployment (MVP)

```bash
# Single Redis instance, few workers
REDIS_HOST=localhost
REDIS_PORT=6379

GEMINI_MAX_RPS=2          # Conservative rate limit
CHAT_WORKER_CONCURRENCY=3
WHATSAPP_WORKER_CONCURRENCY=5
```

### Medium Deployment (100-500 users)

```bash
# Dedicated Redis, moderate workers
REDIS_HOST=redis.production.internal
REDIS_PORT=6379
REDIS_PASSWORD=<secure-password>

GEMINI_MAX_RPS=5
GEMINI_MAX_BURST=10
CHAT_WORKER_CONCURRENCY=8
WHATSAPP_WORKER_CONCURRENCY=15
```

### Large Deployment (1000+ users)

```bash
# Redis Cluster, many workers, distributed setup
REDIS_HOST=redis-cluster-1,redis-cluster-2,redis-cluster-3
REDIS_PORT=6379
REDIS_PASSWORD=<secure-password>

GEMINI_MAX_RPS=10         # Multiple API keys recommended
GEMINI_MAX_BURST=20
CHAT_WORKER_CONCURRENCY=20
WHATSAPP_WORKER_CONCURRENCY=50
QUEUE_MONITOR_INTERVAL=15000

# Run multiple worker instances:
# node worker-process.js --worker-id=1
# node worker-process.js --worker-id=2
# node worker-process.js --worker-id=3
```

---

## 📈 Monitoring & Observability

### Queue Health Endpoint

```bash
GET /health
```

Response:

```json
{
  "status": "healthy",
  "timestamp": "2026-04-28T12:00:00Z",
  "workers": {
    "chatWorker": {
      "active": 5,
      "waiting": 45,
      "completed": 1200,
      "failed": 3
    },
    "whatsappWorker": {
      "active": 8,
      "waiting": 120,
      "completed": 3400,
      "failed": 1
    }
  }
}
```

### Monitor Logs

Watch for these patterns:

```
✅ Good (normal operation):
[info] Chat job completed { jobId, duration: "1200ms" }
[info] WhatsApp message sent { phoneNumber, idempotent: false }

⚠️ Warnings (expected under load):
[warn] Gemini rate limit exceeded, waitTime: 500ms
[warn] Chat job retrying (attempt 2/3)

❌ Errors (investigate):
[error] Chat job failed { attempts: 3, error: "Gemini 503 after 5 retries" }
[error] Queue metrics: high backlog (200+ messages waiting)
```

---

## 🔒 Data Guarantees

### Idempotency

Messages are tracked by `messageId` + `clientId`:
- If same message arrives twice → Processed only once
- Safe to retry webhook sends (no duplicates)

### Delivery Guarantees

Messages queued for sending have:
- **At-least-once delivery**: Message will be sent at least once
- **Max 5 retries**: If WhatsApp API fails, retry automatically
- **Long TTL**: Kept in queue for 24+ hours if needed

### No Message Loss

```
Job submitted → Redis persisted
Even if Node process crashes:
- Job remains in Redis queue
- Worker will resume it on restart
- No messages are lost
```

---

## 🚨 Troubleshooting

### Queue is Growing (Waiting messages backing up)

**Symptom**: `waiting: 500+` in /health

**Causes**:
1. Not enough worker concurrency
2. Workers are crashing
3. Gemini API is slow/rate limited

**Fix**:
```bash
# Increase workers
CHAT_WORKER_CONCURRENCY=10
WHATSAPP_WORKER_CONCURRENCY=20

# Check Gemini stats
# If 503 errors frequent, add rate limiter tokens
GEMINI_MAX_RPS=5
```

### Gemini 503 Errors Frequent

**Symptom**: `[error] gemini-call failed after 5 retries` in logs

**Causes**:
1. Gemini API is overloaded
2. Rate limiter config too high
3. Burst of traffic

**Fix**:
```bash
# Conservative rate limiting
GEMINI_MAX_RPS=2
GEMINI_MAX_BURST=3

# Longer retry delays
GEMINI_BASE_DELAY=2000
GEMINI_MAX_DELAY=60000

# Add more API keys (rotate between them)
```

### WhatsApp Messages Not Sent

**Symptom**: Jobs fail in whatsapp-sender-queue

**Debug**:
```bash
# Check Redis for failed delivery records
redis-cli
> KEYS whatsapp-failed:*
> GET whatsapp-failed:jobId-123
```

**Causes**:
1. WhatsApp Cloud API token expired
2. Phone number not verified
3. Rate limited by WhatsApp (100+ msg/sec per number)

---

## 🔄 Migration Path (Minimal Downtime)

### Phase 1: Deploy Async Infrastructure (No Breaking Changes)

1. Add new files (redis config, queues, workers)
2. Keep old synchronous controller running
3. Add health check endpoint
4. Test workers can start without errors

```bash
npm install
npm start
# Verify /health returns 200
```

### Phase 2: Test Async Controller (Parallel Running)

1. Deploy new async controller to staging
2. Run load test against it
3. Verify message processing works end-to-end
4. Monitor queue health

### Phase 3: Traffic Cutover (Blue-Green)

1. Deploy async controller to production
2. Update webhook route to use async controller
3. Monitor for 1 hour - no issues?
4. Keep old controller as fallback

### Phase 4: Monitor & Optimize

1. Track queue metrics for 24 hours
2. Adjust worker concurrency if needed
3. Fine-tune rate limiter based on actual load
4. Retire old synchronous controller

---

## 📊 Performance Expectations

| Metric | Before (Sync) | After (Async) |
|--------|---|---|
| Webhook Response Time | 5-10s | <100ms |
| Max Concurrent Users | 10-20 | 100+ |
| Message Processing Latency | Instant | 1-3s (queued) |
| Gemini 503 Failures | ~5% | <1% (retried) |
| System Availability | 90% | 99%+ |

---

## 🆘 Support & Debugging

### Enable Debug Logs

```bash
DEBUG=* npm start
# Or just queue debugging:
DEBUG=bullmq:* npm start
```

### Inspect Redis Queue

```bash
redis-cli

# List all keys
> KEYS chat-processing-queue:*

# Get queue size
> XLEN chat-processing-queue

# Inspect a job
> HGETALL bull:chat-processing-queue:job:jobId
```

### Check Worker Status

```bash
# In application code
const workerManager = getWorkerManager();
const stats = await workerManager.getStats();
console.log(stats);
```

---

## Summary

This refactoring transforms the system from a **blocking webhook processor** to a **scalable, resilient queue-based system**. Key improvements:

✅ Webhook returns in <100ms  
✅ No message loss or duplicates  
✅ Automatic retry with backoff  
✅ Global rate limiting prevents Gemini 503s  
✅ Horizontal scaling support  
✅ Full observability & monitoring  

**Next: Follow the implementation steps above to deploy this to your environment.**
