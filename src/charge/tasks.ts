import { db, execute_task, init_env_variables, TaskName } from "akeyless-server-commons/helpers";
import { parse_cdr, parse_ocpi_location } from "./helpers";
import { ParsedOcpiLocationData } from "./types";
import { cache_manager, logger } from "akeyless-server-commons/managers";
import { isEqual } from "lodash";
import { get_config, get_locations, get_user_cdrs, login } from "./cloudwise_api/helpers";
import { ChargingSession } from "./sessions/types";
import { charge_cdr } from "./sessions";

export const run_tasks = async () => {
    const env_data = init_env_variables(["run_tasks"]);
    if (env_data.run_tasks == "true") {
        const hour = 60 * 60 * 1000;
        /// login
        setInterval(login, hour);
        /// collect locations
        execute_task("nx-charge", TaskName.collect_charge_locations, task__collect_charge_locations);
        setInterval(() => {
            execute_task("nx-charge", TaskName.collect_charge_locations, task__collect_charge_locations);
        }, 10 * 1000);
        /// collect cdrs
        execute_task("nx-charge", TaskName.collect_charge_cdrs, task__collect_charge_cdrs, { debug_logs: false });
        setInterval(() => {
            execute_task("nx-charge", TaskName.collect_charge_cdrs, task__collect_charge_cdrs, { debug_logs: false });
        }, 5 * 60 * 1000);
    }
};

export const task__collect_charge_locations = async () => {
    const locations = await get_locations();
    const parsed_data = locations.map(parse_ocpi_location);
    const cached_location: ParsedOcpiLocationData[] = cache_manager.getArrayData("nx-charge-locations");
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
            batch.set(db.collection("nx-charge-locations").doc(loc.id), clone);
        });
        await batch.commit();
        logger.log(`Updated ${need_to_update.length} locations`);
    }
};

export const task__collect_charge_cdrs = async () => {
    const { asset_id, task_collect_cdr_debug } = get_config();
    const cdrs = await get_user_cdrs({ asset_id, car_number: "" });
    const parsed_cdrs = cdrs.map(parse_cdr);
    const cached_sessions: ChargingSession[] = cache_manager.getArrayData("nx-charge-sessions").filter((session: ChargingSession) => {
        return session.id && session.status !== "started" && !session.cdr_id;
    });
    if (task_collect_cdr_debug) {
        logger.log(`🔍 Found ${cached_sessions.length} completed sessions without CDR`);
        logger.log(
            "Sessions ids: ",
            cached_sessions.map((session) => session.id)
        );
    }
    const debug_result: any[] = [];
    if (cached_sessions.length) {
        const batch = db.batch();
        cached_sessions.forEach(async (session) => {
            if (!session.id) {
                return;
            }
            const session_id = session.id;
            const cdr = parsed_cdrs.find((cdr) => cdr.session_id === session_id);
            if (cdr) {
                const cdr_id = cdr.id;
                if (cdr_id) {
                    const current_cdr = cache_manager.getArrayData("nx-charge-cdrs").find((cdr) => cdr.id === cdr_id);
                    if (current_cdr?.paid) {
                        return;
                    }
                    const is_charged = await charge_cdr(session as ChargingSession, cdr);
                    delete (session as any).id;
                    delete cdr.id;
                    batch.set(db.collection("nx-charge-sessions").doc(session_id!), { cdr_id: cdr_id }, { merge: true });
                    batch.set(db.collection("nx-charge-cdrs").doc(cdr_id), {
                        ...cdr,
                        car_number: session.car_number,
                        nx_updated: session.updated,
                        paid: is_charged,
                    });
                    debug_result.push({ session_id, cdr_id });
                }
            }
        });
        await batch.commit();
        if (task_collect_cdr_debug) {
            logger.log(`✔️ updated ${debug_result.length} sessions CDRs`);
        }
    }
};
