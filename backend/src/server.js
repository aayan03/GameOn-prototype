import app from './app.js';
import env, { validateEnv } from './config/env.js';
import { connectDB, disconnectDB, isMemoryDB } from './config/db.js';
import autoSeed from './seed/autoSeed.js';
import { startLifecycleScheduler, stopLifecycleScheduler } from './services/lifecycle.service.js';
import logger from './utils/logger.js';
import { installProcessHandlers, isEnabled as errorTrackingOn } from './services/errorReporter.service.js';
import * as email from './services/email.service.js';
import * as push from './services/push.service.js';

async function start() {
  // Refuses to boot a production server with default secrets or open CORS.
  validateEnv();

  // Catch what escapes everything else, and report it before exiting.
  installProcessHandlers();

  await connectDB();

  // Check the outbound integrations at boot rather than at the moment a user
  // depends on them. A wrong SMTP password should surface in the deploy log,
  // not in a support ticket from someone locked out of their account.
  await email.verifyConnection();

  // Dev convenience: an empty in-memory DB gets demo venues automatically.
  if (isMemoryDB()) await autoSeed();

  // Marks finished bookings complete, expires unanswered requests, sends
  // day-before reminders and settles reliability. Idempotent, so a restart
  // mid-run is harmless. Also exposed at POST /api/admin/lifecycle for
  // platforms where a long-lived interval is not dependable.
  // Five, not fifteen. The unpaid-checkout hold expires after ten minutes,
  // and a sweep that runs every fifteen would make that anywhere from ten to
  // twenty-five — long enough that the slot is still lost for the evening.
  startLifecycleScheduler(5);
  const server = app.listen(env.PORT, () => {
    logger.info('GameOn API listening', {
      port: env.PORT,
      environment: env.NODE_ENV,
      // A one-line summary of what is actually switched on, so a deploy log
      // answers "is email working here?" without anyone having to guess.
      email: email.isConfigured() ? email.transport() : 'disabled',
      push: push.isConfigured() ? 'web-push' : 'disabled',
      errorTracking: errorTrackingOn() ? 'sentry' : 'disabled',
    });
  });

  const shutdown = async (signal) => {
    logger.info('shutting down', { signal });
    // Awaited: a pass may be mid-refund, and closing the connection under it
    // would leave a booking cancelled with the money not yet returned.
    await stopLifecycleScheduler();

    // Stop accepting new connections, let in-flight requests finish, then
    // close the database. A hard exit here can tear down a request that is
    // halfway through moving money.
    const forced = setTimeout(() => {
      logger.error('graceful shutdown timed out - exiting');
      process.exit(1);
    }, 15_000);
    forced.unref();

    server.close(async () => {
      await disconnectDB();
      clearTimeout(forced);
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// The unhandledRejection / uncaughtException handlers live in
// errorReporter.service.js, so a crash is reported before the process exits
// rather than only reaching a log nobody is watching.

start().catch((err) => {
  logger.error('failed to start server', { err });
  process.exit(1);
});
