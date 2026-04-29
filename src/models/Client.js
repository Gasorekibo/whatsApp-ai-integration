import { DataTypes } from 'sequelize';
import CryptoJS from 'crypto-js';

export const SUBSCRIPTION_PLANS = {
  MESSAGE_ONLY:       'message_only',
  MESSAGE_AND_VOICE:  'message_and_voice'
};

export const SUBSCRIPTION_STATUS = {
  ACTIVE:   'active',
  INACTIVE: 'inactive',
  TRIAL:    'trial',
  EXPIRED:  'expired'
};

function encrypt(value) {
  return CryptoJS.AES.encrypt(value, process.env.ENCRYPTION_KEY).toString();
}

function decrypt(value) {
  if (!value) return null;
  const bytes = CryptoJS.AES.decrypt(value, process.env.ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8) || null;
}

export default (sequelize) => {
  const Client = sequelize.define('Client', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true }
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    company: {
      type: DataTypes.STRING,
      allowNull: true
    },

    // ── WhatsApp credentials ──────────────────────────────────────────
    whatsappBusinessId: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      comment: 'WhatsApp Cloud API phone_number_id — primary tenant key'
    },
    whatsappToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Encrypted WhatsApp Cloud API permanent token'
    },
    whatsappAccountId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'WhatsApp Business Account ID (WABA ID) — different from phone_number_id'
    },
    whatsappWebhookVerifyToken: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Webhook verify token set in Meta Developer Console'
    },
    whatsappToNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Default recipient number for test messages'
    },

    // ── AI configuration ─────────────────────────────────────────────
    geminiApiKey: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Encrypted Gemini API key; falls back to DEFAULT_GEMINI_API_KEY'
    },
    pineconeIndex: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Pinecone namespace for tenant isolation'
    },
    pineconeApiKey: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Encrypted Pinecone API key; falls back to server PINECONE_API_KEY'
    },
    pineconeIndexName: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Pinecone index name; falls back to PINECONE_INDEX_NAME env var'
    },
    pineconeEnvironment: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Pinecone environment (e.g. us-east-1-aws)'
    },

    // ── Subscription ──────────────────────────────────────────────────
    subscriptionPlan: {
      type: DataTypes.ENUM(...Object.values(SUBSCRIPTION_PLANS)),
      allowNull: false,
      defaultValue: SUBSCRIPTION_PLANS.MESSAGE_ONLY
    },
    subscriptionStatus: {
      type: DataTypes.ENUM(...Object.values(SUBSCRIPTION_STATUS)),
      allowNull: false,
      defaultValue: SUBSCRIPTION_STATUS.TRIAL
    },
    subscriptionStartDate: { type: DataTypes.DATE, allowNull: true },
    subscriptionEndDate:   { type: DataTypes.DATE, allowNull: true },
    trialEndDate:          { type: DataTypes.DATE, allowNull: true },

    // ── Per-client business configuration ────────────────────────────
    companyName: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Display name used in AI prompts; falls back to name'
    },
    timezone: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Africa/Kigali',
      comment: 'IANA timezone string for calendar and slot display'
    },
    paymentRedirectUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'URL users land on after completing payment'
    },
    currency: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'RWF'
    },
    depositAmount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Consultation deposit in the client currency; null = use DEPOSIT_AMOUNT env var'
    },

    // ── Payments — Flutterwave ────────────────────────────────────────
    flutterwaveSecretKey: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Encrypted Flutterwave secret key; falls back to FLW_SECRET_KEY env var'
    },
    flutterwaveWebhookSecret: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Encrypted Flutterwave webhook secret; falls back to FLW_WEBHOOK_SECRET env var'
    },

    // ── Knowledge Base — Google Sheets ───────────────────────────────
    googleSheetId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Google Spreadsheet ID for this client\'s service list'
    },
    googleSheetsWebhookToken: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Webhook token for Google Sheets push notifications'
    },

    // ── Knowledge Base — Microsoft Excel ─────────────────────────────
    microsoftClientId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Azure App (client) ID for Microsoft Graph API access'
    },
    microsoftObjectId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Azure service principal object ID'
    },
    microsoftTenantId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Azure tenant (directory) ID'
    },
    microsoftClientSecret: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Encrypted Azure app client secret'
    },
    microsoftUserEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Microsoft 365 user email owning the OneDrive files'
    },
    microsoftDriveId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'OneDrive Drive ID containing the client\'s Excel file'
    },
    microsoftItemId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'OneDrive Item ID of the client\'s Excel file'
    },

    // ── Confluence configuration ──────────────────────────────────────
    confluenceBaseUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'e.g. https://yourcompany.atlassian.net/wiki'
    },
    confluenceEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Atlassian account email for API authentication'
    },
    confluenceApiToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Encrypted Atlassian API token'
    },
    confluenceSpaceKey: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Confluence space key (e.g. MYSPACE)'
    },

    // ── Usage ─────────────────────────────────────────────────────────
    maxMonthlyMessages: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'null = unlimited'
    },
    messageCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    messageCountResetAt: { type: DataTypes.DATE, allowNull: true },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
    }
  }, {
    tableName: 'clients',
    timestamps: true,
    hooks: {
      beforeCreate: (client) => {
        if (client.whatsappToken)         client.whatsappToken         = encrypt(client.whatsappToken);
        if (client.geminiApiKey)          client.geminiApiKey          = encrypt(client.geminiApiKey);
        if (client.pineconeApiKey)        client.pineconeApiKey        = encrypt(client.pineconeApiKey);
        if (client.flutterwaveSecretKey)  client.flutterwaveSecretKey  = encrypt(client.flutterwaveSecretKey);
        if (client.flutterwaveWebhookSecret) client.flutterwaveWebhookSecret = encrypt(client.flutterwaveWebhookSecret);
        if (client.microsoftClientSecret) client.microsoftClientSecret = encrypt(client.microsoftClientSecret);
        if (client.confluenceApiToken)    client.confluenceApiToken    = encrypt(client.confluenceApiToken);

        if (!client.trialEndDate) {
          const trialEnd = new Date();
          trialEnd.setDate(trialEnd.getDate() + 7);
          client.trialEndDate = trialEnd;
        }
        client.messageCountResetAt = new Date();
      },
      beforeUpdate: (client) => {
        const encrypted = ['whatsappToken','geminiApiKey','pineconeApiKey','flutterwaveSecretKey','flutterwaveWebhookSecret','microsoftClientSecret','confluenceApiToken'];
        encrypted.forEach(f => { if (client.changed(f) && client[f]) client[f] = encrypt(client[f]); });
        if (client.changed('subscriptionPlan') || client.changed('subscriptionStatus')) {
          if (client.subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE && !client.subscriptionStartDate) {
            client.subscriptionStartDate = new Date();
          }
        }
      }
    }
  });

  // ── Instance methods ─────────────────────────────────────────────────

  Client.prototype.getDecryptedWhatsappToken = function () {
    return decrypt(this.whatsappToken);
  };

  Client.prototype.getDecryptedGeminiKey = function () {
    return decrypt(this.geminiApiKey);
  };

  Client.prototype.getDecryptedConfluenceToken = function () {
    return decrypt(this.confluenceApiToken);
  };

  Client.prototype.getDecryptedFlutterwaveSecretKey = function () {
    return decrypt(this.flutterwaveSecretKey);
  };

  Client.prototype.getConfluenceConfig = function () {
    if (!this.confluenceBaseUrl || !this.confluenceEmail || !this.confluenceApiToken) return null;
    return {
      baseUrl:  this.confluenceBaseUrl,
      email:    this.confluenceEmail,
      apiToken: this.getDecryptedConfluenceToken(),
      spaceKey: this.confluenceSpaceKey || null
    };
  };

  Client.prototype.canUseVoice = function () {
    return (
      this.subscriptionPlan === SUBSCRIPTION_PLANS.MESSAGE_AND_VOICE &&
      this.isSubscriptionValid()
    );
  };

  Client.prototype.isSubscriptionValid = function () {
    if (!this.isActive) return false;
    const now = new Date();
    if (this.subscriptionStatus === SUBSCRIPTION_STATUS.TRIAL) {
      return this.trialEndDate && now <= this.trialEndDate;
    }
    if (this.subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE) {
      return !this.subscriptionEndDate || now <= this.subscriptionEndDate;
    }
    return false;
  };

  Client.prototype.hasReachedMessageLimit = function () {
    if (this.maxMonthlyMessages === null) return false;
    return this.messageCount >= this.maxMonthlyMessages;
  };

  Client.prototype.resetMonthlyMessageCount = async function () {
    this.messageCount = 0;
    this.messageCountResetAt = new Date();
    await this.save();
  };

  Client.prototype.incrementMessageCount = async function () {
    this.messageCount += 1;
    await this.save();
  };

  return Client;
};
