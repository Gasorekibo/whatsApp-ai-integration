# WhatsApp AI Chatbot - Client Onboarding Guide

## Part 1: Step-by-Step Onboarding Workflow

### Phase 1: Create Client & Configure Credentials

#### Step 1.1: Create New Client
1. Go to **Admin Dashboard** → **Clients** tab
2. Click **"+ Create New Client"** button
3. Fill in basic info:
   - **Client Name**: Company name (e.g., "Moyo Tech")
   - **Email**: Primary contact email
   - **Phone**: Contact phone number
   - **Country**: Where the company operates
   - **Industry**: Industry type for reference

#### Step 1.2: Configure WhatsApp Integration
1. In the **WhatsApp** section of Create Client modal:
   - **WhatsApp Account ID**: Get from Meta Business Manager → WhatsApp settings
   - **Webhook Verify Token**: Generate a secure random string (e.g., `uPr4nD0m_t0k3n_2024`)
   - **Webhook Number**: The WhatsApp Business Account phone number (e.g., `1234567890`)
   - **Phone Number ID**: From Meta Business Manager → Phone numbers
   - **Access Token**: From Meta Business Manager → System User credentials

2. **Before saving**: Test WhatsApp connection:
   ```bash
   # Request Meta for webhook access
   # They'll send a GET request with mode=subscribe to your webhook URL
   # Verify token must match what you set above
   ```

#### Step 1.3: Configure Payment Provider (Flutterwave)
1. In the **💳 Payment Provider** section:
   - **Provider**: Select "Flutterwave"
   - **Secret Key**: From Flutterwave Dashboard → API Keys
   - **Webhook Secret**: From Flutterwave Dashboard → Webhooks
   - Leave **Merchant ID** and **Public Key** blank for now

2. Test connection:
   ```bash
   curl -X GET https://api.flutterwave.com/v3/merchants \
     -H "Authorization: Bearer <SECRET_KEY>"
   ```

#### Step 1.4: Configure Knowledge Base Sources

##### Google Sheets:
1. Click **"📦 Knowledge Base Sources"** → **Google Sheets** tab
2. Create a Google Sheet with this structure:
   ```
   | Service Name | Description | Price | Active | Category |
   |---|---|---|---|---|
   | Service 1 | Description | 50000 | true | Consulting |
   | Service 2 | Description | 75000 | true | Development |
   ```
3. Get **Sheet ID** from the URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`
4. Create a service account JSON key:
   - Go to Google Cloud Console → APIs & Services → Credentials
   - Create Service Account → Generate JSON key
   - Copy the JSON and paste as **Google Sheets Webhook Token**
5. Share the sheet with the service account email (from JSON)
6. **Paste Sheet ID** in the modal

##### Microsoft Excel:
1. Click **Microsoft Excel** tab
2. Set up Microsoft Graph API:
   - Go to Azure Portal → App registrations → Create new
   - Get **Client ID**, **Client Secret**, **Tenant ID**
   - Configure these in the modal
3. Upload your Excel file to OneDrive/SharePoint
4. Get the **Drive ID** and **Item ID**:
   ```bash
   # Use Microsoft Graph API to find these
   GET https://graph.microsoft.com/v1.0/me/drive/root/children
   ```

##### Confluence:
1. Click **Confluence** tab
2. Get **Base URL**: `https://yourcompany.atlassian.net`
3. Get **API Token**: Confluence → Personal Settings → API tokens → Create token
4. Set **Email**: The email of the Confluence user with API token
5. Set **Space Key**: From Confluence space URL (e.g., `MOYO` from `https://company.atlassian.net/wiki/spaces/MOYO`)

#### Step 1.5: Configure Vector Database (Pinecone)
1. Click on **Pinecone** within the Knowledge Base section:
   - **API Key**: From Pinecone Dashboard → API keys
   - **Index Name**: Name of your Pinecone index (e.g., `moyo-tech-chatbot`)
   - **Environment**: From Pinecone Dashboard (e.g., `us-east-1-aws`)

