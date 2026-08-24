"""
websocket_manager.py

Registry global untuk WebSocketClient (koneksi upstream ke Binance).
Satu WebSocketClient dijalankan per kombinasi unik (symbol, interval),
dan dipakai bersama (shared) oleh semua local client Flask yang minta
symbol+interval yang sama -- jadi kalau ada 5 orang buka chart BTCUSDT 1m,
cuma ADA SATU koneksi ke Binance untuk itu, bukan 5.

Aturan lifecycle:
- subscribe()   -> kalau belum ada WebSocketClient utk (symbol, interval),
                    buat baru & jalankan di background thread (lazy start).
                    Kalau sudah ada, tinggal numpang (add_candle_listener).
- unsubscribe() -> lepas listener. Kalau itu listener TERAKHIR untuk
                    (symbol, interval) tsb, WebSocketClient-nya di-close()
                    dan dihapus dari registry (lazy stop). Nanti kalau ada
                    yang minta lagi, subscribe() akan buka ulang dari nol.
"""

from __future__ import annotations

import threading
from typing import Callable, Dict, Tuple,Optional,Any
import websocket
import json

CandleCallback = Callable[[dict], None]


class WebSocketManager:
    def __init__(self) -> None:
        # lock tunggal buat proteksi seluruh registry -- subscribe/unsubscribe
        # bisa dipanggil dari thread Flask yang berbeda-beda secara bersamaan
        self._lock = threading.Lock()

        # key: (symbol, interval) -> entry
        # entry = {"client": WebSocketClient, "thread": Thread, "ref_count": int}
        self._entries: Dict[Tuple[str, str], dict] = {}

    @staticmethod
    def _key(symbol: str, interval: str) -> Tuple[str, str]:
        return (symbol.lower(), interval)

    def subscribe(self, symbol: str, interval: str, callback: CandleCallback) -> WebSocketClient:
        """
        Daftarkan `callback` untuk menerima candle dari (symbol, interval).
        Kalau upstream WebSocketClient utk pasangan ini belum jalan,
        otomatis dibuat & di-start di background thread.

        Return: instance WebSocketClient yang dipakai (simpan reference-nya
        kalau perlu, tapi untuk unsubscribe cukup panggil manager.unsubscribe
        dengan symbol/interval/callback yang sama).
        """
        key = self._key(symbol, interval)

        with self._lock:
            entry = self._entries.get(key)

            if entry is None:
                client = WebSocketClient(symbol=symbol, interval=interval)
                thread = threading.Thread(
                    target=client.start,
                    name=f"binance-ws-{symbol.lower()}-{interval}",
                    daemon=True,
                )
                entry = {"client": client, "thread": thread, "ref_count": 0}
                self._entries[key] = entry

                client.add_candle_listener(callback)
                entry["ref_count"] += 1

                thread.start()
                print(f"[WS MANAGER] START upstream -> {symbol.upper()} {interval} "
                      f"(ref_count={entry['ref_count']})")
            else:
                entry["client"].add_candle_listener(callback)
                entry["ref_count"] += 1
                print(f"[WS MANAGER] REUSE upstream -> {symbol.upper()} {interval} "
                      f"(ref_count={entry['ref_count']})")

            return entry["client"]

    def unsubscribe(self, symbol: str, interval: str, callback: CandleCallback) -> None:
        """
        Lepas `callback` dari (symbol, interval). Kalau ref_count jadi 0
        (tidak ada local client lain yang masih dengar), upstream
        WebSocketClient ditutup & dihapus dari registry.
        """
        key = self._key(symbol, interval)

        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                # sudah tidak ada entry (mungkin sudah di-cleanup sebelumnya)
                return

            entry["client"].remove_candle_listener(callback)
            entry["ref_count"] -= 1

            print(f"[WS MANAGER] UNSUB -> {symbol.upper()} {interval} "
                  f"(ref_count={entry['ref_count']})")

            if entry["ref_count"] <= 0:
                entry["client"].close()
                del self._entries[key]
                print(f"[WS MANAGER] STOP upstream (tidak ada listener) -> "
                      f"{symbol.upper()} {interval}")

    def active_streams(self) -> list[dict]:
        """Opsional: buat debugging / endpoint monitoring, lihat stream yg aktif."""
        with self._lock:
            return [
                {"symbol": s, "interval": i, "listeners": e["ref_count"]}
                for (s, i), e in self._entries.items()
            ]

class WebSocketClient:
    """
    WebSocket client untuk stream kline/candlestick Binance.
    """

    def __init__(
        self,
        symbol: str,
        interval: str,
        on_candle: Optional[Callable[[dict], Any]] = None,
    ) -> None:
        self.symbol = symbol.lower()
        self.interval = interval
        self.ws: Optional[websocket.WebSocketApp] = None

        self._candle_listeners: list[Callable[[dict], Any]] = []

        if on_candle is not None:
            self._candle_listeners.append(on_candle)

    def add_candle_listener(self, callback: Callable[[dict], Any]) -> None:
        self._candle_listeners.append(callback)

    def remove_candle_listener(self, callback: Callable[[dict], Any]) -> None:
        if callback in self._candle_listeners:
            self._candle_listeners.remove(callback)

    def build_url(self) -> str:
        return f"wss://stream.binance.com:9443/ws/{self.symbol}@kline_{self.interval}"

    def parse_candle_message(self, message: str) -> dict:
        data = json.loads(message)
        k = data.get("k", {})

        candle = {
            "event_type": data.get("e"),
            "event_time": data.get("E"),
            "symbol": k.get("s"),
            "interval": k.get("i"),
            "open_time": k.get("t"),
            "close_time": k.get("T"),
            "open": float(k["o"]) if "o" in k else None,
            "high": float(k["h"]) if "h" in k else None,
            "low": float(k["l"]) if "l" in k else None,
            "close": float(k["c"]) if "c" in k else None,
            "volume": float(k["v"]) if "v" in k else None,
            "is_closed": k.get("x", False),
            "num_trades": k.get("n"),
            "quote_asset_volume": float(k["q"]) if "q" in k else None,
            "taker_buy_base_asset_volume": float(k["V"]) if "V" in k else None,
            "taker_buy_quote_asset_volume": float(k["Q"]) if "Q" in k else None,
        }
        return candle

    def emit_candle(self, candle: dict) -> None:
        for callback in self._candle_listeners:
            callback(candle)

    def on_open(self, ws: websocket.WebSocketApp) -> None:
        print(f"[BINANCE WS OPEN] {self.symbol.upper()} {self.interval}")

    def on_message(self, ws: websocket.WebSocketApp, message: str) -> None:
        candle = self.parse_candle_message(message)
        self.emit_candle(candle)

    def on_error(self, ws: websocket.WebSocketApp, error: Exception) -> None:
        print(f"[BINANCE WS ERROR] {self.symbol.upper()} {self.interval} -> {error}")

    def on_close(
        self,
        ws: websocket.WebSocketApp,
        close_status_code: int,
        close_msg: str,
    ) -> None:
        print(
            f"[BINANCE WS CLOSED] {self.symbol.upper()} {self.interval} "
            f"status={close_status_code}, msg={close_msg}"
        )

    def start(self) -> None:
        self.ws = websocket.WebSocketApp(
            self.build_url(),
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close,
        )
        self.ws.run_forever()

    def close(self) -> None:
        if self.ws is not None:
            self.ws.close()


# instance singleton yang dipakai di seluruh app
ws_manager = WebSocketManager()