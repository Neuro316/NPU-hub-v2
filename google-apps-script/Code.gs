/**
 * =============================================================================
 * NPU HUB - UNIFIED GOOGLE APPS SCRIPT BACKEND
 * =============================================================================
 * 
 * This single Apps Script powers ALL Google integrations for the NPU Hub:
 * 1. Send Resources Email (Gmail)
 * 2. ShipIt Journal: Create folders, docs, sync content, pull from doc
 * 3. Connection testing
 * 
 * SETUP:
 * 1. Go to script.google.com → New Project
 * 2. Paste this entire file into Code.gs
 * 3. Deploy → New Deployment → Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the Web App URL
 * 5. In NPU Hub → Integrations → Google Apps Script → paste URL
 * 
 * AFTER CHANGES: Always create a NEW deployment (Manage Deployments → New)
 * =============================================================================
 */

const CONFIG = {
  senderName: 'Cameron Allen',
  senderEmail: 'cameron.allen@neuroprogeny.com',
  companyName: 'Neuro Progeny',
  companyWebsite: 'https://neuroprogeny.com',
  companyTagline: 'Building Nervous System Capacity',
  primaryColor: '#386797',
  accentColor: '#E8B54A',
  logoUrl: '',
  enableLogging: true,

  // Parent folder IDs (optional - leave empty to use root)
  // Create a "NPU Hub" folder in Drive, right-click → Get link → extract ID
  shipitParentFolderId: '',  // e.g. '1abc123def456'
  journeyParentFolderId: '',
};


// =============================================================================
// ROUTING
// =============================================================================

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    if (CONFIG.enableLogging) console.log('Action:', action);

    let result;
    switch (action) {
      // Email
      case 'sendResourceEmail':    result = handleSendResourceEmail(data); break;

      // Drive / Docs
      case 'createFolder':         result = handleCreateFolder(data); break;
      case 'createDoc':            result = handleCreateDoc(data); break;
      case 'updateShipitDoc':      result = handleUpdateShipitDoc(data); break;
      case 'getShipitDocContent':  result = handleGetShipitDocContent(data); break;

      // Sheets tracker
      case 'saveShipit':           result = handleSaveShipit(data); break;

      // Test
      case 'ping':                 result = { success: true, message: 'Connected to NPU Hub Apps Script' }; break;

      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error('doPost error:', error);
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    status: 'ok',
    service: 'NPU Hub Apps Script',
    timestamp: new Date().toISOString(),
    capabilities: ['sendResourceEmail', 'createFolder', 'createDoc', 'updateShipitDoc', 'getShipitDocContent', 'saveShipit', 'ping']
  })).setMimeType(ContentService.MimeType.JSON);
}


// =============================================================================
// 1. SEND RESOURCE EMAIL
// =============================================================================

