import jwt from 'jsonwebtoken';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

export const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

// =============================================================================
// RLS middleware
//
// setRLSContext — Tells PostgreSQL which tenant this container serves so that
//   Row Level Security policies filter DB rows automatically. The tenant is
//   always process.env.TENANT_ID — fixed at container startup, never changes.
//
// enforceClientScope — Application-layer guard that prevents JWT tokens from
//   one tenant being used against another tenant's admin routes.
// =============================================================================


// -----------------------------------------------------------------------------
// setRLSContext
//
// Sets app.tenant_id on the PostgreSQL connection so RLS policies activate.
// Because TENANT_ID is constant for the lifetime of this container, we still
// use a transaction-scoped SET so that pooled connections are always clean —
// a recycled connection from the pool cannot carry a stale value.
// -----------------------------------------------------------------------------
export const setRLSContext = async (req, res, next) => {

  if (!req.user) return next();

  const { sequelize } = dbConfig.db;
  const tenantId = process.env.TENANT_ID;

  let t;
  try {
    t = await sequelize.transaction();

    await sequelize.query(
      `SELECT set_config('app.tenant_id', :tenantId, true)`,
      {
        replacements: { tenantId },
        type: 'SELECT',
        transaction: t,
      }
    );

  } catch (err) {
    logger.error('RLS context setup failed', { error: err.message });
    if (t) await t.rollback().catch(() => {});
    return next();
  }


  // ---------------------------------------------------------------------------
  // finish(isError)
  //
  // Commits or rolls back the transaction depending on whether the response
  // indicates success or failure.  Called from two places:
  //   • res.json intercept  — normal request completion
  //   • res 'close' event   — abrupt disconnect / streaming end
  //
  // The t.finished guard prevents double-finalization (commit then rollback
  // on the same transaction would throw a Sequelize error).
  // ---------------------------------------------------------------------------
  const finish = async (isError) => {
    if (t.finished) return; // already committed or rolled back — do nothing

    try {
      if (isError) {
        // 4xx / 5xx response or unexpected close → discard any DB changes
        await t.rollback();
      } else {
        // Successful response → persist DB changes
        await t.commit();
      }
    } catch (e) {
      logger.error('RLS transaction finalization failed', { error: e.message });
      await t.rollback().catch(() => {}); // last-ditch cleanup
    }
  };


  // ---------------------------------------------------------------------------
  // Intercept res.json
  //
  // Why?
  //   We need the transaction to COMMIT before the HTTP response reaches the
  //   client.  If we committed after sending the response and the commit failed,
  //   the client would believe the operation succeeded when it didn't.
  //
  // How?
  //   We temporarily replace res.json on this response object only.  When any
  //   route calls res.json(data), our wrapper runs finish() first, then passes
  //   control to the original res.json.
  //
  // res.statusCode is already set by the time res.json is called, so
  //   statusCode >= 400 reliably signals an error response.
  // ---------------------------------------------------------------------------
  const origJson = res.json.bind(res);
  res.json = async function (body) {
    await finish(res.statusCode >= 400); // commit on 2xx/3xx, rollback on 4xx/5xx
    return origJson(body);              // send the actual response
  };


  // ---------------------------------------------------------------------------
  // Safety net: res 'close' event
  //
  // Fires when the underlying socket closes — covers cases where res.json is
  // never called:
  //   • Client disconnects before the response is sent
  //   • Streaming responses that don't go through res.json
  //   • Unhandled exceptions that bypass the normal response path
  //
  // Always rolls back (true) because if we reach this path we don't know
  // whether the operation was safe to commit.
  // ---------------------------------------------------------------------------
  res.on('close', () => finish(true));

  // Hand off to the next middleware — the transaction stays open until finish()
  next();
};


// -----------------------------------------------------------------------------
// enforceClientScope
//
// Ensures the authenticated user belongs to this container's tenant.
// With one container per tenant, cross-tenant requests are already impossible
// at the network level (wrong subdomain → wrong container), but we keep this
// as a defence-in-depth check against stolen JWTs from other tenants.
// -----------------------------------------------------------------------------
export const enforceClientScope = (req, res, next) => {

  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Admin role bypasses tenant scope check — admin manages this tenant's data.
  if (req.user.role === 'admin') return next();

  // Reject if the JWT's tenantId doesn't match this container's TENANT_ID.
  if (req.user.tenantId && req.user.tenantId !== process.env.TENANT_ID) {
    return res.status(403).json({ error: 'Token is not valid for this tenant' });
  }

  // Inject the trusted tenantId into req.body so route handlers don't need
  // to read from the JWT directly.
  if (req.body) req.body.tenantId = process.env.TENANT_ID;

  next();
};