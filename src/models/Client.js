import { DataTypes } from 'sequelize';
import CryptoJS from 'crypto-js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

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
      validate: { isEmail: true }
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false
    },
    // ── WhatsApp credentials ──────────────────────────────────────────
    whatsappBusinessId: {
      type: DataTypes.STRING,
      allowNull: true,
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
    botName: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Bot display name used in AI prompts and WhatsApp messages; falls back to name'
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
      defaultValue: process.env.FLW_PAYMENT_REDIRECT_URL,
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
    requireDepositBeforeBooking: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'When true the calendar event is only created after the deposit payment is confirmed'
    },
    bookingTypes: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: ['calendar'],
      comment: 'Booking types this client offers: "calendar" | "restaurant" | "hotel"'
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
    password: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'bcrypt-hashed portal login password; null = portal access disabled'
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
    }
  }, {
    tableName: 'clients',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['email'],                 name: 'clients_email_unique' },
      { unique: true, fields: ['phone'],                 name: 'clients_phone_unique' },
      { unique: true, fields: ['whatsapp_business_id'],  name: 'clients_whatsapp_business_id_unique' }
    ],
    hooks: {
      beforeCreate: (client) => {
        if (client.whatsappToken)         client.whatsappToken         = encrypt(client.whatsappToken);
        if (client.geminiApiKey)          client.geminiApiKey          = encrypt(client.geminiApiKey);
        if (client.pineconeApiKey)        client.pineconeApiKey        = encrypt(client.pineconeApiKey);
        if (client.flutterwaveSecretKey)  client.flutterwaveSecretKey  = encrypt(client.flutterwaveSecretKey);
        if (client.flutterwaveWebhookSecret) client.flutterwaveWebhookSecret = encrypt(client.flutterwaveWebhookSecret);
        if (client.microsoftClientSecret) client.microsoftClientSecret = encrypt(client.microsoftClientSecret);
        if (client.confluenceApiToken)    client.confluenceApiToken    = encrypt(client.confluenceApiToken);
        if (client.password)              client.password              = bcrypt.hashSync(client.password, 10);

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
        if (client.changed('password') && client.password) client.password = bcrypt.hashSync(client.password, 10);
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

  Client.prototype.getDecryptedFlutterwaveKey = function () {
    return decrypt(this.flutterwaveSecretKey) || process.env.FLW_SECRET_KEY || null;
  };

  Client.prototype.getDecryptedConfluenceToken = function () {
    return decrypt(this.confluenceApiToken);
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

  Client.prototype.toJSON = function () {
    const values = Object.assign({}, this.get());
    delete values.password;
    // Never expose ciphertexts to API consumers — replace with a sentinel so the
    // frontend knows the field is set without being able to accidentally re-submit
    // the encrypted string as plaintext (which would cause double-encryption on save).
    const SENSITIVE = [
      'whatsappToken', 'geminiApiKey', 'pineconeApiKey',
      'flutterwaveSecretKey', 'flutterwaveWebhookSecret',
      'microsoftClientSecret', 'confluenceApiToken',
    ];
    SENSITIVE.forEach(f => { if (values[f]) values[f] = '__ENCRYPTED__'; });
    return values;
  };

  return Client;
};
