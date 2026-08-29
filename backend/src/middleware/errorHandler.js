import env from '../config/env.js';
import logger from '../utils/logger.js';
import { report } from '../services/errorReporter.service.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: { message: `Route ${req.method} ${req.originalUrl} not found` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = err.statusCode || 500;
  let message = err.message || 'Something went wrong';
  let details = err.details || null;

  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Validation failed';
    details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
  }
  if (err.name === 'CastError') { status = 400; message = `Invalid ${err.path}`; }
  if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern || {}).join(', ');
    message = field.includes('court') && field.includes('date')
      ? 'That slot has just been taken. Please pick another time.'
      : `A record with this ${field} already exists`;
  }
  if (err.name === 'JsonWebTokenError') { status = 401; message = 'Invalid token'; }
  if (err.name === 'TokenExpiredError') { status = 401; message = 'Session expired, please log in again'; }
  // Thrown by the CORS middleware in app.js. Without this it falls through as
  // a 500, so a misconfigured CORS_ORIGINS reads as "the API is broken"
  // rather than "this origin is not on the allow-list".
  if (/^Blocked by CORS/.test(err.message || '')) { status = 403; message = 'This origin is not allowed to call the API'; }
  // express.json() rejecting a malformed or oversized body is the client's
  // fault, not ours; a 500 here would also page whoever is on call.
  if (err.type === 'entity.too.large') { status = 413; message = 'That request was too large'; }
  else if (err.type === 'entity.parse.failed') { status = 400; message = 'The request body was not valid JSON'; }

  if (status >= 500) {
    logger.error('unhandled request error', {
      err,
      method: req.method,
      path: req.originalUrl,
      status,
    });

    // Only genuinely unexpected failures are worth paging someone about. A
    // deliberate 502 from an unreachable payment gateway is already handled
    // and would just be noise in the error tracker.
    if (!err.isOperational) {
      report(err, {
        tags: { path: req.route?.path || req.originalUrl, method: req.method },
        request: { url: req.originalUrl, method: req.method },
        userId: req.user?._id,
        extra: { requestId: req.id },
      });
    }

    // Never hand an unexpected 500's own message to a client in production.
    // `err.message` on an unhandled failure is a stack-adjacent string —
    // Mongoose emits connection URIs with credentials in it, driver errors
    // name internal hosts, and a thrown template literal can carry whatever
    // was being processed at the time. Errors we raised deliberately
    // (ApiError sets isOperational) are already written for a human to read,
    // so those are safe to pass through.
    if (!err.isOperational) {
      message = 'Something went wrong on our end. Please try again in a moment.';
      details = null;
    }
  }

  res.status(status).json({
    success: false,
    error: {
      message,
      // Handed back on server errors so a report of "it broke" can be tied
      // to the exact log line, without exposing anything internal.
      ...(status >= 500 && req.id ? { requestId: req.id } : {}),
      ...(details ? { details } : {}),
      ...(env.NODE_ENV === 'development' && status >= 500 ? { stack: err.stack } : {}),
    },
  });
}
