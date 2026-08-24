// ================= PREDICTION.JS — logika section Prediksi =================
//
// Alur:
//   1. User isi form konfigurasi (koin, K, threshold, panjang input/output)
//      lalu klik "Siapkan Model" -> POST /prepare_model.
//   2. Setelah model siap, script ini SUBSCRIBE ke onCloseCandle (dari
//      candle.js) lewat addOnCloseCandleListener().
//   3. Tiap kali ada candle baru close, kita kumpulkan ke buffer lokal.
//      Begitu buffer sudah cukup panjang (>= panjang input) DAN sudah
//      waktunya (candle baru yang close sejak prediksi terakhir >=
//      panjang output), otomatis POST /predict pakai `panjang input`
//      candle terakhir sebagai `x`.
//   4. Response /predict berupa array hasil neighbor:
//        [{ index, similarity, history, future_scaled,
//           current_avg_close, future_avg_close, direction }, ...]
//      Diagregasi jadi: arah mayoritas (up/down), rata-rata similarity,
//      dan jumlah neighbor naik vs turun -- lalu dirender ke DOM.

let currentModelConfig = null; // { coinId, k, threshold, inputLen, outputLen }
let candlesSinceLastRun = 0;
let hasRunPredictionOnce = false;

document.addEventListener('DOMContentLoaded', () => {
  initPredictForm();
  loadCoinsForPrediction();
  subscribeToCandleClose();
});

/* ================= FORM & INPUT ================= */

function initPredictForm() {
  const form = document.getElementById('predict-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const params = getPredictFormValues();
    prepareModel(params);
  });
}

/**
 * Kumpulkan seluruh nilai form konfigurasi model jadi satu object.
 */
function getPredictFormValues() {
  return {
    coinId: document.getElementById('predict-coin-select')?.value || '',
    k: Number(document.getElementById('predict-k')?.value || 0),
    threshold: Number(document.getElementById('predict-threshold')?.value || 0),
    inputLen: Number(document.getElementById('predict-input-len')?.value || 0),
    outputLen: Number(document.getElementById('predict-output-len')?.value || 0),
  };
}

/* ================= DAFTAR KOIN (dropdown) ================= */

function loadCoinsForPrediction() {
  fetch('/get_all_coins')
    .then(res => res.json())
    .then(coins => renderCoinOptions(coins))
    .catch(err => {
      console.error('Gagal memuat daftar koin untuk prediksi:', err);
      const select = document.getElementById('predict-coin-select');
      if (select) select.innerHTML = '<option value="">Gagal memuat koin</option>';
    });
}

function renderCoinOptions(coins) {
  const select = document.getElementById('predict-coin-select');
  if (!select) return;

  if (!coins || coins.length === 0) {
    select.innerHTML = '<option value="">Belum ada koin tersimpan</option>';
    return;
  }

  select.innerHTML = coins
    .map(coin => `<option value="${coin.id}">${escapeHtml(coin.coin_pair_name)} (${coin.count_data ?? 0} candle)</option>`)
    .join('');
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

/* ================= STATUS PILL ================= */

const STATUS_MAP = {
  idle:       { label: 'Siap',              css: 'idle'    },
  preparing:  { label: 'Menyiapkan model...', css: 'running' },
  ready:      { label: 'Model siap',        css: 'done'    },
  predicting: { label: 'Memprediksi...',    css: 'running' },
  done:       { label: 'Prediksi selesai',  css: 'done'    },
  error:      { label: 'Gagal',             css: 'error'   },
};

function setPredictStatus(stateKey) {
  const statusEl = document.getElementById('predict-status');
  if (!statusEl) return;
  const info = STATUS_MAP[stateKey] || { label: stateKey, css: 'idle' };
  statusEl.textContent = info.label;
  statusEl.dataset.state = info.css;
}

/* ================= TOGGLE STATE HASIL ================= */

function toggleResultState(hasResult) {
  const empty = document.getElementById('predict-result-empty');
  const filled = document.getElementById('predict-result-filled');
  if (empty) empty.hidden = hasResult;
  if (filled) filled.hidden = !hasResult;
}

/* ================= SIAPKAN MODEL (tombol submit) ================= */

/**
 * POST /prepare_model -- dipanggil saat form disubmit.
 * Kalau berhasil: simpan config ke currentModelConfig, reset buffer
 * candle & counter, supaya siklus auto-predict mulai dari nol dengan
 * parameter yang baru.
 */
function prepareModel(params) {
  setPredictStatus('preparing');

  const btn = document.getElementById('prepare-model-btn');
  if (btn) btn.disabled = true;

  fetch('/prepare_model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok || !data.success) {
        setPredictStatus('error');
        console.error('Gagal menyiapkan model:', data && data.message);
        return;
      }

      currentModelConfig = params;
      closedCandles = [];
      candlesSinceLastRun = 0;
      hasRunPredictionOnce = false;

      setPredictStatus('ready');
      toggleResultState(false);
    })
    .catch(err => {
      setPredictStatus('error');
      console.error('Gagal menghubungi server saat menyiapkan model:', err);
    })
    .finally(() => {
      if (btn) btn.disabled = false;
    });
}

