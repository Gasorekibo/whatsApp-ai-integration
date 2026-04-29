# DigitalOcean Deployment Guide - WhatsApp AI Chatbot with Async Architecture

## 🚀 Quick Deployment (30 minutes)

This guide walks you through deploying the async-refactored WhatsApp chatbot to a DigitalOcean droplet.

---

## Step 1: Prerequisites

### What You Need
- DigitalOcean account (https://digitalocean.com)
- SSH key pair (for secure droplet access)
- Domain name (optional but recommended)
- ~20 minutes

---

## Step 2: Create DigitalOcean Droplet

### 2.1: Go to DigitalOcean Console
1. Log in to https://cloud.digitalocean.com
2. Click **Create** → **Droplets**

### 2.2: Configure Droplet

**Basic Settings:**
- **Image**: Ubuntu 22.04 LTS
- **Size**: Basic $6/month (2GB RAM, 50GB SSD) - good for testing
  - For production: $12/month (2GB RAM, 100GB SSD) recommended
- **Datacenter**: Choose closest to users (e.g., Frankfurt for EU)
- **Authentication**: SSH keys (recommended over password)
- **Hostname**: `whatsapp-ai-prod`

**Click Create Droplet** (takes ~1 minute)

### 2.3: Get Your Droplet IP
Once created, note the IPv4 address shown (e.g., `198.51.100.123`)

---

## Step 3: Connect to Droplet via SSH

### 3.1: SSH into Droplet

```bash
ssh root@198.51.100.123
# Replace IP with your actual droplet IP
```

### 3.2: Initial Setup (First Time Only)

```bash
# Update system packages
apt-get update && apt-get upgrade -y

# Install Docker & Docker Compose
apt-get install -y docker.io docker-compose

# Start Docker service
systemctl start docker
systemctl enable docker

# Verify installation
docker --version
docker-compose --version
```

---

## Step 4: Deploy Application

### 4.1: Clone Repository or Upload Code

**Option A: Clone from Git**
```bash
cd /opt
git clone <your-repo-url> whatsapp-ai
cd whatsapp-ai
```

**Option B: Upload via SCP**
```bash
# From your local machine:
scp -r . root@198.51.100.123:/opt/whatsapp-ai
```

### 4.2: Set Up Environment

```bash
cd /opt/whatsapp-ai

# Create .env file for production
cat > .env.prod << 'EOF'
NODE_ENV=production
PORT=3000

# Database (Use DigitalOcean Managed Database)
DATABASE_URL=postgresql://user:password@db-hostname:25060/defaultdb
PG_DATABASE_URL=postgresql://user:password@db-hostname:25060/defaultdb
PGSSLMODE=require

# Redis (Use DigitalOcean Managed Redis or Local)
REDIS_HOST=redis-hostname
REDIS_PORT=25061
REDIS_PASSWORD=your-redis-password
REDIS_DB=0

# Gemini Configuration
GEMINI_API_KEY=AIzaSy...
GEMINI_MAX_RPS=5
GEMINI_MAX_BURST=10
GEMINI_BASE_DELAY=1000
GEMINI_MAX_DELAY=30000
GEMINI_MAX_RETRIES=5

# Workers
CHAT_WORKER_CONCURRENCY=8
WHATSAPP_WORKER_CONCURRENCY=15

# WhatsApp
WHATSAPP_TOKEN=EAAVSQvKWWz0...
WHATSAPP_PHONE_NUMBER_ID=908772575661941
WHATSAPP_BUSINESS_ACCOUNT_ID=863459623353177
WHATSAPP_WEBHOOK_VERIFY_TOKEN=moyo_tech_secret_2025

# Other configurations
ENCRYPTION_KEY=be1a108a317eb5dde6ff2ca5577ae0f9b9c9c08b300783b5bb96b9e4c634c6a0
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://yourdomain.com/oauth/callback

# All other existing env vars...
EOF
```

### 4.3: Update docker-compose for Production

```bash
# Create docker-compose production file
cp docker-compose-prod.yml docker-compose.yml

# Update environment variables
sed -i 's/REDIS_HOST: redis/REDIS_HOST: your-redis-host/g' docker-compose.yml
sed -i 's/localhost:3000/yourdomain.com/g' docker-compose.yml
```

---

## Step 5: Configure Managed Databases (Recommended)

### 5.1: Create Managed PostgreSQL Database

```
DigitalOcean Console → Databases → Create Cluster
- Engine: PostgreSQL 15
- Region: Same as droplet
- Size: $15/month (starter)
```

Copy connection string and add to `.env.prod`

### 5.2: Create Managed Redis Database (Optional but Recommended)

```
DigitalOcean Console → Databases → Create Cluster
- Engine: Redis 7
- Region: Same as droplet
- Size: $15/month (starter)
```

Copy connection string and add to `.env.prod`

---

## Step 6: Configure Domain (Optional)

### 6.1: Point Domain to Droplet

In your domain registrar:
```
A Record: yourdomain.com → 198.51.100.123
```

### 6.2: Update Environment

```bash
# Update .env.prod
sed -i 's|http://localhost:3000|https://yourdomain.com|g' .env.prod
```

### 6.3: Enable HTTPS with Let's Encrypt (via Nginx)

```bash
# Install Nginx
apt-get install -y nginx certbot python3-certbot-nginx

# Generate certificate
certbot certonly --standalone -d yourdomain.com

# Configure Nginx as reverse proxy (see next section)
```

---

## Step 7: Nginx Reverse Proxy Configuration (Optional but Recommended)

### 7.1: Create Nginx Config

```bash
cat > /etc/nginx/sites-available/whatsapp-ai << 'EOF'
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Enable config
ln -s /etc/nginx/sites-available/whatsapp-ai /etc/nginx/sites-enabled/

# Test config
nginx -t

# Start Nginx
systemctl start nginx
systemctl enable nginx
```

---

## Step 8: Start Application with Docker Compose

### 8.1: Start Services

```bash
cd /opt/whatsapp-ai

# Pull latest images
docker-compose pull

# Start all services (app + workers + redis + postgres)
docker-compose up -d

# View logs
docker-compose logs -f app
```

### 8.2: Verify Services Running

```bash
# Check container status
docker-compose ps

# Check app health
curl http://localhost:3000/health

# Check Redis
redis-cli -h redis ping

# Check PostgreSQL
psql -h postgres -U postgres -d whatsapp_ai -c "SELECT 1"
```

---

## Step 9: Set Up Monitoring & Backups

### 9.1: Enable Droplet Monitoring

```
DigitalOcean Console → Droplets → whatsapp-ai-prod → Monitoring
- Enable Monitoring & Alerting
```

### 9.2: Configure Automated Backups

```bash
# Database backups (in DigitalOcean Console)
Databases → Your DB → Backup → Enable Automated Backups

# Droplet backups
DigitalOcean Console → Droplets → Settings → Backups → Enable
```

### 9.3: Health Check Alerts

```bash
# Create health check monitoring script
cat > /root/health-check.sh << 'EOF'
#!/bin/bash
STATUS=$(curl -s http://localhost:3000/health | jq -r '.status')
if [ "$STATUS" != "healthy" ]; then
  echo "WARNING: System unhealthy" | mail -s "WhatsApp AI Alert" admin@yourdomain.com
fi
EOF

chmod +x /root/health-check.sh

# Schedule via crontab
crontab -e
# Add: */5 * * * * /root/health-check.sh
```

---

## Step 10: Ongoing Management

### 10.1: View Logs

```bash
# App logs
docker-compose logs app -f

# Worker logs
docker-compose logs worker-1 worker-2 -f

# All logs
docker-compose logs -f
```

### 10.2: Update Application

```bash
cd /opt/whatsapp-ai

# Pull latest code
git pull origin main

# Rebuild images
docker-compose build

# Restart with new image
docker-compose up -d

# Verify
docker-compose ps
```

### 10.3: Restart Workers

```bash
# Restart all workers gracefully
docker-compose restart worker-1 worker-2

# Or individual
docker-compose restart worker-1
```

### 10.4: Monitor Queue Health

```bash
# Check queue status
docker-compose exec app curl http://localhost:3000/health | jq

# SSH into app and check
docker-compose exec app redis-cli XLEN chat-processing-queue
```

---

## Troubleshooting

### Problem: Services won't start

```bash
# Check Docker logs
docker-compose logs

# Verify .env.prod is correct
cat .env.prod | grep REDIS_HOST

# Restart docker daemon
systemctl restart docker

# Try again
docker-compose up -d
```

### Problem: Database connection timeout

```bash
# Verify database credentials
psql -h your-db-host -U username -d database_name -c "SELECT 1"

# Check firewall (in DigitalOcean)
Databases → Connection Details → Trusted Sources
# Add droplet IP
```

### Problem: High CPU/Memory Usage

```bash
# Check resource usage
docker stats

# Reduce worker concurrency in .env.prod
CHAT_WORKER_CONCURRENCY=3
WHATSAPP_WORKER_CONCURRENCY=5

# Restart
docker-compose restart
```

---

## Production Checklist

```
[ ] SSH key configured (not using password)
[ ] Firewall enabled (UFW)
[ ] HTTPS configured with Let's Encrypt
[ ] Database backups enabled
[ ] Droplet monitoring enabled
[ ] Health check monitoring script set up
[ ] Environment variables all set
[ ] Database and Redis configured
[ ] Application started and healthy
[ ] Logs being monitored
[ ] Domain pointing to droplet
[ ] Nginx reverse proxy working
[ ] SSL certificate auto-renewal configured
```

---

## Cost Breakdown (Monthly)

```
Droplet:                  $6-12
PostgreSQL Database:      $15
Redis Database:           $15 (optional, can use local)
Backups:                  Included
Domain:                   ~$10-15
Bandwidth:                Included (first 1TB)
                          ________
Total:                    ~$46-57/month
```

---

## Next Steps

1. **Test Locally First**
   ```bash
   docker-compose -f docker-compose-prod.yml up -d
   ```

2. **Verify All Features**
   - Send test WhatsApp message
   - Check queue health
   - Review logs

3. **Set Up CI/CD (Optional)**
   - Automate deployments with GitHub Actions
   - Auto-deploy on git push

4. **Monitor Performance**
   - Check latency and error rates
   - Adjust worker concurrency as needed

---

## Support & Resources

- **DigitalOcean Docs**: https://docs.digitalocean.com
- **Docker Compose Docs**: https://docs.docker.com/compose
- **App Health Endpoint**: `GET /health`
- **Queue Monitoring**: `GET /health` (full stats included)

---

**Ready to deploy? Start with Step 2!**