function handleSendResourceEmail(data) {
  const { recipientName, recipientEmail, personalNote, resources, cardName, senderName, senderEmail } = data;

  if (!recipientName?.trim()) return { success: false, error: 'Recipient name required' };
  if (!recipientEmail || !isValidEmail(recipientEmail)) return { success: false, error: 'Valid email required' };
  if (!resources?.length) return { success: false, error: 'At least one resource required' };

  const sender = senderName || CONFIG.senderName;
  const subject = 'Resources from ' + sender + ' - ' + CONFIG.companyName;

  const resourceHtml = resources.map(r => 
    '<tr><td style="padding:12px 16px;border-bottom:1px solid #eee;">' +
    '<a href="' + r.url + '" style="color:' + CONFIG.primaryColor + ';text-decoration:none;font-weight:500;font-size:15px;">' +
    escapeHtml(r.name) + '</a><div style="color:#888;font-size:12px;margin-top:2px;">Click to view</div></td></tr>'
  ).join('');

  const noteHtml = personalNote ? 
    '<div style="background:#f8f9fa;border-left:4px solid ' + CONFIG.primaryColor + ';padding:16px 20px;margin:24px 0;border-radius:0 8px 8px 0;">' +
    '<div style="color:#666;font-size:13px;margin-bottom:8px;">Note from ' + escapeHtml(sender) + ':</div>' +
    '<div style="color:#333;font-size:15px;line-height:1.6;">' + escapeHtml(personalNote) + '</div></div>' : '';

  const html = '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">' +
    '<table width="100%" style="background:#f5f5f5;"><tr><td align="center" style="padding:40px 20px;">' +
    '<table width="100%" style="max-width:600px;background:#fff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.07);">' +
    '<tr><td style="padding:40px 40px 30px;text-align:center;border-bottom:1px solid #eee;">' +
    '<div style="font-size:24px;font-weight:700;color:' + CONFIG.primaryColor + ';margin-bottom:20px;">' + CONFIG.companyName + '</div>' +
    '<div style="font-size:13px;color:#888;">' + CONFIG.companyTagline + '</div></td></tr>' +
    '<tr><td style="padding:30px 40px 20px;"><h1 style="margin:0 0 16px;font-size:22px;color:#333;">Hi ' + escapeHtml(recipientName) + '!</h1>' +
    '<p style="margin:0;font-size:15px;line-height:1.6;color:#555;">' + escapeHtml(sender) + ' shared resources from <strong>' + escapeHtml(cardName || 'your journey') + '</strong>.</p></td></tr>' +
    '<tr><td style="padding:0 40px;">' + noteHtml + '</td></tr>' +
    '<tr><td style="padding:20px 40px 10px;"><table width="100%" style="background:#fafafa;border-radius:8px;">' + resourceHtml + '</table></td></tr>' +
    '<tr><td style="padding:30px 40px 40px;"><div style="border-top:1px solid #eee;padding-top:24px;text-align:center;">' +
    '<p style="margin:0;font-size:13px;color:#aaa;">Sent by <a href="' + CONFIG.companyWebsite + '" style="color:' + CONFIG.primaryColor + ';">' + CONFIG.companyName + '</a></p></div></td></tr>' +
    '</table></td></tr></table></body></html>';

  const plain = 'Hi ' + recipientName + '!\n\n' + sender + ' shared resources from ' + (cardName || 'your journey') + '.\n\n' +
    (personalNote ? 'Note: "' + personalNote + '"\n\n' : '') +
    resources.map((r, i) => (i+1) + '. ' + r.name + '\n   ' + r.url).join('\n\n') +
    '\n\n---\nSent by ' + CONFIG.companyName;

  try {
    GmailApp.sendEmail(recipientEmail, subject, plain, { htmlBody: html, name: sender, replyTo: senderEmail || CONFIG.senderEmail });
    return { success: true, messageId: Utilities.getUuid() };
  } catch (err) {
    return { success: false, error: 'Email failed: ' + err.message };
  }
}


// =============================================================================
// 2. DRIVE FOLDER CREATION
// =============================================================================

function handleCreateFolder(data) {
  const { folderName, parentType } = data;
  if (!folderName) return { success: false, error: 'folderName required' };

  try {
    let parent;
    if (parentType === 'shipit' && CONFIG.shipitParentFolderId) {
      parent = DriveApp.getFolderById(CONFIG.shipitParentFolderId);
    } else if (parentType === 'journey' && CONFIG.journeyParentFolderId) {
      parent = DriveApp.getFolderById(CONFIG.journeyParentFolderId);
    } else {
      parent = DriveApp.getRootFolder();
    }

    const folder = parent.createFolder(folderName);
    return {
      success: true,
      folderId: folder.getId(),
      folderUrl: folder.getUrl()
    };
  } catch (err) {
    return { success: false, error: 'Folder creation failed: ' + err.message };
  }
}


// =============================================================================
// 3. GOOGLE DOC CREATION
// =============================================================================

