/**
 * PDF CLIENT TRACKER
 * Tracks PDF document access, pages viewed, printing, downloading, etc.
 * Embed this script in PDFs or web pages to enable tracking
 */

class PDFClientTracker {
  constructor(config = {}) {
    this.serverUrl = config.serverUrl || 'http://localhost:3000';
    this.documentId = config.documentId;
    this.recipientId = config.recipientId;
    this.watermarkId = config.watermarkId;
    this.enableTracking = config.enableTracking !== false;
    
    this.sessionId = this.generateSessionId();
    this.pageTimeStarted = Date.now();
    this.currentPage = 1;
    
    console.log('📍 Initializing PDF Tracker', {
      documentId: this.documentId,
      recipientId: this.recipientId,
      serverUrl: this.serverUrl
    });
    
    this.init();
  }

  init() {
    if (!this.enableTracking) {
      console.log('📍 Tracking disabled');
      return;
    }
    
    // Track document open
    this.trackEvent('document-open', {
      documentId: this.documentId,
      recipientId: this.recipientId,
      watermarkId: this.watermarkId
    });

    // Setup event listeners
    this.setupEventListeners();
    
    // Setup page tracking
    this.setupPageTracking();
    
    console.log('✅ PDF Tracker initialized successfully');
  }

  setupEventListeners() {
    // Track print
    window.addEventListener('beforeprint', () => {
      console.log('🖨️ Print detected');
      this.trackEvent('print', {
        documentId: this.documentId,
        recipientId: this.recipientId
      });
    });

    // Track download (common PDF viewers)
    window.addEventListener('load', () => {
      // PDF.js viewer
      const downloadBtn = document.querySelector('[aria-label="Download"]');
      if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
          console.log('⬇️ Download detected');
          this.trackEvent('download', {
            documentId: this.documentId,
            recipientId: this.recipientId
          });
        });
      }
    });

    // Track copy
    document.addEventListener('copy', (e) => {
      console.log('📋 Copy detected');
      this.trackEvent('copy', {
        documentId: this.documentId,
        recipientId: this.recipientId,
        copiedText: e.clipboardData.getData('text').substring(0, 50)
      });
    });

    // Track visibility (tab active/inactive)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        console.log('❌ Tab hidden');
        this.recordPageTime();
      } else {
        console.log('✅ Tab active');
        this.pageTimeStarted = Date.now();
      }
    });

    // Track page changes in PDF viewer
    this.trackPageChanges();
  }

  trackPageChanges() {
    // For PDF.js viewer
    if (window.PDFViewerApplication) {
      const pdfViewer = window.PDFViewerApplication;
      
      pdfViewer.eventBus.on('pagerendered', (event) => {
        this.currentPage = pdfViewer.pdfViewer.currentPageNumber;
        
        this.trackEvent('page-view', {
          documentId: this.documentId,
          recipientId: this.recipientId,
          pageNumber: this.currentPage,
          timeSpent: Date.now() - this.pageTimeStarted
        });
        
        this.pageTimeStarted = Date.now();
      });
    }
  }

  setupPageTracking() {
    // Send heartbeat every 30 seconds
    setInterval(() => {
      if (!document.hidden && this.enableTracking) {
        this.trackEvent('page-view', {
          documentId: this.documentId,
          recipientId: this.recipientId,
          pageNumber: this.currentPage,
          timeSpent: Date.now() - this.pageTimeStarted
        });
      }
    }, 30000);
  }

  recordPageTime() {
    const timeSpent = Date.now() - this.pageTimeStarted;
    
    this.trackEvent('page-view', {
      documentId: this.documentId,
      recipientId: this.recipientId,
      pageNumber: this.currentPage,
      timeSpent: timeSpent
    });
  }

  trackEvent(eventType, data = {}) {
    if (!this.enableTracking) return;

    const endpoint = this.getEndpoint(eventType);
    const payload = {
      ...data,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      sessionId: this.sessionId
    };

    // Use sendBeacon for reliability (doesn't block page unload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, JSON.stringify(payload));
    } else {
      // Fallback to fetch
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(e => console.warn('⚠️ Tracking failed:', e));
    }
  }

  getEndpoint(eventType) {
    const baseUrl = `${this.serverUrl}/api/track`;
    
    switch(eventType) {
      case 'document-open': return `${baseUrl}/document-open`;
      case 'page-view': return `${baseUrl}/page-view`;
      case 'download': return `${baseUrl}/download`;
      case 'print': return `${baseUrl}/print`;
      case 'forward': return `${baseUrl}/forward`;
      case 'copy': return `${baseUrl}/copy`;
      default: return `${baseUrl}/event`;
    }
  }

  trackForwarding(forwardedTo) {
    console.log('↪️ Forwarding detected to:', forwardedTo);
    this.trackEvent('forward', {
      documentId: this.documentId,
      recipientId: this.recipientId,
      forwardedTo: forwardedTo
    });
  }

  generateSessionId() {
    return 'session_' + Math.random().toString(36).substring(2, 15) + 
           Date.now().toString(36);
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PDFClientTracker;
}