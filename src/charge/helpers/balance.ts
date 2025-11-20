import { get_nx_service_urls } from "akeyless-server-commons/helpers";
import { get_custom_fb_token } from "../helpers";
import axios from "axios";
import { logger } from "akeyless-server-commons/managers";
import { get_config } from "../cloudwise_api/helpers";

export const get_car_charge_credit_balance = async (car_number: string): Promise<number> => {
    try {
        const token = await get_custom_fb_token();
        const end_users_url = get_nx_service_urls().end_users;
        const response = await axios.post(
            `${end_users_url}/credits/balance`,
            { car_number, types: ["charge_external"] },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );
        const {
            data: { data },
        } = response;
        const { total } = data;
        return total.toFixed(2);
    } catch (error) {
        logger.error("🔴 Error in get_car_charge_credit_balance", error);
        return 0;
    }
};

export const check_car_charge_credit_balance = async (car_number: string, cost = 0): Promise<{ is_has_balance: boolean; balance: number }> => {
    const { credit_balance_threshold } = get_config();
    const balance = await get_car_charge_credit_balance(car_number);
    const required = credit_balance_threshold + cost;
    const is_has_balance = balance > required;
    return { is_has_balance, balance };
};
