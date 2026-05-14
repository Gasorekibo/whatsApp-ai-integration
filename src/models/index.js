import { Sequelize } from 'sequelize';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import config from '../config/database.js';
import Employee from './Employees.js';
import UserSession from './UserSession.js';
import Content from './Content.js';
import ServiceRequest from './ServiceRequest.js';
import ProcessedMessage from './ProcessedMessage.js';
import Client from './Client.js';
import ClientGeneralInfo from './ClientGeneralInfo.js';
import logger from '../logger/logger.js';

// CLS ensures every query dispatched within a request's async context is bound
// to the same transaction (and therefore the same DB connection), which is
// required for SET LOCAL (transaction-scoped) RLS variables to take effect.
const require = createRequire(import.meta.url);
const cls = require('cls-hooked');
const namespace = cls.createNamespace('sequelize-rls');
Sequelize.useCLS(namespace);

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const node_env = process.env.NODE_ENV || 'development';
const dbConfig = config[node_env];

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
  // Client must be registered first — child tables hold FK references to clients.id
  Client: Client(sequelize, Sequelize),
  Employee: Employee(sequelize, Sequelize),
  UserSession: UserSession(sequelize, Sequelize),
  Content: Content(sequelize, Sequelize),
  ServiceRequest: ServiceRequest(sequelize, Sequelize),
  ProcessedMessage: ProcessedMessage(sequelize, Sequelize),
  ClientGeneralInfo: ClientGeneralInfo(sequelize, Sequelize),
};

// ── Associations ─────────────────────────────────────────────────────────────
// Every child table has a mandatory FK to clients.id; CASCADE on delete so
// removing a client wipes all its data atomically.

db.Client.hasMany(db.UserSession,      { foreignKey: 'clientId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
db.UserSession.belongsTo(db.Client,    { foreignKey: 'clientId' });

db.Client.hasOne(db.Content,           { foreignKey: 'clientId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
db.Content.belongsTo(db.Client,        { foreignKey: 'clientId' });

db.Client.hasMany(db.ServiceRequest,   { foreignKey: 'clientId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
db.ServiceRequest.belongsTo(db.Client, { foreignKey: 'clientId' });

db.Client.hasMany(db.ProcessedMessage, { foreignKey: 'clientId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
db.ProcessedMessage.belongsTo(db.Client, { foreignKey: 'clientId' });

db.Client.hasMany(db.Employee,              { foreignKey: 'clientId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
db.Employee.belongsTo(db.Client,            { foreignKey: 'clientId' });

db.Client.hasOne(db.ClientGeneralInfo,      { foreignKey: 'clientId', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
db.ClientGeneralInfo.belongsTo(db.Client,   { foreignKey: 'clientId' });

// ── Lifecycle hooks ───────────────────────────────────────────────────────────
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// ── Database sync + RLS bootstrap ────────────────────────────────────────────
const syncDatabase = async (options = {}) => {
  try {
    await sequelize.authenticate();
    logger.info('Database connection established successfully');

    await sequelize.sync(options);
    logger.info('Database synchronized successfully');

    await applyRLSPolicies();
  } catch (error) {
    logger.error('Unable to connect to the database', { error: error.message });
    throw error;
  }
};

const applyRLSPolicies = async () => {
  try {
    const sql = readFileSync(
      join(__dirname, '../../src/migrations/001_rls_policies.sql'),
      'utf8'
    );
    await sequelize.query(sql);
    logger.info('RLS policies applied successfully');
  } catch (error) {
    logger.error('Failed to apply RLS policies', { error: error.message });
    throw error;
  }
};

export default { db, syncDatabase };
