import { Timestamp } from "firebase-admin/firestore";
import { cache_manager } from "akeyless-server-commons/managers";
import { GetCommandStatusResponse, GetLocationDetailsResponse, SendCommandResponse, UserCdrsResponse } from "../cloudwise_api/types";
import { ChargingSession, ChargingState, CommandStatus } from "../sessions/types";
import { CdrItem, Connector, Evse, Location, ParsedOcpiLocationData } from "../types";
import { parse_stations, parse_location } from "../helpers/parsers";
import { simulator_config } from "./";

interface SessionProgressMetadata {
    started_at: Date;
    target_kwh: number;
    duration_seconds: number;
}

/// mock session progress
export const session_progress_metadata = new Map<string, SessionProgressMetadata>();

export const set_session_progress_metadata = (session_id: string, metadata: SessionProgressMetadata): SessionProgressMetadata => {
    const existing = session_progress_metadata.get(session_id);
    const updated: SessionProgressMetadata = {
        started_at: existing?.started_at ?? metadata.started_at,
        target_kwh: existing?.target_kwh ?? metadata.target_kwh,
        duration_seconds: existing?.duration_seconds ?? metadata.duration_seconds,
    };
    session_progress_metadata.set(session_id, updated);
    return updated;
};

const get_session_progress_metadata = (session_id: string): SessionProgressMetadata | null => {
    return session_progress_metadata.get(session_id) ?? null;
};

type LocationStateInput = Pick<ChargingState, "lat" | "lng" | "timestamp">;

export const DEFAULT_COORDINATES = { lat: 32.0853, lng: 34.7818 };
const DEFAULT_LOCATION_ID = "mock-loc-1";
const DEFAULT_PARTY_ID = "MOCK";
const DEFAULT_COMPANY_NAME = "Mock Company";
const DEFAULT_COUNTRY_CODE = "IL";
const DEFAULT_OPERATOR_NAME = "Mock Operator";
const DEFAULT_OWNER_NAME = "Mock Owner";
const DEFAULT_CITY = "Tel Aviv";
const DEFAULT_ADDRESS = "Mock Address";
const DEFAULT_CURRENCY = "ILS";
const DEFAULT_CONNECTOR_ID = "1";
const DEFAULT_TARIFF_ID = "1";
const NX_LOCATIONS_CACHE_KEY = "nx-charge-locations";
const NX_SESSIONS_CACHE_KEY = "nx-charge-sessions";

type LocationResponsePayload = GetLocationDetailsResponse["Location"];

const mock_location_payloads = new Map<string, LocationResponsePayload>();

const get_location_cache_key = (location_id: string, party_id: string) => `${party_id}::${location_id}`;

const get_cached_sessions = (): ChargingSession[] => cache_manager.getArrayData(NX_SESSIONS_CACHE_KEY) || [];

const get_cached_locations = (): ParsedOcpiLocationData[] => cache_manager.getArrayData(NX_LOCATIONS_CACHE_KEY) || [];

const upsert_cached_location = (location: ParsedOcpiLocationData) => {
    const filtered = get_cached_locations().filter((item) => item.id !== location.id);
    cache_manager.setArrayData(NX_LOCATIONS_CACHE_KEY, [...filtered, location]);
};

const build_evse_uid = (location_id: string): string => `evse-${location_id}`;

const build_mock_connector = (evse_uid: string, last_updated_iso: string): Connector => ({
    Id: DEFAULT_CONNECTOR_ID,
    EvseUid: evse_uid,
    Standard: "IEC_62196_T2",
    Format: "SOCKET",
    PowerType: "AC_3_PHASE",
    MaxVoltage: 400,
    MaxAmperage: 32,
    MaxElectricPower: 0,
    TermsAndConditions: null,
    TariffId: DEFAULT_TARIFF_ID,
    LastUpdated: last_updated_iso,
    PricePerKwh: 0,
    ConnectionFee: 0,
    ParkingFee: 0,
    TariffDetails: {
        PricePerKwh: 0,
        ConnectionFee: 0,
        ParkingFee: null,
        Currency: DEFAULT_CURRENCY,
        TariffItems: [],
        ErrorMessage: null,
        ErrorCode: 0,
    },
});