function handleCreateDoc(data) {
  const { docName, folderId, template } = data;
  if (!docName) return { success: false, error: 'docName required' };

  try {
    const doc = DocumentApp.create(docName);
    const docId = doc.getId();
    const docUrl = doc.getUrl();

    // Move to folder if specified
    if (folderId) {
      const file = DriveApp.getFileById(docId);
      const folder = DriveApp.getFolderById(folderId);
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    }

    // Add initial template content
    const body = doc.getBody();
    body.clear();

    if (template === 'shipit') {
      body.appendParagraph('ShipIt Journal: ' + docName.replace('ShipIt Journal - ', ''))
        .setHeading(DocumentApp.ParagraphHeading.HEADING1)
        .editAsText().setForegroundColor(CONFIG.primaryColor);
      body.appendParagraph('Created from NPU Hub on ' + new Date().toLocaleDateString())
        .editAsText().setForegroundColor('#888888').setFontSize(10);
      body.appendHorizontalRule();

      const sections = [
        { num: '01', title: 'The Project', fields: ['What are you shipping?', 'Who is it for?', 'Why does it matter?'] },
        { num: '02', title: 'Name the Fear', fields: ['Worst case?', 'Lizard brain?', 'Protecting or holding back?'] },
        { num: '03', title: 'Thrashing', fields: ['Unmade decisions?', 'Who needs input?', 'Scope to cut?'] },
        { num: '04', title: 'Blockers', fields: ['Waiting on?', 'Missing skills?', 'One blocker?'] },
        { num: '05', title: 'The Actual Work', fields: ['Milestones?', 'Next 30 minutes?'] },
        { num: '06', title: 'Ship It!', fields: ['Who to tell?', 'How to celebrate?', 'Ship next?'] },
      ];

      sections.forEach(sec => {
        body.appendParagraph(sec.num + '. ' + sec.title)
          .setHeading(DocumentApp.ParagraphHeading.HEADING2)
          .editAsText().setForegroundColor(CONFIG.primaryColor);
        sec.fields.forEach(f => {
          body.appendParagraph(f).setHeading(DocumentApp.ParagraphHeading.HEADING3);
          body.appendParagraph('').editAsText().setFontSize(11);
        });
      });
    }

    doc.saveAndClose();
    return { success: true, docId: docId, docUrl: docUrl };
  } catch (err) {
    return { success: false, error: 'Doc creation failed: ' + err.message };
  }
}


// =============================================================================
// 4. UPDATE SHIPIT DOC (Push content from Hub to Doc)
// =============================================================================

function handleUpdateShipitDoc(data) {
  const { docId, project } = data;
  if (!docId || !project) return { success: false, error: 'docId and project required' };

  try {
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();
    body.clear();

    // Title
    body.appendParagraph('ShipIt Journal: ' + (project.name || 'Untitled'))
      .setHeading(DocumentApp.ParagraphHeading.HEADING1)
      .editAsText().setForegroundColor(CONFIG.primaryColor);

    // Meta
    const metaText = 'Ship Date: ' + (project.shipDate || project.ship_date || 'Not set') + 
      '  |  Status: ' + (project.status || 'planning');
    body.appendParagraph(metaText).editAsText().setBold(true).setFontSize(11);

    if (project.description) {
      body.appendParagraph(project.description).editAsText().setItalic(true).setFontSize(11).setForegroundColor('#666666');
    }
    body.appendHorizontalRule();

    // Sections
    const sectionDefs = [
      { num: '01', title: 'The Project', fields: [
        { id: 'what', label: 'What are you shipping?' },
        { id: 'who', label: 'Who is it for?' },
        { id: 'why', label: 'Why does it matter?' }
      ]},
      { num: '02', title: 'Name the Fear', fields: [
        { id: 'worst', label: 'Worst case?' },
        { id: 'lizard', label: 'Lizard brain?' },
        { id: 'fear-truth', label: 'Protecting or holding back?' }
      ]},
      { num: '03', title: 'Thrashing', fields: [
        { id: 'decisions', label: 'Unmade decisions?' },
        { id: 'approvers', label: 'Who needs input?' },
        { id: 'cut', label: 'Scope to cut?' }
      ]},
      { num: '04', title: 'Blockers & Dependencies', fields: [
        { id: 'waiting', label: 'Waiting on?' },
        { id: 'missing', label: 'Missing skills?' },
        { id: 'one-blocker', label: 'One blocker?' }
      ]},
      { num: '05', title: 'The Actual Work', fields: [
        { id: 'milestones', label: 'Milestones?' },
        { id: '30min', label: 'Next 30 minutes?' }
      ]},
      { num: '06', title: 'Ship It!', fields: [
        { id: 'announce', label: 'Who to tell?' },
        { id: 'celebrate', label: 'How to celebrate?' },
        { id: 'next', label: 'Ship next?' }
      ]},
    ];

    const sections = project.sections || {};

    sectionDefs.forEach(sec => {
      body.appendParagraph(sec.num + '. ' + sec.title)
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .editAsText().setForegroundColor(CONFIG.primaryColor);
      sec.fields.forEach(f => {
        body.appendParagraph(f.label).setHeading(DocumentApp.ParagraphHeading.HEADING3);
        const val = sections[f.id] || '';
        body.appendParagraph(val || '(not yet filled in)').editAsText().setFontSize(11);
      });
    });

    body.appendHorizontalRule();
    body.appendParagraph('Last synced from NPU Hub: ' + new Date().toLocaleString())
      .editAsText().setForegroundColor('#aaaaaa').setFontSize(9);

    doc.saveAndClose();
    return { success: true };
  } catch (err) {
    return { success: false, error: 'Doc update failed: ' + err.message };
  }
}


