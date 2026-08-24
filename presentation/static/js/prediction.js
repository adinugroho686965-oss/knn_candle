// ========== PREDICTION_ANALYSIS.JS — logika section "Prediksi (Analisa)" ==========
//
// Beda dengan prediction.js (versi auto forward-test):
//   - TIDAK subscribe ke onCloseCandle / auto-run tiap candle close.
//   - User trigger prediksi manual lewat tombol #predict-run-last-n-btn.
//   - N candle yang dipakai sebagai input = `inputLen` dari config model
//     (form "Konfigurasi Model" di atas), diambil dari N candle TERAKHIR
//     pada chart (getCandlesData()).
//   - Checkbox #predict-include-unclosed menentukan apakah candle
//     terakhir yang belum close ikut dipakai sebagai input atau tidak.
//   - Hasil prediksi, selain dirender ke panel, juga divisualisasikan
//     ke candle chart lewat visualizePredictionOnChart().
//
// Dependency dari candle.js (harus dimuat sebelum script ini):
//   - getCandleCanvas() -> instance Chart.js (candleChart)
//   - getCandlesData()  -> array candle, candleChart.data.datasets[0].data

let currentModelConfig = null; // { coinId, k, threshold, inputLen, outputLen }

document.addEventListener('DOMContentLoaded', () => {
  initPredictForm();
  initManualPredictButton();
  loadCoinsForPrediction();
});

/* ================= FORM KONFIGURASI MODEL ================= */

function initPredictForm() {
  const form = document.getElementById('predict-form');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const params = getPredictFormValues();
    prepareModel(params);
  });
}

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

/* ================= SIAPKAN MODEL (tombol submit form) ================= */

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
      setPredictStatus('ready');
      toggleResultState(false);
      updateManualHint();
    })
    .catch(err => {
      setPredictStatus('error');
      console.error('Gagal menghubungi server saat menyiapkan model:', err);
    })
    .finally(() => {
      if (btn) btn.disabled = false;
    });
}

function updateManualHint() {
  const hintEl = document.getElementById('predict-manual-hint');
  if (!hintEl) return;
  if (currentModelConfig) {
    hintEl.textContent = `N = ${currentModelConfig.inputLen} (Panjang Input model yang sedang aktif).`;
  } else {
    hintEl.textContent = 'N = Panjang Input pada konfigurasi model di atas.';
  }
}

/* ================= TOMBOL "PREDICT LAST N CANDLE" ================= */

function initManualPredictButton() {
  const btn = document.getElementById('predict-run-last-n-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    predictLastNCandles();
  });
}

/**
 * Entry point tombol "Predict Last N Candle".
 * N diambil dari currentModelConfig.inputLen.
 * Checkbox #predict-include-unclosed menentukan apakah candle terakhir
 * yang belum close ikut dipakai sebagai bagian dari N candle input.
 */
function predictLastNCandles() {
  if (!currentModelConfig) {
    alert('Model belum disiapkan. Klik "Siapkan Model" dulu.');
    return;
  }

  const includeUnclosed = document.getElementById('predict-include-unclosed')?.checked || false;
  const { inputLen } = currentModelConfig;

  const x = getInputCandles(inputLen, includeUnclosed);

  if (!x || x.length < inputLen) {
    alert(`Candle belum cukup untuk prediksi. Butuh ${inputLen} candle, tersedia ${x ? x.length : 0}.`);
    return;
  }

  runPredictionFromCandles(x);
}

/**
 * Ambil `inputLen` candle terakhir dari chart (via getCandlesData()),
 * dengan opsi menyertakan/tidak candle terakhir yang belum close.
 */
function getInputCandles(inputLen, includeUnclosed) {
  const allCandles = typeof getCandlesData === 'function' ? getCandlesData() : [];
  if (!allCandles || allCandles.length === 0) return [];

  let workingCandles = allCandles;

  if (!includeUnclosed) {
    const lastCandle = workingCandles[workingCandles.length - 1];
    if (lastCandle && !isCandleClosed(lastCandle)) {
      workingCandles = workingCandles.slice(0, -1);
    }
  }

  return workingCandles.slice(-inputLen);
}

/**
 * TODO: sesuaikan dengan cara candle.js menandai candle yang belum close
 * (mis. flag `candle.closed`, atau bandingkan `candle.x`/timestamp
 * terhadap waktu real-time saat ini).
 *
 * CATATAN: saat ini di-set default `false` (candle terakhir selalu
 * dianggap BELUM close) -- artinya kalau checkbox "sertakan candle
 * belum close" TIDAK dicentang, candle paling akhir SELALU dibuang
 * dari input, apapun kondisinya. Ganti logic ini kalau kamu sudah
 * punya cara pasti mendeteksi status close candle.
 */
