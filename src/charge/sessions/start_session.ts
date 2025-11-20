import { cache_manager, logger } from "akeyless-server-commons/managers";
import { EvseStatus, ParsedConnectorData, ParsedOcpiLocationData } from "../types";
import type { ChargingState, ClosestUpdatedLocationResult, GetLocationsByGeoAndStatusOptions, ChargingSession } from "./types";
import { Timestamp } from "firebase-admin/firestore";
import { get_config, get_location_details, session_command } from "../cloudwise_api/helpers";
import moment from "moment";
import { check_car_charge_credit_balance, get_distance_meters, parse_eves, parse_location } from "../helpers";
import { SendCommandResponse, SessionCommandSettings } from "../cloudwise_api/types";
import { send_sms, set_document, timestamp_to_string } from "akeyless-server-commons/helpers";
import { retry } from "../helpers/retry";

/// ------------------ start session (main function) ------------------
export const start_session = async (charging_state_object: ChargingState) => {
    const { car_number, lat, lng } = charging_state_object;
    logger.log(`Starting session for car: "${car_number}" ...`, { lat, lng });
    try {
        /// step 1: check credit balance
        await check_credit_balance(car_number);
        /// steps 2 & 3: get start session settings (closest location and connector)
        const command_settings = await get_start_session_settings(charging_state_object);
        /// step 4: send start session command
        const session_id = await send_start_session_command(command_settings);
        logger.log(`🟢 Session "${session_id}" started for car: "${car_number}"`);
        delete command_settings.command;
        const session: ChargingSession = {
            ...command_settings,
            car_number,
            status: "started",
            started: Timestamp.now(),
            updated: Timestamp.now(),
        };
        await set_document("nx-charge-sessions", session_id, session);
        await set_document("nx-charge-state", car_number, {
            ...charging_state_object,
            status: "charging",
            session_id,
            timestamp: Timestamp.now(),
        });
        if (car_number === "16457003") {
            send_sms("0522614678", `היי נאור אילן עם רכב מספר ${car_number} התחיל טעינה בהצלחה`, "naor tests");
        }
        ///  interval for test during session
        // setInterval(async () => {
        //     const { asset_id, ble_id, device_id } = get_config();
        //     const res = await get_session_status({ asset_id, ble_id, session_id, device_id });
        //     console.log("get_session_status", res);
        // }, 5 * 1000);
    } catch (error: any) {
        logger.error("🔴 Error in start_session", error);
        await set_document("nx-charge-state", car_number, {
            ...charging_state_object,
            status: "error",
            timestamp: Timestamp.now(),
            message: error.message || "unknown error",
        });
    }
};

const check_credit_balance = async (car_number: string) => {
    const { is_has_balance } = await check_car_charge_credit_balance(car_number);
    if (!is_has_balance) {
        logger.error(`🔴 Car "${car_number}" does not have enough balance`);
        throw new Error("start_step_1__failed_to_check_car_charge_credit_balance");
    }
    return is_has_balance;
};

const get_locations_by_geo_and_status = async ({
    lat,
    lng,
    radius_in_meters,
    statuses = ["BLOCKED", "PREPARING"],
}: GetLocationsByGeoAndStatusOptions): Promise<ParsedOcpiLocationData[]> => {
    const locations: ParsedOcpiLocationData[] = cache_manager.getArrayData("nx-charge-locations");
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
    const result = ocpi_locations.filter((location) => location.stations.some((station) => statuses.includes(station.status)));
    logger.log(`get_locations_by_geo_and_status: found ${result.length} locations with statuses: ${statuses.join(", ")}`);
    return result;
};

const get_closest_locations = async (charging_state_object: ChargingState): Promise<ParsedOcpiLocationData[]> => {
    const { lat, lng } = charging_state_object;
    try {
        let { radius_in_meters } = get_config();
        const request = async () =>
            await get_locations_by_geo_and_status({
                lat,
                lng,
                radius_in_meters,
            });

        const request_config = {
            debug: true,
            retries: 3,
            throw_if_empty_result: true,
            random_delay: { min: 5, max: 10 },
            on_retry_fn: () => {
                radius_in_meters += 50;
            },
            name: "get_locations_by_geo_and_status",
        };
        const closest_locations: ParsedOcpiLocationData[] = await retry(request, request_config);
        return closest_locations;
    } catch (error) {
        logger.error(`🔴 Error in get_closest_locations ${JSON.stringify({ lat, lng })}`, error);
        throw new Error("start_step_2__failed_to_get_closest_locations");
    }
};

/// ------------------ start session helpers------------------
const get_last_updated_location = (
    locations: ParsedOcpiLocationData[],
    timestamp: Timestamp,
    statuses: EvseStatus[] = ["BLOCKED", "PREPARING"]
): ClosestUpdatedLocationResult => {
    try {
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
                .filter((station) => statuses.includes(station.status))
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
            const timestamps = locations
                .map((location) =>
                    location.stations.map((station) => ({
                        timestamp: timestamp_to_string(station.last_updated as any),
                        name: location.name,
                        location_id: location.id,
                        station_uid: station.uid,
                    }))
                )
                .flat();
            throw new Error(
                `No closest updated location found, plugin time: ${timestamp_to_string(timestamp as any)}, locations: ${JSON.stringify(timestamps)} `
            );
        }
        return closestResult;
    } catch (error) {
        logger.error(`🔴 Error in get_last_updated_location`, error);
        throw new Error("start_step_3__failed_to_get_last_updated_location");
    }
};

const get_start_session_settings = async (charging_state_object: ChargingState): Promise<SessionCommandSettings> => {
    const { timestamp } = charging_state_object;
    /// locations with distance less than "radius_in_meters" and with statuses: BLOCKED, PREPARING
    const closest_locations = await get_closest_locations(charging_state_object);
    /// get the location that match the closest updated time
    const {
        location,
        station: { uid: station_uid },
        connector: { id: connector_id },
    } = get_last_updated_location(closest_locations, timestamp);
    const { party_id, id: location_id } = location;

    logger.log(`🟢 Closest updated location found: ${JSON.stringify(location)}`);
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

const send_start_session_command = async (command_settings: SessionCommandSettings): Promise<string> => {
    try {
        const request = async () => await session_command(command_settings);
        const request_config = { retries: 3, random_delay: { min: 3, max: 10 }, debug: true, name: "send_start_session_command" };
        const response = await retry(request, request_config);
        const { CommandId: session_id } = response;
        if (!session_id) {
            throw new Error("Session id not found in start session response");
        }
        return session_id;
    } catch (error) {
        logger.error(`🔴 Error in send_start_session_command: ${JSON.stringify(command_settings)}`, error);
        throw new Error("start_step_4__failed_to_send_send_start_session_command");
    }
};
