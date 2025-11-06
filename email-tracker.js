/**
 * EMAIL TEMPLATE GENERATOR WITH TRACKING
 * Creates HTML emails with embedded tracking pixels and tracked document links
 */

const crypto = require('crypto');

class EmailTracker {
  constructor(serverUrl = 'http://localhost:3000') {
    this.serverUrl = serverUrl;
  }

  /**
   * Generate a unique document/email ID
   */
  generateId() {
    return crypto.randomUUID();
  }

  /**
   * Create tracking pixel URL for email opens
   */
  createTrackingPixel(documentId, recipientId) {
    const timestamp = Date.now();
    return `${this.serverUrl}/api/track/pixel/${documentId}/${recipientId}?action=opened&ts=${timestamp}`;
  }

  /**
   * Create tracked document download link
   */
  createTrackedDocumentLink(documentId, recipientId, documentName) {
    return `${this.serverUrl}/documents/${documentId}?recipient=${recipientId}&name=${encodeURIComponent(documentName)}`;
  }

  /**
   * Generate complete email HTML with tracking
   */
  generateEmailHTML(options = {}) {
    const {
      recipientEmail,
      recipientName,
      subject = 'Important Document',
      documentName = 'confidential_report.pdf',
      message = 'Please review the attached document.',
      senderName = 'Your Name',
      documentId = this.generateId(),
      recipientId = this.generateId()
    } = options;

    const trackingPixel = this.createTrackingPixel(documentId, recipientId);
    const documentLink = this.createTrackedDocumentLink(documentId, recipientId, documentName);

    return {
      documentId,
      recipientId,
      html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .email-container {
      background-color: white;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      border-bottom: 3px solid #667eea;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    h1 {
      color: #667eea;
      margin: 0;
      font-size: 24px;
    }
    .greeting {
      font-size: 16px;
      margin-bottom: 20px;
    }
    .message {
      margin-bottom: 30px;
      line-height: 1.8;
    }
    .document-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 8px;
      padding: 25px;
      margin: 30px 0;
      text-align: center;
    }
    .document-icon {
      font-size: 48px;
      margin-bottom: 15px;
    }
    .document-name {
      color: white;
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 20px;
    }
    .download-btn {
      display: inline-block;
      background-color: white;
      color: #667eea;
      padding: 12px 30px;
      text-decoration: none;
      border-radius: 5px;
      font-weight: bold;
      transition: transform 0.2s;
    }
    .download-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    }
    .warning {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .warning-title {
      font-weight: bold;
      color: #856404;
      margin-bottom: 5px;
    }
    .warning-text {
      color: #856404;
      font-size: 14px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 14px;
      color: #666;
    }
    .metadata {
      font-size: 12px;
      color: #999;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1>🔒 Secure Document Delivery</h1>
    </div>
    
    <div class="greeting">
      Hello ${recipientName || recipientEmail},
    </div>
    
    <div class="message">
      ${message}
    </div>
    
    <div class="document-box">
      <div class="document-icon">📄</div>
      <div class="document-name">${documentName}</div>
      <a href="${documentLink}" class="download-btn" id="document-link">
        📥 View Document
      </a>
    </div>
    
    <div class="warning">
      <div class="warning-title">⚠️ Important Notice</div>
      <div class="warning-text">
        This document is confidential and intended only for ${recipientEmail}. 
        All access is tracked and logged. Do not forward or share without authorization.
      </div>
    </div>
    
    <div class="footer">
      <p>Best regards,<br>${senderName}</p>
      <div class="metadata">
        Document ID: ${documentId}<br>
        Recipient ID: ${recipientId}<br>
        Generated: ${new Date().toLocaleString()}
      </div>
    </div>
  </div>
  
  <!-- Tracking Pixel (invisible 1x1 image) -->
  <img src="${trackingPixel}" width="1" height="1" style="display:none;" alt="">
  
  <!-- Enhanced tracking script -->
  <script>
    // Track link clicks
    document.addEventListener('DOMContentLoaded', function() {
      const docLink = document.getElementById('document-link');
      if (docLink) {
        docLink.addEventListener('click', function(e) {
          // Send tracking beacon
          if (navigator.sendBeacon) {
            navigator.sendBeacon('${this.serverUrl}/api/track/document-open', JSON.stringify({
              documentId: '${documentId}',
              recipientId: '${recipientId}',
              timestamp: new Date().toISOString()
            }));
          }
        });
      }
    });
    
    // Track email read time
    let startTime = Date.now();
    window.addEventListener('beforeunload', function() {
      const readTime = Date.now() - startTime;
      if (navigator.sendBeacon && readTime > 1000) {
        navigator.sendBeacon('${this.serverUrl}/api/track/pixel/${documentId}/${recipientId}?action=read&duration=' + readTime);
      }
    });
  </script>
</body>
</html>
      `.trim()
    };
  }

  /**
   * Generate plain text version (for email clients that don't support HTML)
   */
  generatePlainText(options = {}) {
    const {
      recipientEmail,
      recipientName,
      documentName = 'confidential_report.pdf',
      message = 'Please review the attached document.',
      senderName = 'Your Name',
      documentLink
    } = options;

    return `
Hello ${recipientName || recipientEmail},

${message}

Document: ${documentName}
Access Link: ${documentLink}

⚠️ IMPORTANT NOTICE
This document is confidential and intended only for ${recipientEmail}.
All access is tracked and logged. Do not forward or share without authorization.

Best regards,
${senderName}
    `.trim();
  }

  /**
   * Create tracked document page with embedded tracking
   */
  generateTrackedDocumentPage(documentId, recipientId, documentUrl, documentName) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${documentName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      text-align: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    .warning-banner {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px;
      margin-bottom: 20px;
      border-radius: 4px;
    }
    .pdf-viewer {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      overflow: hidden;
      height: calc(100vh - 200px);
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
    .controls {
      background: white;
      padding: 15px;
      margin-bottom: 20px;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .btn {
      padding: 10px 20px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    .btn:hover {
      background: #5568d3;
    }
    .btn-danger {
      background: #dc3545;
    }
    .btn-danger:hover {
      background: #c82333;
    }
    .tracking-indicator {
      color: #28a745;
      font-size: 14px;
    }
    .tracking-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: #28a745;
      border-radius: 50%;
      margin-right: 8px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔒 Secure Document Viewer</h1>
    <p>${documentName}</p>
  </div>
  
  <div class="container">
    <div class="warning-banner">
      <strong>⚠️ Tracked Document</strong><br>
      All interactions with this document are monitored and logged. This includes viewing, downloading, printing, and copying.
    </div>
    
    <div class="controls">
      <div class="tracking-indicator">
        <span class="tracking-dot"></span>
        Tracking Active - All actions logged
      </div>
      <div>
        <a href="${documentUrl}" download="${documentName}" class="btn" id="download-btn">
          📥 Download
        </a>
        <button onclick="window.print()" class="btn btn-danger" id="print-btn">
          🖨️ Print
        </button>
      </div>
    </div>
    
    <div class="pdf-viewer">
      <iframe src="${documentUrl}" id="pdf-frame"></iframe>
    </div>
  </div>

  <!-- Load tracking script -->
  <script src="/pdf-client-tracker.js"></script>
  <script>
    // Initialize tracker
    const tracker = new PDFClientTracker({
      serverUrl: '${this.serverUrl}',
      documentId: '${documentId}',
      recipientId: '${recipientId}',
      watermarkId: 'watermark_${documentId.substring(0, 8)}',
      enableTracking: true
    });

    // Track download button
    document.getElementById('download-btn').addEventListener('click', function() {
      tracker.trackEvent('download', {
        documentId: '${documentId}',
        recipientId: '${recipientId}'
      });
    });

    // Track print button
    document.getElementById('print-btn').addEventListener('click', function() {
      tracker.trackEvent('print', {
        documentId: '${documentId}',
        recipientId: '${recipientId}'
      });
    });

    // Prevent right-click (optional security measure)
    document.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      alert('Right-click is disabled on this document.');
    });
  </script>
</body>
</html>
    `.trim();
  }
}

module.exports = EmailTracker;