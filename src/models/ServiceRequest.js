import { DataTypes } from 'sequelize';
export default (sequelize) => {
  const ServiceRequest = sequelize.define('ServiceRequest', {
     id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    service: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isEmail: true
      }
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    company: {
      type: DataTypes.STRING,
      allowNull: true
    },
    details: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    timeline: {
      type: DataTypes.STRING,
      allowNull: true
    },
    budget: {
      type: DataTypes.STRING,
      allowNull: true
    },
    sapModule: {
      type: DataTypes.STRING,
      allowNull: true
    },
    appType: {
      type: DataTypes.STRING,
      allowNull: true
    },
    trainingTopic: {
      type: DataTypes.STRING,
      allowNull: true
    },
    participants: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'new'
    }
  }, {
    tableName: 'service_requests',
    timestamps: true
  });

  return ServiceRequest;
};