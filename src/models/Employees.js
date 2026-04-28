import { DataTypes } from 'sequelize';
import CryptoJS from 'crypto-js';

export default (sequelize) => {
  const Employee = sequelize.define('Employee', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    clientId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Tenant key — employee belongs to one client; their calendar is used for booking slots'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      // unique removed from field — enforced as composite (clientId, email) in indexes
      validate: { isEmail: true }
    },
    refreshToken: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'employees',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['client_id', 'email'], name: 'idx_employees_client_email' }
    ],
    hooks: {
      beforeCreate: (employee) => {
        if (employee.refreshToken) {
          employee.refreshToken = CryptoJS.AES.encrypt(
            employee.refreshToken,
            process.env.ENCRYPTION_KEY
          ).toString();
        }
      },
      beforeUpdate: (employee) => {
        if (employee.changed('refreshToken') && employee.refreshToken) {
          employee.refreshToken = CryptoJS.AES.encrypt(
            employee.refreshToken,
            process.env.ENCRYPTION_KEY
          ).toString();
        }
      }
    }
  });

  Employee.prototype.getDecryptedToken = function () {
    if (!this.refreshToken) return null;
    const bytes = CryptoJS.AES.decrypt(this.refreshToken, process.env.ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  };

  return Employee;
};
