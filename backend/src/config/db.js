import mongoose from 'mongoose';
import env from './env.js';
import logger from '../utils/logger.js';

let memoryServer = null;

/**
 * Connects to MongoDB.
 * - If MONGO_URI is set (e.g. MongoDB Atlas), it connects there.
 * - If not, and we are in development, it spins up an in-memory MongoDB so the
 *   project runs on a fresh machine with zero database installation.
 */
export async function connectDB() {
  let uri = env.MONGO_URI;

  if (!uri) {
    if (env.NODE_ENV === 'production') {
      throw new Error('MONGO_URI is required in production.');
    }
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri('gameon');
    logger.warn('No MONGO_URI set - started an in-memory MongoDB. Data resets when the server stops.');
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });

  /**
   * Surface index build failures.
   *
   * Mongoose builds indexes in the background and reports a failure through
   * an 'index' event on the model. Nothing listened, so a broken declaration
   * was swallowed in complete silence — which is exactly how this collection
   * ran for its whole life with a conflicting text index that never built,
   * and how a missing unique index (the double-booking guard) could go
   * unnoticed until two people turned up for the same pitch.
   */
  for (const name of mongoose.modelNames()) {
    mongoose.model(name).on('index', (err) => {
      if (err) logger.error('index build failed', { err, model: name });
    });
  }

  logger.info('MongoDB connected', { database: mongoose.connection.name });
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

export function isMemoryDB() {
  return Boolean(memoryServer);
}
