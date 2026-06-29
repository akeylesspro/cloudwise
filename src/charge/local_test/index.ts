import { get_config, get_location_details, get_locations, get_user_cdrs, login } from "../cloudwise_api/helpers";

export const run_local_test = async () => {
    const hour = 60 * 60 * 1000;
    let total_requests = 0;
    let total_errors = 0;
    const state = {
        locations: { total: 0, failed: 0, success: 0, most_time: 0, least_time: Infinity },
        location_details: { total: 0, failed: 0, success: 0, most_time: 0, least_time: Infinity },
        cdrs: { total: 0, failed: 0, success: 0, most_time: 0, least_time: Infinity },
    };
    type LocalTestStateKey = keyof typeof state;

    const schedule_request = (key: LocalTestStateKey, interval_ms: number, request: () => Promise<unknown>) => {
        setInterval(async () => {
            const start_time = Date.now();
            const current_state = state[key];
            current_state.total++;
            total_requests++;

            try {
                await request();
                const time_taken_seconds = (Date.now() - start_time) / 1000;
                current_state.most_time = Math.max(current_state.most_time, time_taken_seconds);
                current_state.least_time = Math.min(current_state.least_time, time_taken_seconds);
                current_state.success++;
            } catch (error) {
                current_state.failed++;
                total_errors++;
            }
        }, interval_ms);
    };

    /// login
    setInterval(login, hour);
    /// collect locations
    schedule_request("locations", 6 * 1000, get_locations);
    schedule_request("cdrs", 15 * 1000, async () => {
        const { asset_id } = get_config();
        return get_user_cdrs({ asset_id, car_number: "test-car-number" });
    });
    schedule_request("location_details", 8 * 1000, () =>
        get_location_details("173-SCL-IL", { party_id: "SCL", car_number: "test-car-number" })
    );
    setInterval(() => {
        console.log(`---------------------------------------------------------`);
        console.log(`ℹ️ total requests: ${total_requests}`);
        console.log(`ℹ️ total errors: ${total_errors}`);
        console.log(`ℹ️ locations: ${JSON.stringify(state.locations)}`);
        console.log(`ℹ️ location_details: ${JSON.stringify(state.location_details)}`);
        console.log(`ℹ️ cdrs: ${JSON.stringify(state.cdrs)}`);
        console.log(`---------------------------------------------------------`);
    }, 60 * 1000);
};
