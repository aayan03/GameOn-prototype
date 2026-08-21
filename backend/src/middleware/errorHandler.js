import env from '../config/env.js';

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

  if (status >= 500) console.error('[error]', err);

  res.status(status).json({
    success: false,
    error: { message, ...(details ? { details } : {}), ...(env.NODE_ENV === 'development' && status >= 500 ? { stack: err.stack } : {}) },
  });
}
