const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const geoip = require('geoip-lite');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();


const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
// DB init
const { initDatabase, DB_PATH } = require('./init-db');
const Database = require('better-sqlite3');

// Initialize DB (safe to call multiple times)
initDatabase();
const sqlDb = new Database(DB_PATH);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Track connected dashboard clients (in memory)
const clients = new Set();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// ============================================
// HELPER FUNCTIONS
// ============================================

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] ||
         req.socket.remoteAddress ||
         'unknown';
}

function getLocationFromIP(ip) {
  if (ip === 'unknown') return 'Unknown Location';
  
  try {
    const geo = geoip.lookup(ip);
    if (geo) {
      return `${geo.city || 'Unknown'}, ${geo.country || 'Unknown'}`;
    }
  } catch (e) {
    console.error('Geolocation error:', e);
  }
  return 'Unknown Location';
}

function parseBrowserInfo(userAgent) {
  if (!userAgent) return 'Unknown';
  
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return 'Safari';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Edge')) return 'Edge';
  
  return 'Unknown';
}

function broadcastToAdmins(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Insert a tracking event into SQLite
const insertEventStmt = sqlDb.prepare(`
  INSERT INTO events (
    id, type, documentId, recipientId, action, pageNumber, timeSpent,
    timestamp, ipAddress, location, device, userAgent, risk,
    watermarkId, forwardedTo, unauthorized
  )
  VALUES (@id, @type, @documentId, @recipientId, @action, @pageNumber, @timeSpent,
          @timestamp, @ipAddress, @location, @device, @userAgent, @risk,
          @watermarkId, @forwardedTo, @unauthorized)
`);

function saveEvent(event) {
  // Provide defaults for optional fields
  const record = {
    id: event.id || crypto.randomUUID(),
    type: event.type,
    documentId: event.documentId,
    recipientId: event.recipientId,
    action: event.action || null,
    pageNumber: event.pageNumber ?? null,
    timeSpent: event.timeSpent ?? null,
    timestamp: event.timestamp || new Date().toISOString(),
    ipAddress: event.ipAddress || null,
    location: event.location || null,
    device: event.device || null,
    userAgent: event.userAgent || null,
    risk: event.risk || null,
    watermarkId: event.watermarkId || null,
    forwardedTo: event.forwardedTo || null,
    unauthorized: event.unauthorized ? 1 : 0
  };

  insertEventStmt.run(record);
  return record;
}

// Insert alert
const insertAlertStmt = sqlDb.prepare(`
  INSERT INTO alerts (
    id, type, severity, message, eventId, documentId, recipientId, requiresAction
  )
  VALUES (@id, @type, @severity, @message, @eventId, @documentId, @recipientId, @requiresAction)
`);

function saveAlert(alert) {
  const record = {
    id: alert.id || crypto.randomUUID(),
    type: alert.type,
    severity: alert.severity,
    message: alert.message,
    eventId: alert.eventId || null,
    documentId: alert.documentId || null,
    recipientId: alert.recipientId || null,
    requiresAction: alert.requiresAction ? 1 : 0
  };
  insertAlertStmt.run(record);
  return record;
}

// Insert incident
const insertIncidentStmt = sqlDb.prepare(`
  INSERT INTO incidents (
    id, type, severity, documentId, fromRecipient, toRecipient,
    status, timestamp
  )
  VALUES (@id, @type, @severity, @documentId, @fromRecipient, @toRecipient,
          @status, @timestamp)
`);

function saveIncident(incident) {
  const record = {
    id: incident.id || crypto.randomUUID(),
    type: incident.type,
    severity: incident.severity,
    documentId: incident.documentId,
    fromRecipient: incident.fromRecipient || null,
    toRecipient: incident.toRecipient || null,
    status: incident.status || 'open',
    timestamp: incident.timestamp || new Date().toISOString()
  };
  insertIncidentStmt.run(record);
  return record;
}

function checkForAnomalies(event, recipientId) {
  const anomalies = [];

  const recipientEvents = sqlDb.prepare(
    'SELECT * FROM events WHERE recipientId = ?'
  ).all(recipientId);

  // Check 1: Unusual location
  const locations = [...new Set(recipientEvents.map(e => e.location).filter(Boolean))];
  if (locations.length > 3 && event.location && !locations.includes(event.location)) {
    anomalies.push({
      type: 'UNUSUAL_LOCATION',
      severity: 'medium',
      message: `New location detected: ${event.location}`
    });
  }

  // Check 2: Unusual time (night access)
  const hour = new Date(event.timestamp).getHours();
  if (hour < 6 || hour > 22) {
    anomalies.push({
      type: 'UNUSUAL_TIME',
      severity: 'low',
      message: `Access at ${hour}:00 - outside business hours`
    });
  }

  // Check 3: Rapid access (bulk download)
  const oneMinuteAgo = Date.now() - 60000;
  const recentEvents = recipientEvents.filter(e => {
    const time = new Date(e.timestamp).getTime();
    return time >= oneMinuteAgo;
  });

  if (recentEvents.length > 5) {
    anomalies.push({
      type: 'RAPID_ACCESS',
      severity: 'high',
      message: `${recentEvents.length} accesses in 1 minute - possible data exfiltration`
    });
  }

  if (anomalies.length > 0) {
    broadcastToAdmins({ type: 'ANOMALY_DETECTED', anomalies, event });
  }
}

// ============================================
// TRACKING ENDPOINTS
// ============================================

// Tracking pixel endpoint
app.get('/api/track/pixel/:documentId/:recipientId', (req, res) => {
  const { documentId, recipientId } = req.params;
  const { action, ts } = req.query;

  const ip = getClientIP(req);
  const location = getLocationFromIP(ip);

  const event = saveEvent({
    id: crypto.randomUUID(),
    type: 'pixel_beacon',
    documentId,
    recipientId,
    action: action || 'viewed',
    timestamp: new Date(parseInt(ts) || Date.now()).toISOString(),
    ipAddress: ip,
    location,
    device: parseBrowserInfo(req.headers['user-agent']),
    userAgent: req.headers['user-agent']
  });

  broadcastToAdmins({ type: 'TRACKING_EVENT', event });

  // Return 1x1 pixel
  const pixel = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
    0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x0a, 0x00, 0x01,
    0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
    0x4d, 0x01, 0x00, 0x3b
  ]);

  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(pixel);
});

