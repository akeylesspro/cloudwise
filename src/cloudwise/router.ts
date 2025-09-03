import { Router } from "express";
import { get_cdrs, get_location_status, get_locations, stop_session } from "./services";
import { mandatory, nx_user_login } from "akeyless-server-commons/middlewares";
import package_json from "../../package.json";

const router: Router = Router();

router.get("/", (req, res) => {
    res.send(process.env.mode === "qa" ? "hello from cloudwise QA" : "hello from cloudwise PROD");
});

router.get("/v", (req, res) => {
    res.send(`${package_json.version} --${process.env.mode === "qa" ? "QA" : "PROD"}`);
});

router.get("/locations/status/:original_id", nx_user_login, get_location_status);

router.post("/locations/get", nx_user_login, get_locations);

router.post("/sessions/stop", nx_user_login, mandatory({ body: [{ key: "session_id", type: "string", length: 3 }] }), stop_session);

router.post("/cdrs", nx_user_login, mandatory({ body: [{ key: "car_number", type: "string", length: 3 }] }), get_cdrs);

export default router;
