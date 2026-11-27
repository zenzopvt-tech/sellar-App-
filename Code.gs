/**
 * BLYNZO - Seller Partner Management Web App
 * Backend: Google Apps Script | Database: Google Sheets
 *
 * FIRST-RUN SETUP:
 * 1. Create a new Apps Script project and add this file (Code.gs) and index.html.
 * 2. Run setupDatabase() once from the editor (authorize when asked).
 *    - Creates the BLYNZO_Database Google Sheet with all 21 sheets.
 *    - Seeds default admin credentials: User ID "blynzo_admin" / Password "Blynzo@933"
 *      (stored ONLY as salted hashes in Script Properties - change them in Admin > Settings).
 * 3. Deploy > New deployment > Web app > Execute as: Me | Who has access: Anyone.
 * 4. Open the web app URL.
 *
 * SECURITY: No admin credentials, seller PINs or secrets ever exist in the frontend.
 * Every API call carries a session token that is validated server-side.
 */

var APP_NAME = 'BLYNZO';
var SESSION_PREFIX = 'SESS_';
var FAIL_PREFIX = 'FAIL_';
var MAX_FAILED_LOGINS = 5;
var LOCK_MINUTES = 15;

/* ============================== SHEET SCHEMA ============================== */

var SCHEMA = {
  Admin_Settings:      ['Key', 'Value', 'Updated_At'],
  App_Settings:        ['Key', 'Value', 'Updated_At'],
  Sellers:             ['Seller_ID', 'PIN_Hash', 'PIN_Salt', 'Full_Name', 'Father_Name', 'Mobile', 'WhatsApp', 'Email', 'DOB', 'Gender', 'Address', 'Village', 'District', 'State', 'Pincode', 'Status', 'Commission_Percent', 'Registered_At', 'Approved_At', 'Last_Login', 'Archive_Flag', 'Reject_Reason'],
  Seller_Profiles:     ['Seller_ID', 'Aadhaar_Number', 'PAN_Number', 'Identity_Status', 'Updated_At'],
  Seller_Shops:        ['Seller_ID', 'Shop_Name', 'Logo_FileID', 'Logo_URL', 'Owner_Name', 'Shop_Mobile', 'Shop_Address', 'Category', 'Business_Type', 'Description', 'Open_Time', 'Close_Time', 'Weekly_Holiday', 'Location', 'Services', 'Change_Request', 'Updated_At'],
  Seller_Bank_Details: ['Seller_ID', 'Holder_Name', 'Bank_Name', 'Account_Number', 'IFSC', 'UPI_ID', 'Doc_FileID', 'Doc_URL', 'Updated_At'],
  Seller_Documents:    ['ID', 'Seller_ID', 'Doc_Type', 'File_ID', 'File_URL', 'Uploaded_At'],
  Categories:          ['ID', 'Name', 'Parent', 'Active', 'Created_At'],
  Products:            ['Product_ID', 'Seller_ID', 'Name', 'Image_FileID', 'Image_URL', 'Description', 'Category', 'Subcategory', 'MRP', 'Selling_Price', 'Purchase_Price', 'Stock', 'SKU', 'Unit', 'Variants', 'Status', 'Created_At', 'Updated_At', 'Extra_Images'],
  Inventory:           ['ID', 'Product_ID', 'Seller_ID', 'Change', 'Stock_After', 'Reason', 'Updated_By', 'Updated_At'],
  Orders:              ['Order_ID', 'Order_No', 'Seller_ID', 'Customer_Name', 'Customer_Phone', 'Customer_Address', 'Total_Amount', 'Delivery_Charge', 'Discount', 'Final_Amount', 'Commission_Percent', 'Commission_Amount', 'Seller_Earning', 'Status', 'Remarks', 'Admin_Notes', 'Payment_Status', 'Created_At', 'Updated_At'],
  Order_Items:         ['ID', 'Order_ID', 'Product_ID', 'Product_Name', 'Qty', 'Price', 'Subtotal'],
  Commissions:         ['ID', 'Seller_ID', 'Scope', 'Target', 'Percent', 'Effective_Date', 'Active', 'Created_At', 'Created_By'],
  Payments:            ['Payment_ID', 'Seller_ID', 'Amount', 'Method', 'Txn_ID', 'Payment_Date', 'Remarks', 'Proof_FileID', 'Proof_URL', 'Status', 'Created_At', 'Paid_At', 'Created_By'],
  Transactions:        ['Txn_ID', 'Date', 'Seller_ID', 'Order_ID', 'Type', 'Amount', 'Status', 'Description'],
  Meetings:            ['Meeting_ID', 'Seller_ID', 'Title', 'Description', 'Date', 'Time', 'Meet_Link', 'Status', 'Created_At', 'Created_By', 'Ended_At'],
  Meeting_Messages:    ['ID', 'Meeting_ID', 'Sender_Role', 'Sender_Name', 'Message', 'Sent_At'],
  Notifications:       ['ID', 'Target_Role', 'Target_ID', 'Type', 'Title', 'Body', 'Ref', 'Read_Flag', 'Created_At', 'Read_At'],
  Messages:            ['ID', 'Thread_Seller_ID', 'From_Role', 'From_Name', 'Body', 'Read_Flag', 'Sent_At', 'Image_FileID', 'Image_URL'],
  Support_Tickets:     ['Ticket_ID', 'Seller_ID', 'Category', 'Details', 'Image_FileID', 'Image_URL', 'Status', 'Admin_Reply', 'Reply_At', 'Created_At', 'Updated_At'],
  Activity_Logs:       ['ID', 'Actor_Role', 'Actor_ID', 'Action', 'Details', 'Created_At']
};

var SELLER_STATUSES = ['Pending', 'Approved', 'Active', 'Inactive', 'Suspended', 'Rejected', 'Archived'];
var ORDER_STATUSES = ['New', 'Assigned', 'Pending Acceptance', 'Accepted', 'Processing', 'Ready', 'Completed', 'Cancelled', 'Rejected'];

/* ============================== WEB APP ENTRY ============================== */

function doGet() {
  ensureDatabase_();
  var t = HtmlService.createTemplateFromFile('index');
  t.appName = getSetting_('App_Settings', 'Brand_Name') || APP_NAME;
  return t.evaluate()
    .setTitle(t.appName + ' - Seller Partner')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(f) { return HtmlService.createHtmlOutputFromFile(f).getContent(); }

/* ============================== DATABASE SETUP ============================== */

function setupDatabase() {
  ensureDatabase_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_USER_ID')) {
    props.setProperty('ADMIN_USER_ID', 'blynzo_admin');
    var salt = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('ADMIN_SALT', salt);
    props.setProperty('ADMIN_HASH', hash_('Blynzo@933', salt));
  }
  setSettingDefault_('App_Settings', 'Brand_Name', APP_NAME);
  setSettingDefault_('App_Settings', 'App_Name', APP_NAME + ' Seller Partner');
  setSettingDefault_('App_Settings', 'App_Description', 'BLYNZO Seller Partner Management Platform');
  setSettingDefault_('App_Settings', 'Contact_Number', '');
  setSettingDefault_('App_Settings', 'Email', '');
  setSettingDefault_('App_Settings', 'Business_Address', '');
  setSettingDefault_('App_Settings', 'Logo_URL', '');
  setSettingDefault_('App_Settings', 'Default_Commission', '10');
  setSettingDefault_('App_Settings', 'Product_Approval_Required', 'yes');
  setSettingDefault_('App_Settings', 'Seller_Registration_Open', 'yes');
  setSettingDefault_('App_Settings', 'Session_Hours', '12');
  setSettingDefault_('App_Settings', 'Remember_Me_Days', '30');
  setSettingDefault_('App_Settings', 'Notifications_Enabled', 'yes');
  setSettingDefault_('Admin_Settings', 'Currency', 'Rs.');
  setSettingDefault_('Admin_Settings', 'Recovery_Contact', 'Contact the platform owner to reset admin credentials.');
  ensureSheets_();
  return 'Database ready.';
}

function ensureDatabase_() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('SPREADSHEET_ID');
  var ss = null;
  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(APP_NAME + '_Database');
    props.setProperty('SPREADSHEET_ID', ss.getId());
    var folders = DriveApp.getFoldersByName('BLYNZO_App');
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('BLYNZO_App');
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    props.setProperty('DATA_FOLDER_ID', folder.getId());
  }
  return ss;
}

function ss_() { return ensureDatabase_(); }

function ensureSheets_() {
  var ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]);
      sh.getRange(1, 1, 1, SCHEMA[name].length).setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#c8f542');
      sh.setFrozenRows(1);
    } else {
      var have = sh.getLastColumn();
      if (have < SCHEMA[name].length) {
        var missing = SCHEMA[name].slice(have);
        var hr = sh.getRange(1, have + 1, 1, missing.length).setValues([missing]);
        hr.setFontWeight('bold').setBackground('#0a0a0a').setFontColor('#c8f542');
      }
    }
  });
  var first = ss.getSheets()[0];
  if (first.getName() === 'Sheet1' && ss.getSheets().length > 1) ss.deleteSheet(first);
}

function sheet_(name) {
  ensureSheets_();
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet: ' + name);
  return sh;
}

function allRows_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = SCHEMA[name];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var rowEmpty = true;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var v = values[i][c];
      if (v !== '' && v !== null) rowEmpty = false;
      obj[headers[c]] = (v instanceof Date) ? formatDate_(v) : v;
    }
    if (!rowEmpty) { obj._row = i + 2; out.push(obj); }
  }
  return out;
}

function appendRow_(name, obj) {
  var headers = SCHEMA[name];
  var row = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet_(name).appendRow(row);
}

function updateRow_(name, rowNum, obj) {
  var headers = SCHEMA[name];
  var existing = sheet_(name).getRange(rowNum, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (h, i) { if (obj[h] !== undefined) existing[i] = obj[h]; });
  sheet_(name).getRange(rowNum, 1, 1, headers.length).setValues([existing]);
}

function findRow_(name, key, value) {
  var rows = allRows_(name);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][key]) === String(value)) return rows[i];
  return null;
}

function nextId_(prefix) { return prefix + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100); }

function nowStr_() { return formatDate_(new Date()); }

