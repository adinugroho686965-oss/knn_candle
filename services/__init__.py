
from . import candle_service
from . import coin_service
from . import scraping_manager
from . import websocket_manager
from . import model_manager



def has_accest_to(database,machine_learning):
    candle_service.database=database.database
    coin_service.database=database.database
    model_manager.model = machine_learning.model