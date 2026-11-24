type Place = { city: string | null; state: string | null };
type Rate = {
  pickup_city: string; pickup_state: string; delivery_city: string; delivery_state: string;
  delivery_code: string | null; base_rate: number | string;
};

const normalize = (value: string | null) => (value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
function placeKey(place: Place, delivery = false) {
  const state = normalize(place.state);
  let city = normalize(place.city);
  if (delivery && city === "GARDEN CITY" && state === "GA") city = "SAVANNAH";
  if (!delivery && city === "HAZELHURST" && state === "GA") city = "HAZLEHURST";
  return `${city}|${state}`;
}

export function olamTransitRate(rates: readonly Rate[], pickups: readonly Place[], delivery: Place, deliveryCode: string) {
  const destination = placeKey(delivery, true);
  if (!pickups.length || !delivery.city || !delivery.state) throw Error("OLAM rate lookup requires pickup and delivery cities and states.");
  const amounts = pickups.map(pickup => {
    const origin = placeKey(pickup);
    const lane = rates.filter(rate => placeKey({ city: rate.pickup_city, state: rate.pickup_state }) === origin &&
      placeKey({ city: rate.delivery_city, state: rate.delivery_state }, true) === destination);
    const specific = lane.filter(rate => rate.delivery_code === deliveryCode);
    const matches = specific.length ? specific : lane.filter(rate => !rate.delivery_code);
    if (matches.length !== 1) throw Error(`${matches.length ? "Conflicting" : "Missing"} OLAM base rate for ${pickup.city ?? "unknown city"}, ${pickup.state ?? "unknown state"} → ${delivery.city}, ${delivery.state}.`);
    const amount = Number(matches[0].base_rate);
    if (!Number.isFinite(amount) || amount <= 0) throw Error("The OLAM base rate is invalid.");
    return Math.round(amount * 100);
  });
  if (new Set(amounts).size !== 1) throw Error("OLAM pickups match different base rates. Review this order before creating it.");
  return amounts[0] / 100;
}
