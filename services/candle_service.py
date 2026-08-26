from bs4 import BeautifulSoup
import hashlib
import shutil
import requests
import zipfile
import csv
import json
from typing import Callable, Optional, Any
import websocket
import os
from database import database

from .scraping_manager import ScrapingCancelled



class ScrapeArchivedCoinCandles:

    def __init__(self, url, name=None):
        self.temp_dir = None
        self.database = database
        self.CandleRepository = self.database.CandleRepository
        self.url = url
        self.name = name
        self.job = None

    # ---------------------------------------------------------------
    # Helper log. Semua method lain cukup panggil self._log(message),
    # tidak perlu tahu atau meneruskan job sama sekali. self.job
    # di-set sekali di start(), method lain akses lewat sini.
    # ---------------------------------------------------------------
    def _log(self, message):
        print(message)
        if self.job is not None:
            self.job.add_log(message)

    # ---------------------------------------------------------------
    # Pengecekan cancel. Panggil ini di titik-titik aman (biasanya
    # di dalam loop yang berulang) supaya thread bisa berhenti sendiri
    # begitu /stop_scraping men-set job.cancel = True.
    # ---------------------------------------------------------------
    def _check_cancelled(self):
        if self.job is not None and self.job.cancel:
            raise ScrapingCancelled("Dibatalkan oleh pengguna")

    def extract_candle_urls(self, xml_data):
        xml_soup = BeautifulSoup(xml_data, "xml")

        result = []

        files = {}

        for key_tag in xml_soup.find_all("Key"):
            key = key_tag.text.strip()

            if key.endswith(".zip"):
                files.setdefault(key, {})["url"] = key

            elif key.endswith(".zip.CHECKSUM"):
                zip_key = key[:-9]  # remove ".CHECKSUM"
                files.setdefault(zip_key, {})["checksum"] = key

        for zip_key, data in files.items():
            if "url" in data:
                result.append({
                    "url": data["url"],
                    "checksum": data.get("checksum")
                })

        self._log(f"Ditemukan {len(result)} file candle di daftar.")

        return result

    def download_single_candle(self, zip_url, checksum_url, zip_filename, checksum_filename):
        attempt = 0

        while True:
            attempt += 1

            self._check_cancelled()

            # download zip
            response = requests.get(zip_url, stream=True)
            response.raise_for_status()

            with open(zip_filename, "wb") as f:
                for chunk in response.iter_content(8192):
                    f.write(chunk)

            # download checksum
            response = requests.get(checksum_url)
            response.raise_for_status()

            with open(checksum_filename, "wb") as f:
                f.write(response.content)

            # read expected checksum
            with open(checksum_filename, "r") as f:
                expected_checksum = f.read().strip().split()[0]

            # calculate actual checksum
            sha256 = hashlib.sha256()

            with open(zip_filename, "rb") as f:
                for block in iter(lambda: f.read(65536), b""):
                    sha256.update(block)

            actual_checksum = sha256.hexdigest()

            if actual_checksum.lower() == expected_checksum.lower():

                self._log("Checksum valid")

                return [{
                    "zip_file": zip_filename,
                    "checksum_file": checksum_filename
                }]

            self._log("Checksum mismatch, redownloading...")

            if os.path.exists(zip_filename):
                os.remove(zip_filename)

            if os.path.exists(checksum_filename):
                os.remove(checksum_filename)

    def download_candles(self, candle_urls, temp_dir=None):
        if temp_dir is None:
            temp_dir = self.temp_dir

        base_url = 'https://data.binance.vision/'

        # create temp folder
        os.makedirs(temp_dir, exist_ok=True)

        # clear temp folder
        for filename in os.listdir(temp_dir):

            filepath = os.path.join(temp_dir, filename)

            try:
                if os.path.isfile(filepath):
                    os.remove(filepath)

                elif os.path.isdir(filepath):
                    shutil.rmtree(filepath)

            except Exception as e:
                self._log(f"Failed deleting {filepath}: {e}")

        total = len(candle_urls)
        self._log(f"Mulai mengunduh {total} file candle...")

        candles_downloaded = []
        for index, candle_url in enumerate(candle_urls, start=1):
            self._check_cancelled()

            zip_url = base_url + candle_url["url"]
            checksum_url = base_url + candle_url["checksum"]

            zip_filename = os.path.join(
                temp_dir,
                zip_url.split("/")[-1]
            )

            checksum_filename = os.path.join(
                temp_dir,
                checksum_url.split("/")[-1]
            )

            path_download = self.download_single_candle(zip_url, checksum_url, zip_filename, checksum_filename)
            candles_downloaded.extend(path_download)

            self._log(f"Selesai unduh {index}/{total}: {zip_filename}")

            # progres tahap download di-skala 15-70% dari keseluruhan proses
            if self.job is not None and total > 0:
                self.job.set_progress(15 + int((index / total) * 55))

    def get_candles_xml(self, url_prefix):
        base_url = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"

        params = {
            "delimiter": "/",
            "prefix": url_prefix
        }

        all_contents = []
        first_soup = None

        self._log("Mengambil daftar file dari server...")

        while True:
            self._check_cancelled()

            response = requests.get(
                base_url,
                params=params,
                timeout=30
            )
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "xml")

            if first_soup is None:
                first_soup = soup

            # simpan semua <Contents>
            all_contents.extend(soup.find_all("Contents"))

            is_truncated = (
                soup.find("IsTruncated")
                and soup.find("IsTruncated").text.strip().lower() == "true"
            )

            if not is_truncated:
                break

            next_marker = soup.find("NextMarker")
            if next_marker is None:
                break

            params["marker"] = next_marker.text.strip()

            self._log("Mengambil halaman berikutnya...")

        # hapus Contents lama
        root = first_soup.find("ListBucketResult")
        for tag in root.find_all("Contents"):
            tag.extract()

        # ubah status menjadi selesai
        if root.find("IsTruncated"):
            root.find("IsTruncated").string = "false"

        if root.find("NextMarker"):
            root.find("NextMarker").string = ""

        # tambahkan semua Contents hasil gabungan
        for content in all_contents:
            root.append(content)

        return str(first_soup)

    def extract_candle_zip(self, temp_dir=None):
        if temp_dir is None:
            temp_dir = self.temp_dir

        extracted_files = []

        self._log("Mengekstrak file zip...")

        for filename in os.listdir(self.temp_dir):

            if not filename.lower().endswith(".zip"):
                continue

            zip_path = os.path.join(self.temp_dir, filename)

            with zipfile.ZipFile(zip_path, "r") as zip_ref:

                zip_ref.extractall(self.temp_dir)

                extracted_files.extend(
                    [
                        os.path.join(self.temp_dir, member)
                        for member in zip_ref.namelist()
                    ]
                )

            self._log(f"Selesai ekstrak: {filename}")

        return extracted_files

    def read_candle_csv(self, temp_dir=None):
        if temp_dir is None:
            temp_dir = self.temp_dir

        candles = []

        self._log("Membaca file CSV candle...")

        for filename in os.listdir(temp_dir):

            if not filename.lower().endswith(".csv"):
                continue

            csv_path = os.path.join(temp_dir, filename)

            with open(csv_path, "r", encoding="utf-8") as f:

                reader = csv.reader(f)

                for row in reader:

                    if len(row) < 11:
                        continue

                    candles.append({
                        "open_time": int(row[0]),
                        "open": float(row[1]),
                        "high": float(row[2]),
                        "low": float(row[3]),
                        "close": float(row[4]),
                        "volume": float(row[5]),
                        "close_time": int(row[6]),
                        "quote_asset_volume": float(row[7]),
                        "number_of_trades": int(row[8]),
                        "taker_buy_base_asset_volume": float(row[9]),
                        "taker_buy_quote_asset_volume": float(row[10])
                    })

        candles.sort(key=lambda candle: candle["open_time"])

        # preprocessing open price
        for i in range(1, len(candles)):
            candles[i]["open"] = candles[i - 1]["close"]

        self._log(f"Total {len(candles)} candle berhasil dibaca dari CSV.")

        return candles

    def add_coin(self, url_prefix, url,count_data=0):

        candle_repo = self.CandleRepository()
        id_coin = candle_repo.add_coin(url_prefix, url,count_data=count_data)

        self._log(f"Coin terdaftar dengan id: {id_coin}")

        return id_coin

    def add_candles(self, json_candles):

        candler_repo = self.CandleRepository()

        candler_repo.add_candle(json_candles)

        self._log(f"{len(json_candles)} candle disimpan ke database.")

    def start(self, job):
        self.job = job
        self.temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), str(self.job.client_id))

        try:
            self.job.set_running()
            self._log("Memulai proses scraping...")
            self.job.set_progress(0)

            url = self.url.strip()
            coin_name = self.name
            coins = self.CandleRepository().get_all_coin()

            if url in [coin["url_data"] for coin in coins]:
                raise ValueError(f"URL '{url}' already exists in the database.")
            print(url)
            url_prefix = url[url.find('prefix=') + 7:]

            xml_response = self.get_candles_xml(url_prefix)
            self.job.set_progress(10)

            candle_urls = self.extract_candle_urls(xml_response)
            self.job.set_progress(15)

            self.download_candles(candle_urls)

            self.extract_candle_zip()
            self.job.set_progress(80)

            json_candles = self.read_candle_csv()
            self.job.set_progress(90)

            if len(json_candles) > 0:
                if coin_name is None:
                    coin_name = url_prefix.replace('/', '_')
                id_coin = self.add_coin(coin_name, url,len(json_candles))

                for candle in json_candles:
                    candle['coin_id'] = id_coin
                self.add_candles(json_candles)
            else:
                self._log("Tidak ada candle yang ditemukan.")

            self.job.set_progress(100)

            shutil.rmtree(self.temp_dir, ignore_errors=True)
            self.job.finish()
            self._log("Proses scraping selesai.")

        except ScrapingCancelled as e:
            self.job.fail(str(e))
            shutil.rmtree(self.temp_dir, ignore_errors=True)

            self._log(f"Scraping dibatalkan: {e}")

        except Exception as e:
            self.job.fail(e)
            shutil.rmtree(self.temp_dir, ignore_errors=True)

            self._log(f"Scraping gagal: {e}")
            raise

    

