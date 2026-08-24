// ================= DATA.JS — logika section Data =================
// - addLog / clearLog / toggleCoinDetail / setScrapingButtons : implementasi penuh (murni UI)
// - startScraping / stopScraping : implementasi penuh (POST ke /start_scraping & /stop_scraping)
// - fetchScrapingStatus / polling : implementasi penuh (GET /scraping_status tiap interval)
// - loadCoins / deleteCoin : implementasi penuh (GET /get_all_coins, DELETE /delete_coin/<id>)
//   Detail coin diambil dari data yang sama saat loadCoins(), jadi tidak perlu
//   fetch terpisah tiap dropdown dibuka.

const STATUS_POLL_INTERVAL_MS = 2000;

let statusPollTimer = null;
let renderedLogCount = 0;
let lastErrorShown = false;
let coinsData = [];

document.addEventListener('DOMContentLoaded', () => {
  initScrapingForm();
  initCoinListEvents();
  loadCoins();
  checkInitialScrapingStatus();
});

/* ================= LOG CONSOLE ================= */

/**
 * Menambahkan satu baris log ke konsol.
 * level: 'info' | 'muted' | 'success' | 'error'
 */
function addLog(message, level = 'info') {
  const logEl = document.getElementById('scrape-log');
  if (!logEl) return;

  const line = document.createElement('div');
  line.className = `log-line log-line--${level}`;

  const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-line__time';
  timeSpan.textContent = time;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-line__msg';
  msgSpan.textContent = message;

  line.appendChild(timeSpan);
  line.appendChild(msgSpan);
  logEl.appendChild(line);

  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  const logEl = document.getElementById('scrape-log');
  if (!logEl) return;
  logEl.innerHTML = '';
  addLog('Log dibersihkan.', 'muted');
}

function setScrapeStatus(state) {
  const statusEl = document.getElementById('scrape-status');
  if (!statusEl) return;
  const labels = { idle: 'Siap', running: 'Scraping...', done: 'Selesai', error: 'Gagal' };
  statusEl.textContent = labels[state] || state;
  statusEl.dataset.state = state;
}

/* ================= SCRAPING FORM ================= */

function initScrapingForm() {
  const form = document.getElementById('scrape-form');
  const clearBtn = document.getElementById('clear-log-btn');

  if (clearBtn) {
    clearBtn.addEventListener('click', clearLog);
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('scrape-url');
      const url = input.value.trim();

      if (!url) {
        addLog('URL tidak boleh kosong.', 'error');
        return;
      }

      startScraping(url);
    });
  }

  const stopBtn = document.getElementById('stop-scrape-btn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      const confirmed = confirm('Yakin ingin menghentikan proses scraping?');
      if (!confirmed) return;
      stopScraping();
    });
  }
}

/**
 * Menampilkan tombol Start atau Stop sesuai status scraping.
 * running = true  -> tampilkan tombol Stop, sembunyikan tombol Start
 * running = false -> tampilkan tombol Start, sembunyikan tombol Stop
 */
function setScrapingButtons(running) {
  const startBtn = document.getElementById('start-scrape-btn');
  const stopBtn = document.getElementById('stop-scrape-btn');
  if (startBtn) startBtn.hidden = running;
  if (stopBtn) stopBtn.hidden = !running;
}

/**
 * POST ke /start_scraping dengan body { url }.
 *
 * Response yang ditangani:
 *   - HTTP 400 + { success: false, message: "..." }  -> gagal, tampilkan message
 *   - HTTP 200 + { success: true }                    -> berhasil dimulai
 */
function startScraping(url) {
  setScrapeStatus('running');
  addLog(`Memulai scraping: ${url}`);

  const startBtn = document.getElementById('start-scrape-btn');
  if (startBtn) startBtn.disabled = true;

  fetch('/start_scraping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok || !data.success) {
        addLog(data.message || 'Gagal memulai scraping.', 'error');
        setScrapeStatus('error');
        return;
      }

      addLog('Scraping dimulai.', 'success');
      setScrapeStatus('running');
      setScrapingButtons(true);
      startStatusPolling();
    })
    .catch(err => {
      addLog(`Gagal menghubungi server: ${err.message}`, 'error');
      setScrapeStatus('error');
    })
    .finally(() => {
      if (startBtn) startBtn.disabled = false;
    });
}

