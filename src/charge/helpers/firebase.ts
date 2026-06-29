import { initializeApp, FirebaseOptions } from "firebase/app";
import { getAuth, signInWithCustomToken, UserCredential } from "firebase/auth";
import dotenv from "dotenv";
import { auth, init_env_variables, redis_snapshots_bulk, snapshot_bulk_by_names } from "akeyless-server-commons/helpers";
import { cache_manager } from "akeyless-server-commons/managers";
import { handle_charging_state_snapshot, on_snapshot_first_time } from "../sessions";

dotenv.config();

const required_env_vars = ["apiKey", "authDomain", "databaseURL", "projectId", "storageBucket", "messagingSenderId", "appId"];
const env_data = init_env_variables(required_env_vars);
const firebase_config: FirebaseOptions = {
    apiKey: env_data.apiKey,
    authDomain: env_data.authDomain,
    databaseURL: env_data.databaseURL,
    projectId: env_data.projectId,
    storageBucket: env_data.storageBucket,
    messagingSenderId: env_data.messagingSenderId,
    appId: env_data.appId,
};
const firebase_app = initializeApp(firebase_config);

export const get_custom_fb_token = async (): Promise<string> => {
    const custom_token = await auth.createCustomToken("charge", { role: "backend" });
    const userCredential: UserCredential = await signInWithCustomToken(getAuth(firebase_app), custom_token);
    const token = await userCredential.user.getIdToken();
    return token;
};

export const initialize_snapshot = async () => {
    await snapshot_bulk_by_names(["units", "nx-charge-locations", "nx-charge-cdrs", "nx-charge-sessions"], { subscription_type: "firebase" });
    // await redis_snapshots_bulk([
    //     {
    //         collection_name: "nx-charge-state",
    //         subscription_type: "redis",
    //         on_first_time: on_snapshot_first_time,
    //         on_add: handle_charging_state_snapshot,
    //         on_modify: handle_charging_state_snapshot,
    //         on_remove: (docs) => {
    //             const prev = cache_manager.getArrayData("nx-charge-state");
    //             const new_cars = prev.filter((car) => !docs.some((doc) => doc.id === car.id));
    //             cache_manager.setArrayData("nx-charge-state", new_cars);
    //         },
    //     },
    // ]);
};
