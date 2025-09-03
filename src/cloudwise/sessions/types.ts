import { SessionCommandSettings } from "../api/types";
import { EvseStatus, ParsedConnectorData, ParsedEvseData, ParsedOcpiLocationData } from "../types";
import type { Timestamp } from "firebase-admin/firestore";

type ChargingStatus = "plugin" | "charging" | "plugout" | "error";

export type CommandStatus = "ACTIVE" | "COMPLETED" | "FAILED";

export interface ChargingState {
    id: string;
    status: ChargingStatus;
    car_number: string;
    lat: number;
    lng: number;
    timestamp: Timestamp;
    session_id?: string;
}

export interface GetDistanceMetersOptions {
    lat1: number;
    lng1: number;
    lat2: number;
    lng2: number;
}

export interface GetLocationsByGeoAndStatusOptions {
    lat: number;
    lng: number;
    radius_in_meters: number;
    status?: EvseStatus;
}

export interface ClosestUpdatedLocationResult {
    location: ParsedOcpiLocationData;
    station: ParsedEvseData;
    last_updated: string;
    connector: ParsedConnectorData;
}

export interface ChargingSession extends Omit<SessionCommandSettings, "command"> {
    id?: string;
    car_number: string;
    timestamp: Timestamp;
    start_timestamp: Timestamp;
    end_timestamp?: Timestamp;
    status: "started" | "completed" | "error";
    cdr_id?: string;
}
