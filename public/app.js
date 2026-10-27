// State Aplikasi Shipping Information
let shipments = [];
let networkInfo = null;
let deferredInstallPrompt = null;
let sseSource = null;

// Helper: Format tanggal & jam
function formatDateTime(str) {
  if (!str) return '-';
  const parts = str.split(' ');
  if (parts.length === 2) {
    const time = parts[1].substring(0, 5); // Ambil HH:mm
    const dateParts = parts[0].split('-');
    if (dateParts.length === 3) {
      return `${dateParts[2]}/${dateParts[1]} ${time}`;
    }
  }
  return str;
}

function formatTimeOnly(str) {
  if (!str) return '-';
  const parts = str.split(' ');
  return parts.length === 2 ? parts[1].substring(0, 5) : str;
}

function getNowTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const min = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

// Global helper untuk tombol "Jam Sekarang" di form modal
window.setFieldNow = function(fieldId) {
  const el = document.getElementById(fieldId);
  if (el) {
    el.value = getNowTimestamp();
    showToast('Waktu berhasil diisi waktu saat ini', '⏱️');
  }
};

// Toast notification
function showToast(message, icon = '✅') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toastMessage');
  const iconEl = document.getElementById('toastIcon');
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  iconEl.textContent = icon;
  toast.classList.remove('translate-y-12', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-12', 'opacity-0');
  }, 2800);
}

// Status Badges & Colors
function getStatusBadge(status) {
  switch (status) {
    case 'SELESAI_MUAT':
      return `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✓ Selesai Muat</span>`;
    case 'SEDANG_MUAT':
      return `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 animate-pulse">Sedang Muat</span>`;
    case 'TRUK_TIBA':
      return `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">Truk Tiba Factory</span>`;
    case 'SEDANG_SCAN':
      return `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">Sedang Scan</span>`;
    case 'SELESAI_SCAN':
      return `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">Selesai Scan</span>`;
    case 'PENYIAPAN_PESANAN':
      return `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">Penyiapan Pesanan</span>`;
    case 'SELESAI_PENYIAPAN':
      return `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">Siap Scan</span>`;
    case 'RELEASED':
    default:
      return `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-700 text-slate-300 border border-slate-600">Surat Release</span>`;
  }
}

// Logika penentu tombol "Aksi Cepat Berikutnya" (One-Tap Stamping)
function getNextAction(item) {
  if (!item.waktu_siap_mulai) {
    return {
      field: 'waktu_siap_mulai',
      label: 'Mulai Penyiapan',
      icon: '📦',
      btnClass: 'bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-300 border-yellow-500/30'
    };
  }
  if (!item.waktu_siap_selesai) {
    return {
      field: 'waktu_siap_selesai',
      label: 'Selesai Penyiapan',
      icon: '✓',
      btnClass: 'bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-300 border-yellow-500/30'
    };
  }
  if (!item.waktu_scan_mulai) {
    return {
      field: 'waktu_scan_mulai',
      label: 'Mulai Scan',
      icon: '🔍',
      btnClass: 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border-amber-500/30'
    };
  }
  if (!item.waktu_scan_selesai) {
    return {
      field: 'waktu_scan_selesai',
      label: 'Selesai Scan',
      icon: '✅',
      btnClass: 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border-amber-500/30'
    };
  }
  if (!item.waktu_truk_tiba) {
    return {
      field: 'waktu_truk_tiba',
      label: 'Truk Tiba Pabrik',
      icon: '🚚',
      btnClass: 'bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border-cyan-500/30'
    };
  }
  if (!item.jam_muat_mulai) {
    return {
      field: 'jam_muat_mulai',
      label: 'Mulai Muat Truk',
      icon: '📥',
      btnClass: 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/30'
    };
  }
  if (!item.jam_muat_selesai) {
    return {
      field: 'jam_muat_selesai',
      label: 'Selesai Muat (Truk Siap)',
      icon: '🏁',
      btnClass: 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-500/30'
    };
  }
  return null; // Semua proses selesai
}

// Inisialisasi SSE (Server-Sent Events) untuk sinkronisasi seketika antar PC & HP
function setupSSE() {
  const badge = document.getElementById('liveStatusBadge');
  if (sseSource) sseSource.close();

  sseSource = new EventSource('/api/events');

  sseSource.onopen = () => {
    if (badge) {
      badge.className = 'flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span><span class="hidden md:inline">Tersambung Real-Time</span>';
    }
  };

  sseSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'TUNNEL_READY') {
        loadNetworkInfo();
      }
      if (['CREATED', 'UPDATED', 'STAMPED', 'DELETED', 'SEEDED'].includes(data.type)) {
        loadShipments(false); // Muat ulang data secara halus tanpa kedip
        loadStats();
        if (data.type === 'STAMPED') {
          showToast(`Milestone ${data.data?.nomor_surat || ''} diperbarui real-time!`, '⚡');
        }
      }
    } catch (e) {
      console.error('SSE Error:', e);
    }
  };

  sseSource.onerror = () => {
    if (badge) {
      badge.className = 'flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-400"></span><span class="hidden md:inline">Menghubungkan ulang...</span>';
    }
    // Reconnect otomatis
    setTimeout(setupSSE, 3000);
  };
}

