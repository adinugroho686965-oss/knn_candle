from . import app
from . import candle
from . import candle_stream
from . import scraping
from . import model



def has_accest_to(services):
    app.candle_service=services.candle_service
    candle.candle_service=services.candle_service
    candle.coin_service=services.coin_service
    candle_stream.ws_manager=services.websocket_manager.ws_manager
    model.model_manager=services.model_manager
    scraping.candle_service=services.candle_service
    scraping.scraping_manager=services.scraping_manager
    