const {DataTypes} = require('sequelize');
const CryptoJS = require('crypto-js');
module.exports = (sequelize) => {
  const Employee = sequelize.define('Employee', {
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
      validate: {
        isEmail: true
      }
    },
    refreshToken: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'employees',
    timestamps: true,
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

  // Instance method to decrypt token
  Employee.prototype.getDecryptedToken = function() {
    if (!this.refreshToken) return null;
    const bytes = CryptoJS.AES.decrypt(this.refreshToken, process.env.ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  };

  return Employee;
};