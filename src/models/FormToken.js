import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const FormToken = sequelize.define('FormToken', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    token: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    clientId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'clients', key: 'id' },
      onDelete: 'CASCADE',
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  }, {
    tableName: 'form_tokens',
    underscored: true,
    timestamps: true,
    updatedAt: false,
  });

  return FormToken;
};