// Document open endpoint
app.post('/api/track/document-open', (req, res) => {
  const { documentId, recipientId, watermarkId } = req.body;

  const ip = getClientIP(req);
  const location = getLocationFromIP(ip);

  const event = saveEvent({
    id: crypto.randomUUID(),
    type: 'document_opened',
    documentId,
    recipientId,
    watermarkId,
    timestamp: new Date().toISOString(),
    ipAddress: ip,
    location,
    device: parseBrowserInfo(req.headers['user-agent']),
    userAgent: req.headers['user-agent'],
    risk: 'low'
  });

  broadcastToAdmins({ type: 'DOCUMENT_OPENED', event });
  checkForAnomalies(event, recipientId);

  res.json({ success: true, eventId: event.id });
});

// Page view endpoint
app.post('/api/track/page-view', (req, res) => {
  const { documentId, recipientId, pageNumber, timeSpent } = req.body;

  const ip = getClientIP(req);
  const location = getLocationFromIP(ip);

  const event = saveEvent({
    id: crypto.randomUUID(),
    type: 'page_viewed',
    documentId,
    recipientId,
    pageNumber,
    timeSpent,
    timestamp: new Date().toISOString(),
    ipAddress: ip,
    location,
    device: parseBrowserInfo(req.headers['user-agent']),
    userAgent: req.headers['user-agent']
  });

  broadcastToAdmins({ type: 'PAGE_VIEWED', event });

  res.json({ success: true });
});

// Download endpoint (HIGH RISK)
app.post('/api/track/download', (req, res) => {
  const { documentId, recipientId } = req.body;

  const ip = getClientIP(req);
  const location = getLocationFromIP(ip);

  const event = saveEvent({
    id: crypto.randomUUID(),
    type: 'document_downloaded',
    documentId,
    recipientId,
    timestamp: new Date().toISOString(),
    ipAddress: ip,
    location,
    device: parseBrowserInfo(req.headers['user-agent']),
    userAgent: req.headers['user-agent'],
    risk: 'high'
  });

  const alert = saveAlert({
    id: crypto.randomUUID(),
    type: 'HIGH_RISK_ACTION',
    severity: 'high',
    message: `⬇️ Document downloaded from ${event.location}`,
    eventId: event.id,
    documentId,
    recipientId,
    requiresAction: 0
  });

  broadcastToAdmins({ type: 'DOWNLOAD_ALERT', event, alert });

  res.json({ success: true });
});

