
let candleChart = null;
let socket = null;

// jaga-jaga: sebagian build UMD chartjs-plugin-zoom butuh registrasi manual
if (typeof Chart !== "undefined" && typeof ChartZoom !== "undefined") {
    Chart.register(ChartZoom);
}

// jumlah candle yang ditampilkan (fokus) begitu data baru selesai di-load
const FOCUS_CANDLE_COUNT = 30;

/* =========================
   COIN COMBOBOX STATE
========================= */
const coinCombo = {
    symbols: [],          // semua symbol, misal ["btcusdt", "ethusdt"]
    filtered: [],          // hasil filter pencarian saat ini
    selected: null,        // symbol yang sedang aktif
    activeIndex: -1,       // index yang di-highlight lewat keyboard
    isOpen: false
};

let coinComboEls = {};

function initCoinCombo() {
    coinComboEls = {
        wrapper: document.getElementById("coinCombo"),
        trigger: document.getElementById("coinComboTrigger"),
        value: document.getElementById("coinComboValue"),
        panel: document.getElementById("coinComboPanel"),
        search: document.getElementById("coinComboSearch"),
        list: document.getElementById("coinComboList"),
        empty: document.getElementById("coinComboEmpty")
    };

    coinComboEls.trigger.addEventListener("click", () => {
        coinCombo.isOpen ? closeCoinCombo() : openCoinCombo();
    });

    coinComboEls.search.addEventListener("input", (e) => {
        filterCoinCombo(e.target.value);
    });

    coinComboEls.search.addEventListener("keydown", handleCoinComboKeydown);

    document.addEventListener("click", (e) => {
        if (coinCombo.isOpen && !coinComboEls.wrapper.contains(e.target)) {
            closeCoinCombo();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && coinCombo.isOpen) {
            closeCoinCombo();
            coinComboEls.trigger.focus();
        }
    });
}

function openCoinCombo() {
    coinCombo.isOpen = true;
    coinComboEls.panel.hidden = false;
    coinComboEls.trigger.setAttribute("aria-expanded", "true");
    coinComboEls.search.value = "";
    filterCoinCombo("");
    coinComboEls.search.focus();
}

function closeCoinCombo() {
    coinCombo.isOpen = false;
    coinComboEls.panel.hidden = true;
    coinComboEls.trigger.setAttribute("aria-expanded", "false");
    coinCombo.activeIndex = -1;
}

function filterCoinCombo(query) {
    const q = query.trim().toLowerCase();

    coinCombo.filtered = !q
        ? coinCombo.symbols
        : coinCombo.symbols.filter((s) => s.toLowerCase().includes(q));

    coinCombo.activeIndex = coinCombo.filtered.length > 0 ? 0 : -1;
    renderCoinComboList();
}

function renderCoinComboList() {
    const { list, empty } = coinComboEls;
    list.innerHTML = "";

    if (coinCombo.filtered.length === 0) {
        empty.hidden = false;
        return;
    }
    empty.hidden = true;

    coinCombo.filtered.forEach((symbol, index) => {
        const item = document.createElement("li");
        item.className = "coin-combo__item";
        item.role = "option";
        item.dataset.symbol = symbol;

        if (symbol === coinCombo.selected) item.classList.add("is-selected");
        if (index === coinCombo.activeIndex) item.classList.add("is-active");

        item.innerHTML = `
            <span class="coin-combo__item-dot" aria-hidden="true"></span>
            <span class="coin-combo__item-label">${symbol.toUpperCase()}</span>
        `;

        item.addEventListener("mouseenter", () => {
            coinCombo.activeIndex = index;
            updateActiveItemHighlight();
        });

        item.addEventListener("click", () => selectCoinSymbol(symbol));

        list.appendChild(item);
    });
}

function updateActiveItemHighlight() {
    const items = coinComboEls.list.querySelectorAll(".coin-combo__item");
    items.forEach((el, i) => {
        el.classList.toggle("is-active", i === coinCombo.activeIndex);
        if (i === coinCombo.activeIndex) {
            el.scrollIntoView({ block: "nearest" });
        }
    });
}

