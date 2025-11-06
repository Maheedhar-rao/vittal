/**
 * DATABASE INITIALIZATION
 * Creates SQLite database with tables for persistent tracking
 */

const Database = require('better-sqlite3');
const fs = require('fs');

const DB_PATH = './tracking.db';

function initDatabase() {
  console.log('🗄️  Initializing database...\n');
  
  const db = new Database(DB_PATH);
  
  // Create events table
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      documentId TEXT NOT NULL,
      recipientId TEXT NOT NULL,
      action TEXT,
      pageNumber INTEGER,
      timeSpent INTEGER,
      timestamp TEXT NOT NULL,
      ipAddress TEXT,
      location TEXT,
      city TEXT,
      country TEXT,
      device TEXT,
      userAgent TEXT,
      risk TEXT,
      watermarkId TEXT,
      forwardedTo TEXT,
      unauthorized INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Create alerts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      eventId TEXT,
      documentId TEXT,
      recipientId TEXT,
      requiresAction INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (eventId) REFERENCES events(id)
    )
  `);
  
  // Create incidents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      documentId TEXT NOT NULL,
      fromRecipient TEXT,
      toRecipient TEXT,
      status TEXT DEFAULT 'open',
      timestamp TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Create emails table (for tracking sent emails)
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      documentId TEXT NOT NULL UNIQUE,
      recipientId TEXT NOT NULL,
      recipientEmail TEXT NOT NULL,
      recipientName TEXT,
      subject TEXT NOT NULL,
      documentName TEXT NOT NULL,
      sentAt TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'sent'
    )
  `);
  
  // Create indices for better performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_documentId ON events(documentId);
    CREATE INDEX IF NOT EXISTS idx_events_recipientId ON events(recipientId);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_emails_documentId ON emails(documentId);
  `);
  
  console.log('✅ Database initialized successfully!');
  console.log('📊 Tables created:');
  console.log('   • events - All tracking events');
  console.log('   • alerts - Security alerts');
  console.log('   • incidents - Security incidents');
  console.log('   • emails - Sent emails log');
  console.log(`\n💾 Database file: ${DB_PATH}\n`);
  
  db.close();
}

// Run if called directly
if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase, DB_PATH };