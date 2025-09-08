import { TObject } from "akeyless-types-commons";
import { CdrItem, Evse, Location, OcpiLocation } from "../types";
import { CommandStatus } from "../sessions/types";

export type CloudwiseConfig = {
    base_url: string;
    email: string;
    password: string;
    login_key: string;
    token: string;
    device_id: string;
    ble_id: string;
    asset_id: string;
    allowed_cars: string[];
    minimum_time_difference_of_plugin_in_seconds: number;
    radius_in_meters: number;
};

export interface CloudwiseResponse {
    ErrorCode: number;
    ErrorMessage: string;
    ErrorProvider: number;
    Count: number;
    RequestID: string;
    ServerTime: string;
}

/// get locations
export interface GetLocationsOptions {
    lat?: number;
    lng?: number;
    radius?: number;
    limit?: number;
    offset?: number;
    time_zone?: number;
}

export interface GetLocationsResponse extends CloudwiseResponse {
    Items: OcpiLocation[];
}

/// get location details
export interface GetLocationDetailsOptions {
    party_id: string;
    country_code?: string;
}

export interface GetLocationDetailsResponse extends CloudwiseResponse {
    Location: {
        Location: Location;
        Evses: Evse[];
        ErrorMessage: string | null;
        ErrorCode: number;
    };
}

export type SessionCommand = "START_SESSION" | "STOP_SESSION";
/// send command
export interface SessionCommandSettings {
    command?: SessionCommand;
    location_id: string;
    party_id?: string;
    station_uid: string;
    connector_id: string;
    ble_id: string;
    device_id: string;
    asset_id: string;
    ignore_distance_check?: boolean;
    session_id?: string;
    lat?: number;
    lng?: number;
    country_code?: string;
}

export interface SendCommandResponse extends CloudwiseResponse {
    CommandId: string;
}

/// get command status
export interface GetSessionStatusOptions {
    session_id: string;
    asset_id: string;
    ble_id: string;
    device_id: string;
}

export interface GetCommandStatusResponse extends CloudwiseResponse {
    CommandStatus: CommandStatus;
    Status: string;
    ChargingTimeInSeconds: string;
    CommandId?: string;
    SessionId?: string;
    KWh?: string;
    Cost?: string;
    Cdr?: CdrItem;
}

// user cdrs
export interface UserCdrsOptions {
    asset_id: string;
    offset?: number;
    limit?: number;
    time_zone?: number;
}

export interface UserCdrsResponse extends CloudwiseResponse {
    Items: CdrItem[];
}