function handleCoinComboKeydown(e) {
    if (!coinCombo.isOpen) return;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        if (coinCombo.filtered.length === 0) return;
        coinCombo.activeIndex = (coinCombo.activeIndex + 1) % coinCombo.filtered.length;
        updateActiveItemHighlight();
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (coinCombo.filtered.length === 0) return;
        coinCombo.activeIndex =
            (coinCombo.activeIndex - 1 + coinCombo.filtered.length) % coinCombo.filtered.length;
        updateActiveItemHighlight();
    } else if (e.key === "Enter") {
        e.preventDefault();
        if (coinCombo.activeIndex >= 0) {
            selectCoinSymbol(coinCombo.filtered[coinCombo.activeIndex]);
        }
    }
}

function selectCoinSymbol(symbol) {
    coinCombo.selected = symbol;
    coinComboEls.value.textContent = symbol.toUpperCase();
    closeCoinCombo();
    coinComboEls.trigger.focus();
    handleChartSelectionChange();
}

/* =========================
   INIT CHART
========================= */
function getTimeUnit(interval) {
    switch (interval) {
        case "1m":
        case "5m":
        case "15m":
            return "minute";

        case "1h":
        case "4h":
            return "hour";

        case "1d":
            return "day";

        default:
            return "minute";
    }
}
function initCandleChart() {
    const ctx = document.getElementById("candleCanvas").getContext("2d");

    candleChart = new Chart(ctx, {
        type: "candlestick",
        data: {
            datasets: [{
                label: "Candles",
                data: []
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: true,

            // interaction menentukan gimana Chart.js nyari "titik terdekat"
            // buat tooltip. mode:'index' + intersect:false = hover di mana
            // aja deket sumbu-x tertentu bakal nemu titik terdekat di
            // dataset itu (nggak perlu presisi pas di atas titiknya).
            interaction: {
                mode: "x",
                intersect: false
            },

            plugins: {
                legend: { display: false },


                // drag buat geser (pan) kiri/kanan & atas/bawah,
                // scroll wheel / pinch buat zoom in-out
                zoom: {
                    pan: {
                        enabled: true,
                        mode: "xy"
                    },
                    zoom: {
                        wheel: { enabled: true },
                        pinch: { enabled: true },
                        mode: "xy"
                    }
                    // catatan: sengaja TIDAK di-set "limits" di sini.
                    // "limits: original" akan mengunci batas pan/zoom ke
                    // scales.x.min/max saat itu -- kalau kita juga men-set
                    // scales.x.min/max secara manual (misal buat fokus ke
                    // 30 candle terakhir), batas itu ikut jadi sempit dan
                    // user jadi tidak bisa scroll ke candle yang lebih lama.
                }
            },

            scales: {
                x: {
                    type: "time",
                    time: { unit: "minute" }
                },
                y: {
                    position: "right",
                    beginAtZero: false
                }
            }
        }
    });
}

/* =========================
   FORMAT CANDLE
========================= */
function formatCandle(c) {
    return {
        x: c.open_time,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close
    };
}

/* =========================
 GET CANVASJS OBJ
========================= */
function getCandleCanvas(){
    return candleChart
}


/* =========================
 GET CANDLES DATA
========================= */
function getCandlesData(){
    return candleChart.data.datasets[0].data;

}

/* =========================
   CREATE FIRST / NEW CANDLE
========================= */
function createNewCandle(candle) {
    candleChart.data.datasets[0].data.push(formatCandle(candle));
    candleChart.update("none");
}

/* =========================
   UPDATE CHART FROM WS
========================= */
closeCandleHandlers = new Set();

function addOnCloseCandleListener(callback) {
    closeCandleHandlers.add(callback);
}

function removeOnCloseCandleListener(callback) {
    closeCandleHandlers.delete(callback);
}

function onCloseCandle(candle,candleChart) {
    for (const handler of closeCandleHandlers) {
        try {
            handler(candle,candleChart);
        } catch (err) {
            console.error(err);
        }
    }
}
function handleCandle(candle) {
    if (!candleChart) return;

    const data = candleChart.data.datasets[0].data;

    /* RULE 1: first candle */
    if (data.length === 0) {
        createNewCandle(candle);
        return;
    }

    /* RULE 2: candle still forming → replace last */
    if (candle.is_closed === false) {
        data[data.length - 1] = formatCandle(candle);
        candleChart.update("none");
        return;
    }

    /* RULE 3: candle closed → finalize + create next */
    if (candle.is_closed === true) {

        data[data.length - 1] = formatCandle(candle);

        candleChart.update("none");

        onCloseCandle(data,candleChart)

        createNewCandle({
            open_time: candle.close_time,
            open: candle.close,
            high: candle.close,
            low: candle.close,
            close: candle.close
        });
    }
}
/* =========================
   SET FULL CANDLE DATA
========================= */
function setCandles(candles) {
    if (!candleChart) return;

    candleChart.data.datasets[0].data = candles.map(formatCandle);

    // reset pan/zoom balik ke rentang penuh dulu, biar chart "melihat"
    // seluruh data (bukan cuma window fokus dari load sebelumnya)
    if (typeof candleChart.resetZoom === "function") {
        candleChart.resetZoom("none");
    }

    candleChart.update();

    // baru setelah chart selesai render dengan rentang penuh, arahkan
    // viewport-nya ke N candle TERAKHIR (paling baru). Data candle lama
    // tetap ada di chart -- tinggal di-scroll/drag ke kiri buat lihat.
    focusLatestCandles(FOCUS_CANDLE_COUNT);
}

/* =========================
   FOKUS KE N CANDLE TERAKHIR (PALING BARU)
   dipanggil tiap kali data candle historis baru selesai di-load.
   Cuma menggeser viewport (pakai zoomScale), BUKAN memotong data --
   jadi user tetap bisa pan ke kiri untuk lihat candle yang lebih lama.
========================= */
function focusLatestCandles(count) {
    if (!candleChart || typeof candleChart.zoomScale !== "function") return;

    const data = candleChart.data.datasets[0].data;
    if (data.length === 0) return;

    const visibleCount = Math.min(count, data.length);
    const lastPoint = data[data.length - 1];
    const firstVisiblePoint = data[data.length - visibleCount];

    // sedikit padding kiri-kanan biar candle pertama/terakhir yang
    // kelihatan tidak mepet ke tepi chart
    const span = lastPoint.x - firstVisiblePoint.x;
    const step = visibleCount > 1 ? span / (visibleCount - 1) : 60 * 1000;
    const padding = step * 0.5;

    candleChart.zoomScale(
        "x",
        { min: firstVisiblePoint.x - padding, max: lastPoint.x + padding },
        "none"
    );
}

/* =========================
   COIN SYMBOL DROPDOWN
   endpoint: /get_coins_symbol -> list of string, misal ["btcusdt", "ethusdt"]
========================= */
async function loadCoinSymbols() {
    try {
        const response = await fetch("/get_coins_symbol");

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }

        const symbols = await response.json();
        populateCoinSelect(symbols);

        return symbols;
    } catch (error) {
        console.error("Failed to load coin symbols:", error);
        return [];
    }
}

function populateCoinSelect(symbols) {
    coinCombo.symbols = Array.isArray(symbols) ? symbols : [];

    if (coinCombo.symbols.length === 0) {
        coinComboEls.value.textContent = "Tidak ada coin";
        coinCombo.selected = null;
        return;
    }

    // default: pilih symbol pertama kalau belum ada yang dipilih
    if (!coinCombo.selected || !coinCombo.symbols.includes(coinCombo.selected)) {
        coinCombo.selected = coinCombo.symbols[0];
    }

    coinComboEls.value.textContent = coinCombo.selected.toUpperCase();
    filterCoinCombo("");
}

/* =========================
   BACA PILIHAN DROPDOWN
========================= */
function getSelectedSymbol() {
    return coinCombo.selected || "btcusdt";
}

function getSelectedInterval() {
    const select = document.getElementById("timeframeSelect");
    return select && select.value ? select.value : "1m";
}

/* =========================
   GANTI COIN / TIMEFRAME
   dipanggil tiap salah satu dropdown berubah
========================= */
async function handleChartSelectionChange() {
    const symbol = getSelectedSymbol();
    const interval = getSelectedInterval();

    // muat ulang data candle historis dulu (ini juga otomatis membuang
    // data candle lama di chart lewat setCandles)
    await loadCandles(symbol, interval);

    // baru setelah itu, pindah koneksi WS ke symbol/interval yang baru
    connectCandleWS(symbol, interval);
}

function initChartToolbar() {
    initCoinCombo();

    const timeframeSelect = document.getElementById("timeframeSelect");
    if (timeframeSelect) {
        timeframeSelect.addEventListener("change", handleChartSelectionChange);
    }
}

/* =========================
   FETCH CANDLES FROM FLASK
   endpoint: /candles/<symbol>/<interval>
========================= */
async function loadCandles(symbol = "btcusdt", interval = "1m") {
    try {

        const response = await fetch(`/candles/${symbol}/${interval}`);

        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }

        const candles = await response.json();

        candleChart.options.scales.x.time.unit = getTimeUnit(interval);

        setCandles(candles);

        return candles;

    } catch (error) {
        console.error("Failed to load candles:", error);
        return [];
    }
}
/* =========================
   WEBSOCKET CONNECT
========================= */
const WS_HOST = "127.0.0.1";
const WS_PORT = 5000;

