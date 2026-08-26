from database import database
import requests


class CoinServices:

    
    def get_all_coin(self):
        return database.CoinRepository().get_all_coin()

    def get_symbol_pair_coins(self):
        try:
            BINANCE_EXCHANGE_INFO = "https://api.binance.com/api/v3/exchangeInfo"

            response = requests.get(BINANCE_EXCHANGE_INFO, timeout=30)
            response.raise_for_status()

            symbols = response.json()["symbols"]

            return [
                symbol["symbol"]
                for symbol in symbols
                if symbol["status"] == "TRADING"
            ]
        except:
            return []
    def delete_coin(self, coin_id):
        return database.CoinRepository().delete_coin(coin_id)
    



