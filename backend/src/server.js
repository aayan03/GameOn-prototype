import app from './app.js';
import env, { validateEnv } from './config/env.js';
import { connectDB, disconnectDB, isMemoryDB } from './config/db.js';
import autoSeed from './seed/autoSeed.js';
import { startLifecycleScheduler, stopLifecycleScheduler } from './services/lifecycle.service.js';

async function start() {
  // Refuses to boot a production server with default secrets or open CORS.
  validateEnv();

  await connectDB();

  // Dev convenience: an empty in-memory DB gets demo venues automatically.
  if (isMemoryDB()) await autoSeed();

  // Marks finished bookings complete, expires unanswered requests, sends
  // day-before reminders and settles reliability. Idempotent, so a restart
  // mid-run is harmless. Also exposed at POST /api/admin/lifecycle for
  // platforms where a long-lived interval is not dependable.
  startLifecycleScheduler(15);
  const server = app.listen(env.PORT, () => {
    console.log(`\n🏟️  GameOn API running on http://localhost:${env.PORT}`);
    console.log(`   Environment: ${env.NODE_ENV}`);
    console.log(`   Health check: http://localhost:${env.PORT}/api/health\n`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received — shutting down.`);
    // Awaited: a pass may be mid-refund, and closing the connection under it
    // would leave a booking cancelled with the money not yet returned.
    await stopLifecycleScheduler();

    // Stop accepting new connections, let in-flight requests finish, then
    // close the database. A hard exit here can tear down a request that is
    // halfway through moving money.
    const forced = setTimeout(() => {
      console.error('Graceful shutdown timed out — exiting.');
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

// A rejected promise or thrown error that reaches here means the process is
// in an unknown state; log it loudly and let the platform restart us rather
// than limping along serving requests from a broken server.
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
  process.exit(1);
});

start().catch((err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});
