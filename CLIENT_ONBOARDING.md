# 🚀 Client Onboarding Guide

This guide explains how to onboard a new client to the WhatsApp AI multi-tenant platform. Each client gets their own WhatsApp number, their own AI personality, and their own knowledge base isolation.

---

## 🛠️ Step 1: Meta WhatsApp Setup

1.  **Meta Developer Console**: Log in to [developers.facebook.com](https://developers.facebook.com).
2.  **Add/Select App**: Open your WhatsApp-enabled app.
3.  **WhatsApp Setup**:
    *   Navigate to **WhatsApp > API Setup**.
    *   Add a new phone number or select an existing one.
    *   **Capture the Phone Number ID**: This is the most important ID. It will be your `whatsappBusinessId` in the database.
4.  **Permanent Access Token**: 
    *   Generate a **System User Token** with `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
    *   **Capture the Token**: You will need this for the `whatsappToken` field.
5.  **Webhooks**:
    *   Navigate to **WhatsApp > Configuration**.
    *   Set Callback URL to: `https://your-droplet-ip/webhook`
    *   Set Verify Token to: (The token defined in your `.env` or client record).
    *   Subscribe to `messages` under **Webhook fields**.

---

## 🧠 Step 2: AI & Knowledge Base Setup

1.  **Gemini API Key**: 
    *   Obtain a new key from [Google AI Studio](https://aistudio.google.com/) if the client wants their own billing. 
    *   Otherwise, use the platform's default key.
2.  **Pinecone Namespace**:
    *   Generate a UUID (or use the client's Database UUID).
    *   This ID will be used as the **Namespace** in Pinecone to ensure Client A's data never leaks to Client B.
3.  **Knowledge Upload**:
    *   Prepare the client's PDF/Excel training data.
    *   Upload it to the Pinecone index using the designated namespace.

---

## 🗄️ Step 3: Database Registration

Add a new record to the `clients` table. You can use a SQL client or the provided migration scripts.

### Required Fields:
| Field | Description | Example |
| :--- | :--- | :--- |
| **`name`** | Client name for internal tracking | `"Kanombe"` |
| **`whatsappBusinessId`** | The **Phone Number ID** from Meta | `"908772575661941"` |
| **`whatsappToken`** | The **Permanent Access Token** (Plain text - DB hook will encrypt it) | `"EAAG..."` |
| **`geminiApiKey`** | The client's Gemini key (or null to use default) | `"AIza..."` |
| **`pineconeIndex`** | The **Namespace** for their data | `"client-uuid-here"` |
| **`timezone`** | Client's local timezone | `"Africa/Kigali"` |

### SQL Example:
```sql
INSERT INTO clients (id, name, email, phone, "whatsappBusinessId", "whatsappToken", "pineconeIndex", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(), 
  'Client Name', 
  'client@email.com', 
  '+250...', 
  'PHONE_NUMBER_ID_HERE', 
  'ACCESS_TOKEN_HERE', 
  'NAMESPACE_HERE', 
  true, 
  NOW(), 
  NOW()
);
```

---

## 🧪 Step 4: Verification

1.  **Restart Containers**: On the droplet, run `docker-compose restart`.
2.  **Check Logs**: Run `docker-compose logs -f app` and send a message to the new number.
3.  **Verify Lookup**: Look for `Client resolved and cached` with the new client's name.
4.  **Test AI**: Ensure the bot replies using the correct personality and data.

---

## 🆘 Troubleshooting
*   **Reply on wrong number**: Check if the `whatsappToken` in the database matches the token for the specific `whatsappBusinessId`.
*   **No reply**: Ensure the Webhook is verified in the Meta Console and pointing to the correct URL.
*   **Mixed Data**: Double check that the `pineconeIndex` field matches the namespace used during data upload.
