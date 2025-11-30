import { logger } from "akeyless-server-commons/managers";
import { basic_init, init_env_variables } from "akeyless-server-commons/helpers";
import main_router from "./main_router";
import { run_tasks } from "./charge/tasks";
import package_json from "../package.json";
import { initialize_snapshot } from "./charge/helpers";
import { login } from "./charge/cloudwise_api/helpers";
import { simulator_config, run_simulator } from "./charge/simulator";
import { ExtraSnapshotConfig } from "akeyless-server-commons/types";
export const snapshot_subscription_type = init_env_variables(["snapshot_subscription_type"])
    .snapshot_subscription_type as ExtraSnapshotConfig["subscription_type"];
const init = async () => {
    const version = package_json.version;
    await basic_init(main_router, "nx-charge", version, {
        init_snapshot_options: {
            subscription_type: snapshot_subscription_type,
        },
    });

    await login();
    await initialize_snapshot();

    if (simulator_config.enabled) {
        const result = await run_simulator({ car_number: "3026953" });
        console.log("result of simulate session", result);
    } else {
        await run_tasks();
    }
};

init().catch((e) => {
    logger.error("error in init function", e);
    process.exit(1);
});
