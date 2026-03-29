import { Router } from "express";
import {
    service__get_cdrs,
    service__get_location_status,
    service__get_locations,
    service__stop_session,
    service__simulate_session,
    service__start_session,
    service__fetch_all_locations,
} from "./services";
import { mandatory, nx_user_login, verify_user_auth } from "akeyless-server-commons/middlewares";
import package_json from "../../package.json";

const router: Router = Router();

router.get("/", (req, res) => {
    res.send(process.env.mode === "qa" ? "hello from charge QA" : "hello from charge PROD");
});

router.get("/v", (req, res) => {
    res.send(`${package_json.version} --${process.env.mode === "qa" ? "QA" : "PROD"}`);
});

router.get("/locations/status", service__get_location_status);

router.get("/locations/fetch", verify_user_auth, service__fetch_all_locations);

router.post("/locations/get", service__get_locations);

router.post("/sessions/stop", verify_user_auth, mandatory({ body: [{ key: "car_number", type: "string", length: 3 }] }), service__stop_session);

router.post(
    "/sessions/start",
    verify_user_auth,
    mandatory({
        body: [
            { key: "car_number", type: "string", length: 3 },
            { key: "location_id", type: "string" },
            { key: "station_uid", type: "string" },
            { key: "connector_id", type: "string" },
        ],
    }),
    service__start_session
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
    service__simulate_session
);

router.post("/cdrs", nx_user_login, mandatory({ body: [{ key: "car_number", type: "string", length: 3 }] }), service__get_cdrs);

export default router;