function formatDate_(d) {
  if (!(d instanceof Date)) return d;
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function todayStr_() { return nowStr_().slice(0, 10); }

/* ============================== SETTINGS ============================== */

function getSetting_(sheetName, key) {
  var r = findRow_(sheetName, 'Key', key);
  return r ? r.Value : '';
}

function setSetting_(sheetName, key, value) {
  var r = findRow_(sheetName, 'Key', key);
  if (r) updateRow_(sheetName, r._row, { Value: value, Updated_At: nowStr_() });
  else appendRow_(sheetName, { Key: key, Value: value, Updated_At: nowStr_() });
}

function setSettingDefault_(sheetName, key, value) {
  if (getSetting_(sheetName, key) === '') setSetting_(sheetName, key, value);
}

function getAllSettings_(sheetName) {
  var out = {};
  allRows_(sheetName).forEach(function (r) { out[r.Key] = r.Value; });
  return out;
}

/* ============================== SECURITY HELPERS ============================== */

function hash_(text, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text + '::' + salt, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function checkHash_(text, salt, storedHash) { return hash_(text, salt) === storedHash; }

function uploadFile_(fileObj, sellerId, docType) {
  if (!fileObj || !fileObj.data) return { fileId: '', url: '' };
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('UPLOADS_FOLDER_ID');
  var folder = null;
  if (folderId) { try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; } }
  if (!folder) {
    var folders = DriveApp.getFoldersByName('BLYNZO_App');
    var root = folders.hasNext() ? folders.next() : DriveApp.createFolder('BLYNZO_App');
    var subs = root.getFoldersByName('Uploads');
    folder = subs.hasNext() ? subs.next() : root.createFolder('Uploads');
    props.setProperty('UPLOADS_FOLDER_ID', folder.getId());
  }
  var blob = Utilities.newBlob(Utilities.base64Decode(fileObj.data), fileObj.mimeType || 'application/octet-stream', (sellerId || 'file') + '_' + docType + '_' + Date.now() + '_' + (fileObj.name || 'upload'));
  var file = folder.createFile(blob);
  return { fileId: file.getId(), url: 'https://drive.google.com/uc?export=view&id=' + file.getId() };
}

/* ============================== SESSIONS ============================== */

function createSession_(role, id, remember) {
  cleanSessions_();
  var token = Utilities.getUuid();
  var days = remember ? Number(getSetting_('App_Settings', 'Remember_Me_Days') || 30) : 0;
  var hours = Number(getSetting_('App_Settings', 'Session_Hours') || 12);
  var exp = Date.now() + (days > 0 ? days * 86400000 : hours * 3600000);
  PropertiesService.getScriptProperties().setProperty(SESSION_PREFIX + token, JSON.stringify({ role: role, id: id, exp: exp }));
  return { token: token, exp: exp, role: role };
}

function getSession_(token) {
  if (!token) return null;
  var raw = PropertiesService.getScriptProperties().getProperty(SESSION_PREFIX + token);
  if (!raw) return null;
  var s = JSON.parse(raw);
  if (!s.exp || s.exp < Date.now()) { PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token); return null; }
  return s;
}

function destroySession_(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token);
}

function destroyAllSessions_(actorId) {
  var props = PropertiesService.getScriptProperties();
  props.getKeys().forEach(function (k) {
    if (k.indexOf(SESSION_PREFIX) === 0) {
      var s = JSON.parse(props.getProperty(k));
      if (!actorId || s.id === actorId) props.deleteProperty(k);
    }
  });
}

function cleanSessions_() {
  if (Math.random() > 0.1) return;
  var props = PropertiesService.getScriptProperties();
  props.getKeys().forEach(function (k) {
    if (k.indexOf(SESSION_PREFIX) === 0) {
      try {
        var s = JSON.parse(props.getProperty(k));
        if (s.exp < Date.now()) props.deleteProperty(k);
      } catch (e) { props.deleteProperty(k); }
    }
  });
}

function auth_(token, requiredRole) {
  var s = getSession_(token);
  if (!s) throw new Error('SESSION_EXPIRED');
  if (requiredRole && s.role !== requiredRole) throw new Error('ACCESS_DENIED');
  return s;
}

function logActivity_(role, actorId, action, details) {
  try {
    appendRow_('Activity_Logs', { ID: nextId_('LOG'), Actor_Role: role, Actor_ID: actorId, Action: action, Details: details || '', Created_At: nowStr_() });
  } catch (e) {}
}

function notify_(targetRole, targetId, type, title, body, ref) {
  if (getSetting_('App_Settings', 'Notifications_Enabled') === 'no') return;
  appendRow_('Notifications', { ID: nextId_('NTF'), Target_Role: targetRole, Target_ID: targetId || '', Type: type, Title: title, Body: body, Ref: ref || '', Read_Flag: 'no', Created_At: nowStr_(), Read_At: '' });
}

function loginFailure_(identifier) {
  var cache = CacheService.getScriptCache();
  var k = FAIL_PREFIX + identifier;
  var n = Number(cache.get(k) || 0) + 1;
  cache.put(k, String(n), 21600);
  return n;
}

function clearFailures_(identifier) { CacheService.getScriptCache().remove(FAIL_PREFIX + identifier); }

function isLocked_(identifier) {
  return Number(CacheService.getScriptCache().get(FAIL_PREFIX + identifier) || 0) >= MAX_FAILED_LOGINS;
}

/* ============================== PUBLIC API (no token) ============================== */

function apiPublicConfig() {
  ensureDatabase_();
  var s = getAllSettings_('App_Settings');
  return {
    brand: s.Brand_Name || APP_NAME,
    logo: s.Logo_URL || '',
    appDescription: s.App_Description || '',
    registrationOpen: s.Seller_Registration_Open !== 'no',
    recoveryContact: getSetting_('Admin_Settings', 'Recovery_Contact') || 'Contact the platform owner.',
    contact: s.Contact_Number || ''
  };
}

function apiAdminLogin(userId, password, remember) {
  ensureDatabase_();
  userId = String(userId || '').trim();
  password = String(password || '');
  if (isLocked_('admin:' + userId)) throw new Error('Too many failed attempts. Try again in ' + LOCK_MINUTES + ' minutes.');
  var props = PropertiesService.getScriptProperties();
  var storedId = props.getProperty('ADMIN_USER_ID');
  var salt = props.getProperty('ADMIN_SALT');
  var storedHash = props.getProperty('ADMIN_HASH');
  if (!storedId || !storedHash) {
    setupDatabase();
    storedId = props.getProperty('ADMIN_USER_ID');
    salt = props.getProperty('ADMIN_SALT');
    storedHash = props.getProperty('ADMIN_HASH');
  }
  if (userId !== storedId || !checkHash_(password, salt, storedHash)) {
    var n = loginFailure_('admin:' + userId);
    throw new Error('Invalid Admin User ID or Password. Attempt ' + n + ' of ' + MAX_FAILED_LOGINS + '.');
  }
  clearFailures_('admin:' + userId);
  var sess = createSession_('admin', storedId, remember);
  logActivity_('admin', storedId, 'LOGIN', 'Admin logged in');
  return { token: sess.token, role: 'admin', adminId: storedId, exp: sess.exp };
}

function apiSellerLogin(idOrMobile, pin, remember) {
  ensureDatabase_();
  idOrMobile = String(idOrMobile || '').trim();
  pin = String(pin || '').trim();
  if (isLocked_('seller:' + idOrMobile)) throw new Error('Too many failed attempts. Try again in ' + LOCK_MINUTES + ' minutes.');
  var seller = findRow_('Sellers', 'Seller_ID', idOrMobile);
  if (!seller) {
    var rows = allRows_('Sellers');
    for (var i = 0; i < rows.length; i++) if (String(rows[i].Mobile) === idOrMobile) { seller = rows[i]; break; }
  }
  if (!seller || !checkHash_(pin, String(seller.PIN_Salt), String(seller.PIN_Hash))) {
    var n = loginFailure_('seller:' + idOrMobile);
    throw new Error('Invalid credentials. Attempt ' + n + ' of ' + MAX_FAILED_LOGINS + '.');
  }
  if (String(seller.Status) === 'Suspended') throw new Error('Your account is suspended. Contact admin.');
  if (String(seller.Status) === 'Rejected') throw new Error('Your registration was rejected. Contact admin.');
  clearFailures_('seller:' + idOrMobile);
  var sess = createSession_('seller', seller.Seller_ID, remember);
  updateRow_('Sellers', seller._row, { Last_Login: nowStr_() });
  logActivity_('seller', seller.Seller_ID, 'LOGIN', 'Seller logged in');
  return { token: sess.token, role: 'seller', sellerId: seller.Seller_ID, status: String(seller.Status), shopName: shopName_(seller.Seller_ID), exp: sess.exp };
}

function apiForgotSellerPin(sellerIdOrMobile, contact) {
  logActivity_('seller', String(sellerIdOrMobile || ''), 'PIN_RESET_REQUEST', 'Contact: ' + contact);
  return 'Request recorded. The admin will verify your identity and reset your PIN. Admin contact: ' + (getSetting_('Admin_Settings', 'Recovery_Contact') || 'available from the admin.');
}

/* ============================== SELLER REGISTRATION ============================== */

function generateSellerId_() {
  var letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var rows = allRows_('Sellers');
  var used = {};
  rows.forEach(function (r) { used[String(r.Seller_ID)] = true; });
  for (var attempt = 0; attempt < 200; attempt++) {
    var letter = letters.charAt(Math.floor(Math.random() * letters.length));
    var digits = String(Math.floor(Math.random() * 90) + 10);
    var id = 'BN9' + letter + digits;
    if (!used[id]) return id;
  }
  throw new Error('Could not generate a unique Seller ID. Try again.');
}

function generatePin_() {
  return '933' + String(Math.floor(10000 + Math.random() * 89999)) + String(Math.floor(Math.random() * 10));
}

