import { get_nx_service_urls } from "akeyless-server-commons/helpers";
import { get_custom_fb_token } from "../helpers";
import axios from "axios";
import { logger } from "akeyless-server-commons/managers";
import { get_config } from "../cloudwise_api/helpers";
import { CreditItem } from "akeyless-types-commons";

interface CreditBalance {
    total: number;
    filtered_credits: CreditItem[];
    all_credits: CreditItem[];
}

export const get_car_charge_credit_balance = async (car_number: string): Promise<CreditBalance> => {
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
        return data;
    } catch (error) {
        logger.error("🔴 Error in get_car_charge_credit_balance", error);
        return { total: 0, filtered_credits: [], all_credits: [] };
    }
};

export const check_car_charge_credit_balance = async (car_number: string, cost = 0): Promise<{ is_has_balance: boolean; balance: number }> => {
    const { credit_balance_threshold } = get_config();
    const { total: balance } = await get_car_charge_credit_balance(car_number);
    const required = credit_balance_threshold + cost;
    const is_has_balance = balance > required;
    return { is_has_balance, balance };
};

export interface SubtractActionPayload {
    credit_id: string;
    car_number: string;
    amount: number;
}

export const subtract_credit_balance = async (args: SubtractActionPayload): Promise<number> => {
    try {
        const token = await get_custom_fb_token();
        const end_users_url = get_nx_service_urls().end_users;
        const payload = {
            ...args,
            reason: "plug_and_charge",
            action: "subtract",
        };
        const response = await axios.post(`${end_users_url}/credits/subtract`, payload, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
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
