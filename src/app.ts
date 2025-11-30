import { logger } from "akeyless-server-commons/managers";
import { basic_init, init_env_variables } from "akeyless-server-commons/helpers";
import main_router from "./main_router";
import { run_tasks } from "./charge/tasks";
import package_json from "../package.json";
import { initialize_snapshot } from "./charge/helpers";
import { login } from "./charge/cloudwise_api/helpers";
import { SessionSimulationConfig, simulator_config, run_simulator } from "./charge/simulator";

const init = async () => {
    const version = package_json.version;
    await basic_init(main_router, "nx-charge", version, {
        init_snapshot_options: {
            subscription_type: "firebase",
        },
    });

    await login();
    await initialize_snapshot();
    await run_tasks();
    const { simulator } = init_env_variables();
    if (simulator === "true") {
        const result = await run_simulator({ car_number: "3026953" });
        console.log("result of simulate session", result);
    }
};

init().catch((e) => {
    logger.error("error in init function", e);
    process.exit(1);
});
