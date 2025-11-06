/**
 * REAL EMAIL SENDER - FIXED VERSION
 * Send tracked emails using your email provider
 */

const crypto = require('crypto');
const readline = require('readline');
require('dotenv').config();

// Fix for nodemailer import
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (err) {
  console.error('❌ Error loading nodemailer:', err.message);
  console.log('\nPlease install nodemailer:');
  console.log('  npm install nodemailer');
  process.exit(1);
}

// Database
let Database;
let db;
try {
  Database = require('better-sqlite3');
  db = new Database('./tracking.db');
} catch (err) {
  console.error('❌ Error loading database:', err.message);
  console.log('\nPlease run: node init-db.js');
  process.exit(1);
}

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

// === NEW: use EmailTracker for unified tracking templates ===
const EmailTracker = require('./email-tracker');
const tracker = new EmailTracker(SERVER_URL);

// ============================================
// EMAIL CONFIGURATION
// ============================================

function createTransporter() {
  const config = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  };

  console.log('📧 Creating email transporter...');
  console.log('   Host:', config.host);
  console.log('   Port:', config.port);
  console.log('   User:', config.auth.user);
  
  return nodemailer.createTransport(config);
}

// ============================================
// EMAIL TEMPLATE GENERATOR (NOW USING EmailTracker)
// ============================================

function generateTrackedEmail(options) {
  const {
    recipientEmail,
    recipientName,
    subject,
    documentName,
    message,
    senderName,
    documentId,
    recipientId
  } = options;

  // Use EmailTracker to build the HTML with pixel + tracking script
  const emailHtmlData = tracker.generateEmailHTML({
    recipientEmail,
    recipientName,
    subject: subject || 'Important Document',
    documentName: documentName || 'confidential_report.pdf',
    message: message || 'Please review the attached document.',
    senderName: senderName || 'Your Company',
    documentId,
    recipientId
  });

  const finalDocumentId = emailHtmlData.documentId;
  const finalRecipientId = emailHtmlData.recipientId;

  // Build the same document link for the plain-text version
  const documentLink = `${SERVER_URL}/documents/${finalDocumentId}?recipient=${finalRecipientId}&name=${encodeURIComponent(documentName)}`;

  const text = tracker.generatePlainText({
    recipientEmail,
    recipientName,
    documentName,
    message,
    senderName,
    documentLink
  });

  return {
    documentId: finalDocumentId,
    recipientId: finalRecipientId,
    html: emailHtmlData.html,
    text
  };
}

// ============================================
// SEND EMAIL FUNCTION
// ============================================

