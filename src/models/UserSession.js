import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const UserSession = sequelize.define('UserSession', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'clients', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false    },
    history: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
      validate: {
        isValidHistory(value) {
          if (!Array.isArray(value)) {
            throw new Error('History must be an array');
          }
          value.forEach(item => {
            if (!['user', 'model'].includes(item.role)) {
              throw new Error('Role must be either "user" or "model"');
            }
          });
        }
      }
    },
    state: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
    },
    language: {
      type: DataTypes.STRING(10),
      allowNull: true
    },
    languageSetAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastAccess: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'user_sessions',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['tenant_id', 'phone'], name: 'idx_user_sessions_tenant_phone' }
    ],
    hooks: {
      beforeCreate: (userSession) => {
        if (!userSession.lastAccess) {
          userSession.lastAccess = new Date();
        }
      },
      beforeUpdate: (userSession) => {
        userSession.lastAccess = new Date();
      }
    }
  });

  return UserSession;
};
