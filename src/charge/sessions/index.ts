import { init_env_variables, send_sms } from "akeyless-server-commons/helpers";
import { start_session } from "./start_session";
import { handle_active_session } from "./handle_active_session";
import { stop_session } from "./stop_session";
import type { ChargingState } from "./types";
import { cache_manager } from "akeyless-server-commons/managers";
import { logger } from "akeyless-server-commons/managers";
import { Car } from "akeyless-types-commons";
import { get_config } from "../cloudwise_api/helpers";
import { simulator_config } from "../simulator";

export * from "./start_session";
export * from "./stop_session";
export * from "./handle_active_session";
export { stop_active_session_monitoring } from "./handle_active_session";

export const handle_charging_state_snapshot = (charging_states: ChargingState[]) => {
    let prev: ChargingState[] = cache_manager.getArrayData("nx-charge-state");
    charging_states.forEach(async (new_state) => {
        const prev_state = prev.find((old) => old.car_number === new_state.car_number);
        if (!prev_state) {
            if (check_permissions(new_state.car_number)) {
                logger.log(`🟢 new state: "${new_state.car_number}" entered with status: "${new_state.status}"`);
                handle_status_change(new_state);
            }
            prev = [...prev, new_state];
            return;
        }
        const [old_status, new_status] = [prev_state.status, new_state.status];
        if (old_status !== new_status) {
            if (new_state.session_id && new_status === "plugin") {
                logger.warn(`🚫⏩ get status change from charging to plugin, skipping ...`);
                // Check if there's an active session that should be stopped
                if (new_state.session_id) {
                    await stop_session(new_state.session_id, { message: "Invalid state transition detected", status: "error" });
                }
            }
            if (check_permissions(new_state.car_number)) {
                logger.log(`ℹ️ state: "${new_state.car_number}" got status changed from "${old_status}" to "${new_status}"`);
                handle_status_change(new_state);
            }
        }
        prev = prev.map((old) => (old.car_number === new_state.car_number ? new_state : old));
    });
    cache_manager.setArrayData("nx-charge-state", prev);
};

export const on_snapshot_first_time = (charging_states: ChargingState[]) => {
    cache_manager.setArrayData("nx-charge-state", charging_states);
    for (const charging_state of charging_states) {
        const { status, car_number } = charging_state;
        switch (status) {
            case "plugin":
                if (car_number === "16457003") {
                    send_sms("0522614678", "היי נאור אילן עם רכב מספר 16457003 קיבל אירוע של plugin", "naor tests");
                }
                if (check_permissions(car_number)) {
                    start_session(charging_state);
                }
                break;
            case "charging":
                if (check_permissions(car_number) && charging_state.session_id) {
                    logger.log(`🔄 Resuming monitoring for session ${charging_state.session_id}`);
                    handle_active_session(charging_state.session_id, charging_state.car_number);
                }
                break;
            default:
                break;
        }
    }
};

const handle_status_change = async (charging_state_object: ChargingState) => {
    const { status, car_number } = charging_state_object;
    switch (status) {
        case "plugin":
            if (car_number === "16457003") {
                send_sms("0522614678", "היי נאור אילן עם רכב מספר 16457003 קיבל אירוע של plugin", "naor tests");
            }
            await start_session(charging_state_object);
            break;
        case "charging":
            await handle_active_session(charging_state_object.session_id!, car_number);
            break;
        case "plugout":
            if (car_number === "16457003") {
                send_sms("0522614678", "היי נאור אילן עם רכב מספר 16457003 קיבל אירוע של plugout", "naor tests");
            }
            break;
        default:
            break;
    }
};

const check_feature = (car_number: string): boolean => {
    const units: Car[] = cache_manager.getArrayData("units");
    const car = units.find((car) => car.carId.trim() === car_number.trim());
    if (!car) {
        return false;
    }
    const car_features = car.features || [];
    return car_features.includes("plug_and_charge");
};

const simulator_check = (car_number: string): boolean => {
    if (simulator_config.enabled) {
        return true;
    }
    const { black_list } = get_config();
    return !black_list.includes(car_number);
};

const check_permissions = (car_number: string): boolean => {
    const simulator =  simulator_check(car_number)
    const feature = check_feature(car_number)
    return feature && simulator;
};