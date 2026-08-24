# database/database.py

import sqlite3
import os

class DataBase:

    def __init__(self, db_name="crypto.db"):

        db_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            db_name
        )

        self.connection = sqlite3.connect(db_path)

        self.build_database()

    def execute(self, query, params=()):
        cursor = self.connection.cursor()
        return cursor.execute(query, params)

    def commit(self):
        self.connection.commit()

    def close(self):
        self.connection.close()

    def build_database(self):

        schema_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "database_schema.sql"
        )

        with open(schema_path, "r", encoding="utf-8") as file:
            schema_sql = file.read()

        self.connection.executescript(schema_sql)
        self.connection.commit()
        
class CoinRepository:
    def __init__(self):

        self.database = DataBase()

    def get_all_coin(self):
        query = """
            SELECT id, coin_pair_name, url_data, count_data
            FROM coin
            ORDER BY id DESC
        """

        cursor = self.database.execute(query)
        rows = cursor.fetchall()

        coins = []
        for row in rows:
            coins.append({
                "id": row[0],
                "coin_pair_name": row[1],
                "url_data": row[2],
                "count_data": row[3],
            })

        return coins

    def add_coin(self, coin_pair_name, url_data=None, count_data=0):

        query = """
        INSERT INTO coin (
            coin_pair_name,
            url_data,
            count_data
        )
        VALUES (?, ?, ?)
        """

        cursor = self.database.execute(
            query,
            (
                coin_pair_name,
                url_data,
                count_data
            )
        )
        self.database.commit()

        return cursor.lastrowid

    def delete_coin(self, coin_id):
        # hapus candle dulu, karena candle punya FOREIGN KEY ke coin.id
        delete_candles_query = """
            DELETE FROM candle
            WHERE coin_id = ?
        """
        self.database.execute(delete_candles_query, (coin_id,))

        # baru hapus coin-nya
        delete_coin_query = """
            DELETE FROM coin
            WHERE id = ?
        """
        cursor = self.database.execute(delete_coin_query, (coin_id,))

        # satu commit untuk keduanya, supaya candle & coin
        # sama-sama terhapus atau sama-sama tidak (atomik)
        self.database.commit()

        return cursor.rowcount > 0

class CandleRepository(CoinRepository):

    def __init__(self):

        super().__init__()

    def add_candle(self, value):

        for row in value:

            columns = ", ".join(row.keys())

            placeholders = ", ".join(["?"] * len(row))

            query = f"""
            INSERT INTO candle ({columns})
            VALUES ({placeholders})
            """

            self.database.execute(
                query,
                tuple(row.values())
            )
        self.database.commit()


    
    def delete_candle(self):

        pass

    def get_candles(self, coin_id):
        cursor = self.database.connection.cursor()

        cursor.execute("""
            SELECT
                id,
                coin_id,
                open_time,
                open,
                high,
                low,
                close,
                volume,
                close_time,
                quote_asset_volume,
                number_of_trades,
                taker_buy_base_asset_volume,
                taker_buy_quote_asset_volume
            FROM candle
            WHERE coin_id = ?
            ORDER BY open_time ASC
        """, (coin_id,))

        columns = [column[0] for column in cursor.description]

        return [dict(zip(columns, row)) for row in cursor.fetchall()]


