const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const UserSession = sequelize.define('UserSession', {
     id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
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
    lastAccess: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'user_sessions',
    timestamps: true,
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