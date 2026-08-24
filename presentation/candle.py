from flask import Blueprint, jsonify


if __name__=='__main__':
    from ..services import candle_service,coin_service


candle = Blueprint("candle", __name__)

@candle.route("/candles/<symbol>/<interval>")
def get_candles(symbol, interval):

    candles = candle_service.ScrapeLastCoinCandles(
        symbol,
        interval
    ).get_candles(limit=100)

    return jsonify(candles)


@candle.route("/get_coins_symbol")
def get_symbol_pair_coins():

    symbol = coin_service.CoinServices().get_symbol_pair_coins()

    return jsonify(symbol)


@candle.route("/get_all_coins")
def get_coins():

    coins = coin_service.CoinServices().get_all_coin()

    return jsonify(coins)


@candle.route("/delete_coin/<int:coin_id>", methods=["DELETE"])
def delete_coin(coin_id):

    deleted = coin_service.CoinServices().delete_coin(coin_id)

    if not deleted:
        return jsonify({
            "success": False,
            "message": "Coin not found."
        }), 404

    return jsonify({
        "success": True
    })