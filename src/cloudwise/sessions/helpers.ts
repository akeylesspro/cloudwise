import { cache_manager, logger } from "akeyless-server-commons/managers";
import { EvseStatus, ParsedConnectorData, ParsedOcpiLocationData } from "../types";
import { Timestamp } from "firebase-admin/firestore";
import { get_session_status, get_config, get_location_details, session_command } from "../api/helpers";
import moment from "moment";
import { parse_cdr, parse_eves, parse_location } from "../helpers";
import { ChargingState, ClosestUpdatedLocationResult, GetDistanceMetersOptions, GetLocationsByGeoAndStatusOptions, ChargingSession } from "./types";
import { SessionCommandSettings } from "../api/types";
import { set_document, sleep } from "akeyless-server-commons/helpers";
import { retry } from "../helpers/retry";

/// ------------------ get locations by geo and status ------------------
export const get_distance_meters = ({ lat1, lat2, lng1, lng2 }: GetDistanceMetersOptions): number => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const get_locations_by_geo_and_status = async ({
    lat,
    lng,
    radius_in_meters,
    status = "BLOCKED",
}: GetLocationsByGeoAndStatusOptions): Promise<ParsedOcpiLocationData[]> => {
    const locations: ParsedOcpiLocationData[] = cache_manager.getArrayData("cloudwise-locations");
    const locations_data = locations.filter((location) => {
        const distance = get_distance_meters({
            lat1: lat,
            lng1: lng,
            lat2: location.lat,
            lng2: location.lng,
        });
        return distance <= radius_in_meters;
    });
    logger.log(`get_locations_by_geo_and_status: found ${locations_data.length} locations within ${radius_in_meters} meters`);
    const ocpi_locations: ParsedOcpiLocationData[] = [];
    for (const location of locations_data) {
        const location_details = await get_location_details(location.original_id, { party_id: location.party_id });
        const parsed_location = parse_location(location_details.Location);
        const parsed_evses = location_details.Evses.map(parse_eves);
        ocpi_locations.push({
            ...parsed_location,
            stations: parsed_evses,
            company_name: location.company_name,
            party_id: location.party_id,
            original_id: location.original_id,
        });
    }
    const result = ocpi_locations.filter((location) => location.stations.some((station) => station.status === status));
    logger.log(`get_locations_by_geo_and_status: found ${result.length} locations with status: ${status}`);
    return result;
};

/// ------------------ start session helpers------------------
const get_closest_updated_location = (
    locations: ParsedOcpiLocationData[],
    timestamp: Timestamp,
    status: EvseStatus = "BLOCKED"
): ClosestUpdatedLocationResult => {
    const { minimum_time_difference_of_plugin_in_seconds } = get_config();
    const threshold_ms = minimum_time_difference_of_plugin_in_seconds * 1000;
    let closestDiff = Number.POSITIVE_INFINITY;
    let closestResult: ClosestUpdatedLocationResult | null = null;

    const get_session_connector = (connectors: ParsedConnectorData[]): ParsedConnectorData => {
        if (connectors.length === 1) {
            return connectors[0];
        } else {
            return connectors.find((connector) => connector.standard !== "CHADEMO") || connectors[0];
        }
    };

    locations.forEach((location) => {
        location.stations
            .filter((station) => station.status === status)
            .forEach((station) => {
                const diff = Math.abs(timestamp.toMillis() - station.last_updated.toMillis());
                if (diff <= threshold_ms && diff < closestDiff) {
                    closestDiff = diff;
                    closestResult = {
                        location,
                        station,
                        last_updated: moment(station.last_updated.toDate()).format("YYYY-MM-DD HH:mm:ss"),
                        connector: get_session_connector(station.connectors),
                    };
                }
            });
    });
    if (!closestResult) {
        throw new Error(`No closest updated location found, ms: ${timestamp.toMillis()}, locations: ${JSON.stringify(locations)} `);
    }
    return closestResult;
};

const get_start_session_settings = async (charging_state_object: ChargingState): Promise<SessionCommandSettings> => {
    const { lat, lng, timestamp } = charging_state_object;
    let { radius_in_meters } = get_config();

    const request = async () =>
        await get_locations_by_geo_and_status({
            lat,
            lng,
            radius_in_meters,
        });

    const data: ParsedOcpiLocationData[] = await retry(request, {
        debug: true,
        retries: 3,
        throw_if_empty_result: true,
        delay: 10,
        on_retry_fn: () => {
            radius_in_meters += 50;
        },
    });

    const {
        location: { party_id, id: location_id },
        station: { uid: station_uid },
        connector: { id: connector_id },
    } = get_closest_updated_location(data, timestamp);

    const { asset_id, ble_id, device_id } = get_config();
    const command_options: SessionCommandSettings = {
        asset_id,
        ble_id,
        device_id,
        location_id,
        party_id,
        station_uid,
        connector_id,
        command: "START_SESSION",
    };
    return command_options;
};