const build_mock_evse = (location_id: string, party_id: string, lat: number, lng: number, last_updated_iso: string, connector: Connector): Evse => ({
    Uid: build_evse_uid(location_id),
    LocationId: location_id,
    EvseId: `${DEFAULT_COUNTRY_CODE}*${party_id}*E${location_id}*1`,
    Status: "BLOCKED",
    FloorLevel: null,
    Latitude: lat,
    Longitude: lng,
    PhysicalReference: null,
    Directions: null,
    ParkingRestrictions: null,
    Images: null,
    Capabilities: "",
    LastUpdated: last_updated_iso,
    Connectors: [connector],
    Description: [],
});

const build_mock_location_payload = (charging_state: LocationStateInput): LocationResponsePayload => {
    const lat = DEFAULT_COORDINATES.lat;
    const lng = DEFAULT_COORDINATES.lng;
    const last_updated_iso = charging_state.timestamp.toDate().toISOString();
    const evse_uid = build_evse_uid(DEFAULT_LOCATION_ID);
    const connector = build_mock_connector(evse_uid, last_updated_iso);
    const evse = build_mock_evse(DEFAULT_LOCATION_ID, DEFAULT_PARTY_ID, lat, lng, last_updated_iso, connector);
    const location: Location = {
        Id: DEFAULT_LOCATION_ID,
        OwnerCountryCode: DEFAULT_COUNTRY_CODE,
        OwnerPartyId: DEFAULT_PARTY_ID,
        Publish: true,
        Name: "Mock Location",
        Address: DEFAULT_ADDRESS,
        City: DEFAULT_CITY,
        State: "",
        Country: DEFAULT_COUNTRY_CODE,
        OperatorName: DEFAULT_OPERATOR_NAME,
        OwnerName: DEFAULT_OWNER_NAME,
        Latitude: lat,
        Longitude: lng,
        Facilities: null,
        OpeningTimes: "",
        ParkingType: "",
        Images: null,
        LastUpdated: last_updated_iso,
    };
    return {
        Location: location,
        Evses: [evse],
        ErrorMessage: null,
        ErrorCode: 0,
    };
};

const to_parsed_location = (payload: LocationResponsePayload): ParsedOcpiLocationData => {
    const parsed_location = parse_location(payload.Location);
    const party_id = payload.Location.OwnerPartyId || DEFAULT_PARTY_ID;
    const country = payload.Location.Country || DEFAULT_COUNTRY_CODE;
    return {
        ...parsed_location,
        id: `${parsed_location.id}-${party_id}-${country}`,
        original_id: parsed_location.id,
        company_name: DEFAULT_COMPANY_NAME,
        party_id,
        stations: payload.Evses.map(parse_stations),
    };
};

const cache_location_payload = (payload: LocationResponsePayload): ParsedOcpiLocationData => {
    const parsed_location = to_parsed_location(payload);
    const location_id = payload.Location.Id;
    const party_id = payload.Location.OwnerPartyId || DEFAULT_PARTY_ID;
    const cache_key = get_location_cache_key(location_id, party_id);
    mock_location_payloads.set(cache_key, payload);
    upsert_cached_location(parsed_location);
    return parsed_location;
};

const get_or_create_location_payload = (location_id: string, party_id: string): LocationResponsePayload => {
    const cache_key = get_location_cache_key(location_id, party_id);
    const cached = mock_location_payloads.get(cache_key);
    if (cached) {
        return cached;
    }
    const fallback_state: LocationStateInput = {
        lat: DEFAULT_COORDINATES.lat,
        lng: DEFAULT_COORDINATES.lng,
        timestamp: Timestamp.now(),
    };

    const payload = build_mock_location_payload(fallback_state);
    cache_location_payload(payload);
    return payload;
};

