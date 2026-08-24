import threading

class ScrapingCancelled(Exception):
    """Dilempar saat job.cancel di-set True (lewat /stop_scraping)."""
    pass


class ScrapingJob:

    def __init__(self, client_id):

        self.client_id = client_id

        self.status = "idle"

        self.progress = 0

        self.logs = []

        self.error = None

        self.thread = None

        self.cancel = False

    def add_log(self, message):
        self.logs.append(message)

    def set_progress(self, value):
        self.progress = value

    def set_running(self):
        self.status = "running"

    def finish(self):
        self.status = "finished"
        self.progress = 100

    def fail(self, error):
        self.status = "failed"
        self.error = str(error)

    def to_dict(self):
        return {
            "status": self.status,
            "progress": self.progress,
            "logs": self.logs,
            "error": self.error
        }
    

class ScrapingManager:

    def __init__(self):

        self.jobs = {}

        self.lock = threading.Lock()

    def get_job(self, client_id):

        return self.jobs.get(client_id)

    def start(self, client_id, target):

        with self.lock:

            job = self.jobs.get(client_id)

            if job and job.status == "running":
                return False

            job = ScrapingJob(client_id)

            job.set_running()

            self.jobs[client_id] = job

            thread = threading.Thread(
                target=self._worker,
                args=(job, target),
                daemon=True
            )

            job.thread = thread

            thread.start()

            return True

    def _worker(self, job, target):

        try:

            target.start(job)

            if job.status == "running":
                job.finish()

        except Exception as e:

            job.fail(e)

