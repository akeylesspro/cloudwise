import { cache_manager, logger } from "akeyless-server-commons/managers";
import axios, { AxiosRequestConfig } from "axios";
import { mock_get_command_status, mock_get_location_details, mock_get_user_cdrs, mock_send_command } from "../simulator/mock_store";
import {
    CloudwiseConfig,
    GetLocationsOptions,
    GetLocationsResponse,
    GetLocationDetailsOptions,
    GetLocationDetailsResponse,
    SessionCommandConfig,
    SendCommandResponse,
    GetSessionStatusOptions,
    GetCommandStatusResponse,
    UserCdrsOptions,
    UserCdrsResponse,
} from "./types";

const should_handle_mock = (url: string, car_number: string): boolean => {
    if (!car_number) {
        return false;
    }
    const { simulator_list } = get_config();
    if (!simulator_list.includes(car_number)) {
        return false;
    }
    const is_endpoint = ["sendCommand", "getCommandStatus", "getUserCdrs", "getLocationDetails"].some((endpoint) => url.includes(endpoint));
    return is_endpoint;
};

const handle_mock_request = async (url: string, payload?: any) => {
    logger.log("🤖 API interceptor is handling mock request ...", { url, payload });
    const extract_endpoint = (url: string): string => {
        if (url.includes("sendCommand")) return "sendCommand";
        if (url.includes("getCommandStatus")) return "getCommandStatus";
        if (url.includes("getUserCdrs")) return "getUserCdrs";
        if (url.includes("getLocationDetails")) return "getLocationDetails";
        return "unknown";
    };
    const endpoint = extract_endpoint(url);
    switch (endpoint) {
        case "sendCommand":
            return mock_send_command(payload);
        case "getCommandStatus":
            return mock_get_command_status(payload);
        case "getUserCdrs":
            return mock_get_user_cdrs(payload);
        case "getLocationDetails":
            return mock_get_location_details(payload);
        default:
            return axios.post(url, payload);
    }
};

const get_token = (): string => {
    return cache_manager.getObjectData("cloudwise-token", {}).value || "";
};

export const get_config = (): CloudwiseConfig => {
    const config = cache_manager.getObjectData("nx-settings", {}).cloudwise || {};
    config.token = get_token();
    if (config.id) {
        delete config.id;
    }
    return config;
};

export const cloudwise_request = async <T = any>(endpoint: string, payload: Record<string, any>, timeout_in_sec?: number): Promise<T> => {
    const now = new Date().getTime();
    try {
        const { base_url, token } = get_config();
        const final_url = `${base_url}/${endpoint}`;
        if (should_handle_mock(final_url, payload.car_number)) {
            return handle_mock_request(final_url, payload) as T;
        }
        logger.log("ℹ️ Sending request to Cloudwise", { endpoint, payload });
        const { car_number, ...payload_to_send } = payload;
        const response = await axios.post(
            final_url,
            {
                FirebaseToken: token,
                ...payload_to_send,
            },
            { timeout: (timeout_in_sec ?? 30) * 1000 }
        );
        const data = response.data || {};
        const { ErrorCode } = data;
        if (ErrorCode && ErrorCode > 0) {
            throw new Error(JSON.stringify(data));
        }
        return data as T;
    } catch (error: any) {
        const duration = new Date().getTime() - now;
        logger.error(`❌ cloudwise_request error: "${endpoint}" (${duration}ms), payload: ${JSON.stringify(payload)}`, error);
        throw error;
    }
};

export const login = async (): Promise<string> => {
    try {
        const { login_key, email, password } = get_config();
        const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${login_key}`;
        const response = await axios.post(
            url,
            {
                email,
                password,
                returnSecureToken: true,
            },
            { timeout: 30 * 1000 }
        );
        const token = response.data.idToken;
        cache_manager.setObjectData("cloudwise-token", { value: token });
        return token;
    } catch (error) {
        logger.error("Cloudwise login failed", error);
        throw error;
    }
};

export const get_locations = async (options?: GetLocationsOptions): Promise<GetLocationsResponse["Items"]> => {
    const { radius = 10 * 1000, limit = 99999999, offset = 0, lat = 0, lng = 0, time_zone = 0 } = options || {};
    const { Items = [] } = await cloudwise_request<GetLocationsResponse>("getLocations", {
        lat,
        lon: lng,
        radius,
        Skip: offset,
        PageSize: limit,
        TimeZone: time_zone,
    });

    return Items;
};

export const get_location_details = async (
    locationId: string | number,
    options: GetLocationDetailsOptions
): Promise<GetLocationDetailsResponse["Location"]> => {
    const { party_id, country_code = "IL", car_number } = options;
    const { Location } = await cloudwise_request<GetLocationDetailsResponse>("getLocationDetails", {
        LocationId: locationId,
        PartyID: party_id,
        CountryCode: country_code,
        car_number,
    });
    return Location;
};

export const session_command = async (config: SessionCommandConfig, timeout_in_sec?: number): Promise<SendCommandResponse> => {
    const {
        location_id,
        party_id,
        command = "START_SESSION",
        station_uid: evse_uid,
        connector_id,
        ble_id,
        device_id,
        asset_id,
        session_id,
        ignore_distance_check = false,
        country_code = "IL",
        lat = 0.0,
        lng = 0.0,
        car_number,
    } = config || {};

    const data = await cloudwise_request<SendCommandResponse>(
        "sendCommand",
        {
            command,
            LocationId: location_id,
            PartyID: party_id,
            CountryCode: country_code,
            commandId: session_id,
            evseUid: evse_uid,
            connectorId: connector_id,
            ignoreDistanceCheck: ignore_distance_check,
            BleId: ble_id,
            DeviceId: device_id,
            AssetId: asset_id,
            Latitude: lat,
            Longitude: lng,
            car_number,
        },
        timeout_in_sec
    );

    return data;
};

export const get_session_status = async (options: GetSessionStatusOptions): Promise<GetCommandStatusResponse> => {
    const { asset_id, ble_id, session_id, device_id, car_number } = options || {};

    const data = await cloudwise_request<GetCommandStatusResponse>("getCommandStatus", {
        assetId: asset_id,
        BleId: ble_id,
        commandId: session_id,
        deviceId: device_id,
        car_number,
    });

    return data;
};

export const get_user_cdrs = async (options: UserCdrsOptions): Promise<UserCdrsResponse["Items"]> => {
    const { asset_id, limit = 99999999, offset = 0, time_zone = 0, car_number } = options || {};

    const data = await cloudwise_request<UserCdrsResponse>("getUserCdrs", {
        skip: offset,
        pageSize: limit,
        assetId: asset_id,
        timeZone: time_zone,
        car_number,
    });

    return data.Items;
};

const test_request = async () => {
    try {
        await axios.get(`https://akeyless-sys.com`);
        logger.log("✅ test_request success");
    } catch (error) {
        logger.error("❌ test_request error", error);
    }
};