// Print endpoint (CRITICAL RISK)
app.post('/api/track/print', (req, res) => {
  const { documentId, recipientId } = req.body;

  const ip = getClientIP(req);
  const location = getLocationFromIP(ip);

  const event = saveEvent({
    id: crypto.randomUUID(),
    type: 'document_printed',
    documentId,
    recipientId,
    timestamp: new Date().toISOString(),
    ipAddress: ip,
    location,
    device: parseBrowserInfo(req.headers['user-agent']),
    userAgent: req.headers['user-agent'],
    risk: 'critical'
  });

  const alert = saveAlert({
    id: crypto.randomUUID(),
    type: 'CRITICAL_ACTION',
    severity: 'critical',
    message: '🚨 CRITICAL: Document printed! Physical leak possible!',
    eventId: event.id,
    documentId,
    recipientId,
    requiresAction: 1
  });

  broadcastToAdmins({ 
    type: 'CRITICAL_ALERT', 
    event, 
    alert,
    sound: true 
  });

  res.json({ success: true, alertSent: true });
});

// Forward endpoint (UNAUTHORIZED)
app.post('/api/track/forward', (req, res) => {
  const { documentId, recipientId, forwardedTo } = req.body;

  const ip = getClientIP(req);
  const location = getLocationFromIP(ip);

  const event = saveEvent({
    id: crypto.randomUUID(),
    type: 'document_forwarded',
    documentId,
    recipientId,
    forwardedTo,
    timestamp: new Date().toISOString(),
    ipAddress: ip,
    location,
    device: parseBrowserInfo(req.headers['user-agent']),
    userAgent: req.headers['user-agent'],
    risk: 'critical',
    unauthorized: true
  });

  const incident = saveIncident({
    id: crypto.randomUUID(),
    type: 'UNAUTHORIZED_FORWARDING',
    severity: 'CRITICAL',
    documentId,
    fromRecipient: recipientId,
    toRecipient: forwardedTo,
    status: 'open',
    timestamp: new Date().toISOString()
  });

  const alert = saveAlert({
    id: crypto.randomUUID(),
    type: 'UNAUTHORIZED_SHARE',
    severity: 'critical',
    message: `🚨 Document forwarded to: ${forwardedTo}`,
    eventId: event.id,
    documentId,
    recipientId,
    requiresAction: 1
  });

  broadcastToAdmins({ 
    type: 'UNAUTHORIZED_SHARE_ALERT', 
    event, 
    incident, 
    alert,
    sound: true
  });

  res.json({ success: true, incidentCreated: true });
});

// Copy endpoint
app.post('/api/track/copy', (req, res) => {
  const { documentId, recipientId } = req.body;

  const ip = getClientIP(req);
  const location = getLocationFromIP(ip);

  const event = saveEvent({
    id: crypto.randomUUID(),
    type: 'copy_attempt',
    documentId,
    recipientId,
    timestamp: new Date().toISOString(),
    ipAddress: ip,
    location,
    device: parseBrowserInfo(req.headers['user-agent']),
    userAgent: req.headers['user-agent'],
    risk: 'medium'
  });

  broadcastToAdmins({ type: 'COPY_DETECTED', event });

  res.json({ success: true });
});

// ============================================
// QUERY ENDPOINTS
// ============================================

// Get all events for a document
app.get('/api/documents/:documentId/events', (req, res) => {
  const { documentId } = req.params;

  const events = sqlDb.prepare(
    'SELECT * FROM events WHERE documentId = ? ORDER BY timestamp DESC LIMIT 100'
  ).all(documentId);

  const summary = {
    totalEvents: events.length,
    opens: events.filter(e => e.type === 'document_opened').length,
    downloads: events.filter(e => e.type === 'document_downloaded').length,
    prints: events.filter(e => e.type === 'document_printed').length,
    forwards: events.filter(e => e.type === 'document_forwarded').length,
    copies: events.filter(e => e.type === 'copy_attempt').length,
    locations: [...new Set(events.map(e => e.location).filter(Boolean))],
    devices: [...new Set(events.map(e => e.device).filter(Boolean))]
  };

  res.json({ documentId, events, summary });
});

// Get all events for a recipient
app.get('/api/recipients/:recipientId/events', (req, res) => {
  const { recipientId } = req.params;

  const events = sqlDb.prepare(
    'SELECT * FROM events WHERE recipientId = ? ORDER BY timestamp DESC LIMIT 50'
  ).all(recipientId);

  const suspiciousEvents = events.filter(e => 
    e.risk === 'high' || e.risk === 'critical'
  );

  res.json({
    recipientId,
    totalEvents: events.length,
    events,
    suspicious: suspiciousEvents
  });
});

