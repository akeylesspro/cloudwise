import { Timestamp } from "firebase-admin/firestore";
import { logger, cache_manager } from "akeyless-server-commons/managers";
import { set_document, sleep, init_env_variables } from "akeyless-server-commons/helpers";
import { disable_api_interceptor, enable_api_interceptor } from "./api_interceptor";
import { set_session_progress_metadata, create_mock_location } from "./mock_store";
import { ChargingState } from "../sessions/types";
import { stop_session } from "../sessions";

import dotenv from "dotenv";
import { SessionSimulationConfig, SimulatorConfig } from "./types";
dotenv.config();

export * from "./types";

const { simulator } = init_env_variables();

export const simulator_config: SimulatorConfig = {
    enabled: simulator === "true",
    default_session_duration_seconds: 200,
    default_target_kwh: 12,
};

export const run_simulator = async (config: SessionSimulationConfig) => {
    if (!simulator_config.enabled) {
        logger.error("Simulator is not enabled");
        return { session_id: "", completed: false };
    }
    enable_api_interceptor();
    try {
        logger.log("🤖 Simulator is running ...");

        await trigger_plugin_event(config);

        const session_id = await handle_session(config);

        await finish_session(session_id, config.duration_seconds || simulator_config.default_session_duration_seconds);

        return { session_id, completed: true };
    } catch (error) {
        logger.error(`🤖 Simulator failed to run`, error);
        return { session_id: "", completed: false };
    } finally {
        disable_api_interceptor();
    }
};

const trigger_plugin_event = async (config: SessionSimulationConfig) => {
    const { car_number, lat = 32.0853, lng = 34.7818 } = config;
    const charging_state: ChargingState = {
        id: car_number,
        status: "plugin",
        car_number,
        lat,
        lng,
        timestamp: Timestamp.now(),
    };
    await set_document("nx-charge-state", car_number, charging_state);
    create_mock_location(config, charging_state);
};

const wait_for_session_id = async (car_number: string, max_wait_ms: number = 30000): Promise<string | null> => {
    const start_time = Date.now();
    const poll_interval_ms = 500;

    while (Date.now() - start_time < max_wait_ms) {
        const charging_states: ChargingState[] = cache_manager.getArrayData("nx-charge-state");
        const state = charging_states.find((s) => s.car_number === car_number);

        if (state?.session_id) {
            return state.session_id;
        }

        await sleep(poll_interval_ms);
    }

    return null;
};

const handle_session = async (config: SessionSimulationConfig) => {
    const {
        car_number,
        duration_seconds = simulator_config.default_session_duration_seconds,
        target_kwh = simulator_config.default_target_kwh,
    } = config;
    const session_id = await wait_for_session_id(car_number);

    if (!session_id) {
        throw new Error("Simulator failed to retrieve session_id");
    }
    set_session_progress_metadata(session_id, {
        started_at: new Date(),
        target_kwh,
        duration_seconds,
    });
    logger.log(`🤖 Simulator Session "${session_id}" started successfully`);
    return session_id;
};

const finish_session = async (session_id: string, duration_seconds: number) => {
    await sleep(duration_seconds * 1000);

    await stop_session(session_id, { message: "Simulator completion", status: "completed" });
    // wait for CDR
    await sleep(50 * 1000);
    logger.log("🤖 Simulator completed");
};
