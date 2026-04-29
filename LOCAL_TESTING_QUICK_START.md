# LOCAL TESTING QUICK START

## ✅ All Files Already Updated - Ready to Test

All necessary files have been edited automatically:

✅ `app.js` - Now initializes async infrastructure and uses async webhook  
✅ `package.json` - Added worker and health check scripts  
✅ `.env` - Added all Redis & Gemini configuration  
✅ `Dockerfile` - Updated with health checks  
✅ 11 new infrastructure files - All created  
✅ `docker-compose-prod.yml` - Complete local dev setup  

---

## 🚀 Start Local Testing (5 minutes)

### Step 1: Install Dependencies (First Time Only)

```bash
cd c:\Users\gasor\OneDrive\Desktop\Moyo-tech\Nodejs\whatsapp-ai

npm install
```

### Step 2: Start with Docker Compose

```bash
# Start all services (Redis, Postgres, App, 2 Workers, Redis UI)
docker-compose -f docker-compose-prod.yml up -d

# Or if you want to see logs:
docker-compose -f docker-compose-prod.yml up

# It will take ~30-60 seconds for all services to start
```

### Step 3: Verify Everything Is Running

```bash
# Check all containers are healthy
docker-compose -f docker-compose-prod.yml ps

# Should show:
# app            - Up (healthy)
# worker-1       - Up
# worker-2       - Up
# postgres       - Up (healthy)
# redis          - Up (healthy)
# redis-ui       - Up
```

### Step 4: Check Health Endpoint

```bash
# In a new terminal:
curl http://localhost:3000/health | jq

# Should return:
{
  "status": "healthy",
  "workers": {
    "chatWorker": {
      "active": 0,
      "waiting": 0,
      "completed": 0,
      "failed": 0
    },
    "whatsappWorker": { ... }
  },
  "infrastructure": {
    "redis": "connected",
    "queues": "operational",
    "rateLimiter": "active"
  }
}
```

### Step 5: Test Sending a Message

1. Open WhatsApp on your phone
2. Send a message to your configured WhatsApp Business number
3. Check the server logs for processing:

```bash
# In terminal where docker-compose is running, look for:
[info] Queuing WhatsApp message
[info] Chat processing job queued { jobId: "..." }
[info] Chat job completed { ... duration: "1234ms" }
[info] WhatsApp message sent
```

### Step 6: Monitor Queue Health

```bash
# View real-time queue stats
curl http://localhost:3000/health | jq '.workers'

# Or go to Redis UI
# http://localhost:8081
# See all queued jobs and their status
```

---

## 📊 View Logs

### App Logs
```bash
docker-compose -f docker-compose-prod.yml logs app -f
```

### Worker Logs
```bash
docker-compose -f docker-compose-prod.yml logs worker-1 worker-2 -f
```

### All Logs
```bash
docker-compose -f docker-compose-prod.yml logs -f
```

---

## ⚡ Performance Metrics

### Check Message Processing Time
Look for lines like:
```
[info] Chat job completed { jobId: "xxx", duration: "1234ms" }
```
- First message: 1-3 seconds (includes RAG init)
- Subsequent messages: 500ms-1s (cached)

### Check Worker Utilization
```bash
docker stats
# Shows CPU/Memory per container
```

### Check Queue Depth
```bash
docker-compose -f docker-compose-prod.yml exec redis redis-cli XLEN chat-processing-queue
# Should stay <10 under normal load
```

---

## 🔧 Configuration Tuning

### If Processing is Slow

Edit `.env`:
```bash
# Increase workers
CHAT_WORKER_CONCURRENCY=10
WHATSAPP_WORKER_CONCURRENCY=15

# Increase rate limiting (if not hitting 503 errors)
GEMINI_MAX_RPS=5
GEMINI_MAX_BURST=10
```

Then restart:
```bash
docker-compose -f docker-compose-prod.yml restart app worker-1 worker-2
```

### If Getting Gemini 503 Errors

Edit `.env`:
```bash
# Decrease rate limiting
GEMINI_MAX_RPS=2
GEMINI_MAX_BURST=3

# Longer backoff
GEMINI_BASE_DELAY=2000
```

Restart and test again.

---

## 🧹 Cleanup

### Stop All Services
```bash
docker-compose -f docker-compose-prod.yml down
```

### Stop and Remove Volumes (Clear All Data)
```bash
docker-compose -f docker-compose-prod.yml down -v
```

### View Docker Disk Usage
```bash
docker system df
```

### Clean Up Unused Images
```bash
docker system prune -a
```

---

## ✅ Testing Checklist

```
[ ] Docker Compose started without errors
[ ] All 6 containers healthy
[ ] Health endpoint returns "healthy"
[ ] Sent test WhatsApp message
[ ] Message appears in logs as queued
[ ] Message processed by worker
[ ] Response sent back to user
[ ] Redis UI shows job completed
[ ] Queue depth stays low (<10)
[ ] No Gemini 503 errors (or <5%)
```

---

## 📝 Next Steps

Once local testing passes:

1. **Read** `DIGITALOCEAN_DEPLOYMENT.md` for production deployment
2. **Read** `ASYNC_REFACTORING_GUIDE.md` for architectural details
3. **Deploy** to DigitalOcean following the deployment guide

---

## 🆘 Troubleshooting

### "Cannot connect to Docker daemon"
```bash
# Check if Docker is running
docker ps

# If not, start Docker Desktop (Windows/Mac) or:
sudo systemctl start docker  # Linux
```

### "Port 3000 already in use"
```bash
# Find what's using port 3000
lsof -i :3000
# Kill the process
kill -9 <PID>

# Or change port in docker-compose-prod.yml
# ports: - "3001:3000"
```

### "Database connection failed"
```bash
# Check if Postgres is running
docker-compose -f docker-compose-prod.yml ps postgres

# Check Postgres logs
docker-compose -f docker-compose-prod.yml logs postgres
```

### "Gemini API errors in logs"
```bash
# Check if GEMINI_API_KEY is correct in .env
grep GEMINI_API_KEY .env

# Check logs for specific error
docker-compose -f docker-compose-prod.yml logs app | grep Gemini
```

---

**You're ready to test! Run Step 2 above to start.**
