import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { LandApplication } from './src/types.ts';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { randomBytes } from 'crypto';

dotenv.config();

const app = express();
const PORT = 3000;

// Configure body parsers with limit to handle PDF/image base64 document attachments
app.use(express.json({ limit: '50mb' }));

// Keep administrator credentials on the server; set ADMIN_USERNAME and
// ADMIN_PASSWORD in production. Sessions expire automatically after 8 hours.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Engr.Masum';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Sharmin2023';
const adminSessions = new Map<string, number>();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.header('x-admin-session') || '';
  const expiresAt = adminSessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) adminSessions.delete(token);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + SESSION_TTL_MS);
  res.json({ token, expiresIn: SESSION_TTL_MS });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  adminSessions.delete(req.header('x-admin-session') || '');
  res.status(204).end();
});

// Nodemailer SMTP configured connections or sandboxed Ethereal fallback helper
const getMailTransporter = async () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port: port || 587,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });
  }

  // Live sandbox test credentials
  try {
    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
  } catch (error) {
    // Plain console logger fallback
    return {
      sendMail: async (options: any) => {
        console.log('============= [CONSOLE LOG MOCK EMAIL] =============');
        console.log(`FROM: ${options.from}`);
        console.log(`TO: ${options.to}`);
        console.log(`SUBJECT: ${options.subject}`);
        console.log(`BODY: ${options.text}`);
        console.log('======================================================');
        return { messageId: `local-mock-${Date.now()}` };
      }
    } as any;
  }
};

