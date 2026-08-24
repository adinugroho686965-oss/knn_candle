if True:
    import sys
    import os
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    sys.path.append(parent_dir)
    from database import database
else:

    database= None

from sklearn.neighbors import KNeighborsRegressor
import numpy as np


class DataProcessing:
    """
    Bertanggung jawab untuk semua hal yang berhubungan dengan DATA:
    mengambil candle dari database, membentuk sliding window,
    normalisasi, dan denormalisasi.
    """

    def __init__(self, coin_id=None, window_size=None, future_size=None):
        self.coin_id = coin_id
        self.window_size = window_size
        self.future_size = future_size

    def get_data(self):
        """
        Membuat sliding window OHLC.

        X shape = (samples, window_size, 4)
        Y shape = (samples, future_size, 4)
        """

        candles = database.CandleRepository().get_candles(self.coin_id)

        ohlc = np.asarray(
            [
                [
                    candle["open"],
                    candle["high"],
                    candle["low"],
                    candle["close"],
                ]
                for candle in candles
            ],
            dtype=np.float32,
        )

        X = []
        Y = []

        total = len(ohlc)

        for i in range(total - self.window_size - self.future_size + 1):
            x = ohlc[i : i + self.window_size]
            y = ohlc[
                i + self.window_size :
                i + self.window_size + self.future_size
            ]

            X.append(x)
            Y.append(y)

        X = np.asarray(X, dtype=np.float32)
        Y = np.asarray(Y, dtype=np.float32)

        return X, Y

    def normalize_window(self, window, minmax=None):

        window = np.asarray(window, dtype=np.float32)

        if minmax is None:
            min_val = window.min()
            max_val = window.max()
        else:
            min_val = minmax["min"]
            max_val = minmax["max"]

        if max_val == min_val:
            normalized = np.zeros_like(window)
        else:
            normalized = (window - min_val) / (max_val - min_val)

        return normalized.flatten(), {
            "min": float(min_val),
            "max": float(max_val)
        }

    def normalize(self, data, return_minmax=False, minmax_list=None):
        """
        Normalize each row independently.

        Parameters
        ----------
        data : list[list]

        minmax_list : list[dict] | None
            Jika diberikan maka setiap row menggunakan min/max yang sesuai.
        """

        normalized_data = []
        result_minmax = []

        for i, row in enumerate(data):

            current_minmax = None if minmax_list is None else minmax_list[i]

            normalized, minmax = self.normalize_window(
                row,
                minmax=current_minmax
            )

            normalized_data.append(normalized)

            if return_minmax:
                result_minmax.append(minmax)

        if return_minmax:
            return normalized_data, result_minmax

        return normalized_data

    def denormalize_window(self, window, minmax):
        """
        Denormalize a flattened sliding window back to (window_size, 4).
        """

        window = np.asarray(window, dtype=np.float32)

        window = (
            window * (minmax["max"] - minmax["min"]) + minmax["min"]
        )

        return window.reshape(-1, 4).tolist()


class Model:
    """
    Bertanggung jawab untuk urusan MODEL: training KNN dan prediksi.
    Delegasikan semua urusan data ke CandleDataset lewat self.dataset.
    """

    def __init__(self, k=3):
        self.model = KNeighborsRegressor(n_neighbors=k)
        self.data_x_normalized = None
        self.data_y_normalized = None
        self.id_coin = None
        self.window_size = None
        self.future_size = None
        self.dataset = None

    def fit(self, X, y):
        """
        Train the KNN model.
        """
        self.model.fit(X, y)
        return self

    def prepare_model(self):
        self.dataset = DataProcessing(
            coin_id=self.id_coin,
            window_size=self.window_size,
            future_size=self.future_size
        )

        # Load dataset
        data_x, data_y = self.dataset.get_data()

        # Normalize X dan simpan min/max setiap row
        self.data_x_normalized, minmax_list = self.dataset.normalize(
            data_x,
            return_minmax=True
        )

        # Normalize Y menggunakan min/max milik X
        self.data_y_normalized = self.dataset.normalize(
            data_y,
            minmax_list=minmax_list
        )

        # Train KNN
        self.fit(
            self.data_x_normalized,
            self.data_y_normalized
        )

        return self

    def predict(self, x):

        # Normalize input
        x_norm, minmax = self.dataset.normalize_window(x)

        # Cari K tetangga terdekat
        distances, indices = self.model.kneighbors([x_norm])

        max_distance = np.sqrt(len(x_norm))

        results = []

        # Rata-rata close dari input
        current_avg_close = np.mean(np.array(x)[:, 3])

        avg_max_up=[]
        avg_max_down=[]

        for distance, idx in zip(distances[0], indices[0]):

            history = self.data_x_normalized[idx]
            future = self.data_y_normalized[idx]

            # Scale future ke harga input
            future_scaled = self.dataset.denormalize_window(future, minmax)
            history_scaled = self.dataset.denormalize_window(history, minmax)

            similarity = max(
                0,
                (1 - distance / max_distance) * 100
            )

            # Rata-rata close future
            future_avg_close = np.mean(np.array(future_scaled)[:, 3])

            # Arah pergerakan
            if future_avg_close > current_avg_close:
                direction = "up"
                avg_max_up.append(np.max(np.array(future_scaled)[:, 3]))
            elif future_avg_close < current_avg_close:
                direction = "down"
                avg_max_down.append(np.min(np.array(future_scaled)[:, 3]))

            else:
                direction = "sideways"

            results.append({
                "index": int(idx),
                "similarity": similarity,
                "history": history_scaled,
                "future_scaled": future_scaled,
                "current_avg_close": float(current_avg_close),
                "future_avg_close": float(future_avg_close),
                "direction": direction
            })


        avg_max_up = sum(avg_max_up) / len(avg_max_up) if avg_max_up else 0
        avg_max_down = sum(avg_max_down) / len(avg_max_down) if avg_max_down else 0
        return results,avg_max_down,avg_max_up