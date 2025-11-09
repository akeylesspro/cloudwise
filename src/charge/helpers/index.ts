import { snapshot, snapshot_bulk_by_names } from "akeyless-server-commons/helpers";
import { handle_charging_state_add_and_edit } from "../sessions/helpers";
import { cache_manager } from "akeyless-server-commons/managers";

export * from "./parsers";

export const initialize_snapshot = async () => {
    await snapshot_bulk_by_names(
        [
            "nx-charge-locations",
            "nx-charge-cdrs",
            "nx-charge-sessions",
            {
                collection_name: "nx-charge-state",
                extra_parsers: [
                    {
                        on_add: handle_charging_state_add_and_edit,
                        on_modify: handle_charging_state_add_and_edit,
                    },
                ],
            },
        ],
        {
            subscription_type: "redis",
        }
    );
};

export const get_cdrs = (car_number: string, options?: { limit?: number; offset?: number }) => {
    const { limit = 100, offset = 0 } = options || {};
    const cdrs = cache_manager.getArrayData("nx-charge-cdrs");
    return cdrs.filter((cdr) => cdr.car_number === car_number).slice(offset, offset + limit);
};
