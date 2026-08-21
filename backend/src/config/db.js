import mongoose from 'mongoose';
import env from './env.js';

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
    console.log('⚠️  No MONGO_URI found — started in-memory MongoDB for development.');
    console.log('    Data resets when the server stops. Set MONGO_URI in .env to persist.');
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log(`✅ MongoDB connected → ${mongoose.connection.name}`);
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

export function isMemoryDB() {
  return Boolean(memoryServer);
}
