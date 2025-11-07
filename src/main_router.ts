import express, { Router } from "express";
import { MainRouter } from "akeyless-server-commons/types";
import charge_router from "./charge/router";

const root_router: Router = express.Router();

root_router.get("/", (req, res) => res.status(200).send("OK from charge root"));
root_router.use("/api/charge", charge_router);

const main_router: MainRouter = (app) => {
    app.use(root_router);
};

export default main_router;
