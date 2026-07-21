import { Service } from "akeyless-server-commons/types";
import { get_config, get_location_details } from "./cloudwise_api/helpers";
import { json_failed, json_ok } from "akeyless-server-commons/helpers";
import { get_cdrs as get_cdrs_helper, get_distance_meters, parse_stations, parse_location } from "./helpers";
import { cache_manager, logger } from "akeyless-server-commons/managers";
import { Evse, EvseConnectorStandard, EvseStatus, ParsedOcpiLocationData, ParsedStationData } from "./types";
import { start_session_api, stop_session } from "./sessions";
import { TObject } from "akeyless-types-commons";
import { run_simulator } from "./simulator";
import { ChargingSession } from "./sessions/types";
import { SessionCommandConfig } from "./cloudwise_api/types";
import { task__collect_charge_locations } from "./tasks";

const relevant_statuses: EvseStatus[] = ["AVAILABLE", "PREPARING", "BLOCKED", "CHARGING"];
const relevant_standards: EvseConnectorStandard[] = ["IEC_62196_T2", "IEC_62196_T2_COMBO"];

export const service__fetch_all_locations: Service = async (req, res) => {
    try {
        await task__collect_charge_locations();
        res.json(json_ok({ message: "All locations fetched" }));
    } catch (error) {
        logger.error(`Error in service__fetch_all_locations`, error);
        res.json(json_failed(error));
    }
};

export const service__get_location_status: Service = async (req, res) => {
    const { original_id, party_id } = req.query as TObject<string>;
    try {
        const location: ParsedOcpiLocationData | undefined = cache_manager
            .getArrayData("nx-charge-locations")
            .find((v) => v.original_id === original_id && v.party_id === party_id);
        if (!location) {
            throw new Error("Location not found");
        }
        const location_details = await get_location_details(original_id, { party_id: location.party_id, car_number: "" });
        if (!location_details?.Location) {
            throw new Error("Location details not found");
        }
        const parsed_location = parse_location(location_details.Location);
        const parsed_stations = location_details.Evses.map(parse_stations);
        res.json(json_ok({ ...parsed_location, stations: parsed_stations }));
    } catch (error) {
        logger.error(`Error in service__get_location_status, location id: ${original_id}`, error);
        res.json(json_failed(error));
    }
};

export const service__get_location_details: Service = async (req, res) => {
    const { id } = req.params as TObject<string>;
    try {
        const location: ParsedOcpiLocationData | undefined = cache_manager.getArrayData("nx-charge-locations").find((v) => v.id === id);
        if (!location) {
            throw new Error("Location not found");
        }
        const location_current_details = await get_location_details(location.original_id, { party_id: location.party_id, car_number: "" });
        if (!location_current_details?.Location) {
            throw new Error("Location details not found");
        }
        const parsed_location = parse_location(location_current_details.Location);
        const parsed_stations: ParsedStationData[] = location_current_details.Evses.map(parse_stations);
        const stations = parsed_stations
            .filter((station) => relevant_statuses.includes(station.status))
            .map((station) => {
                const { id, uid, status, connectors, reference } = station;
                return {
                    id,
                    uid,
                    status,
                    reference,
                    connector: connectors[0],
                };
            })
            .filter((station) => station.connector)
            .map((station) => {
                const { id, uid, status, connector, reference } = station;
                const {
                    id: connector_id,
                    standard,
                    format,
                    power_type,
                    max_electric_power: max_power,
                    connection_fee,
                    price_per_kwh: price_kwh,
                } = connector;
                const is_cable_included = format === "CABLE";
                return {
                    id,
                    uid,
                    status,
                    reference,
                    connector: {
                        id: connector_id,
                        standard,
                        cable_included: is_cable_included,
                        power_type,
                        max_power,
                        connection_fee,
                        price_kwh,
                    },
                };
            });

        if (stations.length === 0) {
            throw new Error("Location has no stations with valid statuses");
        }

        const { address, lat, lng, company_name } = parsed_location;
        const { name, image = "" } = location;
        res.json(
            json_ok({
                location: {
                    id,
                    name,
                    company_name,
                    image,
                    address,
                    lat,
                    lng,
                    stations,
                },
            })
        );
    } catch (error) {
        logger.error(`Error in service__get_location_details, id: ${id}`, error);
        res.json(json_failed(error));
    }
};