function isCandleClosed(candle) {
  // TODO: implementasikan sesuai struktur data candle di project ini.
  return false;
}

/* ================= JALANKAN PREDIKSI (manual) ================= */

function runPredictionFromCandles(x) {
  setPredictStatus('predicting');

  fetch('/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'input': x })
  })
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok || !data.success) {
        setPredictStatus('error');
        console.error('Gagal menjalankan prediksi:', data && data.message);
        return;
      }

      const summary = summarizePredictionResults(data.result);
      renderPredictionResult(summary, x);
      setPredictStatus('done');
      visualizePredictionOnChart(data, summary, x);
    })
    .catch(err => {
      setPredictStatus('error');
      console.error('Gagal menghubungi server saat prediksi:', err);
    });
}

/* ================= AGREGASI HASIL /predict ================= */

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

/* ================= RENDER HASIL PREDIKSI (panel) ================= */

function renderPredictionResult(summary, inputCandles) {
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
    const lastCandle = inputCandles && inputCandles.length ? inputCandles[inputCandles.length - 1] : null;
    const label = lastCandle && lastCandle.time ? lastCandle.time : (lastCandle && lastCandle.x ? lastCandle.x : 'candle terakhir');
    metaEl.textContent = `Dijalankan manual setelah ${label}, dari ${summary.total} neighbor`;
  }
}

/* ================= VISUALISASI KE CANDLE CHART ================= */

/**
 * Gambar hasil prediksi di atas candle chart (candleChart, via
 * getCandleCanvas()):
 *   1. Garis input (harga close tiap candle input) -- oranye.
 *   2. Garis target UP -- hijau, cuma kalau avg_max_up > 0.
 *   3. Garis target DOWN -- merah, cuma kalau avg_max_down > 0.
 *
 * Dataset lama dengan label-label di bawah dibuang dulu tiap kali
 * fungsi ini dipanggil, supaya tidak menumpuk sisa run sebelumnya.
 */
