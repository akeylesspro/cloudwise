import { cache_manager, logger } from "akeyless-server-commons/managers";
import { Timestamp } from "firebase-admin/firestore";
import { get_session_status_api, get_config, session_command } from "../../cloudwise_api/helpers";
import { parse_cdr } from "../../helpers";
import { ChargingSession } from "../types";
import { SessionCommandSettings } from "../../cloudwise_api/types";
import { set_document } from "akeyless-server-commons/helpers";
import { retry } from "../../helpers/retry";

/// ------------------ end session ------------------
export const stop_session = async (session_id: string, message: string) => {
    logger.log(`⛔ Stopping session: "${session_id}" with message: "${message}" ...`);
    try {
        const sessions: ChargingSession[] = cache_manager.getArrayData("nx-charge-sessions");
        const session = sessions.find((session) => session.id === session_id);
        if (!session) {
            throw new Error("Session not found");
        }
        const config: SessionCommandSettings & Partial<ChargingSession> = {
            ...session,
            command: "STOP_SESSION",
            session_id: session.id,
            updated: Timestamp.now(),
        };
        delete config.status;
        delete config.car_number;
        delete config.id;
        const request = async () => await session_command(config);
        await retry(request, { retries: 3, random_delay: { min: 3, max: 10 }, debug: true, name: "stop_session" });
        logger.log(`⛔ Session "${session_id}" stopped`);

        /// update session status
        await set_document("nx-charge-sessions", session_id, {
            ...session,
            status: "completed",
            updated: Timestamp.now(),
            ended: Timestamp.now(),
            message,
        });
        await set_document("nx-charge-state", session.car_number, { status: "plugout", session_id: "", timestamp: Timestamp.now(), message });

        /// async update session and cdr (if exists)
        setTimeout(async () => {
            const { asset_id, ble_id, device_id } = get_config();
            const {
                CommandStatus: session_status,
                Cost: cost = 0,
                Count: count = 0,
                KWh: kwh = 0,
                ChargingTimeInSeconds: charging_time_in_seconds,
                Cdr: cdr,
            } = await get_session_status_api({ asset_id, ble_id, session_id, device_id });

            if (session_status.includes("COMPLETED")) {
                const update: any = { cost, count, kwh, charging_time_in_seconds, updated: Timestamp.now() };
                if (cdr) {
                    const parsed_cdr = parse_cdr(cdr);
                    const cdr_id = parsed_cdr.id;
                    delete parsed_cdr.id;
                    update.cdr_id = cdr_id;
                    await set_document("nx-charge-cdrs", cdr_id!, {
                        ...parsed_cdr,
                        session_id,
                        car_number: session.car_number,
                        nx_updated: Timestamp.now(),
                    });
                }
                await set_document("nx-charge-sessions", session_id, update);
            }
        }, 30 * 1000);
    } catch (error) {
        logger.error(`🔴 Error in stop session: ${session_id}`, JSON.stringify(error));
    }
};
