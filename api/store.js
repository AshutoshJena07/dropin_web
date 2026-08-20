// Global in-memory cache for active PIN sessions
// Key: PIN, Value: { url, token, expiresAt }
if (!global._dropinSessions) {
  global._dropinSessions = new Map();
}

module.exports = {
  setSession: (pin, data) => {
    const cleanPin = pin.trim().toUpperCase();
    global._dropinSessions.set(cleanPin, {
      ...data,
      expiresAt: Date.now() + 1000 * 60 * 30 // 30 minutes TTL
    });
  },
  getSession: (pin) => {
    const cleanPin = pin.trim().toUpperCase();
    const session = global._dropinSessions.get(cleanPin);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      global._dropinSessions.delete(cleanPin);
      return null;
    }
    return session;
  },
  removeSession: (pin) => {
    const cleanPin = pin.trim().toUpperCase();
    global._dropinSessions.delete(cleanPin);
  }
};