function visualizePredictionOnChart(data, summary, inputCandles) {
  if (!inputCandles || inputCandles.length === 0) return;

  if (typeof getCandleCanvas !== 'function') {
    console.warn(
      'getCandleCanvas() tidak ditemukan -- pastikan candle.js dimuat sebelum prediction_analysis.js.'
    );
    return;
  }

  const chart = getCandleCanvas();
  if (!chart) return;

  // ============================================================
  // Bersihkan highlight candles jika ada (sisa pendekatan recolor lama)
  // ============================================================
  clearPredictionHighlight();

  // ============================================================
  // Hapus overlay prediction dari run sebelumnya
  // ============================================================
  chart.data.datasets = chart.data.datasets.filter(ds =>
    !['prediction-input-line', 'prediction-up-line', 'prediction-down-line'].includes(ds.label)
  );

  // ============================================================
  // 1. GARIS INPUT
  // ============================================================
  const INPUT_LINE_COLOR = 'rgba(255, 152, 0, 1)';

  const inputLineDataset = {
    label: 'prediction-input-line',
    type: 'line',
    data: inputCandles.map(c => ({ x: c.x, y: c.c })),
    borderColor: INPUT_LINE_COLOR,
    backgroundColor: INPUT_LINE_COLOR,
    borderWidth: 2,
    pointRadius: 3,
    pointBackgroundColor: INPUT_LINE_COLOR,
    pointBorderColor: INPUT_LINE_COLOR,
    fill: false,
    tension: 0,
    spanGaps: true,
    order: 100,
  };

  chart.data.datasets.push(inputLineDataset);

  // ============================================================
  // 2. AMBIL VALUE PREDICTION
  // ============================================================
  const avgMaxUp = Number(data?.avg_max_up ?? 0);
  const avgMaxDown = Number(data?.avg_max_down ?? 0);

  console.log('[prediction] avg_max_up:', avgMaxUp);
  console.log('[prediction] avg_max_down:', avgMaxDown);

  // ============================================================
  // 3. AMBIL RESULT PREDICTION
  // ============================================================
  const predictionResult = data?.result;

  if (!Array.isArray(predictionResult) || predictionResult.length === 0) {
    console.warn('[prediction] result kosong, garis prediction tidak dibuat.');
    chart.update('none');
    return;
  }

  // ============================================================
  // 4. JUMLAH CANDLE OUTPUT
  //
  // BUKAN predictionResult.length -- diambil dari
  // predictionResult[0].future_scaled.length
  // ============================================================
  const outputCount = predictionResult[0]?.future_scaled?.length || 0;

  if (outputCount <= 0) {
    console.warn('[prediction] future_scaled kosong atau tidak ditemukan.');
    chart.update('none');
    return;
  }

  console.log('[prediction] jumlah candle output:', outputCount);

  // ============================================================
  // 5. PASTIKAN ADA MINIMAL 2 CANDLE INPUT
  // ============================================================
  if (inputCandles.length < 2) {
    console.warn('[prediction] minimal membutuhkan 2 candle input untuk menghitung interval.');
    chart.update('none');
    return;
  }

  // ============================================================
  // 6. AMBIL 2 CANDLE INPUT TERAKHIR
  // ============================================================
  const previousInputCandle = inputCandles[inputCandles.length - 2];
  const lastInputCandle = inputCandles[inputCandles.length - 1];

  const previousX = Number(previousInputCandle.x);
  const lastInputX = Number(lastInputCandle.x);

  if (!Number.isFinite(previousX) || !Number.isFinite(lastInputX)) {
    console.warn('[prediction] X candle input tidak valid:', { previousX, lastInputX });
    chart.update('none');
    return;
  }

  // ============================================================
  // 7. HITUNG INTERVAL CANDLE
  // ============================================================
  const candleInterval = lastInputX - previousX;

  if (candleInterval <= 0) {
    console.warn('[prediction] interval candle tidak valid:', candleInterval);
    chart.update('none');
    return;
  }

  console.log('[prediction] previous X:', previousX);
  console.log('[prediction] last input X:', lastInputX);
  console.log('[prediction] candle interval:', candleInterval);

  // ============================================================
  // 8. BUAT X UNTUK CANDLE PREDICTION
  //
  // Candle prediction pertama: lastInputX + interval
  // Candle prediction terakhir: lastInputX + interval * outputCount
  // ============================================================
  const outputX = Array.from({ length: outputCount }, (_, i) => lastInputX + candleInterval * (i + 1));

  console.log('[prediction] output X:', outputX);

  // ============================================================
  // 9. LEVEL HARGA PREDICTION (avg_max_up/down = harga absolut)
  // ============================================================
  const upPrice = avgMaxUp;
  const downPrice = avgMaxDown;

  // ============================================================
  // 10. GARIS UP -- hanya kalau avg_max_up > 0
  // ============================================================
  if (avgMaxUp > 0) {
    const UP_COLOR = 'rgba(40, 200, 120, 1)';

    const upLineDataset = {
      label: 'prediction-up-line',
      type: 'line',
      data: outputX.map(x => ({ x: x, y: upPrice })),
      borderColor: UP_COLOR,
      backgroundColor: UP_COLOR,
      borderWidth: 3,
      pointRadius: 0,      // jangan tampilkan titik
      pointHoverRadius: 0,
      hitRadius: 10,       // tetap mudah di-hover
      fill: false,
      tension: 0,
      spanGaps: true,
      order: 90,
    };

    chart.data.datasets.push(upLineDataset);

    console.log('[prediction] UP line dibuat:', {
      price: upPrice,
      candles: outputCount,
      startX: outputX[0],
      endX: outputX[outputX.length - 1],
    });
  } else {
    console.log('[prediction] UP line tidak dibuat karena avg_max_up = 0');
  }

  // ============================================================
  // 11. GARIS DOWN -- hanya kalau avg_max_down > 0
  // ============================================================
  if (avgMaxDown > 0) {
    const DOWN_COLOR = 'rgba(220, 70, 70, 1)';

    const downLineDataset = {
      label: 'prediction-down-line',
      type: 'line',
      data: outputX.map(x => ({ x: x, y: downPrice })),
      borderColor: DOWN_COLOR,
      backgroundColor: DOWN_COLOR,
      borderWidth: 3,
      pointRadius: 0,
      pointHoverRadius: 0,
      hitRadius: 10,
      fill: false,
      tension: 0,
      spanGaps: true,
      order: 90,
    };

    chart.data.datasets.push(downLineDataset);

    console.log('[prediction] DOWN line dibuat:', {
      price: downPrice,
      candles: outputCount,
      startX: outputX[0],
      endX: outputX[outputX.length - 1],
    });
  } else {
    console.log('[prediction] DOWN line tidak dibuat karena avg_max_down = 0');
  }

  // ============================================================
  // 12. UPDATE CHART
  // ============================================================
  chart.update('none');
}

/**
 * Balikin warna candle ke normal.
 * Aman dipanggil walaupun highlight belum pernah digunakan.
 */
function clearPredictionHighlight() {
  if (typeof getCandleCanvas !== 'function') return;

  const chart = getCandleCanvas();
  if (!chart) return;

  const baseDataset = chart.data.datasets[0];
  if (!baseDataset) return;

  if (baseDataset._originalColor) {
    baseDataset.color = baseDataset._originalColor;
  }
  if (baseDataset._originalBorderColor !== undefined) {
    baseDataset.borderColor = baseDataset._originalBorderColor;
  }
}