/**
 * TODO: sesuaikan endpoint /stop_scraping kalau bentuk request/response
 * backend Anda ternyata berbeda dari asumsi di sini (POST tanpa body,
 * balasan { success, message } seperti /start_scraping).
 */
function stopScraping() {
  const stopBtn = document.getElementById('stop-scrape-btn');
  if (stopBtn) stopBtn.disabled = true;

  fetch('/stop_scraping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok || !data.success) {
        addLog((data && data.message) || 'Gagal menghentikan scraping.', 'error');
        return;
      }

      addLog('Scraping dihentikan.', 'muted');
      setScrapeStatus('idle');
      setScrapingButtons(false);
      stopStatusPolling();
    })
    .catch(err => {
      addLog(`Gagal menghubungi server: ${err.message}`, 'error');
    })
    .finally(() => {
      if (stopBtn) stopBtn.disabled = false;
    });
}

/* ================= POLLING STATUS SCRAPING ================= */

/**
 * Cek status sekali saat halaman pertama dimuat — supaya kalau
 * scraping masih berjalan di server (misal habis refresh), UI
 * langsung sinkron dan polling otomatis dilanjutkan.
 */
function checkInitialScrapingStatus() {
  fetch('/scraping_status')
    .then(res => res.json())
    .then(data => {
      applyScrapingStatus(data);
      if (data.status === 'running') {
        startStatusPolling();
      }
    })
    .catch(() => {
      // diamkan saja kalau gagal saat load awal, tidak perlu tampil error
    });
}

/**
 * Mulai polling GET /scraping_status setiap STATUS_POLL_INTERVAL_MS.
 * Otomatis berhenti sendiri saat status jadi 'finished'/'failed'/'idle'
 * (lihat applyScrapingStatus).
 */
function startStatusPolling() {
  stopStatusPolling(); // pastikan tidak ada interval dobel
  renderedLogCount = 0;
  lastErrorShown = false;

  fetchScrapingStatus(); // langsung cek sekali, tidak nunggu interval pertama
  statusPollTimer = setInterval(fetchScrapingStatus, STATUS_POLL_INTERVAL_MS);
}

function stopStatusPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
}

function fetchScrapingStatus() {
  fetch('/scraping_status')
    .then(res => res.json())
    .then(data => applyScrapingStatus(data))
    .catch(err => {
      addLog(`Gagal mengambil status scraping: ${err.message}`, 'error');
    });
}

/**
 * Terapkan hasil { status, progress, logs, error } dari /scraping_status
 * ke UI: sinkronkan log baru, status pill, dan tombol start/stop.
 */
function applyScrapingStatus(data) {
  const status = data.status || 'idle';

  // logs dari backend adalah daftar LENGKAP, jadi cuma render baris baru
  // (yang belum pernah ditampilkan) supaya tidak dobel.
  if (Array.isArray(data.logs) && data.logs.length > renderedLogCount) {
    data.logs.slice(renderedLogCount).forEach(line => addLog(line));
    renderedLogCount = data.logs.length;
  }

  if (status === 'running') {
    setScrapeStatus('running');
    setScrapingButtons(true);
    return;
  }

  if (status === 'finished') {
    setScrapeStatus('done');
    setScrapingButtons(false);
    stopStatusPolling();
    return;
  }

  if (status === 'failed') {
    setScrapeStatus('error');
    setScrapingButtons(false);
    if (data.error && !lastErrorShown) {
      addLog(`Error: ${data.error}`, 'error');
      lastErrorShown = true;
    }
    stopStatusPolling();
    return;
  }

  // status === 'idle'
  setScrapeStatus('idle');
  setScrapingButtons(false);
  stopStatusPolling();
}

/* ================= DAFTAR COIN (DATABASE) ================= */

/**
 * GET /get_all_coins -> render seluruh list.
 * Data yang sama juga dipakai untuk mengisi dropdown detail,
 * jadi tidak perlu fetch lagi tiap satu coin dibuka.
 */
