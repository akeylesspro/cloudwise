import { cache_manager } from "akeyless-server-commons/managers";
import { GetCommandStatusResponse, GetLocationDetailsResponse, SendCommandResponse, UserCdrsResponse } from "../cloudwise_api/types";
import { ChargingSession, ChargingState, CommandStatus } from "../sessions/types";
import { ParsedConnectorData, ParsedEvseData, ParsedOcpiLocationData } from "../types";
import { simulator_config } from "./";
import { SessionSimulationConfig } from "./types";

interface SessionProgressMetadata {
    session_id: string;
    started_at: Date;
    target_kwh: number;
    duration_seconds: number;
}

/// mock session progress
export const session_progress_metadata = new Map<string, SessionProgressMetadata>();

export const set_session_progress_metadata = (session_id: string, metadata: Partial<SessionProgressMetadata>): SessionProgressMetadata => {
    const existing = session_progress_metadata.get(session_id);
    const updated: SessionProgressMetadata = {
        session_id,
        started_at: metadata.started_at ?? existing?.started_at ?? new Date(),
        target_kwh: metadata.target_kwh ?? existing?.target_kwh ?? simulator_config.default_target_kwh,
        duration_seconds: metadata.duration_seconds ?? existing?.duration_seconds ?? simulator_config.default_session_duration_seconds,
    };
    session_progress_metadata.set(session_id, updated);
    return updated;
};

export const get_session_progress_metadata = (session_id: string): SessionProgressMetadata | null => {
    return session_progress_metadata.get(session_id) ?? null;
};

export const clear_mock_state = (): void => {
    session_progress_metadata.clear();
};

/// mock location
export const create_mock_location = (config: SessionSimulationConfig, charging_state: ChargingState): ParsedOcpiLocationData => {
    const { lat = 32.0853, lng = 34.7818, location_id = "mock-loc-1", party_id = "MOCK" } = config;
    // Use charging_state timestamp for last_updated to match the plugin time
    const station_last_updated = charging_state.timestamp;

    const mock_connector: ParsedConnectorData = {
        id: "1",
        standard: "IEC_62196_T2",
        format: "SOCKET",
        power_type: "AC_3_PHASE",
        max_voltage: 400,
        max_amperage: 32,
        max_electric_power: 0,
        last_updated: station_last_updated,
        tariff_id: "1",
    };

    const mock_station: ParsedEvseData = {
        uid: `evse-${location_id}`,
        status: "BLOCKED",
        floor_level: null,
        physical_reference: null,
        last_updated: station_last_updated,
        connectors: [mock_connector],
    };

    const mock_location: ParsedOcpiLocationData = {
        name: "Mock Location",
        id: `${location_id}-${party_id}-IL`,
        country: "IL",
        address: "Mock Address",
        lat,
        lng,
        original_id: location_id,
        company_name: "Mock Company",
        party_id,
        stations: [mock_station],
    };
    const existing_locations: ParsedOcpiLocationData[] = cache_manager.getArrayData("nx-charge-locations") || [];
    cache_manager.setArrayData("nx-charge-locations", [...existing_locations, mock_location]);
    return mock_location;
};

