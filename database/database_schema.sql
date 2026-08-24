CREATE TABLE IF NOT EXISTS coin (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    coin_pair_name TEXT NOT NULL UNIQUE,
    url_data TEXT,
    count_data INTEGER DEFAULT 0
);



CREATE TABLE IF NOT EXISTS candle (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    coin_id INTEGER NOT NULL,

    open_time INTEGER NOT NULL,

    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,

    volume REAL NOT NULL,

    close_time INTEGER NOT NULL,

    quote_asset_volume REAL,
    number_of_trades INTEGER,

    taker_buy_base_asset_volume REAL,
    taker_buy_quote_asset_volume REAL,

    FOREIGN KEY (coin_id) REFERENCES coin(id)
);