/* ================= SUBSCRIBE KE CANDLE CLOSE (candle.js) ================= */

/**
 * candle.js menyediakan addOnCloseCandleListener(callback) secara global
 * (lihat closeCandleHandlers / onCloseCandle di candle.js). Kita daftarkan
 * handleCandleClose() ke situ supaya tiap candle baru close, section
 * Prediksi otomatis ikut mengecek apakah sudah waktunya prediksi ulang.
 */
function subscribeToCandleClose() {
  if (typeof addOnCloseCandleListener !== 'function') {
    console.warn('addOnCloseCandleListener() tidak ditemukan -- pastikan candle.js dimuat sebelum prediction.js.');
    return;
  }
  addOnCloseCandleListener(handleCandleClose);
}

/**
 * Dipanggil tiap kali satu candle baru close.
 *
 * Aturan auto-predict:
 *   - Kalau model belum disiapkan (currentModelConfig kosong) -> abaikan.
 *   - Kalau candle yang sudah kekumpul di buffer belum sepanjang
 *     `inputLen` -> abaikan (histori belum cukup untuk jadi input).
 *   - Prediksi pertama langsung jalan begitu syarat panjang input
 *     terpenuhi. Prediksi berikutnya baru jalan lagi setelah `outputLen`
 *     candle baru close sejak prediksi terakhir.
 *
 * Contoh: inputLen=10, outputLen=5, posisi sekarang candle ke-100 close
 * -> prediksi jalan. Prediksi berikutnya baru jalan lagi setelah
 * candle ke-105 close.
 */
function handleCandleClose(candle,candleChart) {

  if (!currentModelConfig) return;

  const { inputLen, outputLen } = currentModelConfig;
  if (candle.length < inputLen) {
    alert('candle not enought')
    return;}

  candlesSinceLastRun++;

  const shouldRun = !hasRunPredictionOnce || candlesSinceLastRun >= outputLen;
  if (!shouldRun) return;

  hasRunPredictionOnce = true;
  candlesSinceLastRun = 0;

  const x = candle.slice(-inputLen);
  runPredictionFromCandles(x, candle);
}

/* ================= JALANKAN PREDIKSI (otomatis) ================= */

/**
 * POST /predict dengan { x } berisi `inputLen` candle terakhir.
 * `triggerCandle` cuma dipakai untuk info di UI (kapan prediksi ini
 * dipicu), tidak dikirim ke server.
 */
function runPredictionFromCandles(x, triggerCandle) {
  setPredictStatus('predicting');

  fetch('/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'input':x })
  })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok || !data.success) {
        setPredictStatus('error');
        console.error('Gagal menjalankan prediksi:', data && data.message);
        return;
      }

      const summary = summarizePredictionResults(data.result);
      renderPredictionResult(summary, triggerCandle);
      setPredictStatus('done');
      evaluatePredictionResult(summary,triggerCandle);
    })
    .catch(err => {
      setPredictStatus('error');
      console.error('Gagal menghubungi server saat prediksi:', err);
    });
}
  let predictionHistory = [];
  let correctCount = 0;
  let wrongCount = 0;

  async function evaluatePredictionResult(summary, candle) {
    if (!summary || !currentModelConfig) return;

    const { outputLen } = currentModelConfig;
    const requiredLength = candle.length + outputLen + 1;

    // polling sampai candle sudah cukup panjang
    while (candle.length < requiredLength) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // cek tiap 1 detik
    }

    // semua candle output yang sudah close
    const outputCandles = candle.slice(-(outputLen + 1), -1);
    // candle input terakhir (acuan sebelum output)
    const lastInputCandle = candle.slice(-(outputLen + 2), -(outputLen + 1))[0];

    if (!lastInputCandle || outputCandles.length === 0) return;

    const lastInputClose = lastInputCandle.c;
    const avgOutputClose =
      outputCandles.reduce((sum, c) => sum + c.c, 0) / outputCandles.length;

    const actualDirection = avgOutputClose > lastInputClose ? 'up' : 'down';
    const predictedDirection = summary.direction;
    const isCorrect = actualDirection === predictedDirection;

    isCorrect ? correctCount++ : wrongCount++;

    predictionHistory.push({
      predictedDirection,
      actualDirection,
      isCorrect,
      confidence: summary.confidence,
      lastInputClose,
      avgOutputClose,
      lastInputTime: lastInputCandle.x,
    });

    showHistoricalResult();
  }

  function showHistoricalResult() {
    console.log('=== Riwayat Evaluasi Prediksi ===');
    console.table(predictionHistory);
    console.log(`Benar: ${correctCount} | Salah: ${wrongCount} | Total: ${correctCount + wrongCount}`);
  }
