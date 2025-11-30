import { Service } from "akeyless-server-commons/types";
import { get_location_details } from "./cloudwise_api/helpers";
import { init_env_variables, json_failed, json_ok } from "akeyless-server-commons/helpers";
import { get_cdrs as get_cdrs_helper, get_distance_meters, parse_eves, parse_location } from "./helpers";
import { cache_manager, logger } from "akeyless-server-commons/managers";
import { ParsedOcpiLocationData } from "./types";
import { stop_session } from "./sessions";
import { TObject } from "akeyless-types-commons";
import { SessionSimulationConfig, run_simulator, simulator_config } from "./simulator";
import { ChargingSession } from "./sessions/types";

export const get_location_status: Service = async (req, res) => {
    const { original_id, party_id } = req.query as TObject<string>;
    try {
        const location: ParsedOcpiLocationData | undefined = cache_manager
            .getArrayData("nx-charge-locations")
            .find((v) => v.original_id === original_id && v.party_id === party_id);
        if (!location) {
            throw new Error("Location not found");
        }
        const location_details = await get_location_details(original_id, { party_id: location.party_id });
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
    const { car_number, lat, lng, duration_seconds, target_kwh, location_id, party_id } = req.body;
    try {
        const config: SessionSimulationConfig = {
            car_number,
            lat: lat ? Number(lat) : undefined,
            lng: lng ? Number(lng) : undefined,
            duration_seconds: duration_seconds ? Number(duration_seconds) : undefined,
            target_kwh: target_kwh ? Number(target_kwh) : undefined,
            location_id,
            party_id,
        };
        simulator_config.enabled = true;
        const result = await run_simulator(config);
        const { simulator: simulator_env } = init_env_variables();
        simulator_config.enabled = simulator_env === "true";
        res.json(json_ok({ session_id: result.session_id, completed: result.completed }));
    } catch (error) {
        res.json(json_failed(error));
        logger.error(`Error in run_simulator, car number: ${car_number}`, error);
    }
};
