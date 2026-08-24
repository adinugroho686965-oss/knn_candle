

import services
import database
import presentation
import machine_learning


services.has_accest_to(database,machine_learning)
presentation.has_accest_to(services)


presentation.app.run_app()


