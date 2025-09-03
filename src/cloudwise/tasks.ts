import { db, execute_task, TaskName } from "akeyless-server-commons/helpers";
import { parse_cdr, parse_ocpi_location } from "./helpers";
import { ParsedOcpiLocationData } from "./types";
import { cache_manager, logger } from "akeyless-server-commons/managers";
import { isEqual } from "lodash";
import { get_config, get_locations, get_user_cdrs, login } from "./api/helpers";
import { ChargingSession } from "./sessions/types";

export const run_tasks = async () => {
    /// login
    setInterval(login, 2 * 60 * 60 * 1000);
    /// collect locations
    await execute_task("cloudwise", TaskName.collect_cloudwise_locations, task__collect_cloudwise_locations);
    setInterval(() => {
        execute_task("cloudwise", TaskName.collect_cloudwise_locations, task__collect_cloudwise_locations);
    }, 12 * 60 * 60 * 1000);
    /// collect cdrs
    setInterval(() => {
        execute_task("cloudwise", TaskName.collect_cloudwise_cdrs, task__collect_cloudwise_cdrs);
    }, 60 * 60 * 1000);
};

export const task__collect_cloudwise_locations = async () => {
    const locations = await get_locations();
    const parsed_data = locations.map(parse_ocpi_location);
    const cached_location: ParsedOcpiLocationData[] = cache_manager.getArrayData("cloudwise-locations");
    const need_to_update: ParsedOcpiLocationData[] = [];

    for (const loc of parsed_data) {
        const cached = cached_location.find((l) => l.id === loc.id);
        if (!cached || !isEqual(cached, loc)) {
            need_to_update.push(loc);
        }
    }

    if (need_to_update.length) {
        const batch = db.batch();
        need_to_update.forEach((loc) => {
            const clone: any = { ...loc };
            delete clone.id;
            batch.set(db.collection("cloudwise-locations").doc(loc.id), clone);
        });
        await batch.commit();
        logger.log(`Updated ${need_to_update.length} locations`);
    }
};

export const task__collect_cloudwise_cdrs = async () => {
    const { asset_id } = get_config();
    const cdrs = await get_user_cdrs({ asset_id });
    const parsed_cdrs = cdrs.map(parse_cdr);
    const cached_sessions: ChargingSession[] = cache_manager.getArrayData("cloudwise-sessions").filter((session: ChargingSession) => {
        return session.status === "completed" && !session.cdr_id;
    });
    logger.log(`Found ${cached_sessions.length} completed sessions without cdr`);
    if (cached_sessions.length) {
        const batch = db.batch();
        cached_sessions.forEach((session) => {
            if (!session.id) {
                return;
            }
            const session_id = session.id;
            delete session.id;
            const cdr = parsed_cdrs.find((cdr) => cdr.session_id === session_id);
            if (cdr) {
                const cdr_id = cdr.id;
                delete cdr.id;
                if (cdr_id) {
                    batch.set(db.collection("cloudwise-sessions").doc(session_id!), { ...session, cdr_id: cdr_id });
                    batch.set(db.collection("cloudwise-cdrs").doc(cdr_id), { ...cdr, car_number: session.car_number, timestamp: session.timestamp });
                }
            }
        });
        await batch.commit();
        logger.log(`Updated ${cached_sessions.length} sessions with cdr`);
    }
};
