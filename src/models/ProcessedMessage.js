import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const ProcessedMessage = sequelize.define('ProcessedMessage', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    clientId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Tenant key — messageId deduplication is scoped per client'
    },
    messageId: {
      type: DataTypes.STRING,
      allowNull: false
      // unique removed — enforced as composite (clientId, messageId) in indexes below
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'processed_messages',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['client_id', 'message_id'], name: 'idx_processed_messages_client_msg' }
    ]
  });

  return ProcessedMessage;
};
