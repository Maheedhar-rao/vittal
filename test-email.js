/**
 * REAL-TIME TRACKING TEST SCRIPT
 * Demonstrates email and document tracking capabilities
 */

const EmailTracker = require('./email-tracker');
const http = require('http');
const fs = require('fs');

const SERVER_URL = 'http://localhost:3000';
const tracker = new EmailTracker(SERVER_URL);

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkServerHealth() {
  return new Promise((resolve, reject) => {
    http.get(`${SERVER_URL}/api/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error('Server not healthy'));
        }
      });
    }).on('error', reject);
  });
}

async function sendTrackingRequest(endpoint, method = 'POST', data = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, SERVER_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Test Client)'
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          resolve(responseData);
        }
      });
    });

    req.on('error', reject);
    
    if (method === 'POST') {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function simulateEmailOpen(documentId, recipientId) {
  log(`\n📧 Simulating email open...`, 'cyan');
  
  const pixelUrl = `/api/track/pixel/${documentId}/${recipientId}?action=opened&ts=${Date.now()}`;
  
  await sendTrackingRequest(pixelUrl, 'GET');
  log(`✅ Email opened - Tracking pixel loaded`, 'green');
}

async function simulateDocumentOpen(documentId, recipientId) {
  log(`\n📄 Simulating document open...`, 'cyan');
  
  const response = await sendTrackingRequest('/api/track/document-open', 'POST', {
    documentId,
    recipientId,
    watermarkId: `watermark_${documentId.substring(0, 8)}`
  });
  
  log(`✅ Document opened - Event ID: ${response.eventId}`, 'green');
}

async function simulatePageViews(documentId, recipientId, numPages = 5) {
  log(`\n📖 Simulating page views...`, 'cyan');
  
  for (let page = 1; page <= numPages; page++) {
    await sendTrackingRequest('/api/track/page-view', 'POST', {
      documentId,
      recipientId,
      pageNumber: page,
      timeSpent: Math.floor(Math.random() * 30000) + 5000 // 5-35 seconds
    });
    
    log(`  Page ${page} viewed (${Math.floor(Math.random() * 30) + 5}s)`, 'blue');
    await sleep(500);
  }
  
  log(`✅ All pages viewed`, 'green');
}

async function simulateDownload(documentId, recipientId) {
  log(`\n⬇️  Simulating document download (HIGH RISK)...`, 'yellow');
  
  const response = await sendTrackingRequest('/api/track/download', 'POST', {
    documentId,
    recipientId
  });
  
  log(`⚠️  ALERT: Download detected! Alert created`, 'red');
}

async function simulatePrint(documentId, recipientId) {
  log(`\n🖨️  Simulating print action (CRITICAL RISK)...`, 'yellow');
  
  const response = await sendTrackingRequest('/api/track/print', 'POST', {
    documentId,
    recipientId
  });
  
  log(`🚨 CRITICAL ALERT: Print detected! Physical leak possible!`, 'red');
}

async function simulateForwarding(documentId, recipientId) {
  log(`\n↪️  Simulating unauthorized forwarding (CRITICAL)...`, 'yellow');
  
  const response = await sendTrackingRequest('/api/track/forward', 'POST', {
    documentId,
    recipientId,
    forwardedTo: 'unauthorized@external.com'
  });
  
  log(`🚨 SECURITY INCIDENT: Document forwarded to unauthorized recipient!`, 'red');
}

async function simulateCopy(documentId, recipientId) {
  log(`\n📋 Simulating copy action...`, 'cyan');
  
  await sendTrackingRequest('/api/track/copy', 'POST', {
    documentId,
    recipientId
  });
  
  log(`⚠️  Copy detected - Content may be extracted`, 'yellow');
}

async function displayTrackingSummary(documentId) {
  log(`\n📊 Fetching tracking summary...`, 'cyan');
  
  const summary = await sendTrackingRequest(`/api/documents/${documentId}/tracking-summary`, 'GET');
  
  log(`\n${'='.repeat(60)}`, 'bright');
  log(`TRACKING SUMMARY FOR DOCUMENT`, 'bright');
  log(`${'='.repeat(60)}`, 'bright');
  log(`Document ID: ${summary.documentId}`, 'cyan');
  log(`Total Events: ${summary.totalEvents}`, 'blue');
  log(`Incidents: ${summary.incidents}`, summary.incidents > 0 ? 'red' : 'green');
  log(`Risk Level: ${summary.riskLevel}`, summary.riskLevel === 'CRITICAL' ? 'red' : 'yellow');
  log(`Recipients: ${summary.recipients.length}`, 'blue');
  log(`Locations: ${summary.locations.join(', ')}`, 'blue');
  log(`Last Activity: ${summary.lastActivity}`, 'cyan');
  log(`${'='.repeat(60)}\n`, 'bright');
}

async function displayAlerts() {
  log(`\n🔔 Fetching alerts...`, 'cyan');
  
  const alertsData = await sendTrackingRequest('/api/alerts', 'GET');
  
  if (alertsData.alerts.length === 0) {
    log(`No alerts yet`, 'blue');
    return;
  }
  
  log(`\n${'='.repeat(60)}`, 'bright');
  log(`SECURITY ALERTS (${alertsData.totalAlerts} total)`, 'bright');
  log(`${'='.repeat(60)}`, 'bright');
  
  alertsData.alerts.slice(0, 5).forEach((alert, i) => {
    const severityColor = {
      'critical': 'red',
      'high': 'yellow',
      'medium': 'blue',
      'low': 'cyan'
    }[alert.severity] || 'reset';
    
    log(`\n${i + 1}. [${alert.severity.toUpperCase()}] ${alert.type}`, severityColor);
    log(`   ${alert.message}`, 'reset');
    log(`   Time: ${alert.createdAt}`, 'reset');
  });
  
  log(`\n${'='.repeat(60)}\n`, 'bright');
}

async function generateAndSaveEmail() {
  log(`\n✉️  Generating tracked email...`, 'cyan');
  
  const emailData = tracker.generateEmailHTML({
    recipientEmail: 'john.doe@company.com',
    recipientName: 'John Doe',
    subject: 'Q4 Financial Report - CONFIDENTIAL',
    documentName: 'Q4_Financial_Report_2025.pdf',
    message: `
      Please review the attached Q4 financial report at your earliest convenience.
      This document contains sensitive financial data and should not be shared outside the organization.
    `,
    senderName: 'Finance Department'
  });
  
  // Save email HTML
  fs.writeFileSync('./test-email.html', emailData.html);
  
  log(`✅ Email generated and saved to: test-email.html`, 'green');
  log(`   Document ID: ${emailData.documentId}`, 'blue');
  log(`   Recipient ID: ${emailData.recipientId}`, 'blue');
  
  return emailData;
}

async function runFullDemo() {
  try {
    log(`\n${'='.repeat(60)}`, 'bright');
    log(`🔍 EMAIL & DOCUMENT TRACKING - REAL-TIME DEMO`, 'bright');
    log(`${'='.repeat(60)}\n`, 'bright');
    
    // Check server
    log(`🔌 Checking server connection...`, 'cyan');
    const health = await checkServerHealth();
    log(`✅ Server is running!`, 'green');
    log(`   Total Events: ${health.stats.totalEvents}`, 'blue');
    log(`   Total Alerts: ${health.stats.totalAlerts}`, 'blue');
    log(`   Total Incidents: ${health.stats.totalIncidents}`, 'blue');
    
    await sleep(2000);
    
    // Generate email
    const emailData = await generateAndSaveEmail();
    const { documentId, recipientId } = emailData;
    
    await sleep(2000);
    
    log(`\n🎬 Starting simulation...`, 'magenta');
    log(`📊 Open the dashboard to see real-time updates!`, 'cyan');
    log(`   Dashboard URL: ${SERVER_URL}/dashboard.html\n`, 'bright');
    
    await sleep(3000);
    
    // SCENARIO 1: Normal document viewing
    log(`\n${'─'.repeat(60)}`, 'blue');
    log(`SCENARIO 1: Normal Document Access`, 'bright');
    log(`${'─'.repeat(60)}`, 'blue');
    
    await simulateEmailOpen(documentId, recipientId);
    await sleep(2000);
    
    await simulateDocumentOpen(documentId, recipientId);
    await sleep(2000);
    
    await simulatePageViews(documentId, recipientId, 5);
    await sleep(2000);
    
    // SCENARIO 2: Risky actions
    log(`\n${'─'.repeat(60)}`, 'yellow');
    log(`SCENARIO 2: High-Risk Actions`, 'bright');
    log(`${'─'.repeat(60)}`, 'yellow');
    
    await simulateCopy(documentId, recipientId);
    await sleep(2000);
    
    await simulateDownload(documentId, recipientId);
    await sleep(3000);
    
    // SCENARIO 3: Critical security events
    log(`\n${'─'.repeat(60)}`, 'red');
    log(`SCENARIO 3: Critical Security Events`, 'bright');
    log(`${'─'.repeat(60)}`, 'red');
    
    await simulatePrint(documentId, recipientId);
    await sleep(2000);
    
    await simulateForwarding(documentId, recipientId);
    await sleep(2000);
    
    // Display results
    await displayTrackingSummary(documentId);
    await displayAlerts();
    
    log(`\n✅ DEMO COMPLETE!`, 'green');
    log(`\n📊 Check the dashboard for real-time visualization:`, 'cyan');
    log(`   ${SERVER_URL}/dashboard.html\n`, 'bright');
    
    log(`📧 Open the generated email to test tracking:`, 'cyan');
    log(`   Open: test-email.html in your browser\n`, 'bright');
    
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
    log(`\n💡 Make sure the server is running:`, 'yellow');
    log(`   npm start`, 'bright');
  }
}

// Run if called directly
if (require.main === module) {
  runFullDemo();
}

module.exports = {
  simulateEmailOpen,
  simulateDocumentOpen,
  simulatePageViews,
  simulateDownload,
  simulatePrint,
  simulateForwarding,
  simulateCopy,
  displayTrackingSummary,
  displayAlerts
};