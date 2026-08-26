import threading
from flask import Blueprint
from flask import jsonify,request
from flask import session


from services import candle_service,scraping_manager
    


scraping = Blueprint("scraping", __name__)

manager = None
@scraping.record_once
def initialize_manager(state):
    global manager

    if not manager:
        manager = scraping_manager.ScrapingManager()


@scraping.route("/start_scraping", methods=["POST"])
def start_scraping():
    client_id = session["client_id"]
    post_data=data = request.get_json() 
    started = manager.start(
        client_id,
        candle_service.ScrapeArchivedCoinCandles(post_data.get('url'),post_data.get('name',None))
    )

    if not started:

        return jsonify({
            "success": False,
            "message": "Scraping already running."
        }), 400

    return jsonify({
        "success": True
    })


@scraping.route("/scraping_status")
def scraping_status():

    client_id = session["client_id"]

    job = manager.get_job(client_id)

    if job is None:

        return jsonify({
            "status": "idle"
        })

    return jsonify(job.to_dict())


@scraping.route("/stop_scraping", methods=["POST"])
def stop_scraping():
    client_id = session["client_id"]
    job = manager.get_job(client_id)

    if job is None or job.status != "running":
        return jsonify({
            "success": False,
            "message": "No scraping in progress."
        }), 400

    job.cancel = True

    return jsonify({
        "success": True
    })