2. Verify index exists:
   ```bash
   curl -X GET https://api.pinecone.io/indexes/moyo-tech-chatbot \
     -H "Api-Key: <PINECONE_API_KEY>"
   ```

#### Step 1.6: Save Client
- Click **"Create Client"** button
- System will:
  - Create database record with encrypted credentials
  - Create Pinecone namespace: `{clientId}` (auto-generated)
  - Verify all connections

---

### Phase 2: Sync Data Sources

#### Step 2.1: Sync Google Sheets
1. Go to **Admin Dashboard** → **Services** tab
2. Select client from dropdown
3. Click **"Sync Google Sheets"** button
4. System will:
   - Read all rows from the Google Sheet
   - Parse service name, description, price, active status
   - Create embeddings for each service
   - Store in Pinecone under client's namespace
5. Check logs: `[info] Synced N services from Google Sheets`

#### Step 2.2: Sync Microsoft Excel
1. Same location, click **"Sync Microsoft Excel"**
2. Ensure Excel file has same structure as Google Sheets
3. Verify sync completed in logs

#### Step 2.3: Sync Confluence
1. Click **"Sync Confluence"**
2. System will:
   - Fetch all pages from the configured Space Key
   - Split pages into semantic chunks (400 word max)
   - Create embeddings for each chunk
   - Store in Pinecone with metadata `type: "confluence_page"`
3. Monitor: First sync can take 2-5 minutes depending on page count

#### Step 2.4: Verify Sync Success
1. Check Pinecone Dashboard:
   - Go to Index → Namespaces
   - Find namespace `{clientId}`
   - Verify vector count increased
2. Check average vector count: `count / num_docs`
   - Should be ~768 dimensions for all vectors

---

### Phase 3: Test RAG Pipeline

#### Step 3.1: Send Test WhatsApp Message
1. Add your personal number to WhatsApp Business Account as a tester
2. Send message to WhatsApp number: `"What services do you offer?"`
3. Expected flow (check server logs):
   ```
   [info] Text message received
   [info] Classifying intent → "service_inquiry"
   [info] Detecting language → "en"
   [info] Retrieved 4 documents from vector DB
   [info] Generating response with Gemini
   [info] Response sent to user
   ```

#### Step 3.2: Test Multi-Language Support
1. Send message in French: `"Quels services offrez-vous?"`
2. Expected: Same retrieval but with French language metadata filtering
3. Check logs for: `[info] Language detected: "fr"`

#### Step 3.3: Test Intent Classification
1. Send: `"I want to book a consultation"` → Should classify as `booking`
2. Send: `"How much does X cost?"` → Should classify as `faq`
3. Send: `"Hello, how are you?"` → Should classify as `general`

#### Step 3.4: Monitor Performance
1. Check latency: Total response time should be **1.5-3 seconds** for first request
2. Check cache: Subsequent identical queries should be **<500ms**
3. Check errors: No 503/429 errors in logs (if they appear, rate limit issues)

---

### Phase 4: Go Live

#### Step 4.1: Pre-Launch Checklist
- [ ] All credentials verified and encrypted in database
- [ ] Data synced to Pinecone (all namespaces have vectors)
- [ ] Test messages respond within <3 seconds
- [ ] WhatsApp webhook URL configured in Meta settings
- [ ] Flutterwave webhooks configured
- [ ] Team trained on dashboard
- [ ] Support contact configured
- [ ] Monitoring alerts set up

#### Step 4.2: Enable in Production
1. Admin Dashboard → Clients → Select client → Toggle **"Active"** (if this field exists)
2. Push WhatsApp number to Meta for public use (currently in test mode)
3. Start marketing number to users

#### Step 4.3: Monitor First Week
1. Watch server logs for errors
2. Check latency trends
3. Monitor Gemini API usage/cost
4. Check Pinecone query costs
5. Get user feedback on response quality

---

## Part 2: Production Limitations & Challenges

### 🚨 Critical Limitations

