export interface SimulatorConfig {
    enabled: boolean;
    default_session_duration_seconds: number;
    default_target_kwh: number;
    progress_update_interval_ms: number;
}


export interface SessionSimulationConfig {
    car_number: string;
    lat?: number;
    lng?: number;
    duration_seconds?: number;
    target_kwh?: number;
    location_id?: string;
    party_id?: string;
}

export interface SessionRunnerResult {
    session_id: string;
    completed: boolean;
}