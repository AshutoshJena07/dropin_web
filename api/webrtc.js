const Redis = require('ioredis');

// Global in-memory storage fallback when Redis is unconfigured or unreachable
global.__dropinMemoryStore = global.__dropinMemoryStore || {
  sessions: new Map(),
  candidatesWeb: new Map(),
  candidatesAndroid: new Map()
};

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
    redisClient.on('error', (err) => {
      // Gracefully log without crashing
      console.warn('Redis connection issue, using memory fallback:', err.message);
    });
  } catch (e) {
    redisClient = null;
  }
}

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
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

  const memStore = global.__dropinMemoryStore;
  if (!memStore.sessions.has(cleanPin)) {
    memStore.sessions.set(cleanPin, {});
  }
  if (!memStore.candidatesWeb.has(cleanPin)) {
    memStore.candidatesWeb.set(cleanPin, []);
  }
  if (!memStore.candidatesAndroid.has(cleanPin)) {
    memStore.candidatesAndroid.set(cleanPin, []);
  }

  if (req.method === 'GET') {
    let offer = null;
    let answer = null;
    let metadata = null;
    let candidates_web = [];
    let candidates_android = [];

    // Try Redis if alive, fallback to in-memory store
    if (redisClient && redisClient.status === 'ready') {
      try {
        const [sessionMap, webCands, androidCands] = await Promise.all([
          redisClient.hgetall(sessionKey),
          redisClient.lrange(webCandsKey, 0, -1),
          redisClient.lrange(androidCandsKey, 0, -1)
        ]);

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

          return res.status(200).json({
            offer,
            answer,
            metadata,
            candidates_web,
            candidates_android
          });
        }
      } catch (err) {
        console.warn('Redis GET failed, using memory store fallback:', err.message);
      }
    }

    // Memory Store Fallback
    const memSession = memStore.sessions.get(cleanPin) || {};
    return res.status(200).json({
      offer: memSession.offer || null,
      answer: memSession.answer || null,
      metadata: memSession.metadata || null,
      candidates_web: memStore.candidatesWeb.get(cleanPin) || [],
      candidates_android: memStore.candidatesAndroid.get(cleanPin) || []
    });
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const memSession = memStore.sessions.get(cleanPin);

      if (action === 'setOffer') {
        memSession.offer = body.offer;
        memSession.answer = null;
        memStore.candidatesAndroid.set(cleanPin, []);

        if (redisClient && redisClient.status === 'ready') {
          try {
            await Promise.all([
              redisClient.hset(sessionKey, 'offer', JSON.stringify(body.offer)),
              redisClient.hdel(sessionKey, 'answer'),
              redisClient.del(androidCandsKey)
            ]);
            await redisClient.expire(sessionKey, 3600);
          } catch (e) {}
        }
      } else if (action === 'setAnswer') {
        memSession.answer = body.answer;

        if (redisClient && redisClient.status === 'ready') {
          try {
            await redisClient.hset(sessionKey, 'answer', JSON.stringify(body.answer));
            await redisClient.expire(sessionKey, 3600);
          } catch (e) {}
        }
      } else if (action === 'setMetadata') {
        memSession.metadata = body.metadata;
        memSession.offer = null;
        memSession.answer = null;
        memStore.candidatesWeb.set(cleanPin, []);
        memStore.candidatesAndroid.set(cleanPin, []);

        if (redisClient && redisClient.status === 'ready') {
          try {
            await Promise.all([
              redisClient.hset(sessionKey, 'metadata', JSON.stringify(body.metadata)),
              redisClient.hdel(sessionKey, 'offer'),
              redisClient.hdel(sessionKey, 'answer'),
              redisClient.del(webCandsKey),
              redisClient.del(androidCandsKey)
            ]);
            await redisClient.expire(sessionKey, 3600);
          } catch (e) {}
        }
      } else if (action === 'addCandidate') {
        if (role === 'android') {
          memStore.candidatesAndroid.get(cleanPin).push(body.candidate);
        } else {
          memStore.candidatesWeb.get(cleanPin).push(body.candidate);
        }

        if (redisClient && redisClient.status === 'ready') {
          try {
            const targetListKey = role === 'android' ? androidCandsKey : webCandsKey;
            await redisClient.rpush(targetListKey, JSON.stringify(body.candidate));
            await redisClient.expire(targetListKey, 3600);
            await redisClient.expire(sessionKey, 3600);
          } catch (e) {}
        }
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
    memStore.sessions.delete(cleanPin);
    memStore.candidatesWeb.delete(cleanPin);
    memStore.candidatesAndroid.delete(cleanPin);

    if (redisClient && redisClient.status === 'ready') {
      try {
        await Promise.all([
          redisClient.del(sessionKey),
          redisClient.del(webCandsKey),
          redisClient.del(androidCandsKey)
        ]);
      } catch (e) {}
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
};