// Ambil data surat dari API
async function loadShipments(showLoader = true) {
  try {
    const search = document.getElementById('searchInput')?.value.trim() || '';
    const status = document.getElementById('filterStatus')?.value || 'ALL';
    const tanggal_pickup = document.getElementById('filterDate')?.value || '';

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (status !== 'ALL') params.append('status', status);
    if (tanggal_pickup) params.append('tanggal_pickup', tanggal_pickup);

    const res = await fetch(`/api/shipments?${params.toString()}`);
    shipments = await res.json();
    renderShipments(shipments);
  } catch (err) {
    console.error('Gagal mengambil data pengiriman:', err);
    showToast('Koneksi terputus. Menghubungkan kembali...', '⚠️');
    const tableBody = document.getElementById('shipmentTableBody');
    if (tableBody && (!shipments || shipments.length === 0)) {
      tableBody.innerHTML = `<tr><td colspan="11" class="px-4 py-8 text-center text-amber-400 font-medium">⚠️ Menghubungkan ke server... Jika Antigravity ditutup, klik ikon <strong>"Shipping Information"</strong> di Desktop PC Anda untuk mengaktifkan server.</td></tr>`;
    }
  }
}

// Ambil statistik operasional
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    document.getElementById('statTotalHariIni').textContent = stats.totalHariIni || 0;
    document.getElementById('statSedangScan').textContent = stats.sedangScan || 0;
    document.getElementById('statSedangMuat').textContent = stats.sedangMuat || 0;
    document.getElementById('statSelesaiMuat').textContent = stats.selesaiMuat || 0;
    document.getElementById('statAvgScan').textContent = stats.avgScanFormatted || '-';
    document.getElementById('statAvgMuat').textContent = stats.avgMuatFormatted || '-';
  } catch (err) {
    console.error('Gagal memuat statistik:', err);
  }
}

// Render tampilan desktop (Tabel) dan mobile (Kartu)
function renderShipments(items) {
  const tableBody = document.getElementById('shipmentTableBody');
  const mobileContainer = document.getElementById('mobileCardContainer');
  const emptyState = document.getElementById('emptyState');

  // Hitung total Qty dari items yang tampil saat ini
  let totalQtyTampil = 0;
  if (items && items.length > 0) {
    for (const item of items) {
      const cleanNum = String(item.qty || '').replace(/[^0-9]/g, '');
      const num = parseInt(cleanNum, 10);
      if (!isNaN(num)) totalQtyTampil += num;
    }
  }

  const footTotalQty = document.getElementById('footTotalQty');
  if (footTotalQty) footTotalQty.textContent = totalQtyTampil > 0 ? totalQtyTampil.toLocaleString('id-ID') : '0';
  const footTotalDO = document.getElementById('footTotalDO');
  if (footTotalDO) footTotalDO.textContent = `${items ? items.length : 0} DO`;
  const mobileTotalQty = document.getElementById('mobileTotalQty');
  if (mobileTotalQty) mobileTotalQty.textContent = `${totalQtyTampil > 0 ? totalQtyTampil.toLocaleString('id-ID') : '0'} (${items ? items.length : 0} DO)`;

  if (!items || items.length === 0) {
    if (tableBody) tableBody.innerHTML = '';
    if (mobileContainer) mobileContainer.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  // 1. Render Desktop Table
  if (tableBody) {
    tableBody.innerHTML = items.map((s) => {
      const nextAction = getNextAction(s);
      const actionHtml = nextAction
        ? `<button onclick="stampMilestone(${s.id}, '${nextAction.field}')" class="touch-btn inline-flex items-center px-2.5 py-1 text-[11px] font-bold rounded-lg border transition ${nextAction.btnClass}" title="Klik untuk stamp ${nextAction.label}">
             <span class="mr-1">${nextAction.icon}</span> ${nextAction.label}
           </button>`
        : `<span class="text-xs font-semibold text-emerald-400">✓ Selesai Total</span>`;

      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="px-4 py-3">
            <div class="font-bold text-slate-100">${s.nomor_surat}</div>
            <div class="text-[11px] text-slate-400 truncate max-w-[160px]">${s.customer || '-'}</div>
          </td>
          <td class="px-3 py-3">
            <div class="text-slate-200 text-xs">${formatDateTime(s.tanggal_release)}</div>
          </td>
          <td class="px-3 py-3 text-center">
            <span class="inline-block px-2 py-0.5 rounded-md text-xs font-bold bg-blue-500/10 text-blue-300 border border-blue-500/20">${s.qty || '-'}</span>
          </td>
          <td class="px-3 py-3">
            <div class="text-slate-300 text-xs font-medium">${s.tanggal_penyiapan || '-'}</div>
          </td>
          <td class="px-3 py-3">
            <div class="text-slate-300 text-xs font-semibold">${s.tanggal_pickup || '-'}</div>
          </td>
          <td class="px-3 py-3">
            <div class="text-[11px] text-slate-300">
              <span>${formatTimeOnly(s.waktu_siap_mulai)}</span> - <span>${formatTimeOnly(s.waktu_siap_selesai)}</span>
            </div>
            ${s.durasi_siap_formatted !== '-' ? `<span class="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-400">⏱ ${s.durasi_siap_formatted}</span>` : ''}
          </td>
          <td class="px-3 py-3">
            <div class="text-[11px] text-slate-300">
              <span>${formatTimeOnly(s.waktu_scan_mulai)}</span> - <span>${formatTimeOnly(s.waktu_scan_selesai)}</span>
            </div>
            ${s.durasi_scan_formatted !== '-' ? `<span class="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] bg-amber-500/10 text-amber-300 font-semibold">🔍 ${s.durasi_scan_formatted}</span>` : ''}
          </td>
          <td class="px-3 py-3">
            <div class="text-slate-200 text-xs font-medium">${formatTimeOnly(s.waktu_truk_tiba)}</div>
          </td>
          <td class="px-3 py-3">
            <div class="text-[11px] text-slate-300">
              <span>${formatTimeOnly(s.jam_muat_mulai)}</span> - <span>${formatTimeOnly(s.jam_muat_selesai)}</span>
            </div>
            ${s.durasi_muat_formatted !== '-' ? `<span class="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] bg-indigo-500/10 text-indigo-300 font-semibold">📥 ${s.durasi_muat_formatted}</span>` : ''}
          </td>
          <td class="px-3 py-3 max-w-[210px]">
            <div class="flex items-center space-x-1.5 text-xs font-semibold text-slate-200">
              <span>🚚 ${s.nopol_truk || '-'}</span>
              ${s.nama_driver ? `<span class="text-[11px] text-slate-400 font-normal">(${s.nama_driver})</span>` : ''}
            </div>
            ${s.keterangan ? `<div class="text-[11px] text-slate-400 truncate mt-0.5" title="${s.keterangan}">💬 ${s.keterangan}</div>` : ''}
          </td>
          <td class="px-3 py-3 text-center">
            <div class="mb-1">${getStatusBadge(s.status)}</div>
            <div class="flex items-center justify-center space-x-1">
              ${actionHtml}
              <button onclick="openEditModal(${s.id})" title="Edit Detail" class="p-1 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded transition">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button onclick="deleteShipment(${s.id}, '${s.nomor_surat}')" title="Hapus" class="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // 2. Render Mobile Cards (Khusus smartphone / touch screen)
  if (mobileContainer) {
    mobileContainer.innerHTML = items.map((s) => {
      const nextAction = getNextAction(s);

      return `
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3.5">
          <!-- Card Header -->
          <div class="flex items-start justify-between border-b border-slate-800/80 pb-2.5">
            <div>
              <div class="flex items-center space-x-2">
                <span class="text-sm font-bold text-white tracking-wide">${s.nomor_surat}</span>
                ${s.qty ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">Qty: ${s.qty}</span>` : ''}
              </div>
              <p class="text-xs text-blue-400 font-medium">${s.customer || 'Tanpa Nama Customer'}</p>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 mt-0.5">
                <span>Release: ${formatDateTime(s.tanggal_release)}</span>
                ${s.tanggal_penyiapan ? `<span>&bull; Siap: ${s.tanggal_penyiapan}</span>` : ''}
                <span>&bull; Pick Up: ${s.tanggal_pickup || '-'}</span>
              </div>
            </div>
            <div>
              ${getStatusBadge(s.status)}
            </div>
          </div>

          <!-- Timeline Milestone Mini -->
          <div class="grid grid-cols-3 gap-2 text-[11px] bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/40">
            <div>
              <div class="text-[10px] text-slate-400">1. Penyiapan</div>
              <div class="font-semibold text-slate-200 mt-0.5">${formatTimeOnly(s.waktu_siap_mulai)} - ${formatTimeOnly(s.waktu_siap_selesai)}</div>
              ${s.durasi_siap_formatted !== '-' ? `<span class="text-[10px] text-yellow-400">${s.durasi_siap_formatted}</span>` : ''}
            </div>
            <div>
              <div class="text-[10px] text-slate-400">2. Scan Barang</div>
              <div class="font-semibold text-slate-200 mt-0.5">${formatTimeOnly(s.waktu_scan_mulai)} - ${formatTimeOnly(s.waktu_scan_selesai)}</div>
              ${s.durasi_scan_formatted !== '-' ? `<span class="text-[10px] text-amber-400">${s.durasi_scan_formatted}</span>` : ''}
            </div>
            <div>
              <div class="text-[10px] text-slate-400">3. Muat Truk</div>
              <div class="font-semibold text-slate-200 mt-0.5">${formatTimeOnly(s.jam_muat_mulai)} - ${formatTimeOnly(s.jam_muat_selesai)}</div>
              ${s.durasi_muat_formatted !== '-' ? `<span class="text-[10px] text-emerald-400">${s.durasi_muat_formatted}</span>` : ''}
            </div>
          </div>

          <!-- Info Truk & Driver -->
          <div class="flex items-center justify-between text-xs text-slate-300 px-1">
            <div class="flex items-center space-x-1">
              <span>🚚</span>
              <span class="font-semibold">${s.nopol_truk || 'Plat belum ada'}</span>
              <span class="text-slate-500">(${s.nama_driver || 'Supir -'})</span>
            </div>
            <div class="text-[11px] text-slate-400">
              Truk Tiba: <strong class="text-cyan-300">${formatTimeOnly(s.waktu_truk_tiba)}</strong>
            </div>
          </div>

          ${s.keterangan ? `
            <div class="text-xs bg-slate-950/40 p-2 rounded-lg text-slate-400 italic">
              "${s.keterangan}"
            </div>
          ` : ''}

          <!-- Tombol One-Tap Milestone Utama untuk HP -->
          <div>
            ${nextAction ? `
              <button onclick="stampMilestone(${s.id}, '${nextAction.field}')" class="touch-btn w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-2 shadow-lg transition ${nextAction.btnClass}">
                <span class="text-base">${nextAction.icon}</span>
                <span>Klik Cepat: ${nextAction.label} (Jam Sekarang)</span>
              </button>
            ` : `
              <div class="w-full py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-center text-xs text-emerald-400 font-bold">
                🎉 Seluruh Proses Pengambilan & Muat Selesai
              </div>
            `}
          </div>

          <!-- Tombol Footer Kartu -->
          <div class="flex items-center justify-between pt-1 border-t border-slate-800/60 text-xs">
            <span class="text-[10px] text-slate-500">Release: ${formatDateTime(s.tanggal_release)}</span>
            <div class="flex items-center space-x-2">
              <button onclick="openEditModal(${s.id})" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition font-medium">
                Edit Data
              </button>
              <button onclick="deleteShipment(${s.id}, '${s.nomor_surat}')" class="px-2.5 py-1 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-lg transition font-medium">
                Hapus
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// Quick Stamp Milestone
window.stampMilestone = async function(id, field) {
  try {
    const res = await fetch(`/api/shipments/${id}/stamp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field })
    });
    if (!res.ok) throw new Error('Gagal update milestone');
    const updated = await res.json();
    showToast(`Berhasil mencatat jam untuk ${updated.nomor_surat}`, '⏱️');
    loadShipments(false);
    loadStats();
  } catch (err) {
    showToast(err.message, '❌');
  }
};

// Buka Modal Form Tambah
function openCreateModal() {
  const form = document.getElementById('shipmentForm');
  form.reset();
  document.getElementById('formId').value = '';
  document.getElementById('modalFormTitle').textContent = 'Buat Surat Pengambilan Barang Baru';

  // Isi default waktu saat ini
  document.getElementById('formTanggalRelease').value = getNowTimestamp();
  document.getElementById('formQty').value = '';
  document.getElementById('formTanggalPenyiapan').value = new Date().toISOString().substring(0, 10);
  document.getElementById('formTanggalPickup').value = new Date().toISOString().substring(0, 10);

  document.getElementById('modalForm').classList.remove('hidden');
}

// Buka Modal Form Edit
window.openEditModal = async function(id) {
  try {
    const res = await fetch(`/api/shipments/${id}`);
    if (!res.ok) throw new Error('Surat tidak ditemukan');
    const item = await res.json();

    document.getElementById('formId').value = item.id;
    document.getElementById('modalFormTitle').textContent = `Edit Surat: ${item.nomor_surat}`;
    document.getElementById('formNomorSurat').value = item.nomor_surat || '';
    document.getElementById('formCustomer').value = item.customer || '';
    document.getElementById('formTanggalRelease').value = item.tanggal_release || '';
    document.getElementById('formQty').value = item.qty || '';
    document.getElementById('formTanggalPenyiapan').value = item.tanggal_penyiapan || '';
    document.getElementById('formTanggalPickup').value = item.tanggal_pickup || '';
    document.getElementById('formWaktuSiapMulai').value = item.waktu_siap_mulai || '';
    document.getElementById('formWaktuSiapSelesai').value = item.waktu_siap_selesai || '';
    document.getElementById('formWaktuScanMulai').value = item.waktu_scan_mulai || '';
    document.getElementById('formWaktuScanSelesai').value = item.waktu_scan_selesai || '';
    document.getElementById('formWaktuTrukTiba').value = item.waktu_truk_tiba || '';
    document.getElementById('formJamMuatMulai').value = item.jam_muat_mulai || '';
    document.getElementById('formJamMuatSelesai').value = item.jam_muat_selesai || '';
    document.getElementById('formNamaDriver').value = item.nama_driver || '';
    document.getElementById('formNopolTruk').value = item.nopol_truk || '';
    document.getElementById('formKeterangan').value = item.keterangan || '';

    document.getElementById('modalForm').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, '❌');
  }
};

function closeModalForm() {
  document.getElementById('modalForm').classList.add('hidden');
}

// Simpan Surat (Create / Update)
async function handleFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('formId').value;
  const isEdit = Boolean(id);

  const payload = {
    nomor_surat: document.getElementById('formNomorSurat').value.trim(),
    customer: document.getElementById('formCustomer').value.trim(),
    tanggal_release: document.getElementById('formTanggalRelease').value.trim(),
    qty: document.getElementById('formQty').value.trim(),
    tanggal_penyiapan: document.getElementById('formTanggalPenyiapan').value.trim(),
    tanggal_pickup: document.getElementById('formTanggalPickup').value.trim(),
    waktu_siap_mulai: document.getElementById('formWaktuSiapMulai').value.trim(),
    waktu_siap_selesai: document.getElementById('formWaktuSiapSelesai').value.trim(),
    waktu_scan_mulai: document.getElementById('formWaktuScanMulai').value.trim(),
    waktu_scan_selesai: document.getElementById('formWaktuScanSelesai').value.trim(),
    waktu_truk_tiba: document.getElementById('formWaktuTrukTiba').value.trim(),
    jam_muat_mulai: document.getElementById('formJamMuatMulai').value.trim(),
    jam_muat_selesai: document.getElementById('formJamMuatSelesai').value.trim(),
    nama_driver: document.getElementById('formNamaDriver').value.trim(),
    nopol_truk: document.getElementById('formNopolTruk').value.trim(),
    keterangan: document.getElementById('formKeterangan').value.trim()
  };

  try {
    const url = isEdit ? `/api/shipments/${id}` : '/api/shipments';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal menyimpan data');

    showToast(`Surat ${data.nomor_surat} berhasil disimpan!`, '✅');
    closeModalForm();
    loadShipments(false);
    loadStats();
  } catch (err) {
    showToast(err.message, '❌');
  }
}

// Hapus Surat
window.deleteShipment = async function(id, nomorSurat) {
  if (!confirm(`Apakah Anda yakin ingin menghapus surat ${nomorSurat}?`)) return;

  try {
    const res = await fetch(`/api/shipments/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal menghapus');

    showToast(`Surat ${nomorSurat} telah dihapus`, '🗑️');
    loadShipments(false);
    loadStats();
  } catch (err) {
    showToast(err.message, '❌');
  }
};

// Ambil info koneksi HP (IP & QR Code)
async function loadNetworkInfo() {
  try {
    const res = await fetch('/api/network-info');
    networkInfo = await res.json();

    const qrImg = document.getElementById('qrCodeImage');
    const urlText = document.getElementById('mobileUrlText');

    if (qrImg && networkInfo.qrDataUrl) {
      qrImg.src = networkInfo.qrDataUrl;
    }
    if (urlText && networkInfo.mobileUrl) {
      urlText.textContent = networkInfo.mobileUrl;
    }
    const otherPcText = document.getElementById('otherPcUrlText');
    if (otherPcText && networkInfo.mobileUrl) {
      otherPcText.textContent = networkInfo.mobileUrl;
    }
    const permText = document.getElementById('permanentUrlText');
    if (permText && networkInfo.localUrl) {
      permText.textContent = networkInfo.localUrl;
    }
    const qrPermText = document.getElementById('qrPermanentUrlText');
    if (qrPermText && networkInfo.localUrl) {
      qrPermText.textContent = networkInfo.localUrl;
    }
  } catch (err) {
    console.error('Gagal memuat network info:', err);
  }
}

function openQrModal() {
  document.getElementById('modalQr').classList.remove('hidden');
}

function closeQrModal() {
  document.getElementById('modalQr').classList.add('hidden');
}

// Salin URL HP
function copyMobileUrl() {
  if (!networkInfo || !networkInfo.mobileUrl) return;
  navigator.clipboard.writeText(networkInfo.mobileUrl).then(() => {
    showToast('Alamat URL berhasil disalin!', '📋');
  });
}

// Muat Seed Data Sampel Percobaan
async function seedSampleData() {
  try {
    const res = await fetch('/api/seed', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || 'Data sampel siap!', '✨');
    loadShipments(false);
    loadStats();
  } catch (err) {
    showToast('Gagal memuat data sampel', '❌');
  }
}

// Download PNG: Tangkap seluruh area tabel dan simpan sebagai gambar PNG
async function downloadTableAsPng() {
  const btn = document.getElementById('btnDownloadPng');
  const originalText = btn.innerHTML;

  try {
    // Tampilkan status loading di tombol
    btn.innerHTML = `<svg class="w-4 h-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span>Menyiapkan...</span>`;
    btn.disabled = true;

    // Buat elemen container sementara dengan background & header untuk PNG
    const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: fixed; left: -9999px; top: 0;
      background: #0f172a; padding: 24px; border-radius: 16px;
      font-family: system-ui, -apple-system, sans-serif;
      min-width: max-content;
    `;

    // Header PNG: Judul, tanggal, info
    wrapper.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; padding-bottom:14px; border-bottom:1px solid #334155;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:44px; height:44px; background:linear-gradient(135deg,#2563eb,#4f46e5); border-radius:12px; display:flex; align-items:center; justify-content:center;">
            <svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"/>
            </svg>
          </div>
          <div>
            <div style="color:white; font-size:18px; font-weight:700; letter-spacing:-0.5px;">Shipping Information</div>
            <div style="color:#94a3b8; font-size:11px; margin-top:1px;">Laporan Monitoring Pengambilan & Muat Barang</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="color:#94a3b8; font-size:11px;">Tanggal Cetak</div>
          <div style="color:#e2e8f0; font-size:12px; font-weight:600;">${today}</div>
          <div style="color:#64748b; font-size:11px;">Pukul ${now} WIB</div>
        </div>
      </div>
      <div id="pngTableArea"></div>
      <div style="margin-top:14px; padding-top:10px; border-top:1px solid #1e293b; display:flex; justify-content:space-between; align-items:center;">
        <div style="color:#475569; font-size:10px;">Created by: <span style="color:#60a5fa; font-weight:600;">Hidayat Nurwahid</span></div>
        <div style="color:#475569; font-size:10px;">Total Data: <strong style="color:#94a3b8;">${shipments.length} surat</strong></div>
      </div>
    `;
    document.body.appendChild(wrapper);

    // Ambil konten tabel yang sudah ada (versi desktop)
    const tableArea = document.getElementById('pngTableArea');

    // Buat tabel baru dari data shipments untuk PNG
    const tableHtml = buildPngTable(shipments);
    tableArea.innerHTML = tableHtml;

    // Capture canvas
    const canvas = await html2canvas(wrapper, {
      backgroundColor: '#0f172a',
      scale: 2, // Resolusi 2x agar lebih tajam
      useCORS: true,
      allowTaint: true,
      logging: false
    });

    document.body.removeChild(wrapper);

    // Download file PNG
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    link.download = `Shipping_Information_${dateStr}.png`;
    link.href = canvas.toDataURL('image/png', 1.0);
    link.click();

    showToast('Laporan PNG berhasil diunduh!', '🖼️');
  } catch (err) {
    console.error('Gagal download PNG:', err);
    showToast('Gagal membuat gambar PNG. Coba lagi.', '❌');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

// Helper global untuk klik filter tanggal dari ringkasan
window.filterBySummaryDate = function(dateStr) {
  const filterInput = document.getElementById('filterDate');
  if (filterInput) {
    filterInput.value = dateStr;
    loadShipments(false);
    showToast(`Filter diterapkan: ${dateStr}`, '📅');
  }
};

// ─── Total Qty Muat Per Tanggal ────────────────────────────────────────────────
async function loadQtySummary() {
  const tbody = document.getElementById('qtySummaryTableBody');
  if (!tbody) return;
  try {
    const res  = await fetch('/api/qty-summary');
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="px-4 py-5 text-center text-slate-500 italic">Belum ada data qty muat per tanggal</td></tr>';
      return;
    }

    // Hitung grand total
    const grandTotal = data.reduce((acc, r) => acc + r.totalQty, 0);
    const grandDO    = data.reduce((acc, r) => acc + r.jumlahSurat, 0);

    tbody.innerHTML = data.map((row, i) => {
      // Format tanggal jadi lebih mudah dibaca: YYYY-MM-DD → DD/MM/YYYY
      let tglDisplay = row.tanggal;
      const parts = row.tanggal.split('-');
      if (parts.length === 3) tglDisplay = `${parts[2]}/${parts[1]}/${parts[0]}`;

      return `
        <tr onclick="filterBySummaryDate('${row.tanggal}')" class="${i % 2 === 0 ? 'bg-slate-900/50' : 'bg-slate-950/30'} hover:bg-blue-600/10 cursor-pointer transition" title="Klik untuk memfilter daftar surat pada tanggal ini">
          <td class="px-4 py-2.5 font-semibold text-slate-200 flex items-center space-x-2">
            <span>📅</span>
            <span>${tglDisplay}</span>
            <span class="text-[10px] text-blue-400 font-normal underline ml-1">filter</span>
          </td>
          <td class="px-4 py-2.5 text-center text-slate-300">${row.jumlahSurat} DO</td>
          <td class="px-4 py-2.5 text-center">
            <span class="font-extrabold text-blue-400 text-sm">${row.totalQty > 0 ? row.totalQty.toLocaleString('id-ID') : '-'}</span>
          </td>
        </tr>`;
    }).join('') + `
      <tr class="bg-blue-900/20 border-t-2 border-blue-500/40">
        <td class="px-4 py-2.5 font-extrabold text-blue-300 text-xs uppercase tracking-wide">GRAND TOTAL</td>
        <td class="px-4 py-2.5 text-center font-bold text-blue-200">${grandDO} DO</td>
        <td class="px-4 py-2.5 text-center font-extrabold text-blue-300 text-base">${grandTotal.toLocaleString('id-ID')}</td>
      </tr>`;
  } catch (err) {
    console.error('Gagal memuat qty summary:', err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="px-4 py-4 text-center text-red-400">Gagal memuat data</td></tr>';
  }
}

// Bangun tabel HTML khusus untuk rendering PNG (tanpa tombol aksi)
function buildPngTable(items) {
  const statusLabel = {
    'SELESAI_MUAT':       'Selesai Muat',
    'SEDANG_MUAT':        'Sedang Muat',
    'TRUK_TIBA':          'Truk Tiba',
    'SEDANG_SCAN':        'Sedang Scan',
    'SELESAI_SCAN':       'Selesai Scan',
    'PENYIAPAN_PESANAN':  'Penyiapan',
    'SELESAI_PENYIAPAN':  'Siap Scan',
    'RELEASED':           'Released',
    'DRAFT':              'Draft'
  };
  const statusColor = {
    'SELESAI_MUAT':       '#10b981',
    'SEDANG_MUAT':        '#818cf8',
    'TRUK_TIBA':          '#22d3ee',
    'SEDANG_SCAN':        '#fbbf24',
    'SELESAI_SCAN':       '#38bdf8',
    'PENYIAPAN_PESANAN':  '#facc15',
    'SELESAI_PENYIAPAN':  '#60a5fa',
    'RELEASED':           '#94a3b8',
    'DRAFT':              '#64748b'
  };

  const cols = [
    { label: 'No.Surat',          key: (s) => `<div style="font-weight:700;color:#f1f5f9;">${s.nomor_surat}</div><div style="font-size:10px;color:#94a3b8;">${s.customer || '-'}</div>` },
    { label: 'Date SPPB Release', key: (s) => `<span style="color:#cbd5e1;">${s.tanggal_release ? formatDateTime(s.tanggal_release) : '-'}</span>` },
    { label: 'Qty',               key: (s) => `<span style="font-weight:700;color:#93c5fd;">${s.qty || '-'}</span>` },
    { label: 'Tgl Penyiapan',     key: (s) => `<span style="color:#cbd5e1;">${s.tanggal_penyiapan || '-'}</span>` },
    { label: 'Tgl Pick Up',       key: (s) => `<span style="color:#cbd5e1;">${s.tanggal_pickup || '-'}</span>` },
    { label: 'Waktu Penyiapan',   key: (s) => `<span style="color:#fde68a;">${formatTimeOnly(s.waktu_siap_mulai)} - ${formatTimeOnly(s.waktu_siap_selesai)}</span>${s.durasi_siap_formatted !== '-' ? `<br><span style="font-size:10px;color:#d1d5db;">⏱ ${s.durasi_siap_formatted}</span>` : ''}` },
    { label: 'Waktu Scan',        key: (s) => `<span style="color:#fde68a;">${formatTimeOnly(s.waktu_scan_mulai)} - ${formatTimeOnly(s.waktu_scan_selesai)}</span>${s.durasi_scan_formatted !== '-' ? `<br><span style="font-size:10px;color:#fbbf24;">🔍 ${s.durasi_scan_formatted}</span>` : ''}` },
    { label: 'Truk Datang',       key: (s) => `<span style="color:#67e8f9;">${formatTimeOnly(s.waktu_truk_tiba)}</span>` },
    { label: 'Jam Muat',          key: (s) => `<span style="color:#a5b4fc;">${formatTimeOnly(s.jam_muat_mulai)} - ${formatTimeOnly(s.jam_muat_selesai)}</span>${s.durasi_muat_formatted !== '-' ? `<br><span style="font-size:10px;color:#818cf8;">📥 ${s.durasi_muat_formatted}</span>` : ''}` },
    { label: 'Keterangan & Identitas', key: (s) => `<span style="font-weight:600;color:#f1f5f9;">🚚 ${s.nopol_truk || '-'}</span>${s.nama_driver ? `<br><span style="font-size:10px;color:#94a3b8;">${s.nama_driver}</span>` : ''}${s.keterangan ? `<br><span style="font-size:10px;color:#64748b;font-style:italic;">${s.keterangan}</span>` : ''}` },
    { label: 'Status', key: (s) => `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:700;color:${statusColor[s.status]||'#94a3b8'};border:1px solid ${statusColor[s.status]||'#94a3b8'}40;background:${statusColor[s.status]||'#94a3b8'}18;">${statusLabel[s.status]||s.status}</span>` }
  ];

  const thStyle = `padding:8px 12px; text-align:left; font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.05em; border-bottom:1px solid #1e293b; white-space:nowrap; background:#020617;`;
  const tdStyle = `padding:8px 12px; font-size:11px; border-bottom:1px solid #1e293b22; vertical-align:top;`;

  const headers = cols.map(c => `<th style="${thStyle}">${c.label}</th>`).join('');

  const rows = items.map((s, i) => {
    const bg = i % 2 === 0 ? '#0f172a' : '#111827';
    const cells = cols.map(c => `<td style="${tdStyle}">${c.key(s)}</td>`).join('');
    return `<tr style="background:${bg};">${cells}</tr>`;
  }).join('');

  // Hitung total qty untuk footer tabel PNG
  let totalQtyPng = 0;
  for (const item of items) {
    const cleanNum = String(item.qty || '').replace(/[^0-9]/g, '');
    const num = parseInt(cleanNum, 10);
    if (!isNaN(num)) totalQtyPng += num;
  }

  const footHtml = `
    <tfoot>
      <tr style="background:#020617; border-top:2px solid #334155;">
        <td style="${tdStyle}; font-weight:700; color:#94a3b8;">TOTAL</td>
        <td style="${tdStyle}; color:#94a3b8;">${items.length} DO</td>
        <td style="${tdStyle}; text-align:center; font-weight:800; color:#60a5fa; font-size:13px;">${totalQtyPng.toLocaleString('id-ID')}</td>
        <td colspan="8" style="${tdStyle}; color:#64748b; font-size:10px; font-style:italic;">* Rekapitulasi otomatis seluruh surat muat</td>
      </tr>
    </tfoot>
  `;

  return `
    <div style="border-radius:10px; overflow:hidden; border:1px solid #1e293b;">
      <table style="width:100%; border-collapse:collapse; font-family:system-ui,-apple-system,sans-serif;">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
        ${footHtml}
      </table>
    </div>
  `;
}

// Setup Event Listeners
function setupEventListeners() {
  document.getElementById('btnTambahSurat')?.addEventListener('click', openCreateModal);
  document.getElementById('btnCloseModalForm')?.addEventListener('click', closeModalForm);
  document.getElementById('btnCancelForm')?.addEventListener('click', closeModalForm);
  document.getElementById('shipmentForm')?.addEventListener('submit', handleFormSubmit);

  document.getElementById('btnOpenQrModal')?.addEventListener('click', openQrModal);
  document.getElementById('btnCloseModalQr')?.addEventListener('click', closeQrModal);
  document.getElementById('btnCopyUrl')?.addEventListener('click', copyMobileUrl);

  // Modal Aplikasi Versi PC
  const modalPc = document.getElementById('modalPc');
  document.getElementById('btnOpenPcModal')?.addEventListener('click', () => {
    modalPc?.classList.remove('hidden');
  });
  document.getElementById('btnCloseModalPc')?.addEventListener('click', () => {
    modalPc?.classList.add('hidden');
  });
  document.getElementById('btnCloseModalPc2')?.addEventListener('click', () => {
    modalPc?.classList.add('hidden');
  });
  document.getElementById('btnInstallPcApp')?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast('Aplikasi berhasil dipasang di PC!', '💻');
        modalPc?.classList.add('hidden');
      }
      deferredInstallPrompt = null;
    } else {
      showToast('Shortcut Desktop sudah tersedia di layar PC Anda!', '🖥️');
    }
  });

  document.getElementById('btnCopyOtherPcUrl')?.addEventListener('click', () => {
    if (!networkInfo || !networkInfo.mobileUrl) return;
    navigator.clipboard.writeText(networkInfo.mobileUrl).then(() => {
      showToast('Link online berhasil disalin!', '📋');
    });
  });

  const copyPerm = () => {
    if (!networkInfo || !networkInfo.localUrl) return;
    navigator.clipboard.writeText(networkInfo.localUrl).then(() => {
      showToast('Link Tetap Wi-Fi berhasil disalin!', '⭐');
    });
  };
  document.getElementById('btnCopyPermanentUrl')?.addEventListener('click', copyPerm);
  document.getElementById('btnCopyQrPermanentUrl')?.addEventListener('click', copyPerm);

  document.getElementById('btnSeedData')?.addEventListener('click', seedSampleData);
  document.getElementById('btnDownloadPng')?.addEventListener('click', downloadTableAsPng);

  // Search & Filter debounced
  let searchTimeout = null;
  document.getElementById('searchInput')?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadShipments(false), 300);
  });

  document.getElementById('filterStatus')?.addEventListener('change', () => loadShipments(false));
  document.getElementById('filterDate')?.addEventListener('change', () => loadShipments(false));

  document.getElementById('btnResetFilter')?.addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('filterStatus').value = 'ALL';
    document.getElementById('filterDate').value = '';
    loadShipments(false);
  });

  // PWA Install Prompt Listener
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.classList.remove('hidden');
  });

  document.getElementById('btnInstallPwa')?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('Aplikasi berhasil dipasang di HP!', '📱');
    }
    deferredInstallPrompt = null;
    document.getElementById('pwaInstallBanner')?.classList.add('hidden');
  });
}

// Inisialisasi Service Worker PWA
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.log('SW registration notice:', err);
      });
    });
  }
}

// Main Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupSSE();
  loadShipments(true);
  loadStats();
  loadNetworkInfo();
  registerServiceWorker();
});