#### 1. **Gemini API Rate Limits**
**Problem:**
- Free tier: 15 RPM (requests per minute) for `gemini-2.5-flash`
- Each user message can trigger 1-3 Gemini calls
- Bottleneck: With 10 concurrent users, you hit limits instantly

**Current mitigation:**
- Pattern-based language detection (0 Gemini calls for 80% of messages)
- Auxiliary calls use `gemini-2.0-flash` (separate free tier)
- Query caching prevents duplicate Gemini calls

**Production fix:**
```
If you upgrade to paid:
- gemini-2.5-flash: 1,000 RPM
- gemini-2.0-flash: 1,000 RPM
- Cost: ~$0.0001-0.0006 per call depending on model
```

**Risk:** If viral (100+ concurrent users), add rate limit queue:
```javascript
// Implement request queue with exponential backoff
// Retry failed requests after 5s, 15s, 45s delays
// Return cached/partial results if queue backs up
```

---

#### 2. **Pinecone Vector Database Costs**
**Problem:**
- Free tier: 1 index, limited storage (~100k vectors)
- Production cost: $0.44 per 100k vectors/month + $0.08 per 1M queries/month
- Each synced document = multiple vectors (chunking creates 5-10x vectors)
- 1000 Confluence pages = 5000-10000 vectors = $2.2-4.4/month

**Current setup:**
- All vectors stored in single index: `moyo-tech-chatbot`
- Single namespace per client: `{clientId}`

**Production challenges:**
- Multiple clients → needs multiple indexes OR many namespaces (hurts query latency)
- Deleting old data: Need to track vector IDs to delete (currently only inserts)
- Vector pruning: No automated cleanup of outdated vectors

**Fix needed:**
```javascript
// Track vector metadata with sync timestamp
// Implement: deleteVectorsByOlderThan(namespace, date)
// Or: Archive old namespaces to cold storage

// Monthly cost example:
// - 10 clients × 10k vectors = 100k vectors = $0.44/month storage
// - 10k queries/day = 300k/month = $0.024/month queries
// - Total: ~$0.46/month per client
```

---

#### 3. **WhatsApp Approval & Limits**
**Problem:**
- Meta approval process: Takes 3-7 days
- Business Account required (not personal)
- Phone number locked to one business account
- Conversation window: 24 hours (messages older = paid)
- Template message limit: 1000/day free tier

**Current gap:**
- No template message system (each message is standard, costs money after first 24h)
- No handling of conversation expiry

**Production workaround:**
```javascript
// Implement template messages for common responses:
// - "Hi {name}, thanks for messaging!"
// - "Your booking is confirmed: {date} at {time}"
// - Use templates for first response (free)
// Then continue conversation with standard messages

// Cost after 24h window: ~$0.05 per message
```

---

#### 4. **Multi-Language RAG Complexity**
**Problem:**
- Embeddings model (`gemini-embedding-001`) trained on English
- French/Rwandan documents → Lower-quality embeddings
- Query translation to English adds latency + Gemini call
- No per-language index separation

**Current behavior:**
- RAG filters by `metadata.language` (set during sync)
- If doc has no language metadata → excluded from results
- Translation happens only on query side, not doc side

**Production issues:**
- Mixed-language FAQs get poor retrieval
- Translation errors compound with low embedding quality
- No way to boost French/Rwandan results

**Fix approach:**
```javascript
// Option 1: Multi-language embeddings
// - Switch to: text-embedding-004 (supports 100+ languages)
// - Slightly higher cost but much better quality

// Option 2: Per-language RAG pipelines
// - Create separate Pinecone namespace for each language
// - Sync same content to multiple namespaces with language-specific context
// - Query the appropriate namespace based on detected language
// - Cost: 3x storage for 3 languages

// Current production reality:
// - Expect 40-60% retrieval quality in French/Rwandan
// - English-first optimization needed
```

---

#### 5. **Cold Start & Initialization Lag**
**Problem:**
- First message to a new client takes 20-30 seconds (RAG service initialization)
- Vector DB connection pools need warming
- First embedding call is slow

