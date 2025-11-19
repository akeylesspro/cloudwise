import { cache_manager, logger } from "akeyless-server-commons/managers";
import { get_config, get_session_status_api } from "../../cloudwise_api/helpers";
import { retry } from "../../helpers/retry";
import { send_sms, set_document } from "akeyless-server-commons/helpers";
import { Timestamp } from "firebase-admin/firestore";
import { stop_session } from "./stop_session";
import { CommandStatus } from "../types";

export const handle_active_session = async (session_id: string, car_number: string) => {
    let timer: NodeJS.Timeout | undefined;
    const run = async () => {
        try {
            /// step 1: get session status
            const session_status = await get_session_status(session_id);
            /// step 2: if session is active, continue the timer
            if (!session_status.includes("ACTIVE")) {
                if (timer) {
                    clearTimeout(timer);
                }
                await on_session_completed(session_id, car_number, session_status);
                return;
            }
            timer = setTimeout(run, 30 * 1000);
            return;
        } catch (error) {
            logger.error("🔴 Error in handle_active_session: cannot get session status", error);
            if (timer) {
                clearTimeout(timer);
            }
            await on_session_error(error, session_id, car_number);
        }
    };
    try {
        await run();
    } catch (error) {
        logger.error("🔴 Error in handle_active_session: cannot run the interval", error);
    }
};

const get_session_status = async (session_id: string): Promise<CommandStatus> => {
    const { asset_id, ble_id, device_id } = get_config();
    try {
        const request = async () => await get_session_status_api({ asset_id, ble_id, session_id, device_id });
        const { CommandStatus } = await retry(request, {
            retries: 3,
            random_delay: { min: 10, max: 20 },
            debug: true,
            name: "get_session_status",
        });
        return CommandStatus;
    } catch (error) {
        logger.error("🔴 Error in get_session_status: cannot get session status", error);
        throw new Error("active_step_1__failed_to_get_session_status");
    }
};

const on_session_completed = async (session_id: string, car_number: string, session_status: CommandStatus) => {
    setTimeout(async () => {
        const sessions = cache_manager.getArrayData("nx-charge-sessions");
        const session = sessions.find((session) => session.id === session_id);
        if (session && session.status !== "completed") {
            await stop_session(session_id, `Session status is: ${session_status}`);
            if (car_number === "16457003") {
                send_sms("0522614678", `היי נאור אילן עם רכב מספר ${car_number} סיים טעינה בהצלחה`, "naor tests");
            }
        }
    }, 10 * 1000);
};

const on_session_error = async (error: any, session_id: string, car_number: string) => {
    const sessions = cache_manager.getArrayData("nx-charge-sessions");
    const session = sessions.find((session) => session.id === session_id);
    if (session) {
        await set_document("nx-charge-sessions", session_id, { status: "error", updated: Timestamp.now(), ended: Timestamp.now() });
        if (car_number === "16457003") {
            send_sms("0522614678", `היי נאור אילן עם רכב מספר ${car_number} קיבל שגיאה בטעינה`, "naor tests");
        }
    }
};
