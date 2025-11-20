import { cache_manager, logger } from "akeyless-server-commons/managers";
import { Timestamp } from "firebase-admin/firestore";
import { get_session_status_api, get_config, session_command } from "../cloudwise_api/helpers";
import { parse_cdr } from "../helpers";
import type { ChargingSession } from "./types";
import { SessionCommandSettings } from "../cloudwise_api/types";
import { set_document } from "akeyless-server-commons/helpers";
import { retry } from "../helpers/retry";

interface StopSessionPayload {
    status?: "completed" | "error";
    message: string;
}

type SessionWithId = ChargingSession & { id: string };

export const stop_session = async (session_id: string, options: StopSessionPayload) => {
    const { status = "completed", message } = options;
    logger.log(`⛔ Stopping session: "${session_id}" with message: "${message}" ...`);
    try {
        /// step 1: validate session
        const session = validate_session(session_id);
        /// step 2: stop session command
        await stop_session_command(session_id, session);
        /// step 3: update collections status
        await update_collections(session, message, status);
        /// step 4: async update session and cdr (if exists)
        get_session_cdr(session);
    } catch (error) {
        logger.error(`🔴 Error in stop session: ${session_id}`, JSON.stringify(error));
    }
};

const validate_session = (session_id: string): SessionWithId => {
    const sessions: ChargingSession[] = cache_manager.getArrayData("nx-charge-sessions");
    const session = sessions.find((session) => session.id === session_id);
    if (!session) {
        throw new Error("stop_step_1__session_not_found");
    }
    return session as SessionWithId;
};

const stop_session_command = async (session_id: string, session: SessionWithId) => {
    try {
        const config: SessionCommandSettings & Partial<ChargingSession> = {
            ...session,
            command: "STOP_SESSION",
            session_id: session.id,
        };
        delete config.status;
        delete config.car_number;
        delete config.id;
        const request = async () => await session_command(config);
        await retry(request, { retries: 3, random_delay: { min: 3, max: 10 }, debug: true, name: "stop_session" });
        logger.log(`⛔ Session "${session_id}" stopped`);
    } catch (error) {
        logger.error(`🔴 Error in stop_session_command: ${session.id}`, JSON.stringify(error));
        throw new Error("stop_step_2__failed_to_stop_session_command");
    }
};

const update_collections = async (session: SessionWithId, message: string, status: StopSessionPayload["status"]) => {
    try {
        await set_document("nx-charge-sessions", session.id, {
            ...session,
            status,
            updated: Timestamp.now(),
            ended: Timestamp.now(),
            message,
        });
        await set_document("nx-charge-state", session.car_number, { status, session_id: "", timestamp: Timestamp.now(), message });
    } catch (error) {
        logger.error(`🔴 Error in update_collections: ${session.id}`, JSON.stringify(error));
        throw new Error("stop_step_3__failed_to_update_collections");
    }
};

const get_session_cdr = (session: SessionWithId) => {
    setTimeout(async () => {
        try {
            const { asset_id, ble_id, device_id } = get_config();
            const {
                CommandStatus: session_status,
                Cost: cost = 0,
                Count: count = 0,
                KWh: kwh = 0,
                ChargingTimeInSeconds: charging_time_in_seconds,
                Cdr: cdr,
            } = await get_session_status_api({ asset_id, ble_id, session_id: session.id, device_id });

            if (session_status.includes("COMPLETED")) {
                const update: any = { cost, count, kwh, charging_time_in_seconds, updated: Timestamp.now() };
                if (cdr) {
                    const parsed_cdr = parse_cdr(cdr);
                    const cdr_id = parsed_cdr.id;
                    delete parsed_cdr.id;
                    update.cdr_id = cdr_id;
                    await set_document("nx-charge-cdrs", cdr_id!, {
                        ...parsed_cdr,
                        session_id: session.id,
                        car_number: session.car_number,
                        nx_updated: Timestamp.now(),
                    });
                }
                await set_document("nx-charge-sessions", session.id, update);
            }
        } catch (error) {
            logger.error(`🔴 Error in get_session_cdr: ${session.id}`, JSON.stringify(error));
            throw new Error("stop_step_4__failed_to_get_session_cdr");
        }
    }, 30 * 1000);
};
