import uuid

from flask import Blueprint, jsonify, request, session

if __name__=="__main__":
    from ..services import model_manager

model = Blueprint("model", __name__)

manager = None


@model.record_once
def initialize_manager(state):
    global manager

    if not manager:
        manager = model_manager.ModelManager()


@model.route("/prepare_model", methods=["POST"])
def prepare_model():
    """
    Menerima parameter konfigurasi dari prediction.js
    (lihat getPredictFormValues() di prediction.js), lalu memakai
    ModelManager untuk membuat/menyiapkan object Model milik client
    saat ini (disimpan dengan key session["client_id"]).

    Body request yang diharapkan (JSON):
        {
            "coinId": "...",
            "k": 5,
            "threshold": 70,
            "inputLen": 10,
            "outputLen": 1
        }

    id_coin, window_size, future_size dipetakan dari coinId, inputLen,
    outputLen -- sesuai atribut yang dipakai ModelManager.create_model().

    NOTE: k & threshold masih diterima tapi BELUM dipakai di sini,
    karena ModelManager.create_model() saat ini cuma menyeting
    id_coin/window_size/future_size. Kalau k & threshold memang perlu
    disimpan di object Model juga, tinggal beri tahu -- akan disesuaikan.
    """
    data = request.get_json(silent=True) or {}

    id_coin = data.get("coinId")
    window_size = data.get("inputLen")
    future_size = data.get("outputLen")
    k = data.get("k")
    threshold = data.get("threshold")

    if id_coin is None or window_size is None or future_size is None:
        return jsonify({
            "success": False,
            "message": "coinId, inputLen, dan outputLen wajib diisi.",
        }), 400

    client_id = session["client_id"]

    manager.create_model(client_id, id_coin, window_size, future_size,k,threshold)

    return jsonify({
        "success": True,
        "client_id": client_id,
        "message": "Model berhasil disiapkan.",
    })


@model.route("/predict", methods=["POST"])
def predict():
    """
    Menjalankan prediksi lewat object Model milik client saat ini
    (ModelManager.predict() -> Model.predict(x)).

    Body request yang diharapkan (JSON):
        {
            "x": [...]   # data candle yang jadi input prediksi
        }

    NOTE: bentuk `x` dan bentuk hasil dari Model.predict(x) belum
    dijelaskan, jadi endpoint ini cuma meneruskan `x` apa adanya ke
    ModelManager.predict() dan mengembalikan hasilnya mentah-mentah
    lewat key "result". Sesuaikan lagi kalau bentuknya sudah pasti.
    """
    data = request.get_json(silent=True) or {}

    x = data.get("input")
    if x is None:
        return jsonify({
            "success": False,
            "message": "x wajib diisi.",
        }), 400

    client_id = session["client_id"]

    if not manager.has_model(client_id):
        return jsonify({
            "success": False,
            "message": "Model belum disiapkan. Panggil /prepare_model dulu.",
        }), 400

    result = manager.predict(client_id, x)
    if len(result)==0:
        return jsonify({
            "success": False,
            "message": "tidak menemukan jumlah data yang cocok ",
        })

    result,avg_max_down,avg_max_up = manager.predict(client_id, x)
    return jsonify({
        "success": True,
        "result": result,
        'avg_max_down':avg_max_down,
        'avg_max_up':avg_max_up
    })