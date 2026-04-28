import { sleep } from "akeyless-server-commons/helpers";
import { logger } from "akeyless-server-commons/managers";

type RetryOptions = {
    retries?: number;
    delay?: number;
    random_delay?: {
        min: number;
        max: number;
    };
    delays?: number[];
    delay_fn?: (attempt: number, retries: number, last_error?: any) => number;
    on_retry_fn?: (attempt: number, retries: number, last_error?: any) => void;
    retry_on_errors_codes?: string[];
    debug?: boolean;
    throw_if_empty_result?: boolean;
    is_empty_result_fn?: (result: any) => boolean;
    name?: string;
};

export const retry = async <T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> => {
    const {
        // delay options
        delay = 10,
        delays = [],
        random_delay,
        delay_fn,
        // retry options
        retries = 3,
        retry_on_errors_codes = [],
        on_retry_fn,
        // more options
        throw_if_empty_result = false,
        is_empty_result_fn,
        debug = false,
        name = "",
    } = options || {};

    let last_error: any;
    const is_result_empty_default = (value: T): boolean => {
        if (value === null || value === undefined || value === "") return true;
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === "object") return Object.keys(value).length === 0;
        return false;
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await fn();
            if (throw_if_empty_result) {
                const is_empty = typeof is_empty_result_fn === "function" ? is_empty_result_fn(result) : is_result_empty_default(result);
                if (is_empty) {
                    const empty_error: Error = new Error(`Empty result for function "${name}"`);
                    empty_error.name = "EMPTY_RESULT";
                    throw empty_error;
                }
            }
            if (debug) {
                if (attempt > 1) {
                    logger.log(`✅ ${name} succeeded after ${attempt} attempts`);
                } else {
                    logger.log(`✅ ${name} succeeded on first attempt`);
                }
            }
            return result;
        } catch (error: any) {
            last_error = error;

            const error_code = error?.code || error?.errno || error?.name || "";
            const should_retry = retry_on_errors_codes.length === 0 || retry_on_errors_codes.includes(error_code);

            if (!should_retry) {
                if (debug) {
                    logger.error(`❌ Retry for ${name} failed with error code ${error_code}`, last_error);
                }
                throw error;
            }
            if (attempt === retries) {
                if (debug) {
                    logger.error(`❌ Retry for ${name} failed after ${retries} attempts`, last_error);
                }
                throw error;
            }

            on_retry_fn?.(attempt, retries, last_error);

            let delay_seconds = delay;
            if (random_delay) {
                delay_seconds = get_random_number_between(random_delay.min, random_delay.max);
            } else if (typeof delay_fn === "function") {
                delay_seconds = delay_fn(attempt, retries, last_error);
            } else if (delays.length >= attempt) {
                delay_seconds = delays[attempt - 1];
            }

            const delay_ms = delay_seconds * 1000;
            if (debug) {
                logger.error(`🟡 Retry for ${name} failed in attempt "${attempt} trying again in ${delay_seconds} seconds"`, last_error);
            }
            await sleep(delay_ms);
        }
    }
    if (debug) {
        logger.error(`❌ Retry for ${name} failed after ${retries} attempts`, last_error);
    }
    throw last_error;
};

export const get_random_number_between = (min: number, max: number): number => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};
