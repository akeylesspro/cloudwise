import { cache_manager, logger } from "akeyless-server-commons/managers";
import { get_config, get_session_status_api } from "../../cloudwise_api/helpers";
import { retry } from "../../helpers/retry";
import { send_sms, set_document } from "akeyless-server-commons/helpers";
import { Timestamp } from "firebase-admin/firestore";
import { stop_session } from "./stop_session";
import { CommandStatus } from "../types";
import { check_car_charge_credit_balance } from "../../helpers";

const active_timers = new Map<string, NodeJS.Timeout>();

export const handle_active_session = async (session_id: string, car_number: string) => {
    const existing_timer = active_timers.get(session_id);
    if (existing_timer) {
        clearTimeout(existing_timer);
    }

    let timer: NodeJS.Timeout | undefined;
    const run = async () => {
        try {
            /// step 1: get session status
            const { session_status, cost } = await get_session_status(session_id);
            if (!session_status.includes("ACTIVE")) {
                active_timers.delete(session_id);
                return await on_session_completed(session_id, car_number, timer, `Session status is: ${session_status}`);
            }
            /// step 2: check credit balance
            await check_credit_balance(car_number, cost);
            /// step 3: continue the timer
            const new_timer = setTimeout(run, 30 * 1000);
            active_timers.set(session_id, new_timer);
            timer = new_timer; 
        } catch (error) {
            active_timers.delete(session_id);
            await on_session_error(error, car_number, session_id, timer);
        }
    };
    await run();
};

const get_session_status = async (session_id: string): Promise<{ session_status: CommandStatus; cost: number }> => {
    const { asset_id, ble_id, device_id } = get_config();
    try {
        const request = async () => await get_session_status_api({ asset_id, ble_id, session_id, device_id });
        const { CommandStatus: session_status, Cost } = await retry(request, {
            retries: 3,
            random_delay: { min: 10, max: 20 },
            debug: true,
            name: "get_session_status",
        });
        return { session_status, cost: Number(Cost) || 0 };
    } catch (error) {
        logger.error("🔴 Error in get_session_status: cannot get session status", error);
        throw new Error("active_step_1__failed_to_get_session_status");
    }
};

const on_session_completed = async (session_id: string, car_number: string, timer: NodeJS.Timeout | undefined, message: string) => {
    if (timer) {
        clearTimeout(timer);
    }
    setTimeout(async () => {
        const sessions = cache_manager.getArrayData("nx-charge-sessions");
        const session = sessions.find((session) => session.id === session_id);
        if (session && session.status !== "completed") {
            await stop_session(session_id, message);
            if (car_number === "16457003") {
                send_sms("0522614678", `היי נאור אילן עם רכב מספר ${car_number} סיים טעינה בהצלחה`, "naor tests");
            }
        }
    }, 10 * 1000);
};

const on_session_error = async (error: any, car_number: string, session_id: string, timer: NodeJS.Timeout | undefined) => {
    try {
        logger.error("🔴 Error in handle_active_session", error);
        if (timer) {
            clearTimeout(timer);
        }
        // Get current state to preserve session_id

        await set_document("nx-charge-state", car_number, {
            status: "error",
            timestamp: Timestamp.now(),
            message: error.message || "unknown error",
            session_id: session_id,
        });
        // ... rest of code
    } catch (error) {
        logger.error("🔴 Error in on_session_error", error);
    }
};

const check_credit_balance = async (car_number: string, cost: number) => {
    const { is_has_balance, balance } = await check_car_charge_credit_balance(car_number, cost);
    if (!is_has_balance) {
        logger.error(`🔴 Car "${car_number}" does not have enough balance, balance: ${balance}`);
        throw new Error("active_step_2__credit_balance_not_enough");
    }
};
