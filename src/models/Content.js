const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Content = sequelize.define('Content', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    services: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
      validate: {
        isValidServices(value) {
          if (!Array.isArray(value)) {
            throw new Error('Services must be an array');
          }
        }
      }
    },
    faqs: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
      validate: {
        isValidFaqs(value) {
          if (!Array.isArray(value)) {
            throw new Error('FAQs must be an array');
          }
        }
      }
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'content',
    timestamps: false,
    hooks: {
      beforeUpdate: (content) => {
        content.updatedAt = new Date();
      }
    }
  });

  return Content;
};