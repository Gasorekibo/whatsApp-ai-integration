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
        if (client.whatsappToken) client.whatsappToken = encrypt(client.whatsappToken);
        if (client.geminiApiKey)  client.geminiApiKey  = encrypt(client.geminiApiKey);

        if (!client.trialEndDate) {
          const trialEnd = new Date();
          trialEnd.setDate(trialEnd.getDate() + 7);
          client.trialEndDate = trialEnd;
        }
        client.messageCountResetAt = new Date();
      },
      beforeUpdate: (client) => {
        if (client.changed('whatsappToken') && client.whatsappToken) {
          client.whatsappToken = encrypt(client.whatsappToken);
        }
        if (client.changed('geminiApiKey') && client.geminiApiKey) {
          client.geminiApiKey = encrypt(client.geminiApiKey);
        }
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
