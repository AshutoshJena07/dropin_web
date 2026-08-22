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
  const sessionKey = `webrtc:${cleanPin}:session`;
  const webCandsKey = `webrtc:${cleanPin}:cands_web`;
  const androidCandsKey = `webrtc:${cleanPin}:cands_android`;
  const legacyKey = `webrtc:${cleanPin}`;

  if (req.method === 'GET') {
    try {
      const [sessionMap, webCands, androidCands] = await Promise.all([
        redisClient.hgetall(sessionKey),
        redisClient.lrange(webCandsKey, 0, -1),
        redisClient.lrange(androidCandsKey, 0, -1)
      ]);

      let offer = null;
      let answer = null;
      let metadata = null;
      let candidates_web = [];
      let candidates_android = [];

      if (sessionMap && Object.keys(sessionMap).length > 0) {
        if (sessionMap.offer) {
          try { offer = JSON.parse(sessionMap.offer); } catch (e) { offer = sessionMap.offer; }
        }
        if (sessionMap.answer) {
          try { answer = JSON.parse(sessionMap.answer); } catch (e) { answer = sessionMap.answer; }
        }
        if (sessionMap.metadata) {
          try { metadata = JSON.parse(sessionMap.metadata); } catch (e) { metadata = sessionMap.metadata; }
        }
        candidates_web = (webCands || []).map(c => {
          try { return JSON.parse(c); } catch (e) { return c; }
        });
        candidates_android = (androidCands || []).map(c => {
          try { return JSON.parse(c); } catch (e) { return c; }
        });
      } else {
        // Fallback check for legacy single-key format if present
        const rawData = await redisClient.get(legacyKey);
        if (rawData) {
          try {
            const legacyData = JSON.parse(rawData);
            offer = legacyData.offer || null;
            answer = legacyData.answer || null;
            metadata = legacyData.metadata || null;
            candidates_web = legacyData.candidates_web || [];
            candidates_android = legacyData.candidates_android || [];
          } catch (e) {}
        }
      }

      return res.status(200).json({
        offer,
        answer,
        metadata,
        candidates_web,
        candidates_android
      });
    } catch (err) {
      console.error('GET error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      if (action === 'setOffer') {
        await redisClient.hset(sessionKey, 'offer', JSON.stringify(body.offer));
        await redisClient.expire(sessionKey, 3600);
      } else if (action === 'setAnswer') {
        await redisClient.hset(sessionKey, 'answer', JSON.stringify(body.answer));
        await redisClient.expire(sessionKey, 3600);
      } else if (action === 'setMetadata') {
        await redisClient.hset(sessionKey, 'metadata', JSON.stringify(body.metadata));
        await redisClient.expire(sessionKey, 3600);
      } else if (action === 'addCandidate') {
        const targetListKey = role === 'android' ? androidCandsKey : webCandsKey;
        await redisClient.rpush(targetListKey, JSON.stringify(body.candidate));
        await redisClient.expire(targetListKey, 3600);
        await redisClient.expire(sessionKey, 3600);
      } else {
        return res.status(400).json({ error: 'Invalid action' });
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await Promise.all([
        redisClient.del(legacyKey),
        redisClient.del(sessionKey),
        redisClient.del(webCandsKey),
        redisClient.del(androidCandsKey)
      ]);
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
};
