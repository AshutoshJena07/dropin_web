const Redis = require('ioredis');

// Initialize Redis client using REDIS_URL from Vercel environment
const redisClient = new Redis(process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_REST_URL);

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'DELETE') {
    const { pin } = req.body || req.query;
    if (pin) {
      const cleanPin = pin.trim().toUpperCase();
      await redisClient.del(`session:${cleanPin}`);
    }
    return res.status(200).json({ success: true, message: 'Session removed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { pin, url } = body || {};

    if (!pin || !url) {
      return res.status(400).json({ error: 'Missing PIN or URL' });
    }

    const cleanPin = pin.trim().toUpperCase();
    
    // Store in Redis with an expiration of 24 hours (86400 seconds)
    await redisClient.set(`session:${cleanPin}`, JSON.stringify({ url, createdAt: Date.now() }), 'EX', 86400);

    return res.status(200).json({
      success: true,
      message: 'Session registered successfully',
      pin: cleanPin,
      url
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
