from machine_learning import model 


class ModelManager:
    """
    Mengelola object Model (dari ..machine_learning.Model) per-client.

    ModelManager TIDAK mengakses session Flask secara langsung -- semua
    method di sini menerima `client_id` sebagai parameter, dan script
    yang memakai ModelManager-lah yang bertanggung jawab memberikan
    session["client_id"] itu.

    Object Model disimpan dalam dictionary internal dengan key client_id,
    jadi tiap client punya object Model sendiri-sendiri.

    NOTE: dictionary ini disimpan di memori proses -- akan hilang kalau
    server di-restart, dan tidak cocok dipakai multi-proses/multi-worker
    tanpa penyesuaian tambahan (mis. pindah ke penyimpanan eksternal).
    """

    def __init__(self):
        self._models = {}
        self.k = None
        self.threshold = None

    # ================= CREATE / DELETE =================

    def create_model(self, client_id, id_coin, window_size, future_size,k,threshold):
        """
        Membuat object Model baru untuk `client_id` dan menyimpannya
        ke dictionary (menimpa object lama kalau sudah ada).

        Parameter:
            client_id    : id unik client (dari session["client_id"])
            id_coin      : id koin yang dipakai model
            window_size  : panjang input candle
            future_size  : panjang output candle (candle yang diprediksi)
        """

        self.k = k
        self.threshold=threshold
        model_obj = model.Model(k)
        model_obj.id_coin = id_coin
        model_obj.window_size = window_size
        model_obj.future_size = future_size
        model_obj.prepare_model()

        self._models[client_id] = model_obj
        return model_obj

    def delete_model(self, client_id):
        """
        Hapus object Model milik `client_id` dari dictionary.
        Aman dipanggil walau object-nya belum/tidak ada.
        """
        self._models.pop(client_id, None)

    def has_model(self, client_id):
        """Cek apakah `client_id` sudah punya object Model."""
        return client_id in self._models

    # ================= AKSES MODEL =================

    def get_model(self, client_id, id_coin=None, window_size=None, future_size=None):
        """
        Ambil object Model milik `client_id`.
        Kalau belum ada, otomatis dibuatkan dulu lewat create_model()
        (id_coin/window_size/future_size dipakai hanya kalau memang
        perlu membuat object baru).
        """
        if client_id not in self._models:
            return self.create_model(client_id, id_coin, window_size, future_size)
        return self._models[client_id]

    # ================= PREDIKSI =================

    def predict(self, client_id, input):
        """
        Delegasikan prediksi ke object Model milik `client_id`,
        lewat Model.predict(input).
        """
        model_obj = self.get_model(client_id)

        ohlc = [
            [candle["o"], candle["h"], candle["l"], candle["c"]]
            for candle in input
        ]

        results,avg_max_down,avg_max_up = model_obj.predict(ohlc)

        k_similarity_above_threshold = 0
        for result in results:
            if result['similarity'] >= self.threshold:
                k_similarity_above_threshold+=1
        

        if k_similarity_above_threshold >= self.k:
            return results,avg_max_down,avg_max_up
        else:
            return []