function apiRegisterSeller(reg) {
  ensureDatabase_();
  if (getSetting_('App_Settings', 'Seller_Registration_Open') === 'no') throw new Error('Seller registration is currently closed.');
  reg = reg || {};
  if (!reg.fullName || !reg.mobile) throw new Error('Full name and mobile number are required.');
  var dup = allRows_('Sellers').filter(function (r) { return String(r.Mobile) === String(reg.mobile); });
  if (dup.length) throw new Error('A seller is already registered with this mobile number.');

  var sellerId = generateSellerId_();
  var pin = generatePin_();
  var salt = Utilities.getUuid().replace(/-/g, '');

  appendRow_('Sellers', {
    Seller_ID: sellerId, PIN_Hash: hash_(pin, salt), PIN_Salt: salt,
    Full_Name: reg.fullName, Father_Name: reg.fatherName || '', Mobile: reg.mobile,
    WhatsApp: reg.whatsapp || reg.mobile, Email: reg.email || '', DOB: reg.dob || '',
    Gender: reg.gender || '', Address: reg.address || '', Village: reg.village || '',
    District: reg.district || '', State: reg.state || '', Pincode: reg.pincode || '',
    Status: 'Pending', Commission_Percent: Number(getSetting_('App_Settings', 'Default_Commission') || 10),
    Registered_At: nowStr_(), Approved_At: '', Last_Login: '', Archive_Flag: 'no', Reject_Reason: ''
  });

  var profilePhoto = uploadFile_(reg.profilePhoto, sellerId, 'profile');
  if (profilePhoto.fileId) appendRow_('Seller_Documents', { ID: nextId_('DOC'), Seller_ID: sellerId, Doc_Type: 'Profile_Photo', File_ID: profilePhoto.fileId, File_URL: profilePhoto.url, Uploaded_At: nowStr_() });

  appendRow_('Seller_Profiles', {
    Seller_ID: sellerId,
    Aadhaar_Number: reg.aadhaar ? String(reg.aadhaar) : '',
    PAN_Number: reg.pan ? String(reg.pan).toUpperCase() : '',
    Identity_Status: (reg.aadhaar || reg.pan) ? 'Submitted' : 'Not Submitted',
    Updated_At: nowStr_()
  });
  if (reg.aadhaarDoc) {
    var ad = uploadFile_(reg.aadhaarDoc, sellerId, 'aadhaar');
    appendRow_('Seller_Documents', { ID: nextId_('DOC'), Seller_ID: sellerId, Doc_Type: 'Aadhaar', File_ID: ad.fileId, File_URL: ad.url, Uploaded_At: nowStr_() });
  }
  if (reg.panDoc) {
    var pd = uploadFile_(reg.panDoc, sellerId, 'pan');
    appendRow_('Seller_Documents', { ID: nextId_('DOC'), Seller_ID: sellerId, Doc_Type: 'PAN', File_ID: pd.fileId, File_URL: pd.url, Uploaded_At: nowStr_() });
  }

  var logoUp = reg.shopLogo || reg.shopLogoUp || { fileId: '', url: '' };
  appendRow_('Seller_Shops', {
    Seller_ID: sellerId, Shop_Name: reg.shopName || reg.fullName, Logo_FileID: logoUp.fileId, Logo_URL: logoUp.url,
    Owner_Name: reg.shopOwnerName || reg.fullName, Shop_Mobile: reg.shopMobile || reg.mobile,
    Shop_Address: reg.shopAddress || reg.address || '', Category: reg.shopCategory || '',
    Business_Type: reg.businessType || '', Description: reg.shopDescription || '',
    Open_Time: reg.openTime || '', Close_Time: reg.closeTime || '',
    Weekly_Holiday: reg.weeklyHoliday || 'None', Location: reg.shopLocation || '',
    Services: typeof reg.services === 'string' ? reg.services : (reg.services || []).join(', '),
    Change_Request: '', Updated_At: nowStr_()
  });

  var bankDoc = uploadFile_(reg.bankDoc, sellerId, 'bank_doc');
  appendRow_('Seller_Bank_Details', {
    Seller_ID: sellerId, Holder_Name: reg.accountHolder || '', Bank_Name: reg.bankName || '',
    Account_Number: reg.accountNumber ? String(reg.accountNumber) : '', IFSC: reg.ifsc ? String(reg.ifsc).toUpperCase() : '',
    UPI_ID: reg.upiId || '', Doc_FileID: bankDoc.fileId, Doc_URL: bankDoc.url, Updated_At: nowStr_()
  });

  notify_('admin', '', 'registration', 'New Seller Registration', sellerId + ' - ' + reg.fullName + ' registered and is pending approval.', sellerId);
  logActivity_('seller', sellerId, 'REGISTER', 'New seller registered: ' + reg.fullName);
  return { sellerId: sellerId, pin: pin, name: reg.fullName };
}

/* ============================== BOOTSTRAP / DASHBOARD ============================== */

function apiGetBootstrap(token) {
  var s = auth_(token);
  var settings = getAllSettings_('App_Settings');
  var base = {
    brand: settings.Brand_Name || APP_NAME,
    logo: settings.Logo_URL || '',
    role: s.role,
    identity: s.id,
    exp: getSession_(token).exp
  };
  if (s.role === 'seller') {
    var seller = findRow_('Sellers', 'Seller_ID', s.id);
    base.seller = sellerPublic_(seller);
    base.shop = findRow_('Seller_Shops', 'Seller_ID', s.id) || {};
    base.unread = unreadCount_('seller', s.id);
    base.restricted = seller ? String(seller.Status) !== 'Active' : true;
  } else {
    base.unread = unreadCount_('admin', '');
  }
  return base;
}

function sellerPublic_(seller) {
  if (!seller) return {};
  return {
    sellerId: seller.Seller_ID, name: seller.Full_Name, mobile: seller.Mobile, whatsapp: seller.WhatsApp,
    email: seller.Email, address: seller.Address, village: seller.Village, district: seller.District,
    state: seller.State, pincode: seller.Pincode, status: seller.Status,
    commission: seller.Commission_Percent, registeredAt: seller.Registered_At,
    fatherName: seller.Father_Name, dob: seller.DOB, gender: seller.Gender
  };
}

function shopName_(sellerId) {
  var shop = findRow_('Seller_Shops', 'Seller_ID', sellerId);
  return shop ? shop.Shop_Name : '';
}

function unreadCount_(role, id) {
  return allRows_('Notifications').filter(function (n) {
    return n.Target_Role === role && String(n.Read_Flag) === 'no' &&
      (role === 'admin' || String(n.Target_ID) === String(id));
  }).length;
}

