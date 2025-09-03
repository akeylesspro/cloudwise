import { cache_manager, logger } from "akeyless-server-commons/managers";
import axios from "axios";

import {
    CloudwiseConfig,
    GetLocationsOptions,
    GetLocationsResponse,
    GetLocationDetailsOptions,
    GetLocationDetailsResponse,
    SessionCommandSettings,
    SendCommandResponse,
    GetSessionStatusOptions,
    GetCommandStatusResponse,
    UserCdrsOptions,
    UserCdrsResponse,
} from "./types";

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
        const response = await axios.post(
            `${base_url}/${endpoint}`,
            {
                FirebaseToken: token,
                ...payload,
            },
            { timeout: (timeout_in_sec ?? 30) * 1000 }
        );
        const data = response.data || {};
        const { ErrorCode } = data;
        if (ErrorCode && ErrorCode > 0) {
            throw new Error(data);
        }
        return data as T;
    } catch (error) {
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
    const { party_id, country_code = "IL" } = options;
    const { Location } = await cloudwise_request<GetLocationDetailsResponse>("getLocationDetails", {
        LocationId: locationId,
        PartyID: party_id,
        CountryCode: country_code,
    });
    return Location;
};

export const session_command = async (settings: SessionCommandSettings): Promise<SendCommandResponse> => {
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
    } = settings || {};

    const data = await cloudwise_request<SendCommandResponse>("sendCommand", {
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
    });

    return data;
};

export const get_session_status = async (options: GetSessionStatusOptions): Promise<GetCommandStatusResponse> => {
    const { asset_id, ble_id, session_id, device_id } = options || {};

    const data = await cloudwise_request<GetCommandStatusResponse>("getCommandStatus", {
        assetId: asset_id,
        BleId: ble_id,
        commandId: session_id,
        deviceId: device_id,
    });

    return data;
};

export const get_user_cdrs = async (options: UserCdrsOptions): Promise<UserCdrsResponse["Items"]> => {
    const { asset_id, limit = 99999999, offset = 0, time_zone = 0 } = options || {};

    const data = await cloudwise_request<UserCdrsResponse>("getUserCdrs", {
        skip: offset,
        pageSize: limit,
        assetId: asset_id,
        timeZone: time_zone,
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
