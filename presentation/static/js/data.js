// ================= DATA.JS — Data section logic =================
// - addLog / clearLog / toggleCoinDetail / setScrapingButtons : full implementation (pure UI)
// - startScraping / stopScraping : full implementation (POST to /start_scraping & /stop_scraping)
// - fetchScrapingStatus / polling : full implementation (GET /scraping_status every interval)
// - loadCoins / deleteCoin : full implementation (GET /get_all_coins, DELETE /delete_coin/<id>)
//   Coin details are taken from the same data fetched in loadCoins(), so no
//   separate fetch is needed each time a dropdown is opened.

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
 * Adds a single log line to the console.
 * level: 'info' | 'muted' | 'success' | 'error'
 */
function addLog(message, level = 'info') {
  const logEl = document.getElementById('scrape-log');
  if (!logEl) return;

  const line = document.createElement('div');
  line.className = `log-line log-line--${level}`;

  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
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
  addLog('Log cleared.', 'muted');
}

function setScrapeStatus(state) {
  const statusEl = document.getElementById('scrape-status');
  if (!statusEl) return;
  const labels = { idle: 'Ready', running: 'Scraping...', done: 'Done', error: 'Failed' };
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
        addLog('URL cannot be empty.', 'error');
        return;
      }

      startScraping(url);
    });
  }

  const stopBtn = document.getElementById('stop-scrape-btn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      const confirmed = confirm('Are you sure you want to stop the scraping process?');
      if (!confirmed) return;
      stopScraping();
    });
  }
}

/**
 * Shows the Start or Stop button depending on scraping status.
 * running = true  -> show Stop button, hide Start button
 * running = false -> show Start button, hide Stop button
 */
function setScrapingButtons(running) {
  const startBtn = document.getElementById('start-scrape-btn');
  const stopBtn = document.getElementById('stop-scrape-btn');
  if (startBtn) startBtn.hidden = running;
  if (stopBtn) stopBtn.hidden = !running;
}

/**
 * POST to /start_scraping with body { url }.
 *
 * Handled responses:
 *   - HTTP 400 + { success: false, message: "..." }  -> failed, show message
 *   - HTTP 200 + { success: true }                    -> started successfully
 */
function startScraping(url) {
  setScrapeStatus('running');
  addLog(`Starting scraping: ${url}`);

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
        addLog(data.message || 'Failed to start scraping.', 'error');
        setScrapeStatus('error');
        return;
      }

      addLog('Scraping started.', 'success');
      setScrapeStatus('running');
      setScrapingButtons(true);
      startStatusPolling();
    })
    .catch(err => {
      addLog(`Failed to reach the server: ${err.message}`, 'error');
      setScrapeStatus('error');
    })
    .finally(() => {
      if (startBtn) startBtn.disabled = false;
    });
}

/**
 * TODO: adjust the /stop_scraping endpoint if your backend's
 * request/response shape turns out to differ from what's assumed here
 * (POST with no body, response { success, message } like /start_scraping).
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
        addLog((data && data.message) || 'Failed to stop scraping.', 'error');
        return;
      }

      addLog('Scraping stopped.', 'muted');
      setScrapeStatus('idle');
      setScrapingButtons(false);
      stopStatusPolling();
    })
    .catch(err => {
      addLog(`Failed to reach the server: ${err.message}`, 'error');
    })
    .finally(() => {
      if (stopBtn) stopBtn.disabled = false;
    });
}

/* ================= SCRAPING STATUS POLLING ================= */

/**
 * Check status once when the page first loads — so that if
 * scraping is still running on the server (e.g. after a refresh),
 * the UI syncs immediately and polling resumes automatically.
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
      // silently ignore failures on initial load, no need to show an error
    });
}

/**
 * Starts polling GET /scraping_status every STATUS_POLL_INTERVAL_MS.
 * Automatically stops itself once status becomes 'finished'/'failed'/'idle'
 * (see applyScrapingStatus).
 */
function startStatusPolling() {
  stopStatusPolling(); // make sure there's no duplicate interval
  renderedLogCount = 0;
  lastErrorShown = false;

  fetchScrapingStatus(); // check immediately, don't wait for the first interval
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
      addLog(`Failed to fetch scraping status: ${err.message}`, 'error');
    });
}

/**
 * Applies the { status, progress, logs, error } result from /scraping_status
 * to the UI: syncs new logs, status pill, and start/stop buttons.
 */
function applyScrapingStatus(data) {
  const status = data.status || 'idle';

  // logs from the backend are the FULL list, so only render new lines
  // (ones not shown yet) to avoid duplicates.
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

/* ================= COIN LIST (DATABASE) ================= */

/**
 * GET /get_all_coins -> renders the full list.
 * The same data is also used to populate the detail dropdown,
 * so there's no need to fetch again each time a coin is opened.
 */
function loadCoins() {
  fetch('/get_all_coins')
    .then(res => res.json())
    .then(coins => {
      coinsData = coins;
      renderCoinList(coins);
    })
    .catch(err => {
      addLog(`Failed to load coin list: ${err.message}`, 'error');
    });
}

function renderCoinList(coins) {
  const listEl = document.getElementById('coin-list');
  const emptyEl = document.getElementById('coin-list-empty');
  const countEl = document.getElementById('coin-count');
  if (!listEl) return;

  listEl.innerHTML = '';

  if (countEl) countEl.textContent = `${coins.length} coins`;

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
        <span class="coin-item__meta">${coin.count_data ?? 0} candles</span>
        <svg class="chevron" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <button type="button" class="btn-delete" data-coin-id="${coin.id}" aria-label="Delete ${escapeHtml(coin.coin_pair_name)}" title="Delete">
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
          <path d="M5 6h10M8 6V4.5h4V6M7 6l.5 9h5L13 6" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
    <div id="coin-detail-${coin.id}" class="coin-item__detail" hidden>
      <dl>
        <div><dt>Source</dt><dd>${escapeHtml(coin.url_data || '—')}</dd></div>
        <div><dt>Candle count</dt><dd>${coin.count_data ?? 0}</dd></div>
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
 * Event delegation on the #coin-list container, not per-element.
 * Set up once on load — keeps working automatically even when
 * the list contents are re-rendered by renderCoinList().
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
 * Opens/closes a single coin's detail dropdown. Pure UI — the details
 * are already rendered directly in buildCoinItem() from loadCoins() data,
 * so no additional fetch is needed here.
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
 * DELETE /delete_coin/<coinId> — removes the coin & all of its candles
 * (handled on the backend via CoinRepository.delete_coin).
 */
function deleteCoin(coinId) {
  const coin = coinsData.find(c => String(c.id) === String(coinId));
  const label = coin ? coin.coin_pair_name : coinId;

  const confirmed = confirm(`Delete ${label}? All of its candles will also be deleted.`);
  if (!confirmed) return;

  fetch(`/delete_coin/${coinId}`, { method: 'DELETE' })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok || !data.success) {
        addLog((data && data.message) || `Failed to delete ${label}.`, 'error');
        return;
      }

      addLog(`${label} deleted from the database.`, 'success');
      coinsData = coinsData.filter(c => String(c.id) !== String(coinId));
      renderCoinList(coinsData);
    })
    .catch(err => {
      addLog(`Failed to reach the server: ${err.message}`, 'error');
    });
}