// Compile and dispatch status alert email
async function sendApplicationStatusEmail(landApp: LandApplication) {
  const applicantName = landApp.applicantName || landApp.siteLocation?.applicantName || 'নাগরিক';
  const recipient = landApp.applicantEmail || landApp.siteLocation?.applicantEmail || 'engr.ghm@gmail.com'; 
  console.log(`[Email Alert] Status notifying applicant ${applicantName} (${recipient}) for tracker ${landApp.id}...`);

  try {
    const transporter = await getMailTransporter();
    
    let statusLabelBg = '#f1f5f9';
    let statusLabelText = '#475569';
    let statusLabelBn = 'পেন্ডিং (Pending)';
    
    const s = String(landApp.status).toLowerCase();
    if (s === 'approved') {
      statusLabelBg = '#ecfdf5';
      statusLabelText = '#047857';
      statusLabelBn = 'অনুমোদিত (Approved)';
    } else if (s === 'rejected') {
      statusLabelBg = '#fef2f2';
      statusLabelText = '#b91c1c';
      statusLabelBn = 'প্রত্যাখ্যাত (Rejected)';
    } else if (s === 'under_review' || s === 'investigating' || s === 'under review') {
      statusLabelBg = '#fffbeb';
      statusLabelText = '#b45309';
      statusLabelBn = 'তদন্তাধীন/পর্যালোচনায় (Under Review)';
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const statusPageUrl = `${appUrl}/?trackingId=${landApp.id}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>আবেদন ট্র্যাকিং স্থিতি আপডেট</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #f8fafc;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid #e2e8f0;
          }
          .header {
            background: linear-gradient(135deg, #064e3b 0%, #065f46 100%);
            padding: 30px 20px;
            text-align: center;
            border-bottom: 4px solid #f97316;
          }
          .header h1 {
            color: #ffffff;
            margin: 0;
            font-size: 22px;
            font-weight: 700;
          }
          .header p {
            color: #ffedd5;
            margin: 5px 0 0 0;
            font-size: 13px;
            text-transform: uppercase;
          }
          .content {
            padding: 30px 25px;
          }
          .salutation {
            font-size: 16px;
            font-weight: bold;
            color: #0f172a;
            margin-bottom: 12px;
          }
          .intro-text {
            color: #475569;
            font-size: 14px;
            line-height: 1.6;
            margin-bottom: 25px;
          }
          .status-container {
            text-align: center;
            background-color: #f8fafc;
            border: 1px dashed #cbd5e1;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 25px;
          }
          .status-label {
            font-size: 11px;
            text-transform: uppercase;
            color: #64748b;
            font-weight: bold;
          }
          .status-badge {
            display: inline-block;
            margin-top: 8px;
            padding: 8px 18px;
            font-size: 15px;
            font-weight: bold;
            border-radius: 20px;
            background-color: ${statusLabelBg};
            color: ${statusLabelText};
            border: 1px solid ${statusLabelText}33;
          }
          .details-card {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            margin-bottom: 25px;
            overflow: hidden;
          }
          .details-header {
            background-color: #f1f5f9;
            padding: 10px 15px;
            font-size: 12px;
            font-weight: bold;
            color: #334155;
            border-bottom: 1px solid #e2e8f0;
          }
          .details-row {
            padding: 12px 15px;
            border-bottom: 1px solid #f1f5f9;
            font-size: 13px;
          }
          .details-row:last-child {
            border-bottom: none;
          }
          .details-key {
            font-weight: bold;
            color: #64748b;
            display: inline-block;
            width: 120px;
          }
          .details-val {
            color: #0f172a;
          }
          .remarks-box {
            background-color: #fffbeb;
            border-left: 4px solid #f59e0b;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 25px;
            font-size: 13px;
            color: #78350f;
          }
          .remarks-title {
            font-weight: bold;
            margin-bottom: 5px;
            font-size: 12px;
          }
          .button-container {
            text-align: center;
            margin-bottom: 30px;
          }
          .btn-primary {
            display: inline-block;
            background-color: #047857;
            color: #ffffff !important;
            text-decoration: none;
            padding: 12px 24px;
            font-size: 14px;
            font-weight: bold;
            border-radius: 6px;
          }
          .footer {
            background-color: #f1f5f9;
            padding: 20px;
            text-align: center;
            border-top: 1px solid #e2e8f0;
            font-size: 11px;
            color: #94a3b8;
          }
          .footer p {
            margin: 4px 0;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>ভূমি সীমানা নির্ধারণ ও তদন্ত সেল</h1>
            <p>সীতাকুণ্ড পৌরসভা কার্যালয়, চট্টগ্রাম</p>
          </div>
          <div class="content">
            <div class="salutation">সুপ্রিয় নিবেদক, ${landApp.applicantName}</div>
            <div class="intro-text">
              সীতাকুণ্ড পৌরসভার ভূমি তদন্ত ডেডিকেটেড সেল থেকে জানানো যাচ্ছে যে, আপনার জমাকৃত সীমানা নির্ধারণী ও তদন্ত আবেদনের স্থিতি পরিবর্তন করা হয়েছে। সর্বশেষ তথ্য নিম্নরূপ:
            </div>
            
            <div class="status-container">
              <span class="status-label">আবেদনের বর্তমান স্থিতি / Current Status</span><br>
              <span class="status-badge">${statusLabelBn}</span>
            </div>

            <div class="details-card">
              <div class="details-header">আবেদনের সংক্ষিপ্ত তথ্যাবলী (Application Details)</div>
              <div class="details-row">
                <span class="details-key">ট্র্যাকিং আইডি:</span>
                <span class="details-val" style="font-family: monospace; font-weight: bold; font-size: 14px; color: #064e3b;">${landApp.id}</span>
              </div>
              <div class="details-row">
                <span class="details-key">মৌজার নাম:</span>
                <span class="details-val">${landApp.mouzaName}</span>
              </div>
              <div class="details-row">
                <span class="details-key">বি.এস দাগ নং:</span>
                <span class="details-val">${landApp.bsDagNo}</span>
              </div>
              <div class="details-row">
                <span class="details-key">আবেদনের তারিখ:</span>
                <span class="details-val">${landApp.applicationDate}</span>
              </div>
            </div>

            ${landApp.adminRemarks ? `
              <div class="remarks-box">
                <div class="remarks-title">পৌর কর্তৃপক্ষের মন্তব্য / Remarks:</div>
                <div>${landApp.adminRemarks}</div>
              </div>
            ` : ''}

            <div class="button-container">
              <a href="${statusPageUrl}" target="_blank" class="btn-primary">আবেদনের বিস্তারিত ও কিউআর ডাউনলোড করুন</a>
            </div>
          </div>
          <div class="footer">
            <p>© ২০২৬ সীতাকুণ্ড পৌরসভা। সর্বস্বত্ব সংরক্ষিত।</p>
            <p>এটি একটি স্বয়ংক্রিয় সিস্টেম জেনারেটেড অনলাইন ইমেইল বিজ্ঞপ্তি। কোনো উত্তরের প্রয়োজন নেই।</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const fromAddress = process.env.SMTP_FROM || '"সীতাকুণ্ড পৌরসভা" <no-reply@sitakunda.gov.bd>';
    const mailOptions = {
      from: fromAddress,
      to: recipient,
      subject: `[${landApp.id}] আবেদন স্থিতি পরিবর্তন বিজ্ঞপ্তি - সীতাকুণ্ড পৌরসভা`,
      text: `সুপ্রিয় নিবেদক ${landApp.applicantName},\n\nআপনার সীমানা নির্ধারণী আবেদনের (ID: ${landApp.id}) স্থিতি পরিবর্তন করা হয়েছে।\n\nবর্তমান স্থিতি: ${landApp.status}\n\nপৌর কর্তৃপক্ষের মন্তব্য: ${landApp.adminRemarks || 'নেই'}\n\nবিস্তারিত দেখুন: ${statusPageUrl}`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email Sent] Mail ID: ${info.messageId}`);
    
    // Log preview link if Ethereal test inbox was triggered
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log('======================================================');
      console.log('📬 Ethereal Sandbox Notification sent!');
      console.log(`URL to preview generated HTML email: ${previewUrl}`);
      console.log('======================================================');
    }
  } catch (error) {
    console.error('[Email Error] Failed to compile or dispatch email alert:', error);
  }
}
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'submissions.json');