function inDateRange_(dateStr, filter, from, to) {
  if (filter === 'all' || !filter) return true;
  if (!dateStr) return false;
  var d = String(dateStr).slice(0, 10);
  var today = todayStr_();
  if (filter === 'today') return d === today;
  if (filter === 'yesterday') {
    var y = new Date();
    y.setDate(y.getDate() - 1);
    return d === Utilities.formatDate(y, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (filter === 'week') {
    var w = new Date();
    w.setDate(w.getDate() - 7);
    return d >= Utilities.formatDate(w, Session.getScriptTimeZone(), 'yyyy-MM-dd') && d <= today;
  }
  if (filter === 'month') return d.slice(0, 7) === today.slice(0, 7);
  if (filter === 'custom') return (!from || d >= String(from).slice(0, 10)) && (!to || d <= String(to).slice(0, 10));
  return true;
}

function num_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

function apiGetDashboardStats(token, filter, from, to) {
  var s = auth_(token);
  var range = function (d) { return inDateRange_(d, filter, from, to); };
  var sellers = allRows_('Sellers').filter(function (r) { return String(r.Archive_Flag) !== 'yes'; });
  var products = allRows_('Products');
  var orders = allRows_('Orders').filter(function (o) { return range(o.Created_At); });
  var payments = allRows_('Payments').filter(function (p) { return range(p.Payment_Date || p.Created_At); });
  var txns = allRows_('Transactions').filter(function (t) { return range(t.Date); });
  var meetings = allRows_('Meetings').filter(function (m) { return range(m.Created_At); });
  var count = function (arr, f) { return arr.filter(f).length; };
  var completed = orders.filter(function (o) { return o.Status === 'Completed'; });
  return {
    sellers: {
      total: sellers.length,
      active: count(sellers, function (r) { return r.Status === 'Active'; }),
      inactive: count(sellers, function (r) { return r.Status === 'Inactive'; }),
      pending: count(sellers, function (r) { return r.Status === 'Pending'; }),
      suspended: count(sellers, function (r) { return r.Status === 'Suspended'; }),
      rejected: count(sellers, function (r) { return r.Status === 'Rejected'; })
    },
    products: {
      total: products.length,
      active: count(products, function (r) { return r.Status === 'Active'; }),
      outOfStock: count(products, function (r) { return num_(r.Stock) <= 0; }),
      pendingApproval: count(products, function (r) { return r.Status === 'Pending'; })
    },
    orders: {
      total: orders.length,
      new: count(orders, function (o) { return o.Status === 'New'; }),
      assigned: count(orders, function (o) { return o.Status === 'Assigned' || o.Status === 'Pending Acceptance'; }),
      pending: count(orders, function (o) { return ['Assigned', 'Pending Acceptance', 'Accepted', 'Processing', 'Ready'].indexOf(String(o.Status)) >= 0; }),
      accepted: count(orders, function (o) { return ['Accepted', 'Processing', 'Ready'].indexOf(String(o.Status)) >= 0; }),
      completed: completed.length,
      cancelled: count(orders, function (o) { return o.Status === 'Cancelled' || o.Status === 'Rejected'; })
    },
    finance: {
      totalSales: Math.round(completed.reduce(function (a, o) { return a + num_(o.Final_Amount); }, 0) * 100) / 100,
      commission: Math.round(completed.reduce(function (a, o) { return a + num_(o.Commission_Amount); }, 0) * 100) / 100,
      sellerEarnings: Math.round(completed.reduce(function (a, o) { return a + num_(o.Seller_Earning); }, 0) * 100) / 100,
      pendingPayments: payments.filter(function (p) { return p.Status !== 'Paid'; }).reduce(function (a, p) { return a + num_(p.Amount); }, 0),
      paidPayments: payments.filter(function (p) { return p.Status === 'Paid'; }).reduce(function (a, p) { return a + num_(p.Amount); }, 0),
      totalTransactions: txns.length,
      totalMeetings: meetings.length
    },
    unread: unreadCount_(s.role, s.id)
  };
}

function apiGetSellerDashboard(token) {
  var s = auth_(token, 'seller');
  var sid = s.id;
  var products = allRows_('Products').filter(function (p) { return p.Seller_ID === sid; });
  var orders = allRows_('Orders').filter(function (o) { return o.Seller_ID === sid; });
  var payments = allRows_('Payments').filter(function (p) { return p.Seller_ID === sid; });
  var count = function (arr, f) { return arr.filter(f).length; };
  var completed = orders.filter(function (o) { return o.Status === 'Completed'; });
  var seller = findRow_('Sellers', 'Seller_ID', sid);
  return {
    products: { total: products.length, active: count(products, function (p) { return p.Status === 'Active'; }), outOfStock: count(products, function (p) { return num_(p.Stock) <= 0; }) },
    orders: {
      total: orders.length,
      new: count(orders, function (o) { return o.Status === 'New' || o.Status === 'Assigned' || o.Status === 'Pending Acceptance'; }),
      pending: count(orders, function (o) { return ['Assigned', 'Pending Acceptance', 'Accepted', 'Processing', 'Ready'].indexOf(String(o.Status)) >= 0; }),
      accepted: count(orders, function (o) { return ['Accepted', 'Processing', 'Ready'].indexOf(String(o.Status)) >= 0; }),
      completed: completed.length,
      cancelled: count(orders, function (o) { return o.Status === 'Cancelled' || o.Status === 'Rejected'; })
    },
    finance: {
      totalSales: Math.round(completed.reduce(function (a, o) { return a + num_(o.Final_Amount); }, 0) * 100) / 100,
      commission: Math.round(completed.reduce(function (a, o) { return a + num_(o.Commission_Amount); }, 0) * 100) / 100,
      netEarnings: Math.round(completed.reduce(function (a, o) { return a + num_(o.Seller_Earning); }, 0) * 100) / 100,
      pending: payments.filter(function (p) { return p.Status !== 'Paid'; }).reduce(function (a, p) { return a + num_(p.Amount); }, 0),
      paid: payments.filter(function (p) { return p.Status === 'Paid'; }).reduce(function (a, p) { return a + num_(p.Amount); }, 0)
    },
    recentOrders: orders.sort(function (a, b) { return String(b.Created_At).localeCompare(String(a.Created_At)); }).slice(0, 5),
    unread: unreadCount_('seller', sid),
    restricted: seller ? String(seller.Status) !== 'Active' : true,
    status: seller ? seller.Status : ''
  };
}

/* ============================== SELLERS (ADMIN) ============================== */

function apiGetSellers(token, query, status, filter, from, to) {
  auth_(token, 'admin');
  var sellers = allRows_('Sellers');
  if (String(query || '')) {
    var q = String(query).toLowerCase();
    sellers = sellers.filter(function (r) {
      return [r.Seller_ID, r.Full_Name, r.Mobile, r.Email, r.District].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  if (status && status !== 'all') sellers = sellers.filter(function (r) { return r.Status === status; });
  if (filter && filter !== 'all') sellers = sellers.filter(function (r) { return inDateRange_(r.Registered_At, filter, from, to); });
  var shops = allRows_('Seller_Shops');
  return sellers.sort(function (a, b) { return String(b.Registered_At).localeCompare(String(a.Registered_At)); }).map(function (r) {
    var shop = null;
    for (var i = 0; i < shops.length; i++) if (shops[i].Seller_ID === r.Seller_ID) { shop = shops[i]; break; }
    return { seller: sellerPublic_(r), shopName: shop ? shop.Shop_Name : '', shopCategory: shop ? shop.Category : '' };
  });
}

function apiGetSellerDetail(token, sellerId) {
  auth_(token, 'admin');
  var seller = findRow_('Sellers', 'Seller_ID', sellerId);
  if (!seller) throw new Error('Seller not found.');
  var profile = findRow_('Seller_Profiles', 'Seller_ID', sellerId) || {};
  var bank = findRow_('Seller_Bank_Details', 'Seller_ID', sellerId) || {};
  var docs = allRows_('Seller_Documents').filter(function (d) { return d.Seller_ID === sellerId; });
  var products = allRows_('Products').filter(function (p) { return p.Seller_ID === sellerId; });
  var orders = allRows_('Orders').filter(function (o) { return o.Seller_ID === sellerId; });
  var commissions = allRows_('Commissions').filter(function (c) { return c.Seller_ID === sellerId && String(c.Active) === 'yes'; });
  var payments = allRows_('Payments').filter(function (p) { return p.Seller_ID === sellerId; });
  var completed = orders.filter(function (o) { return o.Status === 'Completed'; });
  return {
    seller: sellerPublic_(seller),
    profile: { aadhaar: profile.Aadhaar_Number || '', pan: profile.PAN_Number || '', identityStatus: profile.Identity_Status || 'Not Submitted' },
    bank: bank,
    docs: docs,
    shop: findRow_('Seller_Shops', 'Seller_ID', sellerId) || {},
    products: products,
    orders: orders,
    payments: payments,
    commission: commissions.length ? Number(commissions[0].Percent) : num_(seller.Commission_Percent),
    stats: {
      totalProducts: products.length,
      totalOrders: orders.length,
      completedOrders: completed.length,
      totalSales: Math.round(completed.reduce(function (a, o) { return a + num_(o.Final_Amount); }, 0) * 100) / 100,
      totalCommission: Math.round(completed.reduce(function (a, o) { return a + num_(o.Commission_Amount); }, 0) * 100) / 100,
      earnings: Math.round(completed.reduce(function (a, o) { return a + num_(o.Seller_Earning); }, 0) * 100) / 100,
      pendingPayments: payments.filter(function (p) { return p.Status !== 'Paid'; }).reduce(function (a, p) { return a + num_(p.Amount); }, 0),
      paidPayments: payments.filter(function (p) { return p.Status === 'Paid'; }).reduce(function (a, p) { return a + num_(p.Amount); }, 0)
    },
    logs: allRows_('Activity_Logs').filter(function (l) { return l.Actor_ID === sellerId; }).slice(-30).reverse()
  };
}

function apiSaveSeller(token, data) {
  var s = auth_(token, 'admin');
  if (data.sellerId) {
    var r = findRow_('Sellers', 'Seller_ID', data.sellerId);
    if (!r) throw new Error('Seller not found.');
    updateRow_('Sellers', r._row, {
      Full_Name: data.fullName, Father_Name: data.fatherName, Mobile: data.mobile, WhatsApp: data.whatsapp,
      Email: data.email, DOB: data.dob, Gender: data.gender, Address: data.address, Village: data.village,
      District: data.district, State: data.state, Pincode: data.pincode
    });
    if (data.shop) {
      var shop = findRow_('Seller_Shops', 'Seller_ID', data.sellerId);
      if (shop) updateRow_('Seller_Shops', shop._row, {
        Shop_Name: data.shop.shopName, Owner_Name: data.shop.ownerName, Shop_Mobile: data.shop.shopMobile,
        Shop_Address: data.shop.shopAddress, Category: data.shop.category, Business_Type: data.shop.businessType,
        Description: data.shop.description, Open_Time: data.shop.openTime, Close_Time: data.shop.closeTime,
        Weekly_Holiday: data.shop.weeklyHoliday, Location: data.shop.location, Services: data.shop.services,
        Updated_At: nowStr_()
      });
    }
    logActivity_('admin', s.id, 'EDIT_SELLER', data.sellerId);
    return { ok: true, message: 'Seller updated.' };
  }
  var reg = {
    fullName: data.fullName, fatherName: data.fatherName, mobile: data.mobile, whatsapp: data.whatsapp,
    email: data.email, dob: data.dob, gender: data.gender, address: data.address,
    village: data.village, district: data.district, state: data.state, pincode: data.pincode,
    shopName: data.shop ? data.shop.shopName : '', shopOwnerName: data.shop ? data.shop.ownerName : data.fullName,
    shopMobile: data.shop ? data.shop.shopMobile : data.mobile, shopAddress: data.shop ? data.shop.shopAddress : data.address,
    shopCategory: data.shop ? data.shop.category : '', businessType: data.shop ? data.shop.businessType : '',
    shopDescription: data.shop ? data.shop.description : '', openTime: data.shop ? data.shop.openTime : '',
    closeTime: data.shop ? data.shop.closeTime : '', weeklyHoliday: data.shop ? data.shop.weeklyHoliday : 'None',
    shopLocation: data.shop ? data.shop.location : '', services: data.shop ? data.shop.services : ''
  };
  var res = apiRegisterSeller(reg);
  logActivity_('admin', s.id, 'ADD_SELLER', res.sellerId);
  return res;
}

function apiSetSellerStatus(token, sellerId, action, reason) {
  var s = auth_(token, 'admin');
  if (action === 'delete') return apiDeleteSeller(token, sellerId);
  var r = findRow_('Sellers', 'Seller_ID', sellerId);
  if (!r) throw new Error('Seller not found.');
  var map = {
    approve: { status: 'Active', msg: 'approved and activated' },
    reject: { status: 'Rejected', msg: 'rejected' },
    activate: { status: 'Active', msg: 'activated' },
    deactivate: { status: 'Inactive', msg: 'deactivated' },
    suspend: { status: 'Suspended', msg: 'suspended' },
    archive: { status: 'Archived', msg: 'archived' },
    restore: { status: 'Pending', msg: 'restored to pending' }
  };
  var m = map[action];
  if (!m) throw new Error('Unknown action.');
  updateRow_('Sellers', r._row, {
    Status: m.status,
    Archive_Flag: action === 'archive' ? 'yes' : 'no',
    Reject_Reason: action === 'reject' ? (reason || 'Rejected by admin') : (reason || r.Reject_Reason)
  });
  if (action === 'approve') updateRow_('Sellers', r._row, { Approved_At: nowStr_() });
  notify_('seller', sellerId, 'account', 'Account ' + m.msg, 'Your seller account has been ' + m.msg + '.' + (reason ? ' Note: ' + reason : ''), '');
  logActivity_('admin', s.id, 'SELLER_' + action.toUpperCase(), sellerId + (reason ? ' - ' + reason : ''));
  return { ok: true, message: 'Seller ' + m.msg + '.' };
}

function apiDeleteSeller(token, sellerId) {
  var s = auth_(token, 'admin');
  var r = findRow_('Sellers', 'Seller_ID', sellerId);
  if (!r) throw new Error('Seller not found.');
  sheet_('Sellers').deleteRow(r._row);
  ['Seller_Profiles', 'Seller_Shops', 'Seller_Bank_Details'].forEach(function (name) {
    var rows = allRows_(name).filter(function (x) { return x.Seller_ID === sellerId; });
    rows.sort(function (a, b) { return b._row - a._row; }).forEach(function (x) { sheet_(name).deleteRow(x._row); });
  });
  logActivity_('admin', s.id, 'DELETE_SELLER', sellerId + ' - orders, payments and transaction history preserved');
  return { ok: true, message: 'Seller deleted. Financial history preserved.' };
}

function apiResetSellerPin(token, sellerId) {
  var s = auth_(token, 'admin');
  var r = findRow_('Sellers', 'Seller_ID', sellerId);
  if (!r) throw new Error('Seller not found.');
  var pin = '933' + String(Math.floor(10000 + Math.random() * 89999)) + String(Math.floor(Math.random() * 10));
  var salt = Utilities.getUuid().replace(/-/g, '');
  updateRow_('Sellers', r._row, { PIN_Hash: hash_(pin, salt), PIN_Salt: salt });
  notify_('seller', sellerId, 'security', 'PIN Reset', 'Your Seller PIN was reset by the admin. Use the new PIN shared by admin to log in.', '');
  logActivity_('admin', s.id, 'RESET_SELLER_PIN', sellerId);
  return { ok: true, pin: pin, message: 'New PIN generated. Share it with the seller securely.' };
}

/* ============================== PRODUCTS ============================== */

function apiGetProducts(token, query, sellerId, status, category) {
  var s = auth_(token);
  var products = allRows_('Products');
  if (s.role === 'seller') products = products.filter(function (p) { return p.Seller_ID === s.id; });
  else if (sellerId && sellerId !== 'all') products = products.filter(function (p) { return p.Seller_ID === sellerId; });
  if (String(query || '')) {
    var q = String(query).toLowerCase();
    products = products.filter(function (p) { return [p.Product_ID, p.Name, p.SKU, p.Category].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  if (status && status !== 'all') products = products.filter(function (p) { return p.Status === status; });
  if (category && category !== 'all') products = products.filter(function (p) { return p.Category === category; });
  return products.sort(function (a, b) { return String(b.Created_At).localeCompare(String(a.Created_At)); }).map(function (p) {
    p.stockLabel = num_(p.Stock) <= 0 ? 'Out of Stock' : (num_(p.Stock) <= 5 ? 'Low Stock' : 'In Stock');
    p.shopName = shopName_(p.Seller_ID);
    return p;
  });
}

function apiSaveProduct(token, p) {
  var s = auth_(token);
  var approvalRequired = getSetting_('App_Settings', 'Product_Approval_Required') !== 'no';
  var isEdit = !!p.productId;
  if (s.role === 'seller') {
    var me = findRow_('Sellers', 'Seller_ID', s.id);
    if (!me || String(me.Status) !== 'Active') throw new Error('Your account must be Active to manage products.');
  }
  if (isEdit) {
    var r = findRow_('Products', 'Product_ID', p.productId);
    if (!r) throw new Error('Product not found.');
    if (s.role === 'seller' && r.Seller_ID !== s.id) throw new Error('ACCESS_DENIED');
    if (p.image && p.image.data) {
      var up = uploadFile_(p.image, r.Seller_ID, 'product');
      p.Image_FileID = up.fileId; p.Image_URL = up.url;
    }
    if (p.images && p.images.length) {
      var urls = [];
      p.images.forEach(function (im) { var u = uploadFile_(im, r.Seller_ID, 'product'); if (u.url) urls.push(u.url); });
      if (urls.length) p.Extra_Images = urls.join('|');
    }
    updateRow_('Products', r._row, {
      Name: p.name, Description: p.description || '', Category: p.category || '', Subcategory: p.subcategory || '',
      MRP: num_(p.mrp), Selling_Price: num_(p.sellingPrice),
      Purchase_Price: (p.purchasePrice === '' || p.purchasePrice === undefined) ? r.Purchase_Price : num_(p.purchasePrice),
      Stock: (p.stock === '' || p.stock === undefined) ? r.Stock : num_(p.stock),
      SKU: p.sku || '', Unit: p.unit || '', Variants: p.variants || '',
      Status: p.status || r.Status,
      Image_FileID: p.Image_FileID !== undefined ? p.Image_FileID : r.Image_FileID,
      Image_URL: p.Image_URL !== undefined ? p.Image_URL : r.Image_URL,
      Extra_Images: p.Extra_Images !== undefined ? p.Extra_Images : r.Extra_Images,
      Updated_At: nowStr_()
    });
    if (p.stock !== undefined && p.stock !== '' && num_(p.stock) !== num_(r.Stock)) {
      appendRow_('Inventory', { ID: nextId_('INV'), Product_ID: p.productId, Seller_ID: r.Seller_ID, Change: num_(p.stock) - num_(r.Stock), Stock_After: num_(p.stock), Reason: 'Manual update via ' + s.role, Updated_By: s.id, Updated_At: nowStr_() });
    }
    logActivity_(s.role, s.id, 'EDIT_PRODUCT', p.productId);
    return { ok: true, message: 'Product updated.' };
  }
  var pid = 'PRD' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10);
  var sellerId = s.role === 'admin' ? (p.sellerId || '') : s.id;
  if (!sellerId) throw new Error('Select a seller for this product.');
  var img = uploadFile_(p.image, sellerId, 'product');
  var extraUrls = [];
  if (p.images && p.images.length) {
    p.images.forEach(function (im) { var u = uploadFile_(im, sellerId, 'product'); if (u.url) extraUrls.push(u.url); });
  }
  var currentStock = num_(p.stock);
  var status = (s.role === 'admin' || !approvalRequired) ? 'Active' : 'Pending';
  if (p.status) status = p.status;
  appendRow_('Products', {
    Product_ID: pid, Seller_ID: sellerId, Name: p.name, Image_FileID: img.fileId, Image_URL: img.url,
    Extra_Images: extraUrls.join('|'),
    Description: p.description || '', Category: p.category || '', Subcategory: p.subcategory || '',
    MRP: num_(p.mrp), Selling_Price: num_(p.sellingPrice),
    Purchase_Price: (p.purchasePrice === '' || p.purchasePrice === undefined) ? '' : num_(p.purchasePrice),
    Stock: currentStock, SKU: p.sku || '', Unit: p.unit || '', Variants: p.variants || '',
    Status: status, Created_At: nowStr_(), Updated_At: nowStr_()
  });
  appendRow_('Inventory', { ID: nextId_('INV'), Product_ID: pid, Seller_ID: sellerId, Change: currentStock, Stock_After: currentStock, Reason: 'Initial stock', Updated_By: s.id, Updated_At: nowStr_() });
  logActivity_(s.role, s.id, 'ADD_PRODUCT', pid);
  if (s.role === 'seller') notify_('admin', '', 'product', 'New Product for Approval', shopName_(sellerId) + ' added product "' + p.name + '" (' + pid + ').', pid);
  return { ok: true, productId: pid, message: (s.role === 'seller' && approvalRequired) ? 'Product submitted for admin approval.' : 'Product added.' };
}

function apiSetProductStatus(token, productId, status) {
  var s = auth_(token);
  var r = findRow_('Products', 'Product_ID', productId);
  if (!r) throw new Error('Product not found.');
  if (s.role === 'seller') {
    if (r.Seller_ID !== s.id) throw new Error('ACCESS_DENIED');
    if (['Active', 'Inactive'].indexOf(status) < 0) throw new Error('ACCESS_DENIED');
  }
  if (['Active', 'Inactive', 'Pending', 'Rejected'].indexOf(status) < 0) throw new Error('Unknown status.');
  updateRow_('Products', r._row, { Status: status, Updated_At: nowStr_() });
  if (s.role === 'admin' && r.Seller_ID) notify_('seller', r.Seller_ID, 'product', 'Product ' + status, 'Your product "' + r.Name + '" is now ' + status + '.', productId);
  logActivity_(s.role, s.id, 'PRODUCT_STATUS', productId + ' -> ' + status);
  return { ok: true, message: 'Product ' + status + '.' };
}

function apiDeleteProduct(token, productId) {
  var s = auth_(token);
  var r = findRow_('Products', 'Product_ID', productId);
  if (!r) throw new Error('Product not found.');
  if (s.role === 'seller' && r.Seller_ID !== s.id) throw new Error('ACCESS_DENIED');
  sheet_('Products').deleteRow(r._row);
  logActivity_(s.role, s.id, 'DELETE_PRODUCT', productId);
  return { ok: true, message: 'Product deleted.' };
}

function apiUpdateStock(token, productId, newStock, reason) {
  var s = auth_(token, 'seller');
  var r = findRow_('Products', 'Product_ID', productId);
  if (!r) throw new Error('Product not found.');
  if (r.Seller_ID !== s.id) throw new Error('ACCESS_DENIED');
  var change = num_(newStock) - num_(r.Stock);
  updateRow_('Products', r._row, { Stock: num_(newStock), Updated_At: nowStr_() });
  appendRow_('Inventory', { ID: nextId_('INV'), Product_ID: productId, Seller_ID: s.id, Change: change, Stock_After: num_(newStock), Reason: reason || 'Stock update', Updated_By: s.id, Updated_At: nowStr_() });
  return { ok: true, message: 'Stock updated.' };
}

function apiGetInventory(token, query) {
  var s = auth_(token, 'seller');
  var products = allRows_('Products').filter(function (p) { return p.Seller_ID === s.id; });
  if (String(query || '')) {
    var q = String(query).toLowerCase();
    products = products.filter(function (p) { return [p.Name, p.SKU].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  var history = allRows_('Inventory').filter(function (i) { return i.Seller_ID === s.id; }).reverse().slice(0, 100);
  return {
    products: products,
    history: history,
    totals: {
      totalStock: products.reduce(function (a, p) { return a + num_(p.Stock); }, 0),
      available: products.filter(function (p) { return num_(p.Stock) > 5; }).length,
      low: products.filter(function (p) { return num_(p.Stock) > 0 && num_(p.Stock) <= 5; }).length,
      out: products.filter(function (p) { return num_(p.Stock) <= 0; }).length
    }
  };
}

/* ============================== CATEGORIES ============================== */

function apiGetCategories(token) {
  auth_(token);
  return allRows_('Categories').sort(function (a, b) { return String(a.Name).localeCompare(String(b.Name)); });
}

function apiSaveCategory(token, c) {
  var s = auth_(token, 'admin');
  if (c.id) {
    var r = findRow_('Categories', 'ID', c.id);
    if (!r) throw new Error('Category not found.');
    updateRow_('Categories', r._row, { Name: c.name, Parent: c.parent || '', Active: c.active === false ? 'no' : 'yes' });
  } else {
    appendRow_('Categories', { ID: nextId_('CAT'), Name: c.name, Parent: c.parent || '', Active: 'yes', Created_At: nowStr_() });
  }
  logActivity_('admin', s.id, 'SAVE_CATEGORY', c.name);
  return { ok: true, message: 'Category saved.' };
}

function apiDeleteCategory(token, id) {
  var s = auth_(token, 'admin');
  var r = findRow_('Categories', 'ID', id);
  if (r) sheet_('Categories').deleteRow(r._row);
  logActivity_('admin', s.id, 'DELETE_CATEGORY', id);
  return { ok: true, message: 'Category deleted.' };
}

/* ============================== ORDERS ============================== */

function computeCommission_(sellerId, category, productId, orderAmount) {
  var rows = allRows_('Commissions').filter(function (c) {
    return String(c.Active) === 'yes' && c.Seller_ID === sellerId && inDateRange_(todayStr_(), 'custom', c.Effective_Date, '');
  });
  var percent = null;
  var scopes = [['product', productId], ['category', category], ['seller', '']];
  for (var i = 0; i < scopes.length; i++) {
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].Scope === scopes[i][0] && String(rows[j].Target) === String(scopes[i][1])) { percent = num_(rows[j].Percent); break; }
    }
    if (percent !== null) break;
  }
  if (percent === null) {
    var seller = findRow_('Sellers', 'Seller_ID', sellerId);
    percent = (seller && seller.Commission_Percent !== '') ? num_(seller.Commission_Percent) : num_(getSetting_('App_Settings', 'Default_Commission') || 10);
  }
  var amount = Math.round(orderAmount * percent / 100 * 100) / 100;
  return { percent: percent, amount: amount, earning: Math.round((orderAmount - amount) * 100) / 100 };
}

function apiCreateOrder(token, order) {
  var s = auth_(token, 'admin');
  if (!order.sellerId) throw new Error('Select a seller.');
  if (!order.customerName || !order.customerPhone) throw new Error('Customer name and phone are required.');
  var items = order.items || [];
  if (!items.length) throw new Error('Add at least one product.');
  var total = items.reduce(function (a, i) { return a + num_(i.price) * num_(i.qty); }, 0);
  var discount = num_(order.discount);
  var delivery = num_(order.deliveryCharge);
  var finalAmount = Math.round((total - discount + delivery) * 100) / 100;
  var first = findRow_('Products', 'Product_ID', items[0].productId);
  var comm = computeCommission_(order.sellerId, first ? first.Category : '', items[0].productId, finalAmount);
  var orderId = 'ORD' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10);
  var orderNo = order.orderNo || ('BLY-' + todayStr_().replace(/-/g, '') + '-' + String(Math.floor(1000 + Math.random() * 8999)));
  appendRow_('Orders', {
    Order_ID: orderId, Order_No: orderNo, Seller_ID: order.sellerId,
    Customer_Name: order.customerName, Customer_Phone: order.customerPhone, Customer_Address: order.customerAddress || '',
    Total_Amount: total, Delivery_Charge: delivery, Discount: discount, Final_Amount: finalAmount,
    Commission_Percent: comm.percent, Commission_Amount: comm.amount, Seller_Earning: comm.earning,
    Status: 'New', Remarks: order.remarks || '', Admin_Notes: order.adminNotes || '',
    Payment_Status: 'Unpaid', Created_At: nowStr_(), Updated_At: nowStr_()
  });
  items.forEach(function (i) {
    appendRow_('Order_Items', { ID: nextId_('OIT'), Order_ID: orderId, Product_ID: i.productId || '', Product_Name: i.productName || '', Qty: num_(i.qty), Price: num_(i.price), Subtotal: num_(i.price) * num_(i.qty) });
  });
  notify_('seller', order.sellerId, 'order', 'New Order Assigned', 'Order ' + orderNo + ' has been assigned to you. Final amount: ' + finalAmount, orderId);
  logActivity_('admin', s.id, 'CREATE_ORDER', orderNo + ' -> ' + order.sellerId);
  return { ok: true, orderId: orderId, orderNo: orderNo, message: 'Order created and seller notified.' };
}

function apiUpdateOrder(token, order) {
  var s = auth_(token, 'admin');
  var r = findRow_('Orders', 'Order_ID', order.orderId);
  if (!r) throw new Error('Order not found.');
  updateRow_('Orders', r._row, {
    Customer_Name: order.customerName, Customer_Phone: order.customerPhone,
    Customer_Address: order.customerAddress !== undefined ? order.customerAddress : r.Customer_Address,
    Delivery_Charge: order.deliveryCharge !== undefined ? num_(order.deliveryCharge) : r.Delivery_Charge,
    Discount: order.discount !== undefined ? num_(order.discount) : r.Discount,
    Final_Amount: order.finalAmount !== undefined ? num_(order.finalAmount) : r.Final_Amount,
    Remarks: order.remarks !== undefined ? order.remarks : r.Remarks,
    Admin_Notes: order.adminNotes !== undefined ? order.adminNotes : r.Admin_Notes,
    Updated_At: nowStr_()
  });
  logActivity_('admin', s.id, 'EDIT_ORDER', r.Order_No);
  return { ok: true, message: 'Order updated.' };
}

function apiGetOrders(token, query, status, filter, from, to) {
  var s = auth_(token);
  var orders = allRows_('Orders');
  if (s.role === 'seller') orders = orders.filter(function (o) { return o.Seller_ID === s.id; });
  if (String(query || '')) {
    var q = String(query).toLowerCase();
    orders = orders.filter(function (o) { return [o.Order_No, o.Customer_Name, o.Customer_Phone, o.Seller_ID].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  if (status && status !== 'all') orders = orders.filter(function (o) { return o.Status === status; });
  if (filter && filter !== 'all') orders = orders.filter(function (o) { return inDateRange_(o.Created_At, filter, from, to); });
  return orders.sort(function (a, b) { return String(b.Created_At).localeCompare(String(a.Created_At)); }).map(function (o) {
    o.shopName = shopName_(o.Seller_ID);
    return o;
  });
}

function apiGetOrderDetail(token, orderId) {
  var s = auth_(token);
  var r = findRow_('Orders', 'Order_ID', orderId);
  if (!r) throw new Error('Order not found.');
  if (s.role === 'seller' && r.Seller_ID !== s.id) throw new Error('ACCESS_DENIED');
  return { order: r, items: allRows_('Order_Items').filter(function (i) { return i.Order_ID === orderId; }) };
}

function apiUpdateOrderStatus(token, orderId, status, remarks) {
  var s = auth_(token);
  var r = findRow_('Orders', 'Order_ID', orderId);
  if (!r) throw new Error('Order not found.');
  if (ORDER_STATUSES.indexOf(status) < 0) throw new Error('Unknown status.');
  if (s.role === 'seller') {
    if (r.Seller_ID !== s.id) throw new Error('ACCESS_DENIED');
    if (['Rejected', 'Cancelled', 'New'].indexOf(status) >= 0) throw new Error('Sellers cannot set this status.');
    if (String(r.Status) === 'New') throw new Error('This order is not assigned yet.');
  }
  updateRow_('Orders', r._row, { Status: status, Remarks: (remarks !== undefined && remarks !== '') ? remarks : r.Remarks, Updated_At: nowStr_() });
  if (status === 'Completed') {
    appendRow_('Transactions', { Txn_ID: nextId_('TXN'), Date: nowStr_(), Seller_ID: r.Seller_ID, Order_ID: orderId, Type: 'Order Sale', Amount: num_(r.Final_Amount), Status: 'Completed', Description: 'Order ' + r.Order_No + ' completed.' });
    appendRow_('Transactions', { Txn_ID: nextId_('TXN'), Date: nowStr_(), Seller_ID: r.Seller_ID, Order_ID: orderId, Type: 'Commission', Amount: num_(r.Commission_Amount), Status: 'Pending', Description: 'BLYNZO commission on order ' + r.Order_No });
    appendRow_('Transactions', { Txn_ID: nextId_('TXN'), Date: nowStr_(), Seller_ID: r.Seller_ID, Order_ID: orderId, Type: 'Earning', Amount: num_(r.Seller_Earning), Status: 'Pending', Description: 'Seller earning credited for order ' + r.Order_No });
  }
  if (s.role === 'seller') notify_('admin', '', 'order', 'Order Status Update', 'Order ' + r.Order_No + ' is now ' + status + ' (' + shopName_(s.id) + ').', orderId);
  else if (status !== 'New') notify_('seller', r.Seller_ID, 'order', 'Order ' + r.Order_No + ' - ' + status, 'Order status updated to ' + status + '.' + (remarks ? ' Note: ' + remarks : ''), orderId);
  logActivity_(s.role, s.id, 'ORDER_STATUS', r.Order_No + ' -> ' + status);
  return { ok: true, message: 'Order marked ' + status + '.' };
}

function apiCancelOrder(token, orderId, reason) {
  return apiUpdateOrderStatus(token, orderId, 'Cancelled', reason);
}

/* ============================== COMMISSIONS ============================== */

function apiSetCommission(token, data) {
  var s = auth_(token, 'admin');
  var existing = allRows_('Commissions').filter(function (c) {
    return String(c.Active) === 'yes' && c.Seller_ID === data.sellerId && c.Scope === data.scope && String(c.Target) === String(data.target || '');
  });
  existing.forEach(function (c) { updateRow_('Commissions', c._row, { Active: 'no' }); });
  appendRow_('Commissions', {
    ID: nextId_('COM'), Seller_ID: data.sellerId, Scope: data.scope, Target: data.target || '',
    Percent: num_(data.percent), Effective_Date: data.effectiveDate || todayStr_(), Active: 'yes',
    Created_At: nowStr_(), Created_By: s.id
  });
  if (data.scope === 'seller') {
    var r = findRow_('Sellers', 'Seller_ID', data.sellerId);
    if (r) updateRow_('Sellers', r._row, { Commission_Percent: num_(data.percent) });
  }
  notify_('seller', data.sellerId, 'commission', 'Commission Updated', 'Your ' + data.scope + ' commission is now ' + data.percent + '% effective ' + (data.effectiveDate || todayStr_()) + '.', '');
  logActivity_('admin', s.id, 'SET_COMMISSION', data.sellerId + ' ' + data.scope + ' ' + data.percent + '%');
  return { ok: true, message: 'Commission set.' };
}

function apiGetCommissions(token, sellerId) {
  var s = auth_(token);
  var rows = allRows_('Commissions');
  if (s.role === 'seller') {
    rows = rows.filter(function (c) { return c.Seller_ID === s.id; });
    var active = rows.filter(function (c) { return String(c.Active) === 'yes'; });
    var seller = findRow_('Sellers', 'Seller_ID', s.id);
    return {
      active: active, history: rows.slice().reverse(), sellers: [],
      currentPercent: active.length ? num_(active[0].Percent) : num_(seller ? seller.Commission_Percent : 0)
    };
  }
  if (sellerId && sellerId !== 'all') rows = rows.filter(function (c) { return c.Seller_ID === sellerId; });
  return {
    active: rows.filter(function (c) { return String(c.Active) === 'yes'; }),
    history: rows.slice().reverse(),
    sellers: allRows_('Sellers').map(function (x) { return { id: x.Seller_ID, name: x.Full_Name, commission: x.Commission_Percent, status: x.Status }; })
  };
}

/* ============================== PAYMENTS ============================== */

function apiGetPayments(token, sellerId, status, filter, from, to) {
  var s = auth_(token);
  var rows = allRows_('Payments');
  if (s.role === 'seller') rows = rows.filter(function (p) { return p.Seller_ID === s.id; });
  else if (sellerId && sellerId !== 'all') rows = rows.filter(function (p) { return p.Seller_ID === sellerId; });
  if (status && status !== 'all') rows = rows.filter(function (p) { return p.Status === status; });
  if (filter && filter !== 'all') rows = rows.filter(function (p) { return inDateRange_(p.Payment_Date || p.Created_At, filter, from, to); });
  return rows.sort(function (a, b) { return String(b.Created_At).localeCompare(String(a.Created_At)); });
}

function apiCreatePayment(token, p) {
  var s = auth_(token, 'admin');
  if (!p.sellerId) throw new Error('Select a seller.');
  if (num_(p.amount) <= 0) throw new Error('Enter a valid amount.');
  var proof = uploadFile_(p.proof, p.sellerId, 'payment_proof');
  var pid = 'PAY' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10);
  appendRow_('Payments', {
    Payment_ID: pid, Seller_ID: p.sellerId, Amount: num_(p.amount), Method: p.method || 'UPI',
    Txn_ID: p.txnId || '', Payment_Date: p.paymentDate || todayStr_(), Remarks: p.remarks || '',
    Proof_FileID: proof.fileId, Proof_URL: proof.url, Status: 'Pending', Created_At: nowStr_(), Paid_At: '', Created_By: s.id
  });
  logActivity_('admin', s.id, 'CREATE_PAYMENT', pid + ' ' + p.sellerId + ' ' + p.amount);
  return { ok: true, paymentId: pid, message: 'Payment recorded as Pending. Mark it Paid only after actual confirmation.' };
}

function apiMarkPaymentPaid(token, paymentId, confirm) {
  var s = auth_(token, 'admin');
  if (!confirm) throw new Error('Explicit confirmation required to mark a payment as Paid.');
  var r = findRow_('Payments', 'Payment_ID', paymentId);
  if (!r) throw new Error('Payment not found.');
  if (String(r.Status) === 'Paid') throw new Error('Payment is already marked Paid.');
  updateRow_('Payments', r._row, { Status: 'Paid', Paid_At: nowStr_() });
  appendRow_('Transactions', { Txn_ID: nextId_('TXN'), Date: nowStr_(), Seller_ID: r.Seller_ID, Order_ID: '', Type: 'Payment', Amount: num_(r.Amount), Status: 'Paid', Description: 'Payment ' + paymentId + ' paid via ' + r.Method + (r.Txn_ID ? ' (Txn: ' + r.Txn_ID + ')' : '') });
  notify_('seller', r.Seller_ID, 'payment', 'Payment Credited', 'Payment of ' + r.Amount + ' has been paid to you via ' + r.Method + '.' + (r.Txn_ID ? ' Transaction ID: ' + r.Txn_ID : ''), paymentId);
  logActivity_('admin', s.id, 'PAYMENT_PAID', paymentId + ' ' + r.Seller_ID + ' ' + r.Amount);
  return { ok: true, message: 'Payment marked Paid. Seller notified.' };
}

function apiDeletePayment(token, paymentId) {
  var s = auth_(token, 'admin');
  var r = findRow_('Payments', 'Payment_ID', paymentId);
  if (!r) throw new Error('Payment not found.');
  if (String(r.Status) === 'Paid') throw new Error('Paid payments cannot be deleted.');
  sheet_('Payments').deleteRow(r._row);
  logActivity_('admin', s.id, 'DELETE_PAYMENT', paymentId);
  return { ok: true, message: 'Payment deleted.' };
}

/* ============================== TRANSACTIONS ============================== */

function apiGetTransactions(token, sellerId, type, filter, from, to) {
  var s = auth_(token);
  var rows = allRows_('Transactions');
  if (s.role === 'seller') rows = rows.filter(function (t) { return t.Seller_ID === s.id; });
  else if (sellerId && sellerId !== 'all') rows = rows.filter(function (t) { return t.Seller_ID === sellerId; });
  if (type && type !== 'all') rows = rows.filter(function (t) { return t.Type === type; });
  if (filter && filter !== 'all') rows = rows.filter(function (t) { return inDateRange_(t.Date, filter, from, to); });
  return rows.sort(function (a, b) { return String(b.Date).localeCompare(String(a.Date)); });
}

/* ============================== MEETINGS ============================== */

function apiGetMeetings(token, status) {
  var s = auth_(token);
  var rows = allRows_('Meetings');
  if (s.role === 'seller') rows = rows.filter(function (m) { return m.Seller_ID === s.id; });
  if (status && status !== 'all') rows = rows.filter(function (m) { return m.Status === status; });
  return rows.sort(function (a, b) { return String(b.Created_At).localeCompare(String(a.Created_At)); }).map(function (m) {
    m.shopName = shopName_(m.Seller_ID);
    return m;
  });
}

function apiSaveMeeting(token, m) {
  var s = auth_(token, 'admin');
  if (!m.sellerId || !m.title || !m.date || !m.time) throw new Error('Seller, title, date and time are required.');
  if (m.meetingId) {
    var r = findRow_('Meetings', 'Meeting_ID', m.meetingId);
    if (!r) throw new Error('Meeting not found.');
    updateRow_('Meetings', r._row, { Seller_ID: m.sellerId, Title: m.title, Description: m.description || '', Date: m.date, Time: m.time, Meet_Link: m.meetLink || r.Meet_Link, Status: 'Scheduled' });
    notify_('seller', m.sellerId, 'meeting', 'Meeting Rescheduled', '"' + m.title + '" rescheduled to ' + m.date + ' at ' + m.time + '.', m.meetingId);
    logActivity_('admin', s.id, 'RESCHEDULE_MEETING', m.meetingId);
    return { ok: true, message: 'Meeting rescheduled.' };
  }
  var id = 'MTG' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10);
  appendRow_('Meetings', {
    Meeting_ID: id, Seller_ID: m.sellerId, Title: m.title, Description: m.description || '',
    Date: m.date, Time: m.time, Meet_Link: m.meetLink || '', Status: 'Scheduled',
    Created_At: nowStr_(), Created_By: s.id, Ended_At: ''
  });
  notify_('seller', m.sellerId, 'meeting', 'Meeting Invitation', '"' + m.title + '" on ' + m.date + ' at ' + m.time + '.', id);
  logActivity_('admin', s.id, 'SCHEDULE_MEETING', id + ' -> ' + m.sellerId);
  return { ok: true, meetingId: id, message: 'Meeting scheduled and invitation sent.' };
}

function apiSetMeetingStatus(token, meetingId, status) {
  var s = auth_(token);
  var r = findRow_('Meetings', 'Meeting_ID', meetingId);
  if (!r) throw new Error('Meeting not found.');
  if (['Scheduled', 'Ongoing', 'Ended', 'Cancelled'].indexOf(status) < 0) throw new Error('Unknown status.');
  if (s.role === 'seller' && (r.Seller_ID !== s.id || ['Ended', 'Cancelled'].indexOf(status) >= 0)) throw new Error('ACCESS_DENIED');
  updateRow_('Meetings', r._row, { Status: status, Ended_At: status === 'Ended' ? nowStr_() : r.Ended_At });
  if (s.role === 'admin') notify_('seller', r.Seller_ID, 'meeting', 'Meeting ' + status, '"' + r.Title + '" is now ' + status + '.', meetingId);
  else notify_('admin', '', 'meeting', 'Meeting ' + status, '"' + r.Title + '" is now ' + status + ' (' + shopName_(s.id) + ').', meetingId);
  logActivity_(s.role, s.id, 'MEETING_STATUS', meetingId + ' -> ' + status);
  return { ok: true, message: 'Meeting ' + status + '.' };
}

function apiGetMeetingMessages(token, meetingId, afterId) {
  var s = auth_(token);
  var meeting = findRow_('Meetings', 'Meeting_ID', meetingId);
  if (!meeting) throw new Error('Meeting not found.');
  if (s.role === 'seller' && meeting.Seller_ID !== s.id) throw new Error('ACCESS_DENIED');
  var msgs = allRows_('Meeting_Messages').filter(function (m) { return m.Meeting_ID === meetingId; });
  if (afterId) {
    var idx = -1;
    for (var i = 0; i < msgs.length; i++) if (msgs[i].ID === afterId) idx = i;
    if (idx >= 0) msgs = msgs.slice(idx + 1);
  }
  return { messages: msgs, status: meeting.Status, meetLink: meeting.Meet_Link || '' };
}

function apiSendMeetingMessage(token, meetingId, message) {
  var s = auth_(token);
  var meeting = findRow_('Meetings', 'Meeting_ID', meetingId);
  if (!meeting) throw new Error('Meeting not found.');
  if (s.role === 'seller' && meeting.Seller_ID !== s.id) throw new Error('ACCESS_DENIED');
  if (!String(message || '').trim()) throw new Error('Message is empty.');
  var name = s.role === 'admin' ? 'Admin' : (shopName_(s.id) || s.id);
  var id = nextId_('MMG');
  appendRow_('Meeting_Messages', { ID: id, Meeting_ID: meetingId, Sender_Role: s.role, Sender_Name: name, Message: String(message).trim(), Sent_At: nowStr_() });
  return { ok: true, id: id };
}

/* ============================== NOTICES / NOTIFICATIONS / MESSAGES ============================== */

function apiGetNotifications(token, box) {
  var s = auth_(token);
  var rows = allRows_('Notifications').filter(function (n) {
    return n.Target_Role === s.role && (s.role === 'admin' || String(n.Target_ID) === String(s.id));
  });
  if (box === 'unread') rows = rows.filter(function (n) { return String(n.Read_Flag) === 'no'; });
  if (box === 'read') rows = rows.filter(function (n) { return String(n.Read_Flag) === 'yes'; });
  return rows.sort(function (a, b) { return String(b.Created_At).localeCompare(String(a.Created_At)); });
}

function apiCreateNotice(token, n) {
  var s = auth_(token, 'admin');
  if (!n.title || !n.body) throw new Error('Title and body are required.');
  var targets = [];
  if (n.target === 'all') {
    targets = allRows_('Sellers').filter(function (r) { return String(r.Archive_Flag) !== 'yes'; }).map(function (r) { return r.Seller_ID; });
  } else {
    targets = n.sellerIds || [];
  }
  if (!targets.length) throw new Error('Select at least one seller.');
  if (n.noticeId) {
    var old = allRows_('Notifications').filter(function (x) { return x.Ref === n.noticeId && x.Type === 'notice'; });
    old.forEach(function (x) { sheet_('Notifications').deleteRow(x._row); });
  }
  var ref = n.noticeId || nextId_('NTC');
  targets.forEach(function (sid) { notify_('seller', sid, 'notice', n.title, n.body, ref); });
  logActivity_('admin', s.id, 'CREATE_NOTICE', n.title + ' -> ' + (n.target === 'all' ? 'All sellers' : targets.join(',')));
  return { ok: true, ref: ref, message: 'Notice published to ' + targets.length + ' seller(s).' };
}

function apiDeleteNotice(token, noticeId) {
  var s = auth_(token, 'admin');
  var rows = allRows_('Notifications').filter(function (x) { return x.Ref === noticeId && x.Type === 'notice'; });
  rows.forEach(function (x) { sheet_('Notifications').deleteRow(x._row); });
  logActivity_('admin', s.id, 'DELETE_NOTICE', noticeId);
  return { ok: true, message: 'Notice deleted.' };
}

function apiMarkNotificationRead(token, notificationId) {
  var s = auth_(token);
  var r = findRow_('Notifications', 'ID', notificationId);
  if (!r) throw new Error('Notification not found.');
  if (r.Target_Role !== s.role || (s.role === 'seller' && String(r.Target_ID) !== String(s.id))) throw new Error('ACCESS_DENIED');
  if (String(r.Read_Flag) !== 'yes') updateRow_('Notifications', r._row, { Read_Flag: 'yes', Read_At: nowStr_() });
  return { ok: true };
}

function apiMarkAllNotificationsRead(token) {
  var s = auth_(token);
  allRows_('Notifications').filter(function (n) {
    return n.Target_Role === s.role && String(n.Read_Flag) === 'no' && (s.role === 'admin' || String(n.Target_ID) === String(s.id));
  }).forEach(function (n) { updateRow_('Notifications', n._row, { Read_Flag: 'yes', Read_At: nowStr_() }); });
  return { ok: true };
}

function apiGetMessages(token) {
  var s = auth_(token);
  var rows = allRows_('Messages');
  if (s.role === 'seller') rows = rows.filter(function (m) { return m.Thread_Seller_ID === s.id; });
  return rows.sort(function (a, b) { return String(a.Sent_At).localeCompare(String(b.Sent_At)); });
}

function apiSendMessage(token, body, sellerId, image) {
  var s = auth_(token);
  var hasText = !!String(body || '').trim();
  var hasImg = !!(image && image.data);
  if (!hasText && !hasImg) throw new Error('Message is empty.');
  var threadId = s.role === 'admin' ? sellerId : s.id;
  if (!threadId) throw new Error('Select a seller.');
  var name = s.role === 'admin' ? 'Admin' : (shopName_(s.id) || s.id);
  var img = hasImg ? uploadFile_(image, threadId, 'message') : { fileId: '', url: '' };
  appendRow_('Messages', { ID: nextId_('MSG'), Thread_Seller_ID: threadId, From_Role: s.role, From_Name: name, Body: hasText ? String(body).trim() : '', Image_FileID: img.fileId, Image_URL: img.url, Read_Flag: 'no', Sent_At: nowStr_() });
  var preview = hasText ? String(body).slice(0, 80) : 'Sent an image';
  if (s.role === 'seller') notify_('admin', '', 'message', 'New Seller Message', name + ': ' + preview, threadId);
  else notify_('seller', threadId, 'message', 'New Message from Admin', preview, '');
  return { ok: true };
}

function apiGetMessageThreads(token) {
  var s = auth_(token, 'admin');
  var rows = allRows_('Messages');
  var threads = {};
  rows.forEach(function (m) {
    var prev = m.Body || (m.Image_URL ? 'Sent an image' : '');
    if (!threads[m.Thread_Seller_ID]) threads[m.Thread_Seller_ID] = { sellerId: m.Thread_Seller_ID, last: prev, lastAt: m.Sent_At, unread: 0, shopName: shopName_(m.Thread_Seller_ID) };
    threads[m.Thread_Seller_ID].last = prev;
    threads[m.Thread_Seller_ID].lastAt = m.Sent_At;
    if (m.From_Role === 'seller' && String(m.Read_Flag) === 'no') threads[m.Thread_Seller_ID].unread++;
  });
  var list = Object.keys(threads).map(function (k) { return threads[k]; });
  allRows_('Sellers').forEach(function (r) {
    if (!threads[r.Seller_ID]) list.push({ sellerId: r.Seller_ID, shopName: shopName_(r.Seller_ID), last: '', lastAt: '', unread: 0 });
  });
  return list.sort(function (a, b) { return String(b.lastAt).localeCompare(String(a.lastAt)); });
}

function apiMarkThreadRead(token, sellerId) {
  var s = auth_(token);
  allRows_('Messages').filter(function (m) {
    return m.Thread_Seller_ID === sellerId && m.From_Role !== s.role && String(m.Read_Flag) === 'no';
  }).forEach(function (m) { updateRow_('Messages', m._row, { Read_Flag: 'yes' }); });
  return { ok: true };
}

/* ============================== SUPPORT TICKETS ============================== */

function apiGetTickets(token, status) {
  var s = auth_(token);
  var rows = allRows_('Support_Tickets');
  if (s.role === 'seller') rows = rows.filter(function (t) { return t.Seller_ID === s.id; });
  if (status && status !== 'all') rows = rows.filter(function (t) { return t.Status === status; });
  return rows.sort(function (a, b) { return String(b.Created_At).localeCompare(String(a.Created_At)); }).map(function (t) {
    t.shopName = shopName_(t.Seller_ID);
    return t;
  });
}

function apiCreateTicket(token, t) {
  var s = auth_(token, 'seller');
  if (!t.category || !t.details) throw new Error('Category and details are required.');
  var img = uploadFile_(t.image, s.id, 'ticket');
  var id = 'TKT' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10);
  appendRow_('Support_Tickets', {
    Ticket_ID: id, Seller_ID: s.id, Category: t.category, Details: t.details,
    Image_FileID: img.fileId, Image_URL: img.url, Status: 'Open',
    Admin_Reply: '', Reply_At: '', Created_At: nowStr_(), Updated_At: nowStr_()
  });
  notify_('admin', '', 'support', 'New Support Ticket', shopName_(s.id) + ': [' + t.category + '] ' + String(t.details).slice(0, 80), id);
  logActivity_('seller', s.id, 'CREATE_TICKET', id);
  return { ok: true, ticketId: id, message: 'Ticket created.' };
}

function apiReplyTicket(token, ticketId, reply, status) {
  var s = auth_(token);
  var r = findRow_('Support_Tickets', 'Ticket_ID', ticketId);
  if (!r) throw new Error('Ticket not found.');
  if (s.role === 'admin') {
    updateRow_('Support_Tickets', r._row, { Admin_Reply: reply || r.Admin_Reply, Status: status || 'Answered', Reply_At: nowStr_(), Updated_At: nowStr_() });
    notify_('seller', r.Seller_ID, 'support', 'Support Ticket Update', 'Ticket ' + ticketId + ': ' + String(reply || '').slice(0, 80), ticketId);
  } else {
    if (r.Seller_ID !== s.id) throw new Error('ACCESS_DENIED');
    updateRow_('Support_Tickets', r._row, { Status: 'Reopened', Details: String(r.Details) + '\n[Seller] ' + reply, Updated_At: nowStr_() });
    notify_('admin', '', 'support', 'Ticket Reopened', ticketId + ' reopened by seller.', ticketId);
  }
  logActivity_(s.role, s.id, 'REPLY_TICKET', ticketId);
  return { ok: true, message: 'Ticket updated.' };
}

/* ============================== PROFILE (SELLER) ============================== */

function apiGetSellerProfile(token) {
  var s = auth_(token, 'seller');
  var seller = findRow_('Sellers', 'Seller_ID', s.id);
  var profile = findRow_('Seller_Profiles', 'Seller_ID', s.id) || {};
  var shop = findRow_('Seller_Shops', 'Seller_ID', s.id) || {};
  var bank = findRow_('Seller_Bank_Details', 'Seller_ID', s.id) || {};
  return { seller: sellerPublic_(seller), profile: { identityStatus: profile.Identity_Status || 'Not Submitted' }, shop: shop, bank: bank };
}

function apiRequestProfileChange(token, data) {
  var s = auth_(token, 'seller');
  var summary = [];
  if (data.profile) summary.push('Profile: ' + data.profile);
  if (data.shop) summary.push('Shop: ' + data.shop);
  if (data.bank) summary.push('Bank: ' + data.bank);
  if (!summary.length) throw new Error('Describe the changes you request.');
  var req = '[' + nowStr_() + '] ' + summary.join(' | ');
  var shop = findRow_('Seller_Shops', 'Seller_ID', s.id);
  if (shop) updateRow_('Seller_Shops', shop._row, { Change_Request: ((shop.Change_Request ? shop.Change_Request + '\n' : '') + req).slice(0, 900), Updated_At: nowStr_() });
  notify_('admin', '', 'profile_change', 'Seller Change Request', shopName_(s.id) + ': ' + summary.join(' | ').slice(0, 120), s.id);
  logActivity_('seller', s.id, 'PROFILE_CHANGE_REQUEST', summary.join(' | '));
  return { ok: true, message: 'Change request sent to admin for approval.' };
}

function apiChangeSellerPin(token, currentPin, newPin) {
  var s = auth_(token, 'seller');
  var r = findRow_('Sellers', 'Seller_ID', s.id);
  if (!r) throw new Error('Seller not found.');
  if (!checkHash_(String(currentPin), String(r.PIN_Salt), String(r.PIN_Hash))) throw new Error('Current PIN is incorrect.');
  newPin = String(newPin || '');
  if (newPin.length < 6 || !/^\d+$/.test(newPin)) throw new Error('New PIN must be at least 6 digits.');
  var salt = Utilities.getUuid().replace(/-/g, '');
  updateRow_('Sellers', r._row, { PIN_Hash: hash_(newPin, salt), PIN_Salt: salt });
  logActivity_('seller', s.id, 'CHANGE_PIN', 'Seller changed PIN');
  return { ok: true, message: 'PIN changed successfully.' };
}

/* ============================== ADMIN SETTINGS / SECURITY ============================== */

function apiGetAdminSettings(token) {
  auth_(token, 'admin');
  return { app: getAllSettings_('App_Settings'), admin: getAllSettings_('Admin_Settings') };
}

function apiSaveAppSettings(token, settings) {
  var s = auth_(token, 'admin');
  Object.keys(settings || {}).forEach(function (k) { setSetting_('App_Settings', k, settings[k]); });
  logActivity_('admin', s.id, 'SAVE_SETTINGS', Object.keys(settings || {}).join(','));
  return { ok: true, message: 'Settings saved.' };
}

function apiChangeAdminCredentials(token, currentPassword, newUserId, newPassword) {
  var s = auth_(token, 'admin');
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('ADMIN_SALT');
  var storedHash = props.getProperty('ADMIN_HASH');
  if (!checkHash_(String(currentPassword), salt, storedHash)) throw new Error('Current password is incorrect.');
  if (newUserId) {
    newUserId = String(newUserId).trim();
    if (newUserId.length < 4) throw new Error('New User ID must be at least 4 characters.');
    props.setProperty('ADMIN_USER_ID', newUserId);
  }
  if (newPassword) {
    newPassword = String(newPassword);
    if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
    var ns = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('ADMIN_SALT', ns);
    props.setProperty('ADMIN_HASH', hash_(newPassword, ns));
  }
  logActivity_('admin', s.id, 'CHANGE_ADMIN_CREDENTIALS', (newUserId ? 'User ID changed ' : '') + (newPassword ? 'Password changed' : ''));
  return { ok: true, message: 'Admin credentials updated.' };
}

function apiLogoutAllSessions(token) {
  var s = auth_(token, 'admin');
  destroyAllSessions_(null);
  logActivity_('admin', s.id, 'LOGOUT_ALL', 'All sessions terminated');
  return { ok: true, message: 'All sessions logged out.' };
}

function apiGetActivityLogs(token, query, filter, from, to) {
  auth_(token, 'admin');
  var rows = allRows_('Activity_Logs');
  if (String(query || '')) {
    var q = String(query).toLowerCase();
    rows = rows.filter(function (l) { return [l.Actor_ID, l.Action, l.Details].join(' ').toLowerCase().indexOf(q) >= 0; });
  }
  if (filter && filter !== 'all') rows = rows.filter(function (l) { return inDateRange_(l.Created_At, filter, from, to); });
  return rows.slice(-500).reverse();
}

function apiExportData(token, entity, sellerId) {
  auth_(token, 'admin');
  var map = {
    sellers: 'Sellers', products: 'Products', orders: 'Orders', payments: 'Payments',
    transactions: 'Transactions', commissions: 'Commissions', logs: 'Activity_Logs'
  };
  if (!map[entity]) throw new Error('Unknown export entity.');
  var rows = allRows_(map[entity]);
  if (sellerId && sellerId !== 'all') rows = rows.filter(function (r) { return r.Seller_ID === sellerId; });
  return rows.map(function (r) {
    var o = {};
    Object.keys(r).forEach(function (k) {
      if (k === '_row') return;
      if (['PIN_Hash', 'PIN_Salt', 'Account_Number'].indexOf(k) >= 0) o[k] = 'PROTECTED';
      else o[k] = r[k];
    });
    return o;
  });
}

function apiLogout(token) {
  var s = getSession_(token);
  if (s) {
    destroySession_(token);
    logActivity_(s.role, s.id, 'LOGOUT', 'User logged out');
  }
  return { ok: true };
}
