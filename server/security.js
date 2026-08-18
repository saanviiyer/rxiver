export function securityHeaders(_req, res, next) {
  res.set({
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });
  next();
}

export function rateLimit({ windowMs = 60_000, max = 120 } = {}) {
  const clients = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const entry = clients.get(key);
    const current = !entry || now - entry.startedAt >= windowMs
      ? { startedAt: now, count: 1 }
      : { ...entry, count: entry.count + 1 };
    clients.set(key, current);
    if (clients.size > 5_000) {
      for (const [client, value] of clients) {
        if (now - value.startedAt >= windowMs) clients.delete(client);
      }
    }
    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(Math.max(0, max - current.count)));
    if (current.count > max) {
      res.set("Retry-After", String(Math.ceil((windowMs - (now - current.startedAt)) / 1000)));
      return res.status(429).json({ error: "Too many requests. Please try again shortly." });
    }
    next();
  };
}

export function refreshAuthorized(req) {
  const token = process.env.REFRESH_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production";
  return req.get("authorization") === `Bearer ${token}`;
}
