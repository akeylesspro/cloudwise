import { Timestamp } from "firebase-admin/firestore";
import { logger, cache_manager } from "akeyless-server-commons/managers";
import { set_document, sleep, init_env_variables } from "akeyless-server-commons/helpers";
import { set_session_progress_metadata, create_mock_location, DEFAULT_COORDINATES } from "./mock_store";
import { ChargingState } from "../sessions/types";
import { stop_session } from "../sessions";

import dotenv from "dotenv";
import { get_config } from "../cloudwise_api/helpers";
dotenv.config();

export interface SimulatorConfig {
    duration_seconds: number;
    target_kwh: number;
    car_number: string;
}

export const simulator_config: SimulatorConfig = {
    duration_seconds: 0,
    target_kwh: 0,
    car_number: "",
};

export const run_simulator = async (config: SimulatorConfig) => {
    simulator_config.duration_seconds = config.duration_seconds;
    simulator_config.target_kwh = config.target_kwh;
    simulator_config.car_number = config.car_number;
    try {
        const { simulator_list } = get_config();
        if (!simulator_list.includes(config.car_number)) {
            throw new Error("Car number is not in simulator list");
        }
        logger.log("🤖 Simulator is running ...");

        await trigger_plugin_event();

        const session_id = await handle_session();

        await finish_session(session_id);

        return { session_id, completed: true };
    } catch (error) {
        logger.error(`🔴🤖 Simulator failed to run`, error);
        return { session_id: "", completed: false };
    }
};

export const test_simulator = async () => {
    const result = await run_simulator({ car_number: "3026953", duration_seconds: 100, target_kwh: 12 });
    console.log("result of simulate session", result);
};

const trigger_plugin_event = async () => {
    const { car_number } = simulator_config;
    const charging_state: ChargingState = {
        id: car_number,
        status: "plugin",
        car_number,
        lat: DEFAULT_COORDINATES.lat,
        lng: DEFAULT_COORDINATES.lng,
        timestamp: Timestamp.now(),
    };
    await set_document("nx-charge-state", car_number, charging_state);
    create_mock_location(charging_state);
};

const wait_for_session_id = async (): Promise<string | null> => {
    const { car_number } = simulator_config;

    const start_time = Date.now();
    const poll_interval_ms = 500;

    while (Date.now() - start_time < 30000) {
        const charging_states: ChargingState[] = cache_manager.getArrayData("nx-charge-state");
        const state = charging_states.find((s) => s.car_number === car_number);

        if (state?.session_id) {
            return state.session_id;
        }

        await sleep(poll_interval_ms);
    }

    return null;
};

const handle_session = async () => {
    const { duration_seconds, target_kwh } = simulator_config;
    const session_id = await wait_for_session_id();

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

const finish_session = async (session_id: string) => {
    const { duration_seconds } = simulator_config;

    await sleep(duration_seconds * 1000);

    await stop_session(session_id, { message: "Simulator completion", status: "completed" });
    // wait for CDR
    await sleep(50 * 1000);
    // reset simulator config
    simulator_config.duration_seconds = 0;
    simulator_config.target_kwh = 0;
    simulator_config.car_number = "";
    logger.log("🤖 Simulator completed");
};
