// ========== PREDICTION_ANALYSIS.JS — "Prediction (Analysis)" section logic ==========
//
// Difference from prediction.js (auto forward-test version):
//   - Does NOT subscribe to onCloseCandle / auto-run on every candle close.
//   - The user triggers prediction manually via the #predict-run-last-n-btn button.
//   - The N candles used as input = `inputLen` from the model config
//     (the "Model Configuration" form above), taken from the LAST N candles
//     on the chart (getCandlesData()).
//   - The #predict-include-unclosed checkbox determines whether the last,
//     not-yet-closed candle is included as input or not.
//   - The prediction result, besides being rendered in the panel, is also
//     visualized on the candle chart via visualizePredictionOnChart().
//
// Dependency from candle.js (must be loaded before this script):
//   - getCandleCanvas() -> Chart.js instance (candleChart)
//   - getCandlesData()  -> candle array, candleChart.data.datasets[0].data

let currentModelConfig = null; // { coinId, k, threshold, inputLen, outputLen }

document.addEventListener('DOMContentLoaded', () => {
  initPredictForm();
  initManualPredictButton();
  loadCoinsForPrediction();
});

/* ================= MODEL CONFIGURATION FORM ================= */

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

/* ================= COIN LIST (dropdown) ================= */

function loadCoinsForPrediction() {
  fetch('/get_all_coins')
    .then(res => res.json())
    .then(coins => renderCoinOptions(coins))
    .catch(err => {
      console.error('Failed to load coin list for prediction:', err);
      const select = document.getElementById('predict-coin-select');
      if (select) select.innerHTML = '<option value="">Failed to load coins</option>';
    });
}

function renderCoinOptions(coins) {
  const select = document.getElementById('predict-coin-select');
  if (!select) return;

  if (!coins || coins.length === 0) {
    select.innerHTML = '<option value="">No coins saved yet</option>';
    return;
  }

  select.innerHTML = coins
    .map(coin => `<option value="${coin.id}">${escapeHtml(coin.coin_pair_name)} (${coin.count_data ?? 0} candles)</option>`)
    .join('');
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

/* ================= STATUS PILL ================= */

const STATUS_MAP = {
  idle:       { label: 'Ready',              css: 'idle'    },
  preparing:  { label: 'Preparing model...', css: 'running' },
  ready:      { label: 'Model ready',        css: 'done'    },
  predicting: { label: 'Predicting...',      css: 'running' },
  done:       { label: 'Prediction complete',css: 'done'    },
  error:      { label: 'Failed',             css: 'error'   },
};

function setPredictStatus(stateKey) {
  const statusEl = document.getElementById('predict-status');
  if (!statusEl) return;
  const info = STATUS_MAP[stateKey] || { label: stateKey, css: 'idle' };
  statusEl.textContent = info.label;
  statusEl.dataset.state = info.css;
}

/* ================= RESULT STATE TOGGLE ================= */

function toggleResultState(hasResult) {
  const empty = document.getElementById('predict-result-empty');
  const filled = document.getElementById('predict-result-filled');
  if (empty) empty.hidden = hasResult;
  if (filled) filled.hidden = !hasResult;
}

/* ================= PREPARE MODEL (form submit button) ================= */

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
        console.error('Failed to prepare model:', data && data.message);
        return;
      }

      currentModelConfig = params;
      setPredictStatus('ready');
      toggleResultState(false);
      updateManualHint();
    })
    .catch(err => {
      setPredictStatus('error');
      console.error('Failed to reach the server while preparing the model:', err);
    })
    .finally(() => {
      if (btn) btn.disabled = false;
    });
}

function updateManualHint() {
  const hintEl = document.getElementById('predict-manual-hint');
  if (!hintEl) return;
  if (currentModelConfig) {
    hintEl.textContent = `N = ${currentModelConfig.inputLen} (currently active model's Input Length).`;
  } else {
    hintEl.textContent = 'N = Input Length from the model configuration above.';
  }
}

/* ================= "PREDICT LAST N CANDLE" BUTTON ================= */

function initManualPredictButton() {
  const btn = document.getElementById('predict-run-last-n-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    predictLastNCandles();
  });
}

/**
 * Entry point for the "Predict Last N Candle" button.
 * N is taken from currentModelConfig.inputLen.
 * The #predict-include-unclosed checkbox determines whether the last,
 * not-yet-closed candle is included as part of the N input candles.
 */
