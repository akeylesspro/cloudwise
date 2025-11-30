import axios, { AxiosRequestConfig } from "axios";
import { mock_get_command_status, mock_get_location_details, mock_get_user_cdrs, mock_send_command } from "./mock_store";

const original_post: typeof axios.post = axios.post;

export const enable_api_interceptor = (): void => {
    axios.post = async (url: string, data?: any, config?: AxiosRequestConfig) => {
        if (should_handle_cloudwise(url)) {
            return handle_cloudwise_request(url, data, config);
        }
        return original_post(url, data, config);
    };
};

export const disable_api_interceptor = (): void => {
    axios.post = original_post;
};

const should_handle_cloudwise = (url: string): boolean => {
    return ["sendCommand", "getCommandStatus", "getUserCdrs", "getLocationDetails"].some((endpoint) => url.includes(endpoint));
};

const handle_cloudwise_request = async (url: string, payload?: any, config?: AxiosRequestConfig) => {
    const extract_endpoint = (url: string): string => {
        if (url.includes("sendCommand")) return "sendCommand";
        if (url.includes("getCommandStatus")) return "getCommandStatus";
        if (url.includes("getUserCdrs")) return "getUserCdrs";
        if (url.includes("getLocationDetails")) return "getLocationDetails";
        return "unknown";
    };
    const endpoint = extract_endpoint(url);
    switch (endpoint) {
        case "sendCommand":
            return { data: mock_send_command(payload) };
        case "getCommandStatus":
            return { data: mock_get_command_status(payload) };
        case "getUserCdrs":
            return { data: mock_get_user_cdrs(payload) };
        case "getLocationDetails":
            return { data: mock_get_location_details(payload) };
        default:
            return original_post ? (original_post as any)(url, payload, config) : Promise.reject(new Error("axios original post missing"));
    }
};
