import dotenv from 'dotenv';
import logger from '../logger/logger.js';

dotenv.config()

// SSL is only needed when connecting to a remote managed database (e.g. Supabase, RDS).
// In production the app connects to yayah-postgres over a private Docker network,
// so SSL is intentionally disabled. Set DATABASE_SSL=true to re-enable if the
// infrastructure changes.
const ssl = process.env.DATABASE_SSL === 'true'
  ? { require: true, rejectUnauthorized: false }
  : false;

export default {
  development: {
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    dialectOptions: ssl ? { ssl } : {},
    logging: false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: false
    }
  },
  production: {
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    dialectOptions: ssl ? { ssl } : {},
    logging: false,
    pool: {
      max: 10,
      min: 2,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: false
    }
  }
}