async function sendTrackedEmail(options) {
  const {
    recipientEmail,
    recipientName = '',
    subject,
    documentName,
    message,
    senderName = process.env.SENDER_NAME || 'Your Company'
  } = options;

  console.log('\n📧 Preparing to send tracked email...\n');

  // Generate tracked email (now backed by EmailTracker)
  const emailData = generateTrackedEmail({
    recipientEmail,
    recipientName,
    subject,
    documentName,
    message,
    senderName
  });

  // Save to database
  try {
    const stmt = db.prepare(`
      INSERT INTO emails (id, documentId, recipientId, recipientEmail, recipientName, subject, documentName, sentAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const emailId = crypto.randomUUID();
    stmt.run(
      emailId,
      emailData.documentId,
      emailData.recipientId,
      recipientEmail,
      recipientName,
      subject,
      documentName,
      new Date().toISOString()
    );
    console.log('✅ Email record saved to database\n');
  } catch (err) {
    console.error('⚠️  Database error:', err.message);
  }

  // Send email
  const transporter = createTransporter();

  const mailOptions = {
    from: `"${senderName}" <${process.env.EMAIL_USER}>`,
    to: recipientEmail,
    subject: subject,
    text: emailData.text,
    html: emailData.html
  };

  try {
    console.log('📤 Sending email...\n');
    const info = await transporter.sendMail(mailOptions);
    
    console.log('✅ Email sent successfully!\n');
    console.log('━'.repeat(60));
    console.log(`📨 To: ${recipientEmail}`);
    console.log(`📋 Subject: ${subject}`);
    console.log(`📄 Document: ${documentName}`);
    console.log(`🆔 Document ID: ${emailData.documentId}`);
    console.log(`🆔 Recipient ID: ${emailData.recipientId}`);
    console.log(`📊 Message ID: ${info.messageId}`);
    console.log('━'.repeat(60));
    console.log('\n🎯 Tracking is now ACTIVE!\n');
    console.log('When the recipient:');
    console.log('  • Opens the email → Tracking pixel fires');
    console.log('  • Clicks the link → Document access tracked');
    console.log('  • Views pages → Page views logged');
    console.log('  • Downloads → HIGH RISK alert');
    console.log('  • Prints → CRITICAL alert\n');
    console.log('📊 View real-time tracking:');
    console.log(`   ${SERVER_URL}/dashboard.html\n`);

    return {
      success: true,
      messageId: info.messageId,
      documentId: emailData.documentId,
      recipientId: emailData.recipientId
    };
  } catch (error) {
    console.error('\n❌ Error sending email:', error.message);
    if (error.message.includes('Invalid login')) {
      console.log('\n💡 Tips:');
      console.log('   • Gmail: Use App Password (not regular password)');
      console.log('   • Generate at: https://myaccount.google.com/apppasswords');
      console.log('   • Remove spaces from password in .env');
    }
    throw error;
  }
}

// ============================================
// INTERACTIVE CLI
// ============================================

async function interactiveSendEmail() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║          📧 SEND TRACKED EMAIL - INTERACTIVE MODE          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    const recipientEmail = await question('📧 Recipient Email: ');
    const recipientName = await question('👤 Recipient Name (optional): ');
    const subject = await question('📋 Email Subject: ');
    const documentName = await question('📄 Document Name (e.g., report.pdf): ');
    console.log('\n💬 Email Message (press Enter twice when done):');
    const message = await question('');
    const senderName = await question('✍️  Your Name/Company: ');

    console.log('\n🔍 Review:');
    console.log(`  To: ${recipientEmail}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Document: ${documentName}\n`);

    const confirm = await question('Send email? (yes/no): ');

    if (confirm.toLowerCase() === 'yes' || confirm.toLowerCase() === 'y') {
      await sendTrackedEmail({
        recipientEmail,
        recipientName,
        subject,
        documentName,
        message,
        senderName
      });
    } else {
      console.log('\n❌ Email cancelled.\n');
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    rl.close();
  }
}

// ============================================
// QUICK SEND EXAMPLES
// ============================================

async function sendQuickExample() {
  console.log('\n📧 Sending example tracked email...\n');

  await sendTrackedEmail({
    recipientEmail: process.env.TEST_RECIPIENT_EMAIL || 'test@example.com',
    recipientName: 'Test User',
    subject: 'Test: Tracked Document',
    documentName: 'Test_Report.pdf',
    message: `This is a test email with tracking enabled.

Please click the link to view the document. All interactions will be tracked in real-time.`,
    senderName: 'Test System'
  });
}

// ============================================
// MAIN
// ============================================

async function main() {
  // Check if email is configured
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.log('\n❌ Email not configured!\n');
    console.log('Please set up your email credentials in .env file:');
    console.log('\nEMAIL_PROVIDER=gmail');
    console.log('EMAIL_USER=your-email@gmail.com');
    console.log('EMAIL_PASSWORD=your-app-password\n');
    console.log('For Gmail: https://support.google.com/accounts/answer/185833');
    console.log('\n');
    process.exit(1);
  }

  const args = process.argv.slice(2);

  if (args.includes('--quick') || args.includes('-q')) {
    await sendQuickExample();
  } else if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage:
  node send-email.js              Interactive mode
  node send-email.js --quick      Send test email
  node send-email.js --help       Show this help
    `);
  } else {
    await interactiveSendEmail();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { sendTrackedEmail, generateTrackedEmail };
