import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
import config from '../config/database.js';
import Employee from './Employees.js';
import UserSession from './UserSession.js';
import Content from './Content.js';
import ServiceRequest from './ServiceRequest.js';
import logger from '../logger/logger.js';

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
    logger.info('Database connection established successfully');

    await sequelize.sync(options);
    logger.info('Database synchronized successfully');
  } catch (error) {
    logger.error('Unable to connect to the database', { error: error.message });
    throw error;
  }
};

export default { db, syncDatabase };