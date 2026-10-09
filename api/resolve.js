const Redis = require('ioredis');

global.__dropinRegisteredSessions = global.__dropinRegisteredSessions || new Map();

let redisClient = null;
const redisUrl = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_REST_URL;

if (redisUrl) {
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: () => null,
      enableOfflineQueue: false
    });
    redisClient.on('error', () => {});
  } catch (e) {
    redisClient = null;
  }
}

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { pin } = req.query;
    if (!pin) {
      return res.status(400).json({ error: 'Missing PIN parameter' });
    }

    const cleanPin = pin.trim().toUpperCase();

    // Check Redis if available
    if (redisClient && redisClient.status === 'ready') {
      try {
        const sessionStr = await redisClient.get(`session:${cleanPin}`);
        if (sessionStr) {
          const session = JSON.parse(sessionStr);
          return res.status(200).json({
            success: true,
            pin: cleanPin,
            url: session.url,
            createdAt: session.createdAt
          });
        }
      } catch (e) {}
    }

    // Fallback to in-memory store
    const mem = global.__dropinRegisteredSessions.get(cleanPin);
    if (!mem) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.status(200).json({
      success: true,
      pin: cleanPin,
      url: mem.url,
      createdAt: mem.createdAt
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
