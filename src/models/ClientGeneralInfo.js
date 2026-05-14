import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const ClientGeneralInfo = sequelize.define('ClientGeneralInfo', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    clientId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'clients', key: 'id' },
      onDelete: 'CASCADE',
    },
    businessName: { type: DataTypes.STRING },
    industry:     { type: DataTypes.STRING },
    description:  { type: DataTypes.TEXT },
    phone:        { type: DataTypes.STRING },
    whatsapp:     { type: DataTypes.STRING },
    email:        { type: DataTypes.STRING },
    website:      { type: DataTypes.STRING },
    address:      { type: DataTypes.TEXT },
    area:         { type: DataTypes.STRING },
    city:         { type: DataTypes.STRING },
    mapsLink:     { type: DataTypes.STRING },
    // { "Monday - Friday": "9am - 5pm", "Saturday": "10am - 2pm" }
    hours: { type: DataTypes.JSONB, defaultValue: {} },
    // [{ question: "...", answer: "..." }]
    faqs:  { type: DataTypes.JSONB, defaultValue: [] },
  }, {
    tableName: 'client_general_info',
    underscored: true,
    timestamps: true,
  });

  return ClientGeneralInfo;
};