/// ------------------ start session ------------------
export const start_session = async (charging_state_object: ChargingState) => {
    const { car_number } = charging_state_object;
    logger.log(`Starting session for car: "${car_number}" ...`);
    try {
        const command_settings = await get_start_session_settings(charging_state_object);
        const request = async () => await session_command(command_settings);
        const start_session_response = await retry(request, { retries: 3, random_delay: { min: 3, max: 5 }, debug: true });
        const { CommandId: session_id } = start_session_response;
        logger.log(`🟢 Session "${session_id}" started for car: "${car_number}"`);
        if (!session_id) {
            throw new Error("Session id not found in start session response");
        }
        delete command_settings.command;
        const session: ChargingSession = {
            ...command_settings,
            car_number,
            status: "started",
            started: Timestamp.now(),
            updated: Timestamp.now(),
        };
        await set_document("cloudwise-sessions", session_id, session);
        await set_document("cloudwise-charging-state", car_number, {
            ...charging_state_object,
            status: "charging",
            session_id,
            timestamp: Timestamp.now(),
        });

        ///  interval for test during session
        // setInterval(async () => {
        //     const { asset_id, ble_id, device_id } = get_config();
        //     const res = await get_session_status({ asset_id, ble_id, session_id, device_id });
        //     console.log("get_session_status", res);
        // }, 5 * 1000);
    } catch (error) {
        logger.error("🔴 Error in start_session", error);
        await set_document("cloudwise-charging-state", car_number, { ...charging_state_object, status: "error", timestamp: Timestamp.now() });
    }
};

/// ------------------ end session ------------------
export const stop_session = async (session_id: string, reason: string) => {
    logger.log(`Stopping session: "${session_id}" with reason: "${reason}" ...`);
    try {
        const sessions: ChargingSession[] = cache_manager.getArrayData("cloudwise-sessions");
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
        await retry(request, { retries: 3, delay: 30, debug: true });
        logger.log(`⛔ Session "${session_id}" stopped`);

        /// update session status
        await set_document("cloudwise-sessions", session_id, {
            ...session,
            status: "completed",
            updated: Timestamp.now(),
            ended: Timestamp.now(),
        });
        await set_document("cloudwise-charging-state", session.car_number, { status: "plugout", session_id: "", timestamp: Timestamp.now() });

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
            } = await get_session_status({ asset_id, ble_id, session_id, device_id });

            if (session_status.includes("COMPLETED")) {
                const update: any = { cost, count, kwh, charging_time_in_seconds, updated: Timestamp.now() };
                if (cdr) {
                    const parsed_cdr = parse_cdr(cdr);
                    const cdr_id = parsed_cdr.id;
                    delete parsed_cdr.id;
                    update.cdr_id = cdr_id;
                    await set_document("cloudwise-cdrs", cdr_id!, {
                        ...parsed_cdr,
                        session_id,
                        car_number: session.car_number,
                        nx_updated: Timestamp.now(),
                    });
                }
                await set_document("cloudwise-sessions", session_id, update);
            }
        }, 30 * 1000);
    } catch (error) {
        logger.error(`🔴 Error in stop session: ${session_id}`, error);
    }
};

/// ------------------ handle active session ------------------
export const handle_active_session = async (session_id: string) => {
    let timer: NodeJS.Timeout | undefined;
    const run = async () => {
        const { asset_id, ble_id, device_id } = get_config();
        try {
            const request = async () => await get_session_status({ asset_id, ble_id, session_id, device_id });
            const { CommandStatus } = await retry(request, { retries: 3, delay: 30, debug: true });
            if (CommandStatus.includes("ACTIVE")) {
                timer = setTimeout(run, 30 * 1000);
            } else {
                if (timer) {
                    clearTimeout(timer);
                }
                setTimeout(async () => {
                    const sessions = cache_manager.getArrayData("cloudwise-sessions");
                    const session = sessions.find((session) => session.id === session_id);
                    if (session && session.status !== "completed") {
                        await stop_session(session_id, `Session status is: ${CommandStatus}`);
                    }
                }, 10 * 1000);
            }
        } catch (error) {
            logger.error("🔴 Error in handle_active_session: cannot get session status", error);
            if (timer) {
                clearTimeout(timer);
            }
            const sessions = cache_manager.getArrayData("cloudwise-sessions");
            const session = sessions.find((session) => session.id === session_id);
            if (session) {
                await set_document("cloudwise-sessions", session_id, { status: "error", updated: Timestamp.now(), ended: Timestamp.now() });
            }
        }
    };
    try {
        await run();
    } catch (error) {
        logger.error("🔴 Error in handle_active_session: cannot run the interval", error);
    }
};

/// ------------------ handle charging state add and edit ------------------
const handle_status_change = async (charging_state_object: ChargingState) => {
    const { status, car_number } = charging_state_object;
    const { allowed_cars } = get_config();
    if (!allowed_cars.includes(car_number)) {
        return;
    }
    switch (status) {
        case "plugin":
            await start_session(charging_state_object);
            break;
        case "charging":
            await handle_active_session(charging_state_object.session_id!);
            break;
        // case "plugout":
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

export const handle_charging_state_add_and_edit = (charging_states: ChargingState[]) => {
    let prev: ChargingState[] = cache_manager.getArrayData("cloudwise-charging-state");
    const { allowed_cars } = get_config();
    charging_states.forEach((new_car) => {
        const old_car = prev.find((old) => old.car_number === new_car.car_number);
        if (!old_car) {
            if (allowed_cars.includes(new_car.car_number)) {
                logger.log(`🟢 new car: "${new_car.car_number}" entered with status: "${new_car.status}"`);
            }
            handle_status_change(new_car);
            prev = [...prev, new_car];
            return;
        }
        const [old_status, new_status] = [old_car.status, new_car.status];
        if (old_status !== new_status) {
            if (old_status === "charging" && new_status === "plugin") {
                logger.warn(`🚫⏩ get status change from charging to plugin, skipping ...`);
                return;
            }
            if (allowed_cars.includes(new_car.car_number)) {
                logger.log(`ℹ️ car: "${new_car.car_number}" got status changed from "${old_status}" to "${new_status}"`);
            }
            handle_status_change(new_car);
        }
        prev = prev.map((old) => (old.car_number === new_car.car_number ? new_car : old));
    });
    cache_manager.setArrayData("cloudwise-charging-state", prev);
};
