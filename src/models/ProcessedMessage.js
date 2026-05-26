import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const ProcessedMessage = sequelize.define('ProcessedMessage', {
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
    messageId: {
      type: DataTypes.STRING,
      allowNull: false
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
      { unique: true, fields: ['tenant_id', 'message_id'], name: 'idx_processed_messages_tenant_msg' }
    ]
  });

  return ProcessedMessage;
};
