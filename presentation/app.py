if __name__=='__main__':
    from ..services import candle_service
from flask import Flask, render_template, jsonify
from flask import session
from .candle import candle
from .model import model
from .candle_stream import register_candle_ws
from .scraping import scraping
import uuid
from flask_sock import Sock


app = Flask(__name__)

sock = Sock(app)

app.secret_key = "random"

@app.before_request
def create_session():

    if "client_id" not in session:
        session["client_id"] = str(uuid.uuid4())


@app.route("/")
def index():
    return render_template("layout.html")



def run_app():
    register_candle_ws(sock=sock)
    app.register_blueprint(candle)
    app.register_blueprint(model)
    app.register_blueprint(scraping)
    app.run(threaded=True)