export const service__stop_session: Service = async (req, res) => {
    const { car_number } = req.body;
    logger.log(`🦋 Stopping session for car: "${car_number}"`);
    const sessions: ChargingSession[] = cache_manager.getArrayData("nx-charge-sessions");
    const filter_sessions = sessions.filter((session) => session.car_number === car_number && session.status === "started");
    if (filter_sessions.length === 0) {
        throw new Error("No session found");
    }
    const session = filter_sessions.sort((a, b) => b.started.toDate().getTime() - a.started.toDate().getTime())[0];
    try {
        await stop_session(session.id!, { message: "API call" });
        res.json(json_ok({ message: "Session stopped" }));
    } catch (error) {
        logger.error(`Error in service__stop_session, car number: ${car_number}`, error);
        res.json(json_failed(error));
    }
};

interface StartSessionApiOptions {
    car_number: string;
    location_id: string;
    station_uid: string;
    connector_id: string;
}

export const service__start_session: Service = async (req, res) => {
    const { car_number, location_id, station_uid, connector_id } = req.body as StartSessionApiOptions;
    logger.log(`🦋 Starting session for car: "${car_number}"`, req.body);
    try {
        const { asset_id, ble_id, device_id } = get_config();
        const config: SessionCommandConfig = {
            asset_id,
            ble_id,
            device_id,
            car_number,
            location_id,
            station_uid,
            connector_id,
        };
        const session_id = await start_session_api(config);
        if (!session_id) {
            throw new Error("Failed to start session");
        }
        res.send(json_ok({ session_id }));
    } catch (error) {
        logger.error(`Error in service__start_session, car number: ${car_number}`, error);
        res.send(json_failed(error));
    }
};

export const service__get_cdrs: Service = async (req, res) => {
    const { car_number, limit, offset } = req.body;
    try {
        const cdrs = get_cdrs_helper(car_number, { limit, offset });
        res.json(json_ok({ cdrs }));
    } catch (error) {
        res.json(json_failed(error));
        logger.error(`Error in service__get_cdrs, car number: ${car_number}`, error);
    }
};

interface GetLocationsOptions {
    limit?: number;
    id?: string;
    offset?: number;
    radius?: number;
    lat?: number;
    lng?: number;
    operator_name?: string;
}

export const service__get_locations: Service = async (req, res) => {
    const { limit = 9999, offset = 0, radius = 1000 * 10, lat, lng, operator_name, id } = req.body as GetLocationsOptions;
    try {
        let locations: ParsedOcpiLocationData[] = cache_manager.getArrayData("nx-charge-locations").filter((location) => location.party_id !== "EDG");
        if (operator_name) {
            locations = locations.filter((location) => location.company_name.toLowerCase() === operator_name.toLowerCase());
        }
        if (id) {
            locations = locations.filter((location) => location.id === id);
        }
        if (lat && lng) {
            locations = locations.filter((location) => {
                const distance = get_distance_meters({ lat1: lat, lng1: lng, lat2: location.lat, lng2: location.lng });
                return distance <= radius;
            });
        }

        //-- keep only relevant locations
        locations = locations
            .map((location) => {
                //-- keep only connectors with standards relevant to Israel.
                location.stations = location.stations
                    .map((station) => {
                        station.connectors = station.connectors.filter((connector) =>
                            relevant_standards.includes(connector.standard as EvseConnectorStandard)
                        );
                        return station;
                    })
                    .filter(
                        (station) =>
                            station.connectors.length > 0 &&
                            relevant_statuses.includes(station.status) &&
                            relevant_standards.includes(station.connectors[0].standard as EvseConnectorStandard)
                    );
                return location;
            })
            .filter((location) => {
                const is_in_israel = location.lat >= 29.0 && location.lat <= 33.5 && location.lng >= 34.2 && location.lng <= 35.9;
                return is_in_israel && location.stations.length > 0;
            });

        locations = locations.slice(offset, offset + limit);
        res.json(json_ok({ locations }));
    } catch (error) {
        logger.error(`Error in service__get_locations`, error);
        res.json(json_failed(error));
    }
};

export const service__simulate_session: Service = async (req, res) => {
    try {
        run_simulator(req.body).catch((e) => {
            logger.error(`Error in simulate_session_service, car number: ${req.body.car_number}`, e);
        });
        res.json(json_ok({ message: "simulator started" }));
    } catch (error) {
        res.json(json_failed(error));
        logger.error(`Error in service__simulate_session, car number: ${req.body.car_number}`, error);
    }
};
