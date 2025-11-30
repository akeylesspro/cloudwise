import { Timestamp } from "firebase-admin/firestore";
import { logger, cache_manager } from "akeyless-server-commons/managers";
import { set_document, sleep, db, init_env_variables } from "akeyless-server-commons/helpers";
import { disable_api_interceptor, enable_api_interceptor } from "./api_interceptor";
import { set_session_progress_metadata, clear_mock_state, create_mock_location } from "./mock_store";
import { ChargingState } from "../sessions/types";
import { stop_session, handle_active_session, start_session, stop_active_session_monitoring } from "../sessions";

import dotenv from "dotenv";
import { SessionRunnerResult, SessionSimulationConfig, SimulatorConfig } from "./types";
dotenv.config();

export * from "./types";
const { simulator } = init_env_variables();
export const simulator_config: SimulatorConfig = {
    enabled: simulator === "true",
    default_session_duration_seconds: 120,
    default_target_kwh: 12,
    progress_update_interval_ms: 1000 * 10,
};

export const run_simulator = async (config: SessionSimulationConfig) => {
    if (!simulator_config.enabled) {
        logger.error("Simulator is not enabled");
        return { session_id: "", completed: false };
    }
    enable_api_interceptor();
    logger.log("🤖 Simulator is running ...");
    const {
        car_number,
        lat = 32.0853,
        lng = 34.7818,
        duration_seconds = simulator_config.default_session_duration_seconds,
        target_kwh = simulator_config.default_target_kwh,
    } = config;

    const charging_state: ChargingState = {
        id: `state-${Date.now()}`,
        status: "plugin",
        car_number,
        lat,
        lng,
        timestamp: Timestamp.now(),
    };
    await set_document("nx-charge-state", car_number, charging_state);

    create_mock_location(config, charging_state);

    const session_id = await start_session(charging_state);

    if (!session_id) {
        throw new Error("Simulator failed to retrieve session_id");
    }

    set_session_progress_metadata(session_id, {
        started_at: new Date(),
        target_kwh,
        duration_seconds,
    });

    await handle_active_session(session_id, car_number);
    
    setTimeout(async () => {
        await stop_session(session_id, { message: "Simulator completion", status: "completed" });
        disable_api_interceptor();
        logger.log("🤖 Simulator completed");
    }, duration_seconds * 1000);

    return { session_id, completed: true };
};
