import { SessionCommandConfig } from "../cloudwise_api/types";
import { EvseStatus, ParsedCdrItem, ParsedConnectorData, ParsedEvseData, ParsedOcpiLocationData } from "../types";
import type { Timestamp } from "firebase-admin/firestore";

type ChargingStateOcpiStatus = "plugin" | "charging" | "plugout" | "error" | "completed";
type ChargingStateCanbusStatus = "plugin" | "plugout" | "charging_on" | "charging_off";

export type SessionStatus = "started" | "completed" | "error" | "paid";

export type CommandStatus = "ACTIVE" | "COMPLETED" | "FAILED";

export interface ChargingState {
    id: string;
    ocpi_status: ChargingStateOcpiStatus;
    canbus_status: ChargingStateCanbusStatus;
    car_number: string;
    lat: number;
    lng: number;
    timestamp: Timestamp;
    session_id?: string;
    message?: string;
}

export interface GetLocationsByGeoAndStatusOptions {
    car_number: string;
    lat: number;
    lng: number;
    radius_in_meters: number;
    statuses?: EvseStatus[];
}

export interface ClosestUpdatedLocationResult {
    location: ParsedOcpiLocationData;
    station: ParsedEvseData;
    last_updated: string;
    connector: ParsedConnectorData;
}

export interface ChargingSession extends Omit<SessionCommandConfig, "command"> {
    id: string;
    lat: number;
    lng: number;
    car_number: string;
    updated: Timestamp;
    started: Timestamp;
    ended?: Timestamp;
    status: SessionStatus;
    message?: string;
    cdr_id?: string;
    cost?: number;
    kwh?: number;
}

export interface ParsedSession {
    session_status: CommandStatus;
    cost: number;
    charging_time_in_seconds: number;
    kwh: number;
    session_id: string;
}
