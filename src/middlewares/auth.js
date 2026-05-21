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
// rls_middleware.js
//
// Two middleware functions that work together to enforce tenant isolation:
//
//  1. setRLSContext      — Tells PostgreSQL which tenant owns this request so
//                          Row Level Security (RLS) policies can filter DB rows
//                          automatically, even if application code forgets to.
//
//  2. enforceClientScope — Application-layer guard that stops a client from
//                          even attempting to access another tenant's data,
//                          and injects the trusted clientId into req.body.
//
// Why two layers?
//   - enforceClientScope catches and rejects bad requests early (fast 403).
//   - setRLSContext / RLS is the safety net: even if a bug in a route forgets
//     to filter by clientId, Postgres enforces isolation at the DB level.
//   Both would have to fail simultaneously for a cross-tenant data leak.
// =============================================================================


// -----------------------------------------------------------------------------
// setRLSContext
//
// Sets PostgreSQL session variables (app.current_client_id, app.current_role)
// so that RLS policies on every table automatically filter rows to the current
// tenant — no manual WHERE client_id = ? needed in every query.
//
// Why a transaction?
//   set_config(..., true) makes the variables transaction-local: they disappear
//   when the transaction ends.  This is critical for connection pooling — a
//   recycled connection cannot carry the previous tenant's identity into the
//   next request.
// -----------------------------------------------------------------------------
export const setRLSContext = async (req, res, next) => {

  // No authenticated user on this request (e.g. public route) — skip RLS setup.
  if (!req.user) return next();

  const { sequelize } = dbConfig.db;

  // Admins get an empty clientId so the RLS policy's NULLIF(..., '') turns it
  // into NULL, making the client_id check fail.  The policy still lets admins
  // through because it checks current_role = 'admin' first.
  const isAdmin  = req.user.role === 'admin';
  const clientId = isAdmin ? '' : (req.user.clientId ?? '');
  const role     = req.user.role ?? 'client';

  let t; // transaction handle — declared here so the catch block can roll it back
  try {
    // Open a transaction that will live for the entire HTTP request lifecycle.
    // All subsequent Sequelize queries on this request should be passed this
    // transaction so they share the same Postgres connection and therefore
    // see the RLS variables we set below.
    t = await sequelize.transaction();

    // set_config(name, value, is_local):
    //   is_local = true → value is scoped to this transaction only.
    //   When the transaction commits or rolls back, these variables are cleared,
    //   which keeps pooled connections clean for the next request.
    await sequelize.query(
      `SELECT
         set_config('app.current_client_id', :clientId, true),
         set_config('app.current_role',       :role,     true)`,
      {
        replacements: { clientId, role },
        type: 'SELECT',
        transaction: t, // must run inside the same transaction
      }
    );

  } catch (err) {
    // RLS setup itself failed (e.g. DB connection error).
    // Log and continue — downstream code still has its own auth checks.
    // NOTE: the request proceeds WITHOUT RLS context set, so make sure
    //       enforceClientScope and route-level checks are in place.
    logger.error('RLS context setup failed', { error: err.message });
    if (t) await t.rollback().catch(() => {}); // clean up the failed transaction
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
// Application-layer guard that runs BEFORE any DB query.  Its job is:
//   1. Reject requests where a client tries to act on another client's data.
//   2. Inject the trusted, server-verified clientId into req.body so route
//      handlers can safely use req.body.clientId without trusting user input.
//
// Why do we need this if RLS already protects us?
//   RLS would silently return empty data or reject the write, but the HTTP
//   response would be ambiguous (200 with empty results vs 403 Forbidden).
//   This middleware gives a clear, early 403 and avoids unnecessary DB round
//   trips for obviously-invalid requests.
// -----------------------------------------------------------------------------
export const enforceClientScope = (req, res, next) => {

  // No user at all — authentication hasn't happened or token is invalid.
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Admins can access any client's data — let them through immediately.
  if (req.user.role === 'admin') return next();


  // ── Cross-tenant access check ─────────────────────────────────────────────
  //
  // A client might try to pass a different clientId in the request body, query
  // string, or URL params to access another tenant's data.  We check all three
  // locations and reject if any of them doesn't match the authenticated user.
  //
  // Example attack: POST /api/orders { clientId: "other-tenant-uuid" }
  //   Without this check the route might query orders for the wrong tenant.
  const requestedClientId =
    req.body?.clientId   ||  // from JSON body
    req.query?.clientId  ||  // from ?clientId=... in the URL
    req.params?.clientId;    // from /resource/:clientId route param

  if (requestedClientId && requestedClientId !== req.user.clientId) {
    // The client is explicitly trying to access a different tenant — deny it.
    return res.status(403).json({ error: 'Access denied: cannot access another client\'s data' });
  }


  // ── Inject trusted clientId ───────────────────────────────────────────────
  //
  // Overwrite whatever clientId the client sent (or didn't send) with the
  // server-verified value from the JWT / session.
  //
  // This means every route handler can safely do:
  //   const { clientId } = req.body;  // always the real, authenticated value
  //
  // Without this, a route that forgot to check would silently use a
  // client-supplied (untrusted) clientId.
  if (req.body) req.body.clientId = req.user.clientId;

  next();
};