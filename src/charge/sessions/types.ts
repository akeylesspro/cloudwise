import { SessionCommandSettings } from "../cloudwise_api/types";
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
    message?: string;
}

export interface GetLocationsByGeoAndStatusOptions {
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

export interface ChargingSession extends Omit<SessionCommandSettings, "command"> {
    id?: string;
    car_number: string;
    updated: Timestamp;
    started: Timestamp;
    ended?: Timestamp;
    status: "started" | "completed" | "error";
    message?: string;
    cdr_id?: string;
}
