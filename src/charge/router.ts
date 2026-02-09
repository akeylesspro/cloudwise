import { Router } from "express";
import { get_cdrs, get_location_status, get_locations, stop_session_service, simulate_session_service, start_session_service } from "./services";
import { mandatory, nx_user_login, verify_user_auth } from "akeyless-server-commons/middlewares";
import package_json from "../../package.json";

const router: Router = Router();

router.get("/", (req, res) => {
    res.send(process.env.mode === "qa" ? "hello from charge QA" : "hello from charge PROD");
});

router.get("/v", (req, res) => {
    res.send(`${package_json.version} --${process.env.mode === "qa" ? "QA" : "PROD"}`);
});

router.get("/locations/status", get_location_status);

router.post("/locations/get", get_locations);

router.post("/sessions/stop", verify_user_auth, mandatory({ body: [{ key: "car_number", type: "string", length: 3 }] }), stop_session_service);

router.post(
    "/sessions/start",
    verify_user_auth,
    mandatory({
        body: [
            { key: "car_number", type: "string", length: 3 },
            { key: "location_id", type: "string" },
            { key: "station_uid", type: "string" },
            { key: "connector_id", type: "string" },
            { key: "lat", type: "number" },
            { key: "lng", type: "number" },
        ],
    }),
    start_session_service
);

router.post(
    "/sessions/simulate",
    nx_user_login,
    mandatory({
        body: [
            { key: "car_number", type: "string", length: 3 },
            { key: "duration_seconds", type: "number" },
            { key: "target_kwh", type: "number" },
        ],
    }),
    simulate_session_service
);

router.post("/cdrs", nx_user_login, mandatory({ body: [{ key: "car_number", type: "string", length: 3 }] }), get_cdrs);

export default router;
