const Redis = require('ioredis');

// Initialize Redis client using REDIS_URL from Vercel environment
const redisClient = new Redis(process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_REST_URL);

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
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
    
    // Retrieve from Redis
    const sessionStr = await redisClient.get(`session:${cleanPin}`);

    if (!sessionStr) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = JSON.parse(sessionStr);

    return res.status(200).json({
      success: true,
      pin: cleanPin,
      url: session.url,
      createdAt: session.createdAt
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