// Get tracking summary for document
app.get('/api/documents/:documentId/tracking-summary', (req, res) => {
  const { documentId } = req.params;

  const events = sqlDb.prepare(
    'SELECT * FROM events WHERE documentId = ? ORDER BY timestamp DESC'
  ).all(documentId);

  const incidents = sqlDb.prepare(
    'SELECT * FROM incidents WHERE documentId = ? ORDER BY timestamp DESC'
  ).all(documentId);

  res.json({
    documentId,
    totalEvents: events.length,
    incidents: incidents.length,
    riskLevel: incidents.length > 0 ? 'CRITICAL' : 'MEDIUM',
    lastActivity: events.length > 0 ? events[0].timestamp : null,
    recipients: [...new Set(events.map(e => e.recipientId).filter(Boolean))],
    locations: [...new Set(events.map(e => e.location).filter(Boolean))],
    timeline: events.slice(0, 50)
  });
});
// ============================================
// EMAIL SUMMARY ENDPOINT (PERSISTENT DASHBOARD)
// ============================================

app.get('/api/emails', (req, res) => {
  const rows = sqlDb.prepare(`
    SELECT
      e.id               AS emailId,
      e.documentId       AS documentId,
      e.recipientId      AS recipientId,
      e.recipientEmail   AS recipientEmail,
      e.recipientName    AS recipientName,
      e.subject          AS subject,
      e.documentName     AS documentName,
      e.sentAt           AS sentAt,

      -- aggregated stats from events
      COALESCE(SUM(CASE WHEN ev.type = 'document_opened'     THEN 1 ELSE 0 END), 0) AS openCount,
      MAX(CASE WHEN ev.type = 'document_opened'              THEN ev.timestamp END)  AS lastOpenAt,
      COALESCE(SUM(CASE WHEN ev.type = 'document_downloaded' THEN 1 ELSE 0 END), 0) AS downloadCount,
      COALESCE(SUM(CASE WHEN ev.type = 'document_printed'    THEN 1 ELSE 0 END), 0) AS printCount,
      COALESCE(SUM(CASE WHEN ev.type = 'document_forwarded'  THEN 1 ELSE 0 END), 0) AS forwardCount
    FROM emails e
    LEFT JOIN events ev
      ON ev.documentId = e.documentId
     AND ev.recipientId = e.recipientId
    GROUP BY e.id
    ORDER BY datetime(e.sentAt) DESC
    LIMIT 200;
  `).all();

  res.json({ emails: rows });
});


// Get all alerts
app.get('/api/alerts', (req, res) => {
  const alerts = sqlDb.prepare(
    'SELECT * FROM alerts ORDER BY createdAt DESC LIMIT 100'
  ).all();

  const totalAlerts = sqlDb.prepare(
    'SELECT COUNT(*) as count FROM alerts'
  ).get().count;

  res.json({ totalAlerts, alerts });
});

// Get all incidents
app.get('/api/incidents', (req, res) => {
  const incidents = sqlDb.prepare(
    'SELECT * FROM incidents ORDER BY timestamp DESC'
  ).all();

  const totalIncidents = sqlDb.prepare(
    'SELECT COUNT(*) as count FROM incidents'
  ).get().count;

  res.json({ totalIncidents, incidents });
});

// Health check
app.get('/api/health', (req, res) => {
  const totalEvents = sqlDb.prepare('SELECT COUNT(*) as count FROM events').get().count;
  const totalAlerts = sqlDb.prepare('SELECT COUNT(*) as count FROM alerts').get().count;
  const totalIncidents = sqlDb.prepare('SELECT COUNT(*) as count FROM incidents').get().count;

  res.json({
    status: 'ok',
    timestamp: new Date(),
    stats: {
      totalEvents,
      totalAlerts,
      totalIncidents,
      connectedAdmins: clients.size
    }
  });
});

app.get('/pdf-client-tracker.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'pdf-client-tracker.js'));
}); 

// ============================================
// WEBSOCKET: REAL-TIME DASHBOARD
// ============================================

