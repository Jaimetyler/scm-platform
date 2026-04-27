export type Terminal = "SAV" | "HOU" | "DAL";

export type TerminalDefaults = {
  terminal: Terminal;
  setup_name: string;
  origin_location_id: string;
  destination_location_id: string;
  revenue_code_id: string;
  commodity_id: string;
  equipment_type_id: string;
  ordered_by: string;
  order_type_id: string;
  order_mode: string;
  collection_method: string;
  rate_type: string;
  rate_units: number;
  rate: number;
  carrier_code?: string;
};

export type TariffCharge = {
  tariff_id: number;
  description: string;
  mcleod_code: string;
  default_units?: number;
};

export type ImportChargeInput = {
  tariff_id: number;
  amount: number;
  units?: number;
};

export type ImportInputRow = {
  cust: string;
  customer_id: string;
  bol?: string;
  mark?: string;
  bales?: number;
  received_date?: string;
  ship_date?: string;
  charges: ImportChargeInput[];
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundRate(value: number) {
  return Math.round(value * 10000) / 10000;
}

function formatMcLeodDate(value?: string | null) {
  if (!value) return null;

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, yyyy, mm, dd] = match;
    return `${yyyy}${mm}${dd}000000-0400`;
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  return `${yyyy}${mm}${dd}000000-0400`;
}

export function buildMcLeodOrderPayload(args: {
  row: ImportInputRow;
  defaults: TerminalDefaults;
  charges: TariffCharge[];
}) {
  const { row, defaults, charges } = args;

  const date = formatMcLeodDate(row.received_date || row.ship_date);

  return {
    __type: "orders",
    company_id: "TMS",

    customer_id: row.customer_id,
    vendor_id: defaults.carrier_code || "SCMIRIGA",

    ordered_by: defaults.ordered_by,
    order_type_id: defaults.order_type_id,
    order_mode: defaults.order_mode,
    collection_method: defaults.collection_method,

    revenue_code_id: defaults.revenue_code_id,
    commodity_id: defaults.commodity_id,
    equipment_type_id: defaults.equipment_type_id,

    blnum: row.bol || row.mark || null,
    consignee_refno: row.mark || null,

    rate_type: defaults.rate_type,
    rate_units: defaults.rate_units,
    rate: defaults.rate,

    stops: [
      {
        __type: "stop",
        __name: "stops",
        company_id: "TMS",
        stop_type: "PU",
        status: "A",
        location_id: defaults.origin_location_id,
        sched_arrive_early: date,
        sched_arrive_late: date,
      },
      {
        __type: "stop",
        __name: "stops",
        company_id: "TMS",
        stop_type: "SO",
        status: "A",
        location_id: defaults.destination_location_id,
        sched_arrive_early: date,
        sched_arrive_late: date,
      },
    ],

    otherCharges: charges.map((charge) => {
      const input = row.charges.find(
        (c) => c.tariff_id === Number(charge.tariff_id)
      );

      const units = input?.units ?? 1;
      const amount = roundMoney(input?.amount ?? 0);
      const rate = roundRate(units ? amount / units : amount);

      return {
        __type: "other_charge",
        company_id: "TMS",
        charge_id: charge.mcleod_code,
        descr: charge.description?.slice(0, 28),
        units,
        rate,
        amount,
        incl_in_freight: "N",
        bill_type: "F",
        calc_method: "F",
      };
    }),
  };
}