**Current logs show:**
```
[info] Initializing RAG service...
[info] Initializing Pinecone vector database
[info] Testing embedding service...
[info] RAG service initialized successfully
Total: ~15-20 seconds
```

**Production impact:**
- Users see 20s delay on first message
- Mobile users think message didn't send
- WhatsApp may re-deliver message, causing duplicates

**Fix:**
```javascript
// Eager init on server startup (not lazy)
// Pre-warm Pinecone connection pool
// Cache RAG service singleton in memory

// Current: Initialized on first request
// Better: Initialize when client config is saved
// Best: Background task at server startup

// Add to app.js:
const ragService = await RAGService.getInstance(clientId);
ragService.initialize(); // Done at startup
```

---

#### 6. **Concurrent User Limits (Hard Limit)**
**Problem:**
- Single Node.js process: ~100-200 concurrent connections before thrashing
- No load balancing
- No rate limiting per user
- Single DB connection pool (default: 10 connections)

**Current setup:**
```javascript
// Sequelize pool (default 10)
// embeddings: 1 connection per request (can queue)
// Pinecone: HTTP connections (unlimited but slower with many)
```

**Production scenario:**
- 50 users send messages simultaneously
- 10 DB connections saturated
- Remaining 40 requests queue
- Latency jumps to 15-30 seconds
- Timeouts start happening

**Required fix:**
```javascript
// 1. Increase DB pool: max: 20-30 (depends on server RAM)
// 2. Add request rate limiting: 1 message per user per 3 seconds
// 3. Implement message queue (Bull/RabbitMQ)
// 4. Deploy behind load balancer (nginx, HAProxy)
// 5. Horizontal scaling: Multiple Node processes

// For MVP: Rate limit + DB pool increase
// For scale: Add queue + load balancer
```

---

#### 7. **Data Sync Conflicts & Staleness**
**Problem:**
- Syncs can fail mid-way (network error, API timeout)
- No transaction rollback (partial data synced)
- Old vectors stay in Pinecone (not replaced)
- No versioning of synced data

**Current behavior:**
```
Sync starts → Sync 500/1000 docs → Network error → Stops
Result: 500 docs synced, 500 missing
Next sync: Adds 1000 more (total: 1500, but should be 1000)
Duplicates created
```

**Production issues:**
- Users get stale pricing info (old sheets version still in Pinecone)
- Manual cleanup required in Pinecone dashboard
- No audit trail of what was synced

**Fix needed:**
```javascript
// 1. Transaction-based sync:
async function syncSheets() {
  const docs = await fetchAllSheets();
  await transaction(async (trx) => {
    await deleteOldVectors(namespace, trx); // Delete first
    await insertNewVectors(docs, trx);      // Then insert
  });
  // If error: entire sync rolls back
}

// 2. Sync metadata table:
// CREATE TABLE syncs (
//   id, clientId, source, startTime, endTime, 
//   docsFound, docsIndexed, status, error
// )

// 3. Version tracking in vectors:
// metadata: { source: "sheets", version: "2024-04-27", syncId: "abc123" }
```

---

### ⚠️ Operational Challenges

#### 8. **Monitoring & Debugging**
**Current state:**
- Logs are file-based (no centralized logging)
- No dashboard for latency, error rates, cost tracking
- Hard to debug per-client issues

**Production needs:**
```
Required (Week 1):
- Centralized logging (DataDog, LogRocket, or ELK stack)
- Error tracking (Sentry)
- Performance monitoring (APM)

Cost: ~$50-200/month depending on log volume

Key metrics to track:
- Gemini API calls (cost alert if >$10/day)
- Pinecone queries (cost alert if >$1/day)
- Response latency (alert if >5s)
- Error rate (alert if >1%)
- RAG retrieval quality (manual spot checks)
```

---

#### 9. **Security & Credential Management**
**Current state:**
- Credentials encrypted at rest in DB
- But: Exposed in server memory when retrieved
- No credential rotation
- No audit log of credential access