function predictLastNCandles() {
  if (!currentModelConfig) {
    alert('Model has not been prepared yet. Click "Prepare Model" first.');
    return;
  }

  const includeUnclosed = document.getElementById('predict-include-unclosed')?.checked || false;
  const { inputLen } = currentModelConfig;

  const x = getInputCandles(inputLen, includeUnclosed);

  if (!x || x.length < inputLen) {
    alert(`Not enough candles for prediction. Need ${inputLen} candles, only ${x ? x.length : 0} available.`);
    return;
  }

  runPredictionFromCandles(x);
}

/**
 * Get the last `inputLen` candles from the chart (via getCandlesData()),
 * with the option to include/exclude the last, not-yet-closed candle.
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
 * TODO: adjust this to match how candle.js marks a candle as not yet closed
 * (e.g. a `candle.closed` flag, or comparing `candle.x`/timestamp
 * against the current real-time clock).
 *
 * NOTE: currently defaults to `false` (the last candle is always
 * treated as NOT closed) -- meaning if the "include unclosed candle"
 * checkbox is NOT checked, the very last candle is ALWAYS dropped
 * from the input, regardless of its actual state. Replace this logic
 * once you have a reliable way to detect a candle's closed status.
 */
function isCandleClosed(candle) {
  // TODO: implement according to this project's candle data structure.
  return false;
}

/* ================= RUN PREDICTION (manual) ================= */

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
        console.error('Failed to run prediction:', data && data.message);
        return;
      }

      const summary = summarizePredictionResults(data.result);
      renderPredictionResult(summary, x);
      setPredictStatus('done');
      visualizePredictionOnChart(data, summary, x);
    })
    .catch(err => {
      setPredictStatus('error');
      console.error('Failed to reach the server during prediction:', err);
    });
}

/* ================= /predict RESULT AGGREGATION ================= */

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

/* ================= RENDER PREDICTION RESULT (panel) ================= */

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
  if (directionLabel) directionLabel.textContent = isUp ? 'UP' : 'DOWN';
  if (confidenceEl) confidenceEl.textContent = `${summary.confidence}%`;

  if (upEl) upEl.textContent = summary.upCount;
  if (downEl) downEl.textContent = summary.downCount;

  const dominantCount = isUp ? summary.upCount : summary.downCount;
  if (dominanceTextEl) dominanceTextEl.textContent = `${summary.dominancePct}% (${dominantCount}/${summary.total})`;
  if (dominanceFillEl) dominanceFillEl.style.width = `${summary.dominancePct}%`;

  if (metaEl) {
    const lastCandle = inputCandles && inputCandles.length ? inputCandles[inputCandles.length - 1] : null;
    const label = lastCandle && lastCandle.time ? lastCandle.time : (lastCandle && lastCandle.x ? lastCandle.x : 'last candle');
    metaEl.textContent = `Run manually after ${label}, from ${summary.total} neighbors`;
  }
}

/* ================= VISUALIZATION ON CANDLE CHART ================= */

/**
 * Draws the prediction result on top of the candle chart (candleChart, via
 * getCandleCanvas()):
 *   1. Input line (close price of each input candle) -- orange.
 *   2. UP target line -- green, only when avg_max_up > 0.
 *   3. DOWN target line -- red, only when avg_max_down > 0.
 *
 * Old datasets with the labels below are removed each time this function
 * is called, so leftovers from previous runs don't pile up.
 */
