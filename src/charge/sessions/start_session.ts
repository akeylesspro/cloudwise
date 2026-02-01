import { cache_manager, logger } from "akeyless-server-commons/managers";
import { EvseStatus, ParsedConnectorData, ParsedOcpiLocationData } from "../types";
import type { ChargingState, ClosestUpdatedLocationResult, GetLocationsByGeoAndStatusOptions, ChargingSession } from "./types";
import { Timestamp } from "firebase-admin/firestore";
import { get_config, get_location_details, session_command } from "../cloudwise_api/helpers";
import moment from "moment";
import { check_charge_balance, get_distance_meters, parse_eves, parse_location } from "../helpers";
import { SessionCommandConfig } from "../cloudwise_api/types";
import { send_sms, set_document, timestamp_to_string } from "akeyless-server-commons/helpers";
import { retry } from "../helpers/retry";
import { stop_session } from "./stop_session";

/// ------------------ start session (main function) ------------------
export const start_session = async (charging_state_object: ChargingState) => {
    const { car_number, lat, lng } = charging_state_object;
    const maps_url = `https://www.google.com/maps?q=${lat},${lng}`;
    logger.log(`Starting session for car: "${car_number}" ...`, { maps_url });
    let session_id: string | undefined;
    try {
        /// step 1: check credit balance
        await validate_credit(car_number);
        /// steps 2 & 3: get start session settings (closest location and connector)
        const command_config = await get_start_session_config(charging_state_object);
        /// step 4: send start session command
        session_id = await send_start_session_command(command_config);
        /// step 5: update collections
        await update_collections(command_config, charging_state_object, car_number, session_id);
        logger.log(`🟢 Session "${session_id}" started for car: "${car_number}"`);
        if (car_number === "16457003") {
            send_sms("0522614678", `היי נאור אילן עם רכב מספר ${car_number} התחיל טעינה בהצלחה`, "naor tests");
        }
        return session_id;
    } catch (error: any) {
        logger.error("🔴 Error in start_session", error);
        if (session_id) {
            await stop_session(session_id, { message: error.message || "unknown error", status: "error" });
        } else {
            await set_document("nx-charge-state", car_number, {
                ...charging_state_object,
                ocpi_status: "error",
                timestamp: Timestamp.now(),
                message: error.message || "unknown error",
            });
        }
    }
};

const validate_credit = async (car_number: string) => {
    const { is_has_balance } = await check_charge_balance(car_number);
    if (!is_has_balance) {
        logger.error(`🔴 Car "${car_number}" does not have enough balance`);
        throw new Error("start_step_1__failed_to_check_car_charge_credit_balance");
    }
    return is_has_balance;
};

const get_locations_by_geo_and_status = async ({
    car_number,
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
        const location_details = await get_location_details(location.original_id, { party_id: location.party_id, car_number });
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
    if (result.length === 0 && ocpi_locations.length > 0) {
        logger.error(
            `get_locations_by_geo_and_status: no locations found with statuses: ${statuses.join(", ")}`,
            ocpi_locations.map((location) => ({
                location_name: location.name,
                location_id: location.id,
                stations_statuses: location.stations.map((station) => station.status),
            }))
        );
    } else {
        logger.log(`get_locations_by_geo_and_status: found ${result.length} locations with statuses: ${statuses.join(", ")}`);
    }
    return result;
};

const get_closest_locations = async (charging_state_object: ChargingState): Promise<ParsedOcpiLocationData[]> => {
    const { lat, lng } = charging_state_object;
    try {
        let { radius_in_meters } = get_config();
        const request = async () =>
            await get_locations_by_geo_and_status({
                car_number: charging_state_object.car_number,
                lat,
                lng,
                radius_in_meters,
            });

        const request_config = {
            debug: true,
            retries: 5,
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
        const maps_url = `https://www.google.com/maps?q=${lat},${lng}`;
        logger.error(`🔴 Error in get_closest_locations ${JSON.stringify({ maps_url })}`, error);
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
        let closest_diff = Number.POSITIVE_INFINITY;
        let closest_result: ClosestUpdatedLocationResult | null = null;

        const get_session_connector = (connectors: ParsedConnectorData[]): ParsedConnectorData => {
            if (connectors.length === 1) {
                return connectors[0];
            } else {
                return connectors.find((connector) => connector.standard !== "CHADEMO") || connectors[0];
            }
        };
        if (locations.length === 1) {
            const filtered_stations = locations[0].stations.filter((station) => statuses.includes(station.status));
            if (filtered_stations.length === 1) {
                closest_result = {
                    location: locations[0],
                    station: filtered_stations[0],
                    last_updated: moment(filtered_stations[0].last_updated.toDate()).format("YYYY-MM-DD HH:mm:ss"),
                    connector: get_session_connector(filtered_stations[0].connectors),
                };
                return closest_result;
            }
        }
        locations.forEach((location) => {
            location.stations
                .filter((station) => statuses.includes(station.status))
                .forEach((station) => {
                    const diff = Math.abs(timestamp.toMillis() - station.last_updated.toMillis());
                    // if (diff <= threshold_ms && diff < closestDiff) {
                    if (diff < closest_diff) {
                        closest_diff = diff;
                        closest_result = {
                            location,
                            station,
                            last_updated: moment(station.last_updated.toDate()).format("YYYY-MM-DD HH:mm:ss"),
                            connector: get_session_connector(station.connectors),
                        };
                    }
                });
        });
        if (!closest_result) {
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
        return closest_result;
    } catch (error) {
        logger.error(`🔴 Error in get_last_updated_location`, error);
        throw new Error("start_step_3__failed_to_get_last_updated_location");
    }
};

const get_start_session_config = async (charging_state_object: ChargingState): Promise<SessionCommandConfig> => {
    /// locations with distance less than "radius_in_meters" and with statuses: BLOCKED, PREPARING
    const closest_locations = await get_closest_locations(charging_state_object);
    /// get the location that match the closest updated time
    const {
        location,
        station: { uid: station_uid },
        connector: { id: connector_id },
    } = get_last_updated_location(closest_locations, charging_state_object.timestamp);
    const { party_id, id: location_id } = location;

    logger.log(`🟢 Closest updated location found: ${JSON.stringify(location)}`);
    const { asset_id, ble_id, device_id } = get_config();
    const command_config: SessionCommandConfig = {
        car_number: charging_state_object.car_number,
        asset_id,
        ble_id,
        device_id,
        location_id,
        party_id,
        station_uid,
        connector_id,
        command: "START_SESSION",
    };
    return command_config;
};

// ------------------ start session command ------------------
const send_start_session_command = async (command_settings: SessionCommandConfig): Promise<string> => {
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

// ------------------ update collections ------------------
const update_collections = async (config: SessionCommandConfig, state_object: ChargingState, car_number: string, session_id: string) => {
    try {
        delete config.command;
        const session: Omit<ChargingSession, "id"> = {
            ...config,
            car_number,
            lat: state_object.lat,
            lng: state_object.lng,
            status: "started",
            started: Timestamp.now(),
            updated: Timestamp.now(),
        };
        await set_document("nx-charge-sessions", session_id, session);
        await set_document("nx-charge-state", car_number, {
            ...state_object,
            ocpi_status: "charging",
            session_id,
            timestamp: Timestamp.now(),
        });
    } catch (error) {
        logger.error(`🔴 Error in update_collections: ${session_id}`, JSON.stringify(error));
        throw new Error("start_step_5__failed_to_update_collections");
    }
};
