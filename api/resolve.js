const { getSession } = require('./store');

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

  const { pin } = req.query;

  if (!pin) {
    return res.status(400).json({ error: 'Please provide a 6-digit PIN' });
  }

  const session = getSession(pin);

  if (!session) {
    return res.status(404).json({
      error: 'Session not found or expired. Please verify the PIN on your phone.'
    });
  }

  return res.status(200).json({
    success: true,
    pin: pin.trim().toUpperCase(),
    url: session.url
  });
};