function visualizePredictionOnChart(data, summary, inputCandles) {
  if (!inputCandles || inputCandles.length === 0) return;

  if (typeof getCandleCanvas !== 'function') {
    console.warn(
      'getCandleCanvas() not found -- make sure candle.js is loaded before prediction_analysis.js.'
    );
    return;
  }

  const chart = getCandleCanvas();
  if (!chart) return;

  // ============================================================
  // Clear candle highlights if any (leftover from the old recolor approach)
  // ============================================================
  clearPredictionHighlight();

  // ============================================================
  // Remove the prediction overlay from the previous run
  // ============================================================
  chart.data.datasets = chart.data.datasets.filter(ds =>
    !['prediction-input-line', 'prediction-up-line', 'prediction-down-line'].includes(ds.label)
  );

  // ============================================================
  // 1. INPUT LINE
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
  // 2. GET PREDICTION VALUES
  // ============================================================
  const avgMaxUp = Number(data?.avg_max_up ?? 0);
  const avgMaxDown = Number(data?.avg_max_down ?? 0);

  console.log('[prediction] avg_max_up:', avgMaxUp);
  console.log('[prediction] avg_max_down:', avgMaxDown);

  // ============================================================
  // 3. GET PREDICTION RESULT
  // ============================================================
  const predictionResult = data?.result;

  if (!Array.isArray(predictionResult) || predictionResult.length === 0) {
    console.warn('[prediction] result is empty, prediction line not created.');
    chart.update('none');
    return;
  }

  // ============================================================
  // 4. OUTPUT CANDLE COUNT
  //
  // NOT predictionResult.length -- taken from
  // predictionResult[0].future_scaled.length
  // ============================================================
  const outputCount = predictionResult[0]?.future_scaled?.length || 0;

  if (outputCount <= 0) {
    console.warn('[prediction] future_scaled is empty or not found.');
    chart.update('none');
    return;
  }

  console.log('[prediction] output candle count:', outputCount);

  // ============================================================
  // 5. MAKE SURE THERE ARE AT LEAST 2 INPUT CANDLES
  // ============================================================
  if (inputCandles.length < 2) {
    console.warn('[prediction] at least 2 input candles are needed to compute the interval.');
    chart.update('none');
    return;
  }

  // ============================================================
  // 6. GET THE LAST 2 INPUT CANDLES
  // ============================================================
  const previousInputCandle = inputCandles[inputCandles.length - 2];
  const lastInputCandle = inputCandles[inputCandles.length - 1];

  const previousX = Number(previousInputCandle.x);
  const lastInputX = Number(lastInputCandle.x);

  if (!Number.isFinite(previousX) || !Number.isFinite(lastInputX)) {
    console.warn('[prediction] invalid input candle X:', { previousX, lastInputX });
    chart.update('none');
    return;
  }

  // ============================================================
  // 7. CALCULATE CANDLE INTERVAL
  // ============================================================
  const candleInterval = lastInputX - previousX;

  if (candleInterval <= 0) {
    console.warn('[prediction] invalid candle interval:', candleInterval);
    chart.update('none');
    return;
  }

  console.log('[prediction] previous X:', previousX);
  console.log('[prediction] last input X:', lastInputX);
  console.log('[prediction] candle interval:', candleInterval);

  // ============================================================
  // 8. BUILD X VALUES FOR PREDICTION CANDLES
  //
  // First prediction candle: lastInputX + interval
  // Last prediction candle: lastInputX + interval * outputCount
  // ============================================================
  const outputX = Array.from({ length: outputCount }, (_, i) => lastInputX + candleInterval * (i + 1));

  console.log('[prediction] output X:', outputX);

  // ============================================================
  // 9. PREDICTION PRICE LEVELS (avg_max_up/down = absolute price)
  // ============================================================
  const upPrice = avgMaxUp;
  const downPrice = avgMaxDown;

  // ============================================================
  // 10. UP LINE -- only if avg_max_up > 0
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
      pointRadius: 0,      // don't show points
      pointHoverRadius: 0,
      hitRadius: 10,       // still easy to hover
      fill: false,
      tension: 0,
      spanGaps: true,
      order: 90,
    };

    chart.data.datasets.push(upLineDataset);

    console.log('[prediction] UP line created:', {
      price: upPrice,
      candles: outputCount,
      startX: outputX[0],
      endX: outputX[outputX.length - 1],
    });
  } else {
    console.log('[prediction] UP line not created because avg_max_up = 0');
  }

  // ============================================================
  // 11. DOWN LINE -- only if avg_max_down > 0
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

    console.log('[prediction] DOWN line created:', {
      price: downPrice,
      candles: outputCount,
      startX: outputX[0],
      endX: outputX[outputX.length - 1],
    });
  } else {
    console.log('[prediction] DOWN line not created because avg_max_down = 0');
  }

  // ============================================================
  // 12. UPDATE CHART
  // ============================================================
  chart.update('none');
}

/**
 * Revert candle colors back to normal.
 * Safe to call even if the highlight was never used.
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