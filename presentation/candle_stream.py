"""
websocket_routes.py

Route WebSocket sisi Flask: /ws/<symbol>/<interval>

Contoh dari client:
    ws://127.0.0.1:8765/ws/btcusdt/1m
    ws://127.0.0.1:8765/ws/ethusdt/15m

Alur tiap koneksi masuk:
1. Ambil symbol & interval dari path URL.
2. Daftarkan callback ke WebSocketManager (subscribe). Manager akan
   reuse WebSocketClient yang sudah jalan kalau ada, atau bikin baru
   kalau belum ada yang stream symbol+interval itu.
3. Loop nunggu koneksi client putus (ws.receive() return None saat client
   disconnect).
4. Begitu putus -> unsubscribe dari manager. Kalau ini listener terakhir
   untuk symbol+interval itu, manager otomatis menutup koneksi ke Binance.

Cara pasang ke Flask app kamu yang sudah ada:

    from flask import Flask
    from flask_sock import Sock
    from websocket_routes import register_candle_ws

    app = Flask(__name__)
    sock = Sock(app)
    register_candle_ws(sock)

    if __name__ == "__main__":
        app.run(host="127.0.0.1", port=8765, threaded=True)

Install dependency:
    pip install flask-sock
"""

from __future__ import annotations

import json
from services.websocket_manager import ws_manager

# daftar interval yang valid, biar tidak asal buka koneksi ke Binance
# kalau ada typo / request iseng
VALID_INTERVALS = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"}


def register_candle_ws(sock) -> None:
    """Daftarkan route WS candle ke instance flask_sock.Sock yang dikasih."""

    @sock.route("/ws/<symbol>/<interval>")
    def candle_ws(ws, symbol: str, interval: str) -> None:
        symbol = symbol.lower().strip()
        interval = interval.strip()

        if not symbol or interval not in VALID_INTERVALS:
            ws.send(json.dumps({"error": "symbol atau interval tidak valid"}))
            ws.close()
            return

        # callback ini dipanggil dari thread upstream Binance (bukan thread
        # request Flask ini), tiap kali ada candle baru masuk
        def on_candle(candle: dict) -> None:
            try:
                ws.send(json.dumps(candle))
            except Exception:
                # koneksi client kemungkinan sudah putus di tengah jalan,
                # biarkan saja -- loop di bawah yang akan mendeteksi &
                # men-trigger unsubscribe lewat blok finally
                pass

        ws_manager.subscribe(symbol, interval, on_candle)
        print(f"[WS ROUTE] client connect -> {symbol.upper()} {interval}")

        try:
            while True:
                # nunggu dari sisi client. Kita tidak butuh isi pesannya
                # (symbol/interval sudah dari path), ini cuma dipakai
                # untuk mendeteksi kapan client disconnect.
                message = ws.receive()
                if message is None:
                    break
        finally:
            ws_manager.unsubscribe(symbol, interval, on_candle)
            print(f"[WS ROUTE] client disconnect -> {symbol.upper()} {interval}")