let wsReconnectTimer = null;
let wsConnectionId = 0; // token unik tiap kali sengaja buka koneksi baru

/* Tutup koneksi WS yang sedang aktif (kalau ada) secara bersih:
   - batalkan auto-reconnect timer yang mungkin masih tertunda
   - lepas semua handler dulu sebelum close, supaya event close/message
     dari socket lama tidak lagi diproses
   - socket dipaksa null supaya tidak ada referensi nyangkut */
function closeCandleWS() {
    if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
    }

    if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;

        if (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        ) {
            socket.close();
        }

        socket = null;
    }
}

function connectCandleWS(symbol, interval, host = WS_HOST, port = WS_PORT) {
    // pastikan koneksi sebelumnya benar-benar diputus dulu sebelum buka yang baru
    closeCandleWS();

    // token koneksi ini, dipakai untuk memvalidasi bahwa event yang masuk
    // memang berasal dari koneksi yang masih "aktif" saat ini, bukan sisa
    // koneksi lama yang sempat tertunda (race condition saat ganti coin/interval cepat)
    const connectionId = ++wsConnectionId;

    // symbol & interval dikirim lewat path URL, sesuai route Flask:
    // /ws/<symbol>/<interval>
    const wsUrl = `ws://${host}:${port}/ws/${encodeURIComponent(symbol)}/${encodeURIComponent(interval)}`;
    const ws = new WebSocket(wsUrl);
    socket = ws;

    ws.onopen = () => {
        if (connectionId !== wsConnectionId) return; // sudah usang, abaikan
        console.log(`[WS] connected -> symbol=${symbol} interval=${interval}`);
    };

    ws.onmessage = (event) => {
        // buang pesan yang datang dari koneksi lama yang sudah tidak relevan
        if (connectionId !== wsConnectionId) return;

        try {
            const candle = JSON.parse(event.data);
            handleCandle(candle);
        } catch (e) {
            console.error("[WS] invalid message", event.data);
        }
    };

    ws.onclose = () => {
        // kalau koneksi ini sudah digantikan (ditutup sengaja karena ganti
        // coin/interval), jangan auto-reconnect pakai symbol/interval lama
        if (connectionId !== wsConnectionId) return;

        console.log("[WS] disconnected, reconnecting...");
        wsReconnectTimer = setTimeout(
            () => connectCandleWS(symbol, interval, host, port),
            2000
        );
    };

    ws.onerror = (err) => {
        if (connectionId !== wsConnectionId) return;
        console.error("[WS] error", err);
    };
}

/* =========================
   START APP
========================= */
async function startApp() {
    initCandleChart();
    initChartToolbar();

    await loadCoinSymbols();

    try {
        const symbol = getSelectedSymbol();
        const interval = getSelectedInterval();

        await loadCandles(symbol, interval);
        connectCandleWS(symbol, interval);
    } catch (error) {
        console.error("Failed to load candles:", error);
    }
}

startApp();
