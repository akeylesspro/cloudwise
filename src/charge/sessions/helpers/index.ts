import { send_sms } from "akeyless-server-commons/helpers";
import { start_session } from "./start_session";
import { handle_active_session } from "./handle_active_session";
import { stop_session } from "./stop_session";
import { ChargingState } from "../types";
import { cache_manager } from "akeyless-server-commons/managers";
import { logger } from "akeyless-server-commons/managers";
import { Car } from "akeyless-types-commons";

export * from "./start_session";
export * from "./stop_session";
export * from "./handle_active_session";

export const handle_charging_state_snapshot = (charging_states: ChargingState[]) => {
    let prev: ChargingState[] = cache_manager.getArrayData("nx-charge-state");
    charging_states.forEach((new_car) => {
        const old_car = prev.find((old) => old.car_number === new_car.car_number);
        if (!old_car) {
            if (check_car_charging_features(new_car.car_number)) {
                logger.log(`🟢 new car: "${new_car.car_number}" entered with status: "${new_car.status}"`);
                handle_car_status_change(new_car);
            }
            prev = [...prev, new_car];
            return;
        }
        const [old_status, new_status] = [old_car.status, new_car.status];
        if (old_status !== new_status) {
            if (old_status === "charging" && new_status === "plugin") {
                logger.warn(`🚫⏩ get status change from charging to plugin, skipping ...`);
                return;
            }
            if (check_car_charging_features(new_car.car_number)) {
                logger.log(`ℹ️ car: "${new_car.car_number}" got status changed from "${old_status}" to "${new_status}"`);
                handle_car_status_change(new_car);
            }
        }
        prev = prev.map((old) => (old.car_number === new_car.car_number ? new_car : old));
    });
    cache_manager.setArrayData("nx-charge-state", prev);
};

const handle_car_status_change = async (charging_state_object: ChargingState) => {
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
        case "error":
            if (charging_state_object.session_id?.length) {
                logger.warn(`🔴 Stopping session from status snapshot ...  `);
                await stop_session(charging_state_object.session_id, "error in session status");
            }
            break;
        default:
            break;
    }
};

const check_car_charging_features = (car_number: string): boolean => {
    const units: Car[] = cache_manager.getArrayData("units");
    const car = units.find((car) => car.carId.trim() === car_number.trim());
    if (!car) {
        return false;
    }
    const car_features = car.features || [];
    return car_features.includes("charge") && car_features.includes("plug_and_charge");
};
