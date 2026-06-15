import { get_nx_service_urls } from "akeyless-server-commons/helpers";
import { get_custom_fb_token } from "../helpers";
import axios from "axios";
import { logger } from "akeyless-server-commons/managers";
import { get_config } from "../cloudwise_api/helpers";
import { retry } from "./retry";
import { CreditItem, TObject } from "akeyless-types-commons";

interface CreditBalance {
    total: number;
    filtered_credits: CreditItem[];
    all_credits: CreditItem[];
}

export const get_car_charge_credit_balance = async (car_number: string, src: string): Promise<CreditBalance> => {
    try {
        const token = await get_custom_fb_token();
        const end_users_url = get_nx_service_urls().end_users;
        const response = await retry(
            () =>
                axios.post(
                    `${end_users_url}/credits/balance`,
                    { car_number, types: ["charge_external"] },
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                ),
            {
                retries: 3,
                name: "get_car_charge_credit_balance",
                on_retry_fn: (attempt, retries, last_error) => {
                    logger.warn(`🟠 Retry ${attempt}/${retries} for get_car_charge_credit_balance failed for car "${car_number}" from "${src}"`, last_error);
                },
                random_delay: { min: 20, max: 40 },
            }
        );
        const {
            data: { data },
        } = response;
        const { total } = data;
        logger.log(`⚡ Car "${car_number}" has ${total} credits balance from "${src}"`);
        return data;
    } catch (error) {
        logger.error(`🔴 Error in get_car_charge_credit_balance for car "${car_number}" from "${src}"`, error);
        return { total: 0, filtered_credits: [], all_credits: [] };
    }
};

export const check_charge_balance = async (car_number: string, src: string, cost = 0): Promise<{ is_has_balance: boolean; balance: number }> => {
    const { credit_balance_threshold } = get_config();
    const { total: balance } = await get_car_charge_credit_balance(car_number, src);
    const required = credit_balance_threshold + cost;
    const is_has_balance = balance > required;
    return { is_has_balance, balance };
};

export interface SubtractActionPayload {
    credit_id: string;
    car_number: string;
    amount: number;
}

export const subtract_credit_balance = async (args: SubtractActionPayload): Promise<TObject<any> | null> => {
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
        return data;
    } catch (error) {
        logger.error("🔴 Error in subtract_credit_balance", error);
        return null;
    }
};
