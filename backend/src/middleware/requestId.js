import { randomUUID } from 'node:crypto';
import logger, { requestContext } from '../utils/logger.js';

/**
 * Gives every request an id and binds it to the async context.
 *
 * Without this, a production log is a flat stream in which the three lines
 * belonging to one failed booking are interleaved with two hundred lines from
 * everyone else, and there is no way to tell which belong together. With it,
 * one id ties the access log, every service-level warning and the eventual
 * stack trace into a single story — and the same id goes back to the client
 * in a header, so a user reporting "it failed at 2pm" hands you the exact
 * request.
 *
 * An inbound `X-Request-Id` is honoured so a trace survives across a proxy,
 * but it is bounded and sanitised: it ends up in log files and response
 * headers, and an unchecked value there is a log-injection and
 * response-splitting vector.
 */
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

export default function requestId(req, res, next) {
  const inbound = req.get('x-request-id');
  const id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();

  req.id = id;
  res.setHeader('X-Request-Id', id);

  requestContext.run({ requestId: id }, () => {
    // `protect` resolves the user well after this point, so the id is bound
    // first and the user is attached to the same store when it is known.
    res.on('finish', () => {
      // Only the interesting ones. Morgan already logs every request; this is
      // the structured counterpart for the ones worth alerting on.
      if (res.statusCode >= 500) {
        logger.error('request failed', {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
        });
      }
    });
    next();
  });
}
