const { Redis } = require('@upstash/redis');

// Initialize Upstash Redis with fallback for different Vercel environment variables
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

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
      await kv.del(`session:${cleanPin}`);
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
    await kv.set(`session:${cleanPin}`, { url, createdAt: Date.now() }, { ex: 86400 });

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