/// api
export const mock_get_location_details = (payload: any): GetLocationDetailsResponse => {
    const location_id = payload?.LocationId || "mock-loc-1";
    return {
        ErrorCode: 0,
        ErrorMessage: "",
        ErrorProvider: 0,
        Count: 1,
        RequestID: `mock-req-${Date.now()}`,
        ServerTime: new Date().toISOString(),
        Location: {
            Location: {
                Id: location_id,
                Name: "Mock Location",
                Address: "Mock Address",
                City: "Tel Aviv",
                Country: "ISR",
                Latitude: 32.0853,
                Longitude: 34.7818,
                OwnerCountryCode: "IL",
                OwnerPartyId: "MOCK",
                Publish: true,
                State: "",
                OperatorName: "Mock Operator",
                OwnerName: "Mock Owner",
                Facilities: null,
                OpeningTimes: "",
                ParkingType: "",
                Images: null,
                LastUpdated: new Date().toISOString(),
            },
            Evses: [
                {
                    Uid: `evse-${location_id}`,
                    LocationId: location_id,
                    EvseId: `IL*MOCK*E${location_id}*1`,
                    Status: "BLOCKED",
                    FloorLevel: null,
                    Latitude: 32.0853,
                    Longitude: 34.7818,
                    PhysicalReference: null,
                    Directions: null,
                    ParkingRestrictions: null,
                    Images: null,
                    Capabilities: "",
                    Connectors: [
                        {
                            Id: "1",
                            EvseUid: `evse-${location_id}`,
                            Standard: "IEC_62196_T2",
                            Format: "SOCKET",
                            PowerType: "AC_3_PHASE",
                            MaxVoltage: 400,
                            MaxAmperage: 32,
                            MaxElectricPower: 0,
                            TermsAndConditions: null,
                            TariffId: "1",
                            LastUpdated: new Date().toISOString(),
                            PricePerKwh: 0,
                            ConnectionFee: 0,
                            ParkingFee: 0,
                            TariffDetails: {
                                PricePerKwh: 0,
                                ConnectionFee: 0,
                                ParkingFee: null,
                                Currency: "ILS",
                                TariffItems: [],
                                ErrorMessage: null,
                                ErrorCode: 0,
                            },
                        },
                    ],
                    Description: [],
                    LastUpdated: new Date().toISOString(),
                },
            ],
            ErrorMessage: null,
            ErrorCode: 0,
        },
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
        // Store minimal metadata for progress calculation
        set_session_progress_metadata(session_id, {
            started_at: new Date(),
        });
        return base_response;
    }

    if (command === "STOP_SESSION") {
        // Real code handles session completion, we just return success
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

    const sessions: ChargingSession[] = cache_manager.getArrayData("nx-charge-sessions") || [];
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
        set_session_progress_metadata(session_id, {
            started_at: session.started?.toDate() || new Date(),
            target_kwh: simulator_config.default_target_kwh,
            duration_seconds: simulator_config.default_session_duration_seconds,
        });
    }
    const final_metadata = get_session_progress_metadata(session_id)!;

    const now = new Date();
    const elapsed_seconds = Math.floor((now.getTime() - final_metadata.started_at.getTime()) / 1000);
    const is_completed = elapsed_seconds >= final_metadata.duration_seconds || session.status === "completed";
    const charging_time = is_completed ? final_metadata.duration_seconds : elapsed_seconds;
    const kwh = is_completed
        ? final_metadata.target_kwh
        : Math.min(final_metadata.target_kwh * (elapsed_seconds / final_metadata.duration_seconds), final_metadata.target_kwh);
    const cost = 5 + kwh * 1.4;

    const response: GetCommandStatusResponse = {
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
    };

    if (is_completed && session.status === "completed") {
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
        response.Cdr = {
            OcpCountryCode: "IL",
            OcpPartyId: session.party_id || "MOCK",
            Id: `cdr-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            StartDateTime: final_metadata.started_at.toISOString(),
            EndDateTime: new Date().toISOString(),
            SessionId: session_id,
            AuthMethod: "AUTH_REQUEST",
            AuthorizationReference: null,
            Currency: "ILS",
            TotalCost: cost,
            TotalCostWithVat: cost * 1.17,
            TotalCostExcVat: cost,
            TotalFixCost: 5,
            TotalFixCostWithVat: 5.85,
            TotalEnergy: final_metadata.target_kwh,
            TotalEnergyCost: cost - 5,
            TotalEnergyCostWithVat: (cost - 5) * 1.17,
            TotalTime: final_metadata.duration_seconds,
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
            AvgKwhPrice: final_metadata.target_kwh === 0 ? 0 : cost / final_metadata.target_kwh,
            Duration: format_duration(final_metadata.duration_seconds),
        };
    }

    return response;
};

export const mock_get_user_cdrs = (payload: any): UserCdrsResponse => {
    // Read real CDRs from cache (real code handles CDR storage)
    const skip = payload?.skip ?? 0;
    const page_size = payload?.pageSize ?? 999999;

    // For now, return empty - real code should handle CDR retrieval
    // This is just a mock API response
    return {
        ErrorCode: 0,
        ErrorMessage: "",
        ErrorProvider: 0,
        Count: 0,
        RequestID: `mock-req-${Date.now()}`,
        ServerTime: new Date().toISOString(),
        Items: [],
    };
};
