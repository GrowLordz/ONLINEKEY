// api/status.js — GET /api/status
// Health check + key count

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({
    online:  true,
    service: "Grow Key Server",
    version: "1.0.0",
    time:    new Date().toISOString(),
  });
}