// Ensure the local database directory and file exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Seed mock land applications for Sitakunda to give a realistic out-of-the-box demo
const seedData: any[] = [
  {
    id: "APP-2026-0001",
    formNo: "SP-7482-01",
    formPrice: 100,
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    status: 'Pending',
    adminRemarks: '',
    proposedStructureType: 'Building',
    buildingFloors: '৫',
    buildingCategory: 'Residential',
    owners: [
      {
        name: 'আলহাজ্ব মো: জাফর উল্লাহ',
        fatherOrHusbandName: 'মরহুম আব্দুল খালেক',
        permanentAddress: {
          villageOrMahalla: 'শেখের পাড়া',
          wardNo: '০৩',
          upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
          thana: 'সীতাকুণ্ড',
          upazila: 'সীতাকুণ্ড',
          district: 'চট্টগ্রাম'
        },
        presentAddress: {
          villageOrMahalla: 'মুন্সেফ পাড়া',
          wardNo: '০৪',
          upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
          thana: 'সীতাকুণ্ড',
          upazila: 'সীতাকুণ্ড',
          district: 'চট্টগ্রাম'
        }
      }
    ],
    mouzaName: 'মহাদেবপুর',
    jlNo: '27',
    rsKhatianNo: '৪৫০',
    rsDagNo: '১২০৫',
    bsKhatianNo: '৭৮২',
    bsDagNo: '৩৪৮ো',
    mutatedBsKhatianNo: '৭৮২/ক',
    landQuantity: '০.১৫ একর (১৫ শতক)',
    landClass: 'নাল (ভিটি)',
    deedNoAndDate: 'দলিল নং ৫১২৪/২০১৮, তারিখ: ১২/০৬/২০১৮',
    permanentAddress: {
      villageOrMahalla: 'শেখের পাড়া',
      wardNo: '০৩',
      upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
      thana: 'সীতাকুণ্ড',
      upazila: 'সীতাকুণ্ড',
      district: 'চট্টগ্রাম'
    },
    presentAddress: {
      villageOrMahalla: 'মুন্সেফ পাড়া',
      wardNo: '০৪',
      upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
      thana: 'সীতাকুণ্ড',
      upazila: 'সীতাকুণ্ড',
      district: 'চট্টগ্রাম'
    },
    proposedSiteAddress: {
      villageOrMahalla: 'মহাদেবপুর সড়ক সংলগ্ন',
      wardNo: '০৩',
      upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
      thana: 'সীতাকুণ্ড',
      upazila: 'সীতাকুণ্ড',
      district: 'চট্টগ্রাম'
    },
    applicantName: 'আলহাজ্ব মো: জাফর উল্লাহ',
    applicantFatherOrHusbandName: 'মরহুম আব্দুল খালেক',
    applicantMobile: '01819654321',
    applicantEmail: 'zafar@example.com',
    applicationDate: '2026-06-01',
    attachments: [
      { 
        id: '1', 
        label: 'জাতীয় পরিচয়পত্র/জন্ম নিবন্ধন সনদ/পাসপোর্টের ফটোকপি (আবশ্যক)', 
        required: true, 
        uploaded: true, 
        fileName: 'nid_zafar.pdf', 
        fileSize: '242 KB', 
        fileData: 'data:application/pdf;base64,JVBERi0xLjQKJdPr6gogMSAwIG9iagogIDw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+CmVuZG9iagoyIDAgb2JqagogIDw8L1R5cGUvUGFnZXMvS2lkc1szIDAgUl0vQ291bnQgMT4+CmVuZG9iagozIDAgb2JqagogIDw8L1R5cGUvUGFnZS9QYXJlbnQgMiAwIFIvTWVkaWFCb3hbMCAwIDU5NSA4NDJdL1Jlc291cmNlczw8Pj4vQ29udGVudHMgNCAwIFI+PgplbmRvYmoKNCAwIG9iagogIDw8L0xlbmd0aCAwPj5zdHJlYW0KZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2MCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyMjIgMDAwMDAgbiAKdHJhaWxlcagogIDw8L1NpemUgNS9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjI3MQolJUVPRgo='
      },
      { 
        id: '2', 
        label: 'ছবি (পাসপোর্ট সাইজ) (আবশ্যক)', 
        required: true, 
        uploaded: true, 
        fileName: 'photo_zafar.jpg', 
        fileSize: '85 KB', 
        fileData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      },
      { id: '3', label: 'আর.এস খতিয়ান এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'rs_khatian_1205.pdf', fileSize: '320 KB' },
      { id: '4', label: 'বি.এস খতিয়ান এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'bs_khatian_3480.pdf', fileSize: '344 KB' },
      { id: '5', label: 'সৃজিত বি.এস খতিয়ান এর ফটোকপি', required: true, uploaded: true, fileName: 'mutated_bs_782.pdf', fileSize: '180 KB' },
      { id: '6', label: 'খরিদা/হেবা/দানপত্র/বণ্টননামা দলিল (রেজিস্ট্রিকৃত) এর ফটোকপি', required: true, uploaded: true, fileName: 'deed_5124.pdf', fileSize: '1.2 MB' },
      { id: '7', label: 'মৌজা ম্যাপ এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'mouja_map_38.jpg', fileSize: '540 KB' },
      { id: '8', label: 'ওয়ারিশান সনদপত্র এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: false },
      { id: '9', label: 'অনাপত্তি পত্র (দাগের অন্যান্য মালিকগণের) এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: false },
      { id: '10', label: 'হোল্ডিং কর পরিশোধের হালনাগাদ রশিদের ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'holding_tax_2026.pdf', fileSize: '150 KB' },
      { id: '11', label: 'আয়কর ই-রিটার্ন সার্টিফিকেট', required: false, uploaded: true, fileName: 'e_return_tax.pdf', fileSize: '98 KB' }
    ]
  },
  {
    id: "APP-2026-0002",
    formNo: "SP-8930-02",
    formPrice: 100,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    status: 'Approved',
    adminRemarks: 'भूमि সরজমিনে পরিদর্শন করা হয়েছে। আর.এস ও বি.এস দাগের সীমানা সঠিক আছে। অনুমোদন দেওয়া হলো।',
    proposedStructureType: 'Boundary Wall',
    buildingCategory: 'Residential',
    owners: [
      {
        name: 'মোছাম্মৎ রিজিয়া বেগম',
        fatherOrHusbandName: 'মো: জহিরুল ইসলাম',
        permanentAddress: {
          villageOrMahalla: 'হৈদার পাড়া',
          wardNo: '০৬',
          upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
          thana: 'সীতাকুণ্ড',
          upazila: 'সীতাকুণ্ড',
          district: 'চট্টগ্রাম'
        },
        presentAddress: {
          villageOrMahalla: 'হৈদার পাড়া',
          wardNo: '০৬',
          upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
          thana: 'সীতাকুণ্ড',
          upazila: 'সীতাকুণ্ড',
          district: 'চট্টগ্রাম'
        }
      }
    ],
    mouzaName: 'জঙ্গল মহাদেবপুর',
    jlNo: '30',
    rsKhatianNo: '৫৮',
    rsDagNo: '৮৯২',
    bsKhatianNo: '৩১২',
    bsDagNo: '১৮৫৪',
    mutatedBsKhatianNo: '',
    landQuantity: '০.০৮ একর (৮ শতক)',
    landClass: 'নাল',
    deedNoAndDate: 'দলিল নং ৩০১৪/২০২১, তারিখ: ১২/১০/২০২১',
    permanentAddress: {
      villageOrMahalla: 'হৈদার পাড়া',
      wardNo: '০৬',
      upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
      thana: 'সীতাকুণ্ড',
      upazila: 'সীতাকুণ্ড',
      district: 'চট্টগ্রাম'
    },
    presentAddress: {
      villageOrMahalla: 'হৈদার পাড়া',
      wardNo: '০৬',
      upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
      thana: 'সীতাকুণ্ড',
      upazila: 'সীতাকুণ্ড',
      district: 'চট্টগ্রাম'
    },
    proposedSiteAddress: {
      villageOrMahalla: 'হৈদার পাড়া (বি.এস ১৮৫৪)',
      wardNo: '০৬',
      upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
      thana: 'সীতাকুণ্ড',
      upazila: 'সীতাকুণ্ড',
      district: 'চট্টগ্রাম'
    },
    applicantName: 'মো: জহিরুল ইসলাম',
    applicantFatherOrHusbandName: 'মৃত সুলতান আহমেদ',
    applicantMobile: '01712345678',
    applicantEmail: 'jahir@example.com',
    applicationDate: '2026-06-03',
    attachments: [
      { 
        id: '1', 
        label: 'জাতীয় পরিচয়পত্র/জন্ম নিবন্ধন সনদ/পাসপোর্টের ফটোকপি (আবশ্যক)', 
        required: true, 
        uploaded: true, 
        fileName: 'nid_jahir.pdf', 
        fileSize: '310 KB', 
        fileData: 'data:application/pdf;base64,JVBERi0xLjQKJdPr6gogMSAwIG9iagogIDw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+CmVuZG9iagoyIDAgb2JqagogIDw8L1R5cGUvUGFnZXMvS2lkc1szIDAgUl0vQ291bnQgMT4+CmVuZG9iagozIDAgb2JqagogIDw8L1R5cGUvUGFnZS9QYXJlbnQgMiAwIFIvTWVkaWFCb3hbMCAwIDU5NSA4NDJdL1Jlc291cmNlczw8Pj4vQ29udGVudHMgNCAwIFI+PgplbmRvYmoKNCAwIG9iagogIDw8L0xlbmd0aCAwPj5zdHJlYW0KZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2MCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyMjIgMDAwMDAgbiAKdHJhaWxlcagogIDw8L1NpemUgNS9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjI3MQolJUVPRgo='
      },
      { 
        id: '2', 
        label: 'ছবি (পাসপোর্ট সাইজ) (আবশ্যক)', 
        required: true, 
        uploaded: true, 
        fileName: 'photo_jahir.jpg', 
        fileSize: '95 KB', 
        fileData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      },
      { id: '3', label: 'আর.এস খতিয়ান এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'rs_kh_58.pdf', fileSize: '215 KB' },
      { id: '4', label: 'বি.এস খতিয়ান এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'bs_kh_312.pdf', fileSize: '410 KB' },
      { id: '5', label: 'সৃজিত বি.এস খতিয়ান এর ফটোকপি', required: true, uploaded: false },
      { id: '6', label: 'খরিদা/হেবা/দানপত্র/বণ্টননামা দলিল (রেজিস্ট্রিকৃত) এর ফটোকপি', required: true, uploaded: true, fileName: 'deed_registry_copy.pdf', fileSize: '2.4 MB' },
      { id: '7', label: 'মৌজা ম্যাপ এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'mouja_map_92.png', fileSize: '1.5 MB' },
      { id: '8', label: 'ওয়ারিশান সনদপত্র এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: false },
      { id: '9', label: 'অনাপত্তি পত্র (দাগের অন্যান্য মালিকগণের) এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: false },
      { id: '10', label: 'হোল্ডিং কর পরিশোধের হালনাগাদ রশিদের ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'tax_slip_2026.jpg', fileSize: '335 KB' },
      { id: '11', label: 'আয়কর ই-রিটারৃত সার্টিফিকেট', required: false, uploaded: false }
    ]
  },
  {
    id: "APP-2026-0003",
    formNo: "SP-1049-03",
    formPrice: 100,
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    status: 'Rejected',
    adminRemarks: 'আর.এস খতিয়ান ও বি.এস খতিয়ানের দাগ ও নামের মণ্ডলে ব্যাপক অসঙ্গতি রয়েছে এবং দখল নিয়ে স্থানীয় বিরোধ রয়েছে। পুনঃযাচাইয়ের পরামর্শ দেওয়া হলো।',
    proposedStructureType: 'Building',
    buildingFloors: '১০',
    buildingCategory: 'Commercial',
    owners: [
      {
        name: 'মেসার্স সীতাকুণ্ড স্টিল কোং',
        fatherOrHusbandName: 'ব্যবস্থাপনা পরিচালক: মো: কামরুল হাসান',
        permanentAddress: {
          villageOrMahalla: 'হালিশহর চৌধুরী পাড়া',
          wardNo: '১৬',
          upOrPourashava: 'চট্টগ্রাম সিটি কর্পোরেশন',
          thana: 'হালিশহর',
          upazila: 'ডবলমুরিং',
          district: 'চট্টগ্রাম'
        },
        presentAddress: {
          villageOrMahalla: 'ডেকটাওয়ার সংলগ্ন',
          wardNo: '০৫',
          upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
          thana: 'সীতাকুণ্ড',
          upazila: 'সীতাকুণ্ড',
          district: 'চট্টগ্রাম'
        }
      }
    ],
    mouzaName: 'শিবপুর',
    jlNo: '19',
    rsKhatianNo: '১০২',
    rsDagNo: '৭৫',
    bsKhatianNo: '৪৯২',
    bsDagNo: '২৪১০',
    mutatedBsKhatianNo: '৪৯২/ক',
    landQuantity: '০.৪৫ একর (৪৫ শতক)',
    landClass: 'বাণিজ্যিক জমি (নাল সংলগ্ন)',
    deedNoAndDate: 'দলিল নং ১০৮৪/২০২২, তারিখ: ০৪/০৫/২০২২',
    permanentAddress: {
      villageOrMahalla: 'হালিশহর চৌধুরী পাড়া',
      wardNo: '১৬',
      upOrPourashava: 'চট্টগ্রাম সিটি কর্পোরেশন',
      thana: 'হালিশহর',
      upazila: 'ডবলমুরিং',
      district: 'চট্টগ্রাম'
    },
    presentAddress: {
      villageOrMahalla: 'ডেকটাওয়ার সংলগ্ন',
      wardNo: '০৫',
      upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
      thana: 'সীতাকুণ্ড',
      upazila: 'সীতাকুণ্ড',
      district: 'চট্টগ্রাম'
    },
    proposedSiteAddress: {
      villageOrMahalla: 'মেইন রোড কুমিরা',
      wardNo: '০৯',
      upOrPourashava: 'সীতাকুণ্ড পৌরসভা',
      thana: 'সীতাকুণ্ড',
      upazila: 'সীতাকুণ্ড',
      district: 'চট্টগ্রাম'
    },
    applicantName: 'মো: কামরুল হাসান',
    applicantFatherOrHusbandName: 'আবুল কালাম আজাদ',
    applicantMobile: '01815123456',
    applicantEmail: 'kamrul@example.com',
    applicationDate: '2026-06-04',
    attachments: [
      { 
        id: '1', 
        label: 'জাতীয় পরিচয়পত্র/জন্ম নিবন্ধন সনদ/পাসপোর্টের ফটোকপি (আবশ্যক)', 
        required: true, 
        uploaded: true, 
        fileName: 'nid_kamrul.pdf', 
        fileSize: '1.1 MB', 
        fileData: 'data:application/pdf;base64,JVBERi0xLjQKJdPr6gogMSAwIG9iagogIDw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+CmVuZG9iagoyIDAgb2JqagogIDw8L1R5cGUvUGFnZXMvS2lkc1szIDAgUl0vQ291bnQgMT4+CmVuZG9iagozIDAgb2JqagogIDw8L1R5cGUvUGFnZS9QYXJlbnQgMiAwIFIvTWVkaWFCb3hbMCAwIDU5NSA4NDJdL1Jlc291cmNlczw8Pj4vQ29udGVudHMgNCAwIFI+PgplbmRvYmoKNCAwIG9iagogIDw8L0xlbmd0aCAwPj5zdHJlYW0KZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2MCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyMjIgMDAwMDAgbiAKdHJhaWxlcagogIDw8L1NpemUgNS9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjI3MQolJUVPRgo='
      },
      { 
        id: '2', 
        label: 'ছবি (পাসপোর্ট সাইজ) (আবশ্যক)', 
        required: true, 
        uploaded: true, 
        fileName: 'company_photo.jpg', 
        fileSize: '120 KB', 
        fileData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      },
      { id: '3', label: 'আর.এস খতিয়ান এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'rs_khatian_75.pdf', fileSize: '480 KB' },
      { id: '4', label: 'বি.এস খতিয়ান এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'bs_khatian_2410.pdf', fileSize: '530 KB' },
      { id: '5', label: 'সৃজিত বি.এস খতিয়ান এর ফটোকপি', required: true, uploaded: true, fileName: 'srijit_khatian.pdf', fileSize: '320 KB' },
      { id: '6', label: 'খরিদা/হেবা/দানপত্র/বণ্টননামা দলিল (রেজিস্ট্রিকৃত) এর ফটোকপি', required: true, uploaded: true, fileName: 'deed_commercial_1084.pdf', fileSize: '3.8 MB' },
      { id: '7', label: 'মৌজা ম্যাপ এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'mouja_map_kumira.pdf', fileSize: '1.2 MB' },
      { id: '8', label: 'ওয়ারিশান সনদপত্র এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: false },
      { id: '9', label: 'অনাপত্তি পত্র (দাগের অন্যান্য মালিকগণের) এর ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'noc_copartners.pdf', fileSize: '650 KB' },
      { id: '10', label: 'হোল্ডিং কর পরিশোধের হালনাগাদ রশিদের ফটোকপি (প্রযোজ্য ক্ষেত্রে)', required: false, uploaded: true, fileName: 'holding_tax_receipt.png', fileSize: '740 KB' },
      { id: '11', label: 'আয়কর ই-রিটার্ন সার্টিফিকেট', required: false, uploaded: true, fileName: 'tax_return_corp.pdf', fileSize: '580 KB' }
    ]
  }
];

let shouldSeed = !fs.existsSync(DATA_FILE);
if (!shouldSeed) {
  try {
    const existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    if (existing.length > 0 && !existing[0].attachments.some((a: any) => a.id === '1')) {
      shouldSeed = true;
    }
  } catch (e) {
    shouldSeed = true;
  }
}
if (shouldSeed) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(seedData, null, 2), 'utf-8');
}

// Helper to write submissions
const getSubmissions = (): LandApplication[] => {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
};

const saveSubmissions = (data: LandApplication[]) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
};

// API Endpoints

// 1. Get all submissions with filtering & search done server-side or handled nicely
app.get('/api/submissions', (req, res) => {
  try {
    const data = getSubmissions();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve applications' });
  }
});

// 2. Submit new application
app.post('/api/submissions', (req, res) => {
  try {
    const submissions = getSubmissions();
    const newApp: LandApplication = req.body;
    
    // Add server-side auto validation/fill
    const dateSegment = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randNo = Math.floor(1000 + Math.random() * 9000);
    newApp.id = `APP-${dateSegment}-${randNo}`;
    newApp.formNo = `SP-${Math.floor(1000 + Math.random() * 9000)}-${submissions.length + 1}`;
    newApp.formPrice = 100;
    newApp.createdAt = new Date().toISOString();
    newApp.status = 'pending';
    newApp.adminRemarks = '';

    submissions.push(newApp);
    saveSubmissions(submissions);
    res.status(201).json(newApp);
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit application. Please try again.' });
  }
});

// 3. Update Status
app.put('/api/submissions/:id/status', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminRemarks } = req.body;
    const submissions = getSubmissions();
    const targetIdx = submissions.findIndex(item => item.id === id);
    if (targetIdx === -1) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    submissions[targetIdx].status = status;
    submissions[targetIdx].adminRemarks = adminRemarks || '';
    
    saveSubmissions(submissions);

    // Asynchronously dispatch the status notification alert
    sendApplicationStatusEmail(submissions[targetIdx]).catch(mailErr => {
      console.error('[Nodemailer Alert Trigger Error]', mailErr);
    });

    res.json(submissions[targetIdx]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update application status' });
  }
});

// 4. Return database schematic layout structures & config for documentation copy
app.get('/api/db-schemas', (req, res) => {
  // Return schema code as specified in prompt (PostgreSQL schema & MongoDB config)
  res.json([
    {
      title: 'PostgreSQL Schema (Drizzle SQL)',
      description: 'Production-ready highly structured PostgreSQL model using Drizzle ORM specifying data types, keys, and relational fields for land demarcation with support for multiple land owners.',
      language: 'typescript',
      code: `import { pgTable, text, timestamp, integer, serial } from 'drizzle-orm/pg-core';

// Application Flow Sections Order:
// 1. Proposed Construction & Purpose (proposedStructureType, buildingFloors, buildingCategory)
// 2. Land Owner Information (relational table: landOwners)
// 3. Land Details/Schedule (mouzaName, jlNo, rsKhatianNo, rsDagNo, bsKhatianNo, bsDagNo, mutatedBsKhatianNo, landQuantity, landClass, deedNoAndDate)
// 4. Proposed Site Address (siteAddress fields)
// 5. Required Documents (attachments JSONB field)
// 6. Declaration & Applicant Info (applicantName, applicantFatherOrHusband, applicantMobile, permAddress fields)

export const landApplications = pgTable('land_applications', {
  id: text('id').primaryKey(),
  formNo: text('form_no').notNull().unique(),
  formPrice: integer('form_price').default(100),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  status: text('status', { enum: ['Pending', 'Approved', 'Rejected', 'Under Review'] }).default('Pending').notNull(),
  adminRemarks: text('admin_remarks'),

  // Proposed structure
  proposedStructureType: text('proposed_structure_type').notNull(), // 'Boundary Wall', 'Semi-pucka', 'Building'
  buildingFloors: text('building_floors'),
  buildingCategory: text('building_category').notNull(), // 'Residential', 'Commercial'

  mouzaName: text('mouza_name').notNull(),
  jlNo: text('jl_no').notNull(),
  rsKhatianNo: text('rs_khatian_no').notNull(),
  rsDagNo: text('rs_dag_no').notNull(),
  bsKhatianNo: text('bs_khatian_no').notNull(),
  bsDagNo: text('bs_dag_no').notNull(),
  mutatedBsKhatianNo: text('mutated_bs_khatian_no'),
  landQuantity: text('land_quantity').notNull(),
  landClass: text('land_class').notNull(),
  deedNoAndDate: text('deed_no_and_date').notNull(),

  // Applicant Permanent Address
  permVillageOrMahalla: text('perm_village_or_mahalla').notNull(),
  permWardNo: text('perm_ward_no').notNull(),
  permUpOrPourashava: text('perm_up_or_pourashava').notNull(),
  permThana: text('perm_thana').notNull(),
  permUpazila: text('perm_upazila').notNull(),
  permDistrict: text('perm_district').notNull(),

  // Applicant Present Address
  presVillageOrMahalla: text('pres_village_or_mahalla').notNull(),
  presWardNo: text('pres_ward_no').notNull(),
  presUpOrPourashava: text('pres_up_or_pourashava').notNull(),
  presThana: text('pres_thana').notNull(),
  presUpazila: text('pres_upazila').notNull(),
  presDistrict: text('pres_district').notNull(),

  siteVillageOrMahalla: text('site_village_or_mahalla').notNull(),
  siteWardNo: text('site_ward_no').notNull(),
  siteUpOrPourashava: text('site_up_or_pourashava').notNull(),
  siteThana: text('site_thana').notNull(),
  siteUpazila: text('site_upazila').notNull(),
  siteDistrict: text('site_district').notNull(),

  // Applicant info
  applicantName: text('applicant_name').notNull(),
  applicantFatherOrHusband: text('applicant_father_or_husband').notNull(),
  applicantMobile: text('applicant_mobile').notNull(),
  applicationDate: text('application_date').notNull(),
  
  // Attachments are stored as a JSONB list specifying metadata & file URLs
  attachments: text('attachments').notNull() // JSONB format: [{id, label, required, uploaded, fileName, fileSize, fileData, fileUrl, copies}]
});

// Relational Land Owners table (1:N relationship)
export const landOwners = pgTable('land_owners', {
  id: serial('id').primaryKey(),
  applicationId: text('application_id').references(() => landApplications.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  fatherOrHusbandName: text('father_or_husband_name').notNull(),
  
  // Permanent Address
  permVillageOrMahalla: text('perm_village_or_mahalla').notNull(),
  permWardNo: text('perm_ward_no').notNull(),
  permUpOrPourashava: text('perm_up_or_pourashava').notNull(),
  permThana: text('perm_thana').notNull(),
  permUpazila: text('perm_upazila').notNull(),
  permDistrict: text('perm_district').notNull(),

  // Present Address
  presVillageOrMahalla: text('pres_village_or_mahalla').notNull(),
  presWardNo: text('pres_ward_no').notNull(),
  presUpOrPourashava: text('pres_up_or_pourashava').notNull(),
  presThana: text('pres_thana').notNull(),
  presUpazila: text('pres_upazila').notNull(),
  presDistrict: text('pres_district').notNull()
});`
    },
    {
      title: 'MongoDB Mongoose Schema & S3 Configuration',
      description: 'Flexible NoSQL model optimized for Document attachments, deep nestings, and AWS S3 storage configurations.',
      language: 'typescript',
      code: `import mongoose, { Schema, Document } from 'mongoose';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// 1. Mongoose Document Interface definitions
export interface ILandApplication extends Document {
  id: string;
  formNo: string;
  formPrice: number;
  createdAt: Date;
  status: string;
  adminRemarks: string;
  proposedStructureType: string;
  buildingFloors?: string;
  buildingCategory: string;
  owners: Array<{
    name: string;
    fatherOrHusbandName: string;
    permanentAddress: {
      villageOrMahalla: string;
      wardNo: string;
      upOrPourashava: string;
      thana: string;
      upazila: string;
      district: string;
    };
    presentAddress: {
      villageOrMahalla: string;
      wardNo: string;
      upOrPourashava: string;
      thana: string;
      upazila: string;
      district: string;
    };
  }>;
  mouzaName: string;
  jlNo: string;
  rsKhatianNo: string;
  rsDagNo: string;
  bsKhatianNo: string;
  bsDagNo: string;
  mutatedBsKhatianNo?: string;
  landQuantity: string;
  landClass: string;
  deedNoAndDate: string;
  permanentAddress: {
    villageOrMahalla: string;
    wardNo: string;
    upOrPourashava: string;
    thana: string;
    upazila: string;
    district: string;
  };
  presentAddress: {
    villageOrMahalla: string;
    wardNo: string;
    upOrPourashava: string;
    thana: string;
    upazila: string;
    district: string;
  };
  proposedSiteAddress: {
    villageOrMahalla: string;
    wardNo: string;
    upOrPourashava: string;
    thana: string;
    upazila: string;
    district: string;
  };
  applicantName: string;
  applicantFatherOrHusbandName: string;
  applicantMobile: string;
  applicationDate: Date;
  attachments: Array<{
    id: string;
    label: string;
    required: boolean;
    uploaded: boolean;
    fileName?: string;
    fileSize?: string;
    fileUrl?: string; // AWS S3 bucket URL link
    fileData?: string;
    copies?: number;
  }>;
}

// 2. Mongoose Schema definition
const AddressSchema = new Schema({
  villageOrMahalla: { type: String, required: true },
  wardNo: { type: String, required: true },
  upOrPourashava: { type: String, required: true },
  thana: { type: String, required: true },
  upazila: { type: String, required: true },
  district: { type: String, required: true }
}, { _id: false });

const LandApplicationSchema: Schema = new Schema({
  formNo: { type: String, required: true, unique: true },
  formPrice: { type: Number, default: 100 },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Under Review'], default: 'Pending' },
  adminRemarks: { type: String, default: '' },
  proposedStructureType: { type: String, required: true },
  buildingFloors: { type: String },
  buildingCategory: { type: String, required: true },
  owners: [{
    name: { type: String, required: true },
    fatherOrHusbandName: { type: String, required: true },
    permanentAddress: { type: AddressSchema, required: true },
    presentAddress: { type: AddressSchema, required: true }
  }],
  mouzaName: { type: String, required: true },
  jlNo: { type: String, required: true },
  rsKhatianNo: { type: String, required: true },
  rsDagNo: { type: String, required: true },
  bsKhatianNo: { type: String, required: true },
  bsDagNo: { type: String, required: true },
  mutatedBsKhatianNo: { type: String },
  landQuantity: { type: String, required: true },
  landClass: { type: String, required: true },
  deedNoAndDate: { type: String, required: true },
  permanentAddress: { type: AddressSchema, required: true },
  presentAddress: { type: AddressSchema, required: true },
  proposedSiteAddress: { type: AddressSchema, required: true },
  applicantName: { type: String, required: true },
  applicantFatherOrHusbandName: { type: String, required: true },
  applicantMobile: { type: String, required: true },
  applicationDate: { type: Date, default: Date.now },
  attachments: [{
    id: String,
    label: String,
    required: Boolean,
    uploaded: Boolean,
    fileName: String,
    fileSize: String,
    fileUrl: String,
    fileData: String,
    copies: Number
  }]
});

export const LandApplicationModel = mongoose.model<ILandApplication>('LandApplication', LandApplicationSchema);

// 3. AWS S3 File Storage Integration Service boilerplate code
export const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-southeast-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

export async function uploadAttachmentToS3(
  applicationId: string, 
  attachmentId: string, 
  fileBuffer: Buffer, 
  originalName: string, 
  mimeType: string
): Promise<string> {
  const fileExtension = originalName.split('.').pop();
  const s3Key = \`demarcation-docs/\${applicationId}/\${attachmentId}-\${Date.now()}.\${fileExtension}\`;
  
  const uploadCommand = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME || 'sitakunda-demarcation-vault',
    Key: s3Key,
    Body: fileBuffer,
    ContentType: mimeType,
    ACL: 'private' // Keep documents strictly private and query via signed URLs
  });
  
  await s3Client.send(uploadCommand);
  return \`https://\${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/\${s3Key}\`;
}`
    }
  ]);
});

// Configure Vite integration as middleware in development or direct static in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve index.html or dynamic resources
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Land Demarcation Verification backend listening on port ${PORT}`);
  });
}

startServer();
