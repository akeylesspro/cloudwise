import { Service } from "akeyless-server-commons/types";
import { get_config, get_location_details } from "./cloudwise_api/helpers";
import { init_env_variables, json_failed, json_ok } from "akeyless-server-commons/helpers";
import { get_cdrs as get_cdrs_helper, get_distance_meters, parse_eves, parse_location } from "./helpers";
import { cache_manager, logger } from "akeyless-server-commons/managers";
import { ParsedOcpiLocationData } from "./types";
import { start_session_api, stop_session } from "./sessions";
import { TObject } from "akeyless-types-commons";
import { run_simulator } from "./simulator";
import { ChargingSession } from "./sessions/types";
import { SessionCommandConfig } from "./cloudwise_api/types";

export const get_location_status: Service = async (req, res) => {
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
        const parsed_evses = location_details.Evses.map(parse_eves);
        res.json(json_ok({ ...parsed_location, stations: parsed_evses }));
    } catch (error) {
        res.json(json_failed(error));
        logger.error(`Error in get_location_status, location id: ${original_id}`, error);
    }
};

export const stop_session_service: Service = async (req, res) => {
    const { car_number } = req.body;
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
        logger.error(`Error in stop session service for car number: ${car_number}`, error);
        res.json(json_failed(error));
    }
};

interface StartSessionApiOptions {
    car_number: string;
    location_id: string;
    station_uid: string;
    connector_id: string;
}
export const start_session_service: Service = async (req, res) => {
    const { car_number, location_id, station_uid, connector_id } = req.body as StartSessionApiOptions;
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
        logger.error(`Error in start_session_service, car number: ${car_number}`, error);
        res.send(json_failed({ error, config: req.body }));
    }
};

export const get_cdrs: Service = async (req, res) => {
    const { car_number, limit, offset } = req.body;
    try {
        const cdrs = get_cdrs_helper(car_number, { limit, offset });
        res.json(json_ok({ cdrs }));
    } catch (error) {
        res.json(json_failed(error));
        logger.error(`Error in get_cdrs, car number: ${car_number}`, error);
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
export const get_locations: Service = async (req, res) => {
    const { limit = 9999, offset = 0, radius = 1000 * 10, lat, lng, operator_name, id } = req.body as GetLocationsOptions;
    try {
        let locations: ParsedOcpiLocationData[] = cache_manager.getArrayData("nx-charge-locations");
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
        locations = locations.slice(offset, offset + limit);
        res.json(json_ok({ locations }));
    } catch (error) {
        logger.error(`Error in get_locations`, error);
        res.json(json_failed(error));
    }
};

export const simulate_session_service: Service = async (req, res) => {
    try {
        run_simulator(req.body).catch((e) => {
            logger.error(`Error in simulate_session_service, car number: ${req.body.car_number}`, e);
        });
        res.json(json_ok({ message: "simulator started" }));
    } catch (error) {
        res.json(json_failed(error));
        logger.error(`Error in simulate_session_service, car number: ${req.body.car_number}`, error);
    }
};
