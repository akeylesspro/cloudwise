import {
    CdrItem,
    Connector,
    Evse,
    Location,
    OcpiConnector,
    OcpiEvse,
    OcpiLocation,
    ParsedCdrItem,
    ParsedConnectorData,
    ParsedEvseData,
    ParsedLocationData,
    ParsedOcpiLocationData,
    ParsedTariffDetails,
    ParsedTariffItem,
    TariffDetails,
    TariffItem,
} from "../types";

import { Timestamp } from "firebase-admin/firestore";

export const parse_location = (location: Location): ParsedLocationData => {
    const { Name: name, Images: image, Id: id, Country: country, Address: address, Latitude: lat, Longitude: lng } = location;
    const res: ParsedLocationData = {
        name,
        id,
        country,
        address,
        lat,
        lng,
    };
    if (image) {
        res.image = image;
    }

    return res;
};

export const parse_ocpi_location = (location: OcpiLocation): ParsedOcpiLocationData => {
    const { OcpiEvses: ocpi_evses, CompanyName: company_name, PartyId: party_id } = location;
    const ocpi_evses_data = ocpi_evses.map(parse_ocpi_eves);
    const loc = parse_location(location);
    const res: ParsedOcpiLocationData = {
        ...loc,
        id: `${loc.id}-${party_id}-${loc.country}`,
        original_id: loc.id,
        company_name,
        party_id,
        stations: ocpi_evses_data,
    };

    return res;
};

export const parse_eves = (evse: Evse | OcpiEvse): ParsedEvseData => {
    const { Uid: uid, Status: status, FloorLevel: floor_level, PhysicalReference: physical_reference, LastUpdated: last_updated } = evse;
    const connectors = "OcpiConnectors" in evse ? evse.OcpiConnectors : evse.Connectors;

    const connectors_data = connectors.map(parse_ocpi_connectors);
    return {
        uid,
        status,
        floor_level,
        physical_reference,
        last_updated: Timestamp.fromDate(new Date(last_updated)),
        connectors: connectors_data,
    };
};

export const parse_ocpi_eves = (evse: OcpiEvse): ParsedEvseData => {
    const {
        Uid: uid,
        Status: status,
        FloorLevel: floor_level,
        PhysicalReference: physical_reference,
        LastUpdated: last_updated,
        OcpiConnectors: connectors,
    } = evse;
    const connectors_data = connectors.map(parse_ocpi_connectors);
    return {
        uid,
        status,
        floor_level,
        physical_reference,
        last_updated: Timestamp.fromDate(new Date(last_updated)),
        connectors: connectors_data,
    };
};

const parse_tariff_item = (tariff_item: TariffItem): ParsedTariffItem => {
    const { Text: text, Currency: currency, Prices: prices, From: from, To: to, DaysOfWeek: days_of_week } = tariff_item;
    const res: ParsedTariffItem = {
        text,
        currency,
        days_of_week,
        prices: prices.map((v) => {
            const { Type: type, Price: price, Vat: vat } = v;
            return {
                type,
                price,
                vat,
            };
        }),
        from: Timestamp.fromDate(new Date(from)),
        to: Timestamp.fromDate(new Date(to)),
    };
    return res;
};

const parse_tariff_details = (tariff_details: TariffDetails) => {
    const {
        PricePerKwh: price_per_kwh,
        ConnectionFee: connection_fee,
        ParkingFee: parking_fee,
        TariffItems: tariff_items,
        Currency: currency,
    } = tariff_details;
    const res: ParsedTariffDetails = {
        price_per_kwh,
        connection_fee,
        parking_fee,
        currency,
        tariff_items: tariff_items.map(parse_tariff_item),
    };
    return res;
};

export const parse_ocpi_connectors = (connector: OcpiConnector | Connector): ParsedConnectorData => {
    const {
        Id: connector_id,
        Standard: standard,
        Format: format,
        PowerType: power_type,
        MaxVoltage: max_voltage,
        MaxAmperage: max_amperage,
        MaxElectricPower: max_electric_power,
        LastUpdated: last_updated,
        TariffId: tariff_id,
    } = connector;
    const res: ParsedConnectorData = {
        id: connector_id,
        standard,
        format,
        power_type,
        max_voltage,
        max_amperage,
        max_electric_power,
        last_updated: Timestamp.fromDate(new Date(last_updated)),
        tariff_id,
    };
    const is_not_ocpi = "TariffDetails" in connector;
    if (is_not_ocpi) {
        const { PricePerKwh: price_per_kwh, ConnectionFee: connection_fee, ParkingFee: parking_fee, TariffDetails: tariff_details } = connector;
        res.price_per_kwh = price_per_kwh;
        res.connection_fee = connection_fee;
        res.parking_fee = parking_fee;
        res.tariff_details = parse_tariff_details(tariff_details);
    }
    return res;
};

export const parse_cdr = (cdr: CdrItem): ParsedCdrItem => {
    const {
        OcpPartyId: party_id,
        Id: id,
        StartDateTime: start_date_time,
        EndDateTime: end_date_time,
        LastUpdated: last_updated,
        Currency: currency,
        TotalCost: total_cost,
        TotalCostWithVat: total_cost_with_vat,
        TotalFixCost: total_fix_cost,
        TotalFixCostWithVat: total_fix_cost_with_vat,
        TotalEnergy: total_energy,
        TotalTime: total_time,
        TotalParkingTime: total_parking_time,
        AvgKwhPrice: avg_kwh_price,
        Duration: duration,
    } = cdr;

    const res: ParsedCdrItem = {
        id,
        party_id,
        start_date_time: Timestamp.fromDate(new Date(start_date_time)),
        end_date_time: Timestamp.fromDate(new Date(end_date_time)),
        last_updated: Timestamp.fromDate(new Date(last_updated)),
        currency,
        total_cost,
        total_cost_with_vat,
        total_fix_cost,
        total_fix_cost_with_vat,
        total_energy,
        total_time,
        total_parking_time,
        avg_kwh_price,
        duration,
    };

    return res;
};
