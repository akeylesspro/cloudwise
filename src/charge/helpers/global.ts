import { cache_manager } from "akeyless-server-commons/managers";
import { GetDistanceMetersOptions } from "../types";

export const get_cdrs = (car_number: string, options?: { limit?: number; offset?: number }) => {
    const { limit = 100, offset = 0 } = options || {};
    const cdrs = cache_manager.getArrayData("nx-charge-cdrs");
    return cdrs.filter((cdr) => cdr.car_number === car_number).slice(offset, offset + limit);
};

export const get_distance_meters = ({ lat1, lat2, lng1, lng2 }: GetDistanceMetersOptions): number => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