**Production vulnerabilities:**
```
Risk: Server compromise → All client credentials exposed
Risk: Disgruntled employee → Can access all client data
Risk: Expired credentials → Service breaks silently
```

**Hardening needed:**
```javascript
// 1. Vault service (HashiCorp Vault or AWS Secrets Manager)
// - Centralized credential storage
// - Automatic rotation
// - Audit logging
// - Per-request credential retrieval

// 2. Role-based access control (RBAC)
// - Admin can't see client credentials (only set them)
// - Different permissions for sync, query, edit

// 3. Encryption in transit
// - HTTPS only (already done)
// - Credential never logged

// Cost: ~$0.01-0.05 per credential fetch (with Vault)
```

---

#### 10. **Subscription & Billing Integration**
**Current state:**
- Flutterwave configured but no usage-based billing
- No tiering (all clients same price)
- No cost tracking per client

**Production need:**
- Link message volume to subscription tier
- Charge by: Messages sent, Vector DB storage, Gemini API usage
- Enforce tier limits (e.g., tier1 = 1k messages/month)

**Implementation:**
```javascript
// After each Gemini call:
const cost = {
  gemini_classification: 0.0001,
  gemini_translation: 0.0001,
  gemini_reply: 0.0005,
  embedding: 0.00001,
  pinecone_query: 0.0001
};

// Track in: client_usage table
// At month end: Generate invoice + charge Flutterwave
// If unpaid: Disable client's chatbot until paid

// Monthly cost per client (rough):
// - 1000 messages: $0.50 in Gemini + $0.10 in Pinecone = $0.60
// - Suggest tiering: Basic $5 (1k msgs), Pro $20 (10k msgs)
```

---

#### 11. **Pinecone Vector Corruption & Recovery**
**Problem:**
- No backup of vector data
- If namespace corrupted → Data loss
- Sync script re-runs slowly (can't recover in <10min)

**Example disaster:**
```
Accidental deletion:
  DELETE FROM Pinecone namespace abc123
  Data gone forever
  Must re-sync all sources (can take hours)
  Users see 0 retrieval results in meanwhile
```

**Fix:**
```javascript
// 1. Automated backups
// - Weekly full snapshot of Pinecone index
// - Store in S3
// - Cost: ~$0.10/GB/month for S3

// 2. Point-in-time recovery script
// - Restore namespace from backup in <5 minutes

// 3. Per-vector versioning
// - Keep last 2 versions of each vector
// - Allows rollback if update corrupted data
```

---

### 📊 Scalability Roadmap

| Users | Issues | Solution |
|---|---|---|
| 1-10 | Cold starts, no queue | Increase DB pool, eager RAG init |
| 10-50 | Rate limiting needed | Add request queue (Bull) |
| 50-100 | Load balancing required | 2 Node processes + nginx |
| 100-500 | Gemini API costs exceed budget | Move to paid tier OR cache more |
| 500-1000 | Pinecone query costs spike | Archive old vectors, per-language namespaces |
| 1000+ | Database scaling | Sharding by clientId, read replicas |

---

## Summary: Immediate Production Prep (Priority Order)

1. **Week 1:** Add monitoring (DataDog/Sentry) + set up cost alerts
2. **Week 1:** Increase Pinecone backup frequency + test recovery
3. **Week 2:** Upgrade to paid Gemini tier + set usage limits per client
4. **Week 2:** Add request rate limiting + message queue
5. **Week 3:** Implement sync transaction rollback
6. **Week 4:** Add multi-language embedding model (text-embedding-004)
7. **Month 2:** Add centralized credential vault
8. **Month 3:** Implement load balancing + horizontal scaling

**Estimated cost increase for 50 users in production:**
- Gemini API: $20-50/month (paid tier)
- Pinecone: $10-20/month (50k vectors, 1k queries/day)
- Monitoring: $50-100/month
- Infrastructure: $50-200/month (depending on hosting)
- **Total: $130-370/month for infrastructure alone**

---

Last updated: 2026-04-27
