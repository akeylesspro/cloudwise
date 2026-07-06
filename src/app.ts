import { logger } from "akeyless-server-commons/managers";
import { basic_init } from "akeyless-server-commons/helpers";
import main_router from "./main_router";
import { run_tasks } from "./charge/tasks";
import package_json from "../package.json";
import { initialize_snapshot } from "./charge/helpers";
import { login } from "./charge/cloudwise_api/helpers";

const init = async () => {
    const version = package_json.version;
    await basic_init(main_router, "nx-charge", version, {
        init_snapshot_options: {
            subscription_type: "redis",
        },
        log_requests: {
            url: true,
            body: true,
        },
    });
    await login();
    await initialize_snapshot();
    await run_tasks();
};

init().catch((e) => {
    logger.error("error in init function", e);
    process.exit(1);
});