wss.on('connection', (ws) => {
  console.log('👤 Admin connected to dashboard');
  clients.add(ws);

  const recentEvents = sqlDb.prepare(
    'SELECT * FROM events ORDER BY timestamp DESC LIMIT 20'
  ).all();

  const totalEvents = sqlDb.prepare('SELECT COUNT(*) as count FROM events').get().count;
  const totalAlerts = sqlDb.prepare('SELECT COUNT(*) as count FROM alerts').get().count;
  const totalIncidents = sqlDb.prepare('SELECT COUNT(*) as count FROM incidents').get().count;

  ws.send(JSON.stringify({
    type: 'CONNECTED',
    data: {
      totalEvents,
      totalAlerts,
      totalIncidents,
      recentEvents
    }
  }));

  ws.on('close', () => {
    console.log('👤 Admin disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// ============================================
// DOCUMENT VIEWER ROUTE
// ============================================

app.get('/documents/:documentId', (req, res) => {
  const { documentId } = req.params;
  const { recipient, name } = req.query;

  const documentName = name || 'Secure Document';
  const recipientId = recipient || 'anonymous';

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${documentName} - Secure Viewer</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e5e7eb;
      margin: 0;
      padding: 0;
      display: flex;
      min-height: 100vh;
      justify-content: center;
      align-items: center;
    }
    .container {
      background: #020617;
      border-radius: 16px;
      padding: 24px 28px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
      max-width: 640px;
      width: 100%;
      border: 1px solid #1e293b;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      color: #e5e7eb;
    }
    .meta {
      font-size: 12px;
      color: #9ca3af;
      margin-bottom: 16px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(59,130,246,0.15);
      color: #bfdbfe;
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 11px;
      margin-bottom: 16px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }
    button {
      border-radius: 999px;
      border: none;
      padding: 8px 16px;
      font-size: 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-primary {
      background: #3b82f6;
      color: white;
    }
    .btn-ghost {
      background: transparent;
      color: #e5e7eb;
      border: 1px solid #374151;
    }
    .notice {
      font-size: 12px;
      color: #9ca3af;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">
      <span>🔒 Secure Viewer Active</span>
    </div>
    <h1>${documentName}</h1>
    <div class="meta">
      Document ID: ${documentId}<br/>
      Recipient ID: ${recipientId}
    </div>
    <p>
      The actual document content would be embedded here (for example via
      a PDF viewer or secure iframe).
    </p>
    <p>
      All interactions on this page are being tracked: opens, page views,
      downloads, prints, and forwards.
    </p>
    <div class="actions">
      <button class="btn-primary" onclick="handleOpen()">
        📄 Open Document
      </button>
      <button class="btn-ghost" onclick="handleDownload()">
        ⬇️ Download
      </button>
      <button class="btn-ghost" onclick="handlePrint()">
        🖨️ Print
      </button>
    </div>
    <div class="notice">
      ⚠️ For production, replace this placeholder with a real embedded PDF / file
      viewer and wire the buttons to your actual download/print logic.
    </div>
  </div>

  <script src="/pdf-client-tracker.js"></script>
  <script>
    // Initialize tracker with same server URL & IDs used in the email
    const tracker = new PDFClientTracker({
      serverUrl: '${SERVER_URL}',
      documentId: '${documentId}',
      recipientId: '${recipientId}'
    });

    // Track that the document viewer itself was opened
    document.addEventListener('DOMContentLoaded', () => {
      tracker.trackDocumentOpen();
    });

    function handleOpen() {
      // You would open your real PDF/viewer here
      tracker.trackPageView(1); // example: first page viewed
      alert('Document "opened" (demo). Tracking event sent.');
    }

    function handleDownload() {
      tracker.trackDownload();
      alert('Download tracked (demo). Wire this to a real file.');
      // window.location.href = '/path/to/real.pdf';
    }

    function handlePrint() {
      tracker.trackPrint();
      alert('Print tracked (demo).');
      // window.print();
    }
  </script>
</body>
</html>
  `);
});


// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║       📍 PDF TRACKING SERVER STARTED                   ║
╚════════════════════════════════════════════════════════╝

🚀 Server: http://localhost:${PORT}
📊 WebSocket: ws://localhost:${PORT}
📊 Dashboard: http://localhost:${PORT}/dashboard.html

Available Endpoints:
  POST /api/track/document-open
  POST /api/track/page-view
  POST /api/track/download
  POST /api/track/print
  POST /api/track/forward
  POST /api/track/copy
  
  GET  /api/documents/:documentId/events
  GET  /api/documents/:documentId/tracking-summary
  GET  /api/recipients/:recipientId/events
  GET  /api/alerts
  GET  /api/incidents
  GET  /api/health
  `);
});

module.exports = { app, server, wss, db: sqlDb };
