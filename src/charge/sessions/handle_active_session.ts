import { cache_manager, logger } from "akeyless-server-commons/managers";
import { get_config, get_session_status } from "../cloudwise_api/helpers";
import { retry } from "../helpers/retry";
import { send_sms, set_document } from "akeyless-server-commons/helpers";
import { stop_session } from "./stop_session";
import type { ParsedSession } from "./types";
import { is_has_charge_balance, parse_session } from "../helpers";

const active_timers = new Map<string, NodeJS.Timeout>();

export const stop_active_session_monitoring = (session_id: string): void => {
    const existing_timer = active_timers.get(session_id);
    if (existing_timer) {
        clearTimeout(existing_timer);
        active_timers.delete(session_id);
    }
};

export const handle_active_session = async (session_id: string, car_number: string) => {
    const clear_timer = () => {
        const existing_timer = active_timers.get(session_id);
        if (existing_timer) {
            clearTimeout(existing_timer);
        }
        active_timers.delete(session_id);
    };
    const run = async () => {
        try {
            /// step 1: get session status
            const session = await get_session_details(session_id, car_number);
            const { session_status, cost } = session;
            await update_session(session_id, session);
            if (!session_status.includes("ACTIVE")) {
                clear_timer();
                return await on_session_completed(session_id, car_number, `Session status is: ${session_status}`);
            }
            /// step 2: check credit balance
            const { is_has_balance, balance } = await check_credit_balance(car_number, cost);
            if (!is_has_balance) {
                clear_timer();
                return await on_session_completed(session_id, car_number, `Car "${car_number}" does not have enough balance, balance: ${balance}`);
            }
            /// step 3: continue the timer
            active_timers.set(session_id, setTimeout(run, 30 * 1000));
        } catch (error) {
            clear_timer();
            await on_session_error(error, car_number, session_id);
        }
    };
    await run();
};

const get_session_details = async (session_id: string, car_number: string): Promise<ParsedSession> => {
    const { asset_id, ble_id, device_id } = get_config();
    try {
        const request = async () => await get_session_status({ asset_id, ble_id, session_id, device_id, car_number });
        const session = await retry(request, {
            retries: 4,
            random_delay: { min: 10, max: 20 },
            debug: true,
            name: "get_session_details",
        });

        return parse_session(session);
    } catch (error) {
        logger.error("🔴 Error in get_session_details: cannot get session details", error);
        throw new Error("active_step_1__failed_to_get_session_details");
    }
};

const update_session = async (session_id: string, session: ParsedSession) => {
    const { cost, kwh, charging_time_in_seconds } = session;
    await set_document("nx-charge-sessions", session_id, { kwh, cost, charging_time_in_seconds });
};

const on_session_completed = async (session_id: string, car_number: string, message: string) => {
    setTimeout(async () => {
        const sessions = cache_manager.getArrayData("nx-charge-sessions");
        const session = sessions.find((session) => session.id === session_id);
        if (session && session.status !== "completed") {
            await stop_session(session_id, { message });
            if (car_number === "16457003") {
                send_sms("0522614678", `היי נאור אילן עם רכב מספר ${car_number} סיים טעינה בהצלחה`, "naor tests");
            }
        }
    }, 10 * 1000);
};

const on_session_error = async (error: any, car_number: string, session_id: string) => {
    try {
        logger.error("🔴 Error in handle_active_session", error);
        const message = error.message || "unknown error";
        await stop_session(session_id, { message, status: "error" });
    } catch (error) {
        logger.error("🔴 Error in on_session_error", error);
    }
};

const check_credit_balance = async (car_number: string, cost: number) => {
    const { is_has_balance, balance } = await is_has_charge_balance(car_number, cost);
    if (!is_has_balance) {
        logger.log(`🟡 Car "${car_number}" does not have enough balance, balance: ${balance}`);
    }
    return { is_has_balance, balance };
};
