const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');
const config  = require ('../config/database.js');
const Employee = require('./Employees.js');
const UserSession = require('./UserSession.js')
const Content = require('./Content.js');
const ServiceRequest = require('./ServiceRequest.js');
dotenv.config()
const node_env = process.env.NODE_ENV || 'development'
const dbConfig = config[node_env]
const sequelize = new Sequelize(process.env.PG_DATABASE_URL, {
  dialect: dbConfig.dialect,
  logging: dbConfig.logging,
  pool: dbConfig.pool,
  define: dbConfig.define,
  dialectOptions: dbConfig.dialectOptions
});

const db = {
  sequelize,
  Sequelize,
  Employee: Employee(sequelize, Sequelize),
  UserSession: UserSession(sequelize, Sequelize),
  Content: Content(sequelize, Sequelize),
  ServiceRequest: ServiceRequest(sequelize, Sequelize)
};

// Set up model associations

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});
const syncDatabase = async (options = {}) => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    
    await sequelize.sync(options);
    console.log('Database synchronized successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    throw error;
  }
};

module.exports = { db, syncDatabase };