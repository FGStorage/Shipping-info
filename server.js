const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

let publicTunnelUrl = null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pastikan direktori data ada
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Inisialisasi SQLite database
const dbPath = path.join(dataDir, 'dispatch.db');
const db = new DatabaseSync(dbPath);

// Buat tabel pengiriman & pencatatan muat barang
db.exec(`
  CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nomor_surat TEXT NOT NULL UNIQUE,
    customer TEXT,
    tanggal_release TEXT,
    qty TEXT,
    tanggal_penyiapan TEXT,
    tanggal_pickup TEXT,
    waktu_siap_mulai TEXT,
    waktu_siap_selesai TEXT,
    waktu_scan_mulai TEXT,
    waktu_scan_selesai TEXT,
    waktu_truk_tiba TEXT,
    jam_muat_mulai TEXT,
    jam_muat_selesai TEXT,
    nama_driver TEXT,
    nopol_truk TEXT,
    keterangan TEXT,
    status TEXT DEFAULT 'RELEASED',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_nomor_surat ON shipments(nomor_surat);
  CREATE INDEX IF NOT EXISTS idx_tanggal_pickup ON shipments(tanggal_pickup);
`);

// Migration otomatis jika kolom qty & tanggal_penyiapan belum ada di database lama
try {
  db.exec(`ALTER TABLE shipments ADD COLUMN qty TEXT`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE shipments ADD COLUMN tanggal_penyiapan TEXT`);
} catch (e) {}

// Server-Sent Events (SSE) Client Pool untuk Sinkronisasi Real-Time
const sseClients = new Set();

function broadcastUpdate(type, data) {
  const payload = `data: ${JSON.stringify({ type, data, timestamp: new Date().toISOString() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

// Endpoint SSE
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  // Kirim ping sambutan
  res.write(`data: ${JSON.stringify({ type: 'connected', clientsCount: sseClients.size })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Helper untuk deteksi IP lokal (agar HP bisa terhubung via Wi-Fi)
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Helper perhitungan durasi dalam menit
function calculateDurationMinutes(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr.replace(' ', 'T'));
  const end = new Date(endStr.replace(' ', 'T'));
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  const diffMs = end - start;
  if (diffMs < 0) return null;
  return Math.round(diffMs / 60000);
}

function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return '-';
  if (minutes < 60) return `${minutes} mnt`;
  const hrs = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hrs}j ${rem}m` : `${hrs} jam`;
}

// Tentukan status otomatis berdasarkan milestone yang sudah dicapai
function determineAutoStatus(item) {
  if (item.jam_muat_selesai) return 'SELESAI_MUAT';
  if (item.jam_muat_mulai) return 'SEDANG_MUAT';
  if (item.waktu_truk_tiba) return 'TRUK_TIBA';
  if (item.waktu_scan_selesai) return 'SELESAI_SCAN';
  if (item.waktu_scan_mulai) return 'SEDANG_SCAN';
  if (item.waktu_siap_selesai) return 'SELESAI_PENYIAPAN';
  if (item.waktu_siap_mulai) return 'PENYIAPAN_PESANAN';
  if (item.tanggal_release) return 'RELEASED';
  return 'DRAFT';
}

function enrichShipment(row) {
  const durasiSiap = calculateDurationMinutes(row.waktu_siap_mulai, row.waktu_siap_selesai);
  const durasiScan = calculateDurationMinutes(row.waktu_scan_mulai, row.waktu_scan_selesai);
  const durasiMuat = calculateDurationMinutes(row.jam_muat_mulai, row.jam_muat_selesai);
  const leadTime = calculateDurationMinutes(row.tanggal_release, row.jam_muat_selesai);

  return {
    ...row,
    durasi_siap_menit: durasiSiap,
    durasi_siap_formatted: formatDuration(durasiSiap),
    durasi_scan_menit: durasiScan,
    durasi_scan_formatted: formatDuration(durasiScan),
    durasi_muat_menit: durasiMuat,
    durasi_muat_formatted: formatDuration(durasiMuat),
    lead_time_menit: leadTime,
    lead_time_formatted: formatDuration(leadTime),
    status: row.status || determineAutoStatus(row)
  };
}

// Endpoint info jaringan & QR Code untuk akses dari HP
app.get('/api/network-info', async (req, res) => {
  try {
    const ip = getLocalIp();
    const localUrl = `http://${ip}:${PORT}`;
    const mobileUrl = publicTunnelUrl || localUrl;
    const qrDataUrl = await QRCode.toDataURL(mobileUrl, {
      margin: 1,
      width: 260,
      color: { dark: '#0f172a', light: '#ffffff' }
    });

    res.json({
      localIp: ip,
      port: PORT,
      localUrl,
      mobileUrl,
      publicTunnelUrl,
      qrDataUrl,
      connectedClients: sseClients.size
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Ambil daftar surat jalan / pengambilan barang
app.get('/api/shipments', (req, res) => {
  try {
    const { search, status, tanggal_pickup } = req.query;
    let query = 'SELECT * FROM shipments WHERE 1=1';
    const params = [];

    if (search) {
      query += ` AND (nomor_surat LIKE ? OR customer LIKE ? OR nama_driver LIKE ? OR nopol_truk LIKE ? OR keterangan LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }

    if (status && status !== 'ALL') {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (tanggal_pickup) {
      query += ` AND tanggal_pickup = ?`;
      params.push(tanggal_pickup);
    }

    query += ' ORDER BY id DESC';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    const enriched = rows.map(enrichShipment);

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Detail 1 surat
app.get('/api/shipments/:id', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM shipments WHERE id = ?');
    const row = stmt.get(Number(req.params.id));
    if (!row) {
      return res.status(404).json({ error: 'Data tidak ditemukan' });
    }
    res.json(enrichShipment(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Buat surat pengambilan barang baru
app.post('/api/shipments', (req, res) => {
  try {
    const {
      nomor_surat,
      customer = '',
      tanggal_release = new Date().toISOString().replace('T', ' ').substring(0, 19),
      qty = '',
      tanggal_penyiapan = '',
      tanggal_pickup = new Date().toISOString().substring(0, 10),
      waktu_siap_mulai = '',
      waktu_siap_selesai = '',
      waktu_scan_mulai = '',
      waktu_scan_selesai = '',
      waktu_truk_tiba = '',
      jam_muat_mulai = '',
      jam_muat_selesai = '',
      nama_driver = '',
      nopol_truk = '',
      keterangan = '',
      status
    } = req.body;

    if (!nomor_surat) {
      return res.status(400).json({ error: 'Nomor Surat Pengambilan Barang wajib diisi' });
    }

    const calculatedStatus = status || determineAutoStatus({
      tanggal_release, waktu_siap_mulai, waktu_siap_selesai,
      waktu_scan_mulai, waktu_scan_selesai, waktu_truk_tiba,
      jam_muat_mulai, jam_muat_selesai
    });

    const stmt = db.prepare(`
      INSERT INTO shipments (
        nomor_surat, customer, tanggal_release, qty, tanggal_penyiapan, tanggal_pickup,
        waktu_siap_mulai, waktu_siap_selesai, waktu_scan_mulai, waktu_scan_selesai,
        waktu_truk_tiba, jam_muat_mulai, jam_muat_selesai,
        nama_driver, nopol_truk, keterangan, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      nomor_surat.trim(),
      customer.trim(),
      tanggal_release || null,
      (qty || '').trim(),
      (tanggal_penyiapan || '').trim() || null,
      tanggal_pickup || null,
      waktu_siap_mulai || null,
      waktu_siap_selesai || null,
      waktu_scan_mulai || null,
      waktu_scan_selesai || null,
      waktu_truk_tiba || null,
      jam_muat_mulai || null,
      jam_muat_selesai || null,
      nama_driver.trim(),
      nopol_truk.trim(),
      keterangan.trim(),
      calculatedStatus
    );

    const newRecord = db.prepare('SELECT * FROM shipments WHERE id = ?').get(result.lastInsertRowid);
    const enriched = enrichShipment(newRecord);

    broadcastUpdate('CREATED', enriched);
    res.status(201).json(enriched);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: `Nomor Surat "${req.body.nomor_surat}" sudah terdaftar` });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST: Quick Stamp untuk HP (One-Touch Stamping Milestone)
app.post('/api/shipments/:id/stamp', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { field, customTime } = req.body;

    const allowedFields = [
      'tanggal_release',
      'waktu_siap_mulai',
      'waktu_siap_selesai',
      'waktu_scan_mulai',
      'waktu_scan_selesai',
      'waktu_truk_tiba',
      'jam_muat_mulai',
      'jam_muat_selesai'
    ];

    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: `Field stamping '${field}' tidak valid` });
    }

    // Default timestamp: Waktu sekarang (format YYYY-MM-DD HH:mm:ss lokal)
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const currentTimestamp = customTime || `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;

    const existing = db.prepare('SELECT * FROM shipments WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Surat tidak ditemukan' });
    }

    const updatedObj = { ...existing, [field]: currentTimestamp };
    const newStatus = determineAutoStatus(updatedObj);

    const updateStmt = db.prepare(`
      UPDATE shipments
      SET ${field} = ?, status = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `);

    updateStmt.run(currentTimestamp, newStatus, id);

    const finalRow = db.prepare('SELECT * FROM shipments WHERE id = ?').get(id);
    const enriched = enrichShipment(finalRow);

    broadcastUpdate('STAMPED', enriched);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT: Update lengkap data surat
app.put('/api/shipments/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      nomor_surat,
      customer = '',
      tanggal_release,
      qty = '',
      tanggal_penyiapan = '',
      tanggal_pickup,
      waktu_siap_mulai,
      waktu_siap_selesai,
      waktu_scan_mulai,
      waktu_scan_selesai,
      waktu_truk_tiba,
      jam_muat_mulai,
      jam_muat_selesai,
      nama_driver = '',
      nopol_truk = '',
      keterangan = '',
      status
    } = req.body;

    const existing = db.prepare('SELECT * FROM shipments WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Surat tidak ditemukan' });
    }

    const calculatedStatus = status || determineAutoStatus({
      tanggal_release, waktu_siap_mulai, waktu_siap_selesai,
      waktu_scan_mulai, waktu_scan_selesai, waktu_truk_tiba,
      jam_muat_mulai, jam_muat_selesai
    });

    const stmt = db.prepare(`
      UPDATE shipments SET
        nomor_surat = ?,
        customer = ?,
        tanggal_release = ?,
        qty = ?,
        tanggal_penyiapan = ?,
        tanggal_pickup = ?,
        waktu_siap_mulai = ?,
        waktu_siap_selesai = ?,
        waktu_scan_mulai = ?,
        waktu_scan_selesai = ?,
        waktu_truk_tiba = ?,
        jam_muat_mulai = ?,
        jam_muat_selesai = ?,
        nama_driver = ?,
        nopol_truk = ?,
        keterangan = ?,
        status = ?,
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `);

    stmt.run(
      (nomor_surat || existing.nomor_surat).trim(),
      customer.trim(),
      tanggal_release || null,
      (qty !== undefined ? qty : (existing.qty || '')).trim(),
      (tanggal_penyiapan !== undefined ? tanggal_penyiapan : (existing.tanggal_penyiapan || '')).trim() || null,
      tanggal_pickup || null,
      waktu_siap_mulai || null,
      waktu_siap_selesai || null,
      waktu_scan_mulai || null,
      waktu_scan_selesai || null,
      waktu_truk_tiba || null,
      jam_muat_mulai || null,
      jam_muat_selesai || null,
      nama_driver.trim(),
      nopol_truk.trim(),
      keterangan.trim(),
      calculatedStatus,
      id
    );

    const updatedRow = db.prepare('SELECT * FROM shipments WHERE id = ?').get(id);
    const enriched = enrichShipment(updatedRow);

    broadcastUpdate('UPDATED', enriched);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Hapus surat
app.delete('/api/shipments/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM shipments WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Surat tidak ditemukan' });
    }

    db.prepare('DELETE FROM shipments WHERE id = ?').run(id);
    broadcastUpdate('DELETED', { id, nomor_surat: existing.nomor_surat });
    res.json({ success: true, message: `Surat ${existing.nomor_surat} berhasil dihapus` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Statistik operasional harian
app.get('/api/stats', (req, res) => {
  try {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;

    const all = db.prepare('SELECT * FROM shipments').all().map(enrichShipment);

    const totalHariIni = all.filter(s => s.tanggal_pickup === today || s.tanggal_release?.startsWith(today)).length;
    const sedangProses = all.filter(s => s.status !== 'SELESAI_MUAT' && s.status !== 'DRAFT').length;
    const sedangScan = all.filter(s => s.status === 'SEDANG_SCAN').length;
    const sedangMuat = all.filter(s => s.status === 'SEDANG_MUAT').length;

    // Selesai muat HANYA untuk hari ini (otomatis kembali ke 0 jika sudah berganti tanggal)
    const selesaiMuat = all.filter(s => {
      if (s.status !== 'SELESAI_MUAT') return false;
      const tgl = s.jam_muat_selesai ? s.jam_muat_selesai.substring(0, 10) : s.tanggal_pickup;
      return tgl === today;
    }).length;

    // Hitung rata-rata durasi muat hari ini
    const muatList = all.filter(s => {
      const tgl = s.jam_muat_selesai ? s.jam_muat_selesai.substring(0, 10) : s.tanggal_pickup;
      return tgl === today && s.durasi_muat_menit !== null && s.durasi_muat_menit > 0;
    });
    const avgMuatMenit = muatList.length
      ? Math.round(muatList.reduce((acc, curr) => acc + curr.durasi_muat_menit, 0) / muatList.length)
      : 0;

    // Hitung rata-rata durasi scan hari ini
    const scanList = all.filter(s => {
      const tgl = s.waktu_scan_selesai ? s.waktu_scan_selesai.substring(0, 10) : (s.tanggal_pickup || s.tanggal_release?.substring(0, 10));
      return tgl === today && s.durasi_scan_menit !== null && s.durasi_scan_menit > 0;
    });
    const avgScanMenit = scanList.length
      ? Math.round(scanList.reduce((acc, curr) => acc + curr.durasi_scan_menit, 0) / scanList.length)
      : 0;

    res.json({
      totalSemua: all.length,
      totalHariIni,
      sedangProses,
      sedangScan,
      sedangMuat,
      selesaiMuat,
      avgMuatMenit,
      avgMuatFormatted: formatDuration(avgMuatMenit),
      avgScanMenit,
      avgScanFormatted: formatDuration(avgScanMenit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Total Qty Muat Per Tanggal
app.get('/api/qty-summary', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT 
        COALESCE(NULLIF(tanggal_pickup, ''), NULLIF(tanggal_penyiapan, ''), NULLIF(SUBSTR(tanggal_release, 1, 10), ''), 'Lainnya') as tgl,
        qty,
        nomor_surat,
        customer,
        status
      FROM shipments
      ORDER BY tgl DESC
    `).all();

    const byDate = {};
    for (const row of rows) {
      const tgl = row.tgl || 'Lainnya';
      if (!byDate[tgl]) {
        byDate[tgl] = { 
          tanggal: tgl, 
          totalQty: 0, 
          jumlahSurat: 0, 
          rincian: [] 
        };
      }
      byDate[tgl].jumlahSurat++;
      
      // Bersihkan nilai qty dari teks non-angka jika ada (misal "50 Box" -> 50)
      const cleanNum = String(row.qty || '').replace(/[^0-9]/g, '');
      const num = parseInt(cleanNum, 10);
      if (!isNaN(num)) {
        byDate[tgl].totalQty += num;
      }
      
      byDate[tgl].rincian.push({ 
        nomor_surat: row.nomor_surat, 
        qty: row.qty,
        customer: row.customer,
        status: row.status
      });
    }

    const result = Object.values(byDate).sort((a, b) => b.tanggal.localeCompare(a.tanggal));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Download Paket Aplikasi PC (.zip)
app.get('/api/download/pc-launcher', (req, res) => {
  const zipPath = path.join(__dirname, 'public', 'downloads', 'Shipping-Information-PC.zip');
  if (fs.existsSync(zipPath)) {
    res.download(zipPath, 'Shipping-Information-PC.zip');
  } else {
    res.status(404).json({ error: 'File installer belum tersedia' });
  }
});

// GET: Export CSV format rapi untuk Excel
app.get('/api/export/csv', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM shipments ORDER BY id DESC').all().map(enrichShipment);
    
    // Header CSV
    const headers = [
      'No',
      'No.Surat',
      'Customer/Tujuan',
      'Date SPPB Release',
      'Qty',
      'Tanggal Penyiapan',
      'Tanggal Pick Up',
      'Waktu Penyiapan Pesanan (Mulai)',
      'Waktu Penyiapan Pesanan (Selesai)',
      'Durasi Penyiapan (Menit)',
      'Waktu Mulai Scan',
      'Waktu Selesai Scan',
      'Durasi Scan (Menit)',
      'Waktu Truk Datang ke Factory',
      'Jam Mulai Muat',
      'Jam Selesai Muat',
      'Durasi Muat (Menit)',
      'Total Lead Time (Menit)',
      'Nama Driver/Ekspedisi',
      'No Polisi Truk',
      'Keterangan & Identitas',
      'Status'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const csvLines = [headers.join(',')];

    rows.forEach((r, idx) => {
      csvLines.push([
        idx + 1,
        escapeCsv(r.nomor_surat),
        escapeCsv(r.customer),
        escapeCsv(r.tanggal_release),
        escapeCsv(r.qty || ''),
        escapeCsv(r.tanggal_penyiapan || ''),
        escapeCsv(r.tanggal_pickup),
        escapeCsv(r.waktu_siap_mulai),
        escapeCsv(r.waktu_siap_selesai),
        escapeCsv(r.durasi_siap_menit ?? ''),
        escapeCsv(r.waktu_scan_mulai),
        escapeCsv(r.waktu_scan_selesai),
        escapeCsv(r.durasi_scan_menit ?? ''),
        escapeCsv(r.waktu_truk_tiba),
        escapeCsv(r.jam_muat_mulai),
        escapeCsv(r.jam_muat_selesai),
        escapeCsv(r.durasi_muat_menit ?? ''),
        escapeCsv(r.lead_time_menit ?? ''),
        escapeCsv(r.nama_driver),
        escapeCsv(r.nopol_truk),
        escapeCsv(r.keterangan),
        escapeCsv(r.status)
      ].join(','));
    });

    const csvContent = '\uFEFF' + csvLines.join('\r\n'); // BOM UTF-8 agar Excel membaca karakter dengan benar
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Laporan_Muat_Barang_${new Date().toISOString().substring(0, 10)}.csv"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Seed data simulasi awal jika database kosong
app.post('/api/seed', (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM shipments').get().c;
    if (count > 0) {
      return res.json({ message: 'Database sudah memiliki data' });
    }

    const today = new Date().toISOString().substring(0, 10);
    const nowTime = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    const t = (h, m) => `${today} ${pad(h)}:${pad(m)}:00`;

    const sampleData = [
      {
        nomor_surat: 'SPB-2026-001',
        customer: 'PT Surya Makmur Logistik',
        tanggal_release: t(7, 30),
        tanggal_pickup: today,
        waktu_siap_mulai: t(7, 45),
        waktu_siap_selesai: t(8, 15),
        waktu_scan_mulai: t(8, 20),
        waktu_scan_selesai: t(8, 45),
        waktu_truk_tiba: t(8, 30),
        jam_muat_mulai: t(8, 50),
        jam_muat_selesai: t(9, 30),
        nama_driver: 'Budi Santoso',
        nopol_truk: 'B 9182 UXZ',
        keterangan: 'Muatan 12 Pallet Barang Elektronik - Lengkap & Segel OK',
        status: 'SELESAI_MUAT'
      },
      {
        nomor_surat: 'SPB-2026-002',
        customer: 'CV Prima Perkasa',
        tanggal_release: t(8, 0),
        tanggal_pickup: today,
        waktu_siap_mulai: t(8, 15),
        waktu_siap_selesai: t(8, 50),
        waktu_scan_mulai: t(9, 0),
        waktu_scan_selesai: t(9, 25),
        waktu_truk_tiba: t(9, 15),
        jam_muat_mulai: t(9, 35),
        jam_muat_selesai: '',
        nama_driver: 'Hendra Gunawan',
        nopol_truk: 'B 9401 TCD',
        keterangan: 'Sedang proses muat karton batch 3',
        status: 'SEDANG_MUAT'
      },
      {
        nomor_surat: 'SPB-2026-003',
        customer: 'PT Global Distribusi Utama',
        tanggal_release: t(8, 30),
        tanggal_pickup: today,
        waktu_siap_mulai: t(8, 40),
        waktu_siap_selesai: t(9, 10),
        waktu_scan_mulai: t(9, 15),
        waktu_scan_selesai: '',
        waktu_truk_tiba: t(9, 30),
        jam_muat_mulai: '',
        jam_muat_selesai: '',
        nama_driver: 'Slamet Riyadi',
        nopol_truk: 'D 8812 AB',
        keterangan: 'Truk wingbox sudah stanby di bay 2, sedang scan barcode paket',
        status: 'SEDANG_SCAN'
      },
      {
        nomor_surat: 'SPB-2026-004',
        customer: 'Toko Sumber Rejeki',
        tanggal_release: t(9, 0),
        tanggal_pickup: today,
        waktu_siap_mulai: t(9, 10),
        waktu_siap_selesai: '',
        waktu_scan_mulai: '',
        waktu_scan_selesai: '',
        waktu_truk_tiba: '',
        jam_muat_mulai: '',
        jam_muat_selesai: '',
        nama_driver: 'Yanto',
        nopol_truk: 'B 9023 KYZ',
        keterangan: 'Penyiapan barang di rak C-4',
        status: 'PENYIAPAN_PESANAN'
      }
    ];

    const insert = db.prepare(`
      INSERT INTO shipments (
        nomor_surat, customer, tanggal_release, tanggal_pickup,
        waktu_siap_mulai, waktu_siap_selesai, waktu_scan_mulai, waktu_scan_selesai,
        waktu_truk_tiba, jam_muat_mulai, jam_muat_selesai,
        nama_driver, nopol_truk, keterangan, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const d of sampleData) {
      insert.run(
        d.nomor_surat, d.customer, d.tanggal_release, d.tanggal_pickup,
        d.waktu_siap_mulai, d.waktu_siap_selesai, d.waktu_scan_mulai, d.waktu_scan_selesai,
        d.waktu_truk_tiba, d.jam_muat_mulai, d.jam_muat_selesai,
        d.nama_driver, d.nopol_truk, d.keterangan, d.status
      );
    }

    broadcastUpdate('SEEDED', { count: sampleData.length });
    res.json({ message: 'Sample data berhasil di-generate', total: sampleData.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto seed jika database baru
try {
  const count = db.prepare('SELECT COUNT(*) as c FROM shipments').get().c;
  if (count === 0) {
    console.log('Database kosong, menginisialisasi sampel data operasional...');
    // Seed default sample
    const today = new Date().toISOString().substring(0, 10);
    const pad = (n) => String(n).padStart(2, '0');
    const t = (h, m) => `${today} ${pad(h)}:${pad(m)}:00`;
    
    db.prepare(`
      INSERT INTO shipments (
        nomor_surat, customer, tanggal_release, tanggal_pickup,
        waktu_siap_mulai, waktu_siap_selesai, waktu_scan_mulai, waktu_scan_selesai,
        waktu_truk_tiba, jam_muat_mulai, jam_muat_selesai,
        nama_driver, nopol_truk, keterangan, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'SPB-2026-001',
      'PT Surya Makmur Logistik',
      t(7, 30),
      today,
      t(7, 45),
      t(8, 15),
      t(8, 20),
      t(8, 45),
      t(8, 30),
      t(8, 50),
      t(9, 30),
      'Budi Santoso',
      'B 9182 UXZ',
      'Muatan 12 Pallet Barang Elektronik - Selesai muat aman',
      'SELESAI_MUAT'
    );
  }
} catch (e) {
  console.error('Error saat auto-seed:', e.message);
}

// Cloudflare Tunnel untuk akses dari HP di mana saja (bebas blokir LAN/Firewall)
function startCloudflareTunnel() {
  const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
  if (!fs.existsSync(cloudflaredPath)) {
    console.log('⚠️ cloudflared.exe tidak ditemukan, menggunakan IP lokal.');
    return;
  }

  console.log('⏳ Menginisialisasi jalur koneksi HP (Cloudflare Tunnel)...');
  const tunnelProcess = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const handleTunnelOutput = (chunk) => {
    const text = chunk.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match && (!publicTunnelUrl || publicTunnelUrl !== match[0])) {
      publicTunnelUrl = match[0];
      console.log('----------------------------------------------------');
      console.log(`🌐 LINK AKSES HANDPHONE (AKTIF SEMUA JARINGAN):`);
      console.log(`📱 ${publicTunnelUrl}`);
      console.log('----------------------------------------------------');
      broadcastUpdate('TUNNEL_READY', { mobileUrl: publicTunnelUrl });
    }
  };

  tunnelProcess.stdout.on('data', handleTunnelOutput);
  tunnelProcess.stderr.on('data', handleTunnelOutput);

  tunnelProcess.on('error', (err) => {
    console.error('⚠️ Cloudflare Tunnel notice:', err.message);
  });

  tunnelProcess.on('close', (code) => {
    publicTunnelUrl = null;
    console.log(`Tunnel ditutup (kode: ${code}), mencoba menghubungkan ulang dalam 5 detik...`);
    setTimeout(startCloudflareTunnel, 5000);
  });
}

// Jalankan server
app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log('====================================================');
  console.log(`🚀 Shipping Information Server berjalan aktif!`);
  console.log(`💻 Akses dari PC/Laptop: http://localhost:${PORT}`);
  console.log(`📱 Akses Wi-Fi Lokal:    http://${localIp}:${PORT}`);
  console.log('====================================================');
  startCloudflareTunnel();
});
