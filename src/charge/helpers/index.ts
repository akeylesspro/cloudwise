import { cache_manager } from "akeyless-server-commons/managers";

export * from "./parsers";
export * from "./firebase";

export const get_cdrs = (car_number: string, options?: { limit?: number; offset?: number }) => {
    const { limit = 100, offset = 0 } = options || {};
    const cdrs = cache_manager.getArrayData("nx-charge-cdrs");
    return cdrs.filter((cdr) => cdr.car_number === car_number).slice(offset, offset + limit);
};