class ScrapeLastCoinCandles:
    def __init__(self, symbol: str, interval: str):
        self.symbol = symbol.upper()
        self.interval = interval
        self.base_url = "https://api.binance.com"

    def build_url(self) -> str:
        return f"{self.base_url}/api/v3/klines"

    def parse_candles(self, row: list) -> dict:
        """
        Format row Binance /api/v3/klines:
        [
            0 open time,
            1 open,
            2 high,
            3 low,
            4 close,
            5 volume,
            6 close time,
            7 quote asset volume,
            8 number of trades,
            9 taker buy base asset volume,
            10 taker buy quote asset volume,
            11 ignore
        ]
        """
        return {
            "symbol": self.symbol,
            "interval": self.interval,
            "open_time": row[0],
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5]),
            "close_time": row[6],
            "quote_asset_volume": float(row[7]),
            "num_trades": int(row[8]),
            "taker_buy_base_asset_volume": float(row[9]),
            "taker_buy_quote_asset_volume": float(row[10]),
            "is_closed": True,  # historical candle pasti sudah closed
        }

    def get_candles(
        self,
        limit: int = 500,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> list[dict]:
        params = {
            "symbol": self.symbol,
            "interval": self.interval,
            "limit": limit,
        }

        if start_time is not None:
            params["startTime"] = start_time

        if end_time is not None:
            params["endTime"] = end_time

        response = requests.get(self.build_url(), params=params, timeout=30)
        response.raise_for_status()

        raw_klines = response.json()
        return [self.parse_candles(row) for row in raw_klines]
    

# ScrapeArchivedCoinCandles().perform_candle_scraper('https://data.binance.vision/?prefix=data/spot/daily/klines/BTCUSDT/1m/')