function loadCoins() {
  fetch('/get_all_coins')
    .then(res => res.json())
    .then(coins => {
      coinsData = coins;
      renderCoinList(coins);
    })
    .catch(err => {
      addLog(`Gagal memuat daftar coin: ${err.message}`, 'error');
    });
}

function renderCoinList(coins) {
  const listEl = document.getElementById('coin-list');
  const emptyEl = document.getElementById('coin-list-empty');
  const countEl = document.getElementById('coin-count');
  if (!listEl) return;

  listEl.innerHTML = '';

  if (countEl) countEl.textContent = `${coins.length} coin`;

  if (coins.length === 0) {
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  coins.forEach(coin => listEl.appendChild(buildCoinItem(coin)));
}

function buildCoinItem(coin) {
  const li = document.createElement('li');
  li.className = 'coin-item';
  li.dataset.coinId = coin.id;

  li.innerHTML = `
    <div class="coin-item__head">
      <div class="coin-item__row" data-coin-id="${coin.id}" role="button" tabindex="0"
           aria-expanded="false" aria-controls="coin-detail-${coin.id}">
        <span class="coin-item__name">${escapeHtml(coin.coin_pair_name)}</span>
        <span class="coin-item__meta">${coin.count_data ?? 0} candle</span>
        <svg class="chevron" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <button type="button" class="btn-delete" data-coin-id="${coin.id}" aria-label="Hapus ${escapeHtml(coin.coin_pair_name)}" title="Hapus">
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
          <path d="M5 6h10M8 6V4.5h4V6M7 6l.5 9h5L13 6" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
    <div id="coin-detail-${coin.id}" class="coin-item__detail" hidden>
      <dl>
        <div><dt>Sumber</dt><dd>${escapeHtml(coin.url_data || '—')}</dd></div>
        <div><dt>Jumlah candle</dt><dd>${coin.count_data ?? 0}</dd></div>
      </dl>
    </div>
  `;

  return li;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

/**
 * Event delegation di container #coin-list, bukan per-elemen.
 * Dipasang sekali saja saat load — otomatis tetap jalan walau
 * isi list-nya di-render ulang oleh renderCoinList().
 */
function initCoinListEvents() {
  const listEl = document.getElementById('coin-list');
  if (!listEl) return;

  listEl.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.btn-delete');
    if (deleteBtn) {
      e.stopPropagation();
      deleteCoin(deleteBtn.dataset.coinId);
      return;
    }

    const row = e.target.closest('.coin-item__row');
    if (row) {
      toggleCoinDetail(row.dataset.coinId);
    }
  });

  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.coin-item__row');
    if (row) {
      e.preventDefault();
      toggleCoinDetail(row.dataset.coinId);
    }
  });
}

/**
 * Buka/tutup dropdown detail satu coin. Murni UI — detail-nya
 * sudah dirender langsung di buildCoinItem() dari data loadCoins(),
 * jadi tidak butuh fetch tambahan di sini.
 */
function toggleCoinDetail(coinId) {
  const row = document.querySelector(`.coin-item__row[data-coin-id="${coinId}"]`);
  const detail = document.getElementById(`coin-detail-${coinId}`);
  if (!row || !detail) return;

  const isOpen = row.getAttribute('aria-expanded') === 'true';
  row.setAttribute('aria-expanded', String(!isOpen));
  detail.hidden = isOpen;
}

/**
 * DELETE /delete_coin/<coinId> — menghapus coin & seluruh candle-nya
 * (ditangani di backend lewat CoinRepository.delete_coin).
 */
function deleteCoin(coinId) {
  const coin = coinsData.find(c => String(c.id) === String(coinId));
  const label = coin ? coin.coin_pair_name : coinId;

  const confirmed = confirm(`Hapus ${label}? Semua candle miliknya juga akan ikut terhapus.`);
  if (!confirmed) return;

  fetch(`/delete_coin/${coinId}`, { method: 'DELETE' })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok || !data.success) {
        addLog((data && data.message) || `Gagal menghapus ${label}.`, 'error');
        return;
      }

      addLog(`${label} dihapus dari database.`, 'success');
      coinsData = coinsData.filter(c => String(c.id) !== String(coinId));
      renderCoinList(coinsData);
    })
    .catch(err => {
      addLog(`Gagal menghubungi server: ${err.message}`, 'error');
    });
}