// =============================================================================
// 5. GET SHIPIT DOC CONTENT (Pull from Doc back to Hub)
// =============================================================================

function handleGetShipitDocContent(data) {
  const { docId } = data;
  if (!docId) return { success: false, error: 'docId required' };

  try {
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();
    const elements = body.getNumChildren();

    const fieldIds = ['what', 'who', 'why', 'worst', 'lizard', 'fear-truth', 
                      'decisions', 'approvers', 'cut', 'waiting', 'missing', 'one-blocker',
                      'milestones', '30min', 'announce', 'celebrate', 'next'];
    const labels = [
      'What are you shipping?', 'Who is it for?', 'Why does it matter?',
      'Worst case?', 'Lizard brain?', 'Protecting or holding back?',
      'Unmade decisions?', 'Who needs input?', 'Scope to cut?',
      'Waiting on?', 'Missing skills?', 'One blocker?',
      'Milestones?', 'Next 30 minutes?',
      'Who to tell?', 'How to celebrate?', 'Ship next?'
    ];

    const sections = {};
    let currentFieldIdx = -1;

    for (let i = 0; i < elements; i++) {
      const el = body.getChild(i);
      if (el.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
      
      const para = el.asParagraph();
      const text = para.getText().trim();
      const heading = para.getHeading();

      if (heading === DocumentApp.ParagraphHeading.HEADING3) {
        // Match to a field label
        const idx = labels.findIndex(l => text.toLowerCase().includes(l.toLowerCase().replace('?', '')));
        currentFieldIdx = idx >= 0 ? idx : currentFieldIdx + 1;
      } else if (heading === DocumentApp.ParagraphHeading.NORMAL && currentFieldIdx >= 0 && currentFieldIdx < fieldIds.length) {
        if (text && text !== '(not yet filled in)') {
          const fid = fieldIds[currentFieldIdx];
          sections[fid] = sections[fid] ? sections[fid] + '\n' + text : text;
        }
      }
    }

    return { success: true, sections: sections };
  } catch (err) {
    return { success: false, error: 'Doc read failed: ' + err.message };
  }
}


// =============================================================================
// 6. SAVE TO SHEETS TRACKER
// =============================================================================

function handleSaveShipit(data) {
  const { shipit } = data;
  if (!shipit) return { success: false, error: 'shipit data required' };

  // This is optional - creates/updates a tracking spreadsheet
  // Skip if you don't need sheet tracking
  try {
    return { success: true, message: 'Sheet tracking placeholder - configure spreadsheet ID to enable' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}


// =============================================================================
// UTILITIES
// =============================================================================

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// =============================================================================
// TEST FUNCTIONS (run from Apps Script editor)
// =============================================================================

function testConnection() {
  console.log('Connection test: OK');
  console.log('Gmail access:', typeof GmailApp !== 'undefined' ? 'YES' : 'NO');
  console.log('Drive access:', typeof DriveApp !== 'undefined' ? 'YES' : 'NO');
  console.log('Docs access:', typeof DocumentApp !== 'undefined' ? 'YES' : 'NO');
}

function testEmail() {
  const result = handleSendResourceEmail({
    recipientName: 'Test',
    recipientEmail: 'YOUR_EMAIL@gmail.com',  // Change this!
    personalNote: 'Test from NPU Hub',
    resources: [{ name: 'Test Resource', url: 'https://neuroprogeny.com', type: 'link' }],
    cardName: 'Test Card',
    senderName: CONFIG.senderName,
    senderEmail: CONFIG.senderEmail
  });
  console.log(JSON.stringify(result));
}
