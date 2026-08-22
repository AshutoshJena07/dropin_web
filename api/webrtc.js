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

  const { pin, action, role } = req.query; // role: 'web' or 'android'

  if (!pin) {
    return res.status(400).json({ error: 'Missing PIN' });
  }

  const cleanPin = pin.trim().toUpperCase();
  const sessionKey = `webrtc:${cleanPin}`;

  if (req.method === 'GET') {
    const rawData = await redisClient.get(sessionKey);
    let sessionData = {};
    if (rawData) {
      try {
        sessionData = JSON.parse(rawData);
      } catch (e) {}
    }
    return res.status(200).json(sessionData);
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    
    // Acquire a simple lock or just use get+set (optimistic approach is fine for this low-concurrency use case)
    const rawData = await redisClient.get(sessionKey);
    let sessionData = {
      offer: null,
      answer: null,
      candidates_web: [],
      candidates_android: [],
      metadata: null,
      createdAt: Date.now()
    };
    
    if (rawData) {
      try {
        sessionData = { ...sessionData, ...JSON.parse(rawData) };
      } catch (e) {}
    }

    if (action === 'setOffer') {
      sessionData.offer = body.offer;
    } else if (action === 'setAnswer') {
      sessionData.answer = body.answer;
    } else if (action === 'addCandidate') {
      if (role === 'web') {
        sessionData.candidates_web.push(body.candidate);
      } else if (role === 'android') {
        sessionData.candidates_android.push(body.candidate);
      }
    } else if (action === 'setMetadata') {
      sessionData.metadata = body.metadata;
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    await redisClient.set(sessionKey, JSON.stringify(sessionData), 'EX', 3600); // 1 hour expiry
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    await redisClient.del(sessionKey);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
};