/* ================= AGREGASI HASIL /predict ================= */

/**
 * `results` adalah array neighbor dari backend, tiap item:
 *   { index, similarity, history, future_scaled,
 *     current_avg_close, future_avg_close, direction }
 *
 * Dari situ dihitung:
 *   - upCount / downCount  : jumlah neighbor yang arahnya naik/turun
 *   - direction            : arah mayoritas (dipakai sebagai prediksi akhir)
 *   - confidence            : rata-rata `similarity` seluruh neighbor
 *   - dominance             : porsi neighbor yang searah dengan `direction`
 *
 * CATATAN: skala `similarity` dari backend belum dipastikan (0-1 atau
 * 0-100). Di sini diasumsikan sudah dalam bentuk persen (0-100) --
 * kalau ternyata 0-1, tinggal kalikan 100 di bagian confidenceSum.
 */
function summarizePredictionResults(results) {
  if (!Array.isArray(results) || results.length === 0) return null;

  let upCount = 0;
  let downCount = 0;
  let similaritySum = 0;

  results.forEach(r => {
    if (r.direction === 'up') upCount++;
    else if (r.direction === 'down') downCount++;
    similaritySum += Number(r.similarity) || 0;
  });

  const total = results.length;
  const direction = upCount >= downCount ? 'up' : 'down';
  const dominantCount = Math.max(upCount, downCount);
  const confidence = total > 0 ? Math.round((similaritySum / total) * 100) / 100 : 0;
  const dominancePct = total > 0 ? Math.round((dominantCount / total) * 100) : 0;

  return { direction, confidence, upCount, downCount, total, dominancePct };
}

/* ================= RENDER HASIL PREDIKSI ================= */

function renderPredictionResult(summary, triggerCandle) {
  if (!summary) {
    toggleResultState(false);
    return;
  }

  toggleResultState(true);

  const directionBox = document.getElementById('predict-direction');
  const directionLabel = document.getElementById('predict-direction-label');
  const confidenceEl = document.getElementById('predict-confidence');
  const upEl = document.getElementById('predict-up-count');
  const downEl = document.getElementById('predict-down-count');
  const dominanceTextEl = document.getElementById('predict-accuracy-text');
  const dominanceFillEl = document.getElementById('predict-accuracy-fill');
  const metaEl = document.getElementById('predict-result-meta');

  const isUp = summary.direction === 'up';

  if (directionBox) {
    directionBox.classList.toggle('predict-direction--up', isUp);
    directionBox.classList.toggle('predict-direction--down', !isUp);
  }
  if (directionLabel) directionLabel.textContent = isUp ? 'NAIK' : 'TURUN';
  if (confidenceEl) confidenceEl.textContent = `${summary.confidence}%`;

  if (upEl) upEl.textContent = summary.upCount;
  if (downEl) downEl.textContent = summary.downCount;

  const dominantCount = isUp ? summary.upCount : summary.downCount;
  if (dominanceTextEl) dominanceTextEl.textContent = `${summary.dominancePct}% (${dominantCount}/${summary.total})`;
  if (dominanceFillEl) dominanceFillEl.style.width = `${summary.dominancePct}%`;

  if (metaEl) {
    const label = triggerCandle && triggerCandle.time ? triggerCandle.time : 'candle terbaru';
    metaEl.textContent = `Terakhir dijalankan: setelah close ${label}, dari ${summary.total} neighbor`;
  }
}