/// mock location
export const create_mock_location = (charging_state: LocationStateInput): ParsedOcpiLocationData => {
    const payload = build_mock_location_payload(charging_state);
    return cache_location_payload(payload);
};

/// api
export const mock_get_location_details = (payload: any): GetLocationDetailsResponse => {
    const location_id = payload?.LocationId || DEFAULT_LOCATION_ID;
    const party_id = payload?.PartyID || DEFAULT_PARTY_ID;
    const location_payload = get_or_create_location_payload(location_id, party_id);
    return {
        ErrorCode: 0,
        ErrorMessage: "",
        ErrorProvider: 0,
        Count: 1,
        RequestID: `mock-req-${Date.now()}`,
        ServerTime: new Date().toISOString(),
        Location: location_payload,
    };
};

export const mock_send_command = (payload: any): SendCommandResponse => {
    const command = payload?.command;
    const session_id = payload?.commandId || `session-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const base_response = {
        ErrorCode: 0,
        ErrorMessage: "",
        ErrorProvider: 0,
        Count: 1,
        RequestID: `mock-req-${Date.now()}`,
        ServerTime: new Date().toISOString(),
        CommandId: session_id,
    };

    if (command === "START_SESSION") {
        set_session_progress_metadata(session_id, {
            started_at: new Date(),
            target_kwh: simulator_config.target_kwh,
            duration_seconds: simulator_config.duration_seconds,
        });
        return base_response;
    }

    if (command === "STOP_SESSION") {
        return base_response;
    }

    return { ...base_response, ErrorCode: 1, ErrorMessage: `Unknown command ${command}`, Count: 0, CommandId: "" };
};

export const mock_get_command_status = (payload: any): GetCommandStatusResponse => {
    const session_id = payload?.commandId || payload?.SessionId;
    if (!session_id) {
        return {
            ErrorCode: 1,
            ErrorMessage: "Missing session_id",
            ErrorProvider: 0,
            Count: 0,
            RequestID: `mock-req-${Date.now()}`,
            ServerTime: new Date().toISOString(),
            CommandStatus: "FAILED" as CommandStatus,
            Status: "FAILED",
            ChargingTimeInSeconds: "0",
        };
    }

    const sessions = get_cached_sessions();
    const session = sessions.find((s) => s.id === session_id);
    if (!session) {
        return {
            ErrorCode: 1,
            ErrorMessage: "Session not found",
            ErrorProvider: 0,
            Count: 0,
            RequestID: `mock-req-${Date.now()}`,
            ServerTime: new Date().toISOString(),
            CommandStatus: "FAILED" as CommandStatus,
            Status: "FAILED",
            ChargingTimeInSeconds: "0",
        };
    }

    const metadata = get_session_progress_metadata(session_id);
    if (!metadata) {
        throw new Error(`Session progress metadata not found for session_id: ${session_id}`);
    }

    const now = new Date();
    const elapsed_seconds = Math.floor((now.getTime() - metadata.started_at.getTime()) / 1000);
    const is_completed = elapsed_seconds >= metadata.duration_seconds || session.status === "completed" || session.status === "paid";
    const charging_time = is_completed ? metadata.duration_seconds : elapsed_seconds;
    const kwh = is_completed
        ? metadata.target_kwh
        : Math.min(metadata.target_kwh * (elapsed_seconds / metadata.duration_seconds), metadata.target_kwh);
    const cost = 5 + kwh * 1.4;

    const session_for_cdr: ChargingSession = {
        ...session,
        status: is_completed ? (session.status === "paid" ? "paid" : "completed") : session.status,
        ended: is_completed ? session.ended || Timestamp.now() : session.ended,
    };
    const cdr = is_completed ? create_cdr_from_session(session_for_cdr) : null;

    return {
        ErrorCode: 0,
        ErrorMessage: "",
        ErrorProvider: 0,
        Count: 1,
        RequestID: `mock-req-${Date.now()}`,
        ServerTime: new Date().toISOString(),
        CommandStatus: is_completed ? "COMPLETED" : "ACTIVE",
        Status: is_completed ? "COMPLETED" : "ACTIVE",
        ChargingTimeInSeconds: String(charging_time),
        CommandId: session_id,
        SessionId: session_id,
        Kwh: kwh.toFixed(3),
        Cost: cost.toFixed(2),
        Cdr: cdr || undefined,
    };
};

const create_cdr_from_session = (session: ChargingSession): CdrItem | null => {
    if (!session.id) {
        return null;
    }

    const metadata = get_session_progress_metadata(session.id);
    if (!metadata) {
        return null;
    }

    // Only return CDR for completed sessions
    if (session.status !== "completed" && session.status !== "paid" && !session.ended) {
        return null;
    }

    const format_duration = (s: number) => {
        const h = Math.floor(s / 3600)
            .toString()
            .padStart(2, "0");
        const m = Math.floor((s % 3600) / 60)
            .toString()
            .padStart(2, "0");
        const sec = Math.floor(s % 60)
            .toString()
            .padStart(2, "0");
        return `${h}:${m}:${sec}`;
    };

    const end_time = session.ended ? session.ended.toDate() : new Date();
    const kwh = metadata.target_kwh;
    const cost = 5 + kwh * 1.4;

    return {
        OcpCountryCode: "IL",
        OcpPartyId: session.party_id || "MOCK",
        Id: `cdr-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        StartDateTime: metadata.started_at.toISOString(),
        EndDateTime: end_time.toISOString(),
        SessionId: session.id,
        AuthMethod: "AUTH_REQUEST",
        AuthorizationReference: null,
        Currency: "ILS",
        TotalCost: cost,
        TotalCostWithVat: cost * 1.17,
        TotalCostExcVat: cost,
        TotalFixCost: 5,
        TotalFixCostWithVat: 5.85,
        TotalEnergy: kwh,
        TotalEnergyCost: cost - 5,
        TotalEnergyCostWithVat: (cost - 5) * 1.17,
        TotalTime: metadata.duration_seconds,
        TotalTimeCost: null,
        TotalTimeCostWithVat: null,
        TotalParkingTime: null,
        TotalParkingCost: null,
        TotalParkingCostWithVat: null,
        TotalReservationCost: null,
        TotalReservationCostWithVat: null,
        CdrTokenCountryCode: "IL",
        CdrTokenPartyId: session.party_id || "MOCK",
        CdrTokenUid: session.car_number || null,
        CdrTokenType: "RFID",
        CdrTokenContractId: null,
        InvoiceReferenceId: null,
        CreditsBalance: null,
        CreditsExpirationDate: null,
        Credit: false,
        CreditReferenceId: null,
        HomeCharging: false,
        LastUpdated: new Date().toISOString(),
        AvgKwhPrice: kwh === 0 ? 0 : cost / kwh,
        Duration: format_duration(metadata.duration_seconds),
    };
};

export const mock_get_user_cdrs = (payload: any): UserCdrsResponse => {
    const skip = payload?.skip ?? 0;
    const page_size = payload?.pageSize ?? 999999;

    // Get all completed sessions from cache
    const sessions = get_cached_sessions();

    // Create CDRs for all completed sessions
    const cdrs: CdrItem[] = sessions
        .map((session) => create_cdr_from_session(session))
        .filter((cdr): cdr is CdrItem => cdr !== null)
        .slice(skip, skip + page_size);

    return {
        ErrorCode: 0,
        ErrorMessage: "",
        ErrorProvider: 0,
        Count: cdrs.length,
        RequestID: `mock-req-${Date.now()}`,
        ServerTime: new Date().toISOString(),
        Items: cdrs,
    };
};
