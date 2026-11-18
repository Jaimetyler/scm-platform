// Explicit aliases identify billing accounts; never infer a customer from a mark.
export function bookingChargeCustomer(name: string, terminal?: string) {
  const value = name.trim().replace(/\s+/g, " ").toUpperCase();
  if (/^BUNGE USA AGRICULTURE\s*,?\s*LLC\.?$/.test(value))
    return { code: "BUNGOMNE", ids: ["BUNGOMNE"], negotiatedFuel: true };
  if (/^(?:OLAM AGRI AMERICAS INC\.?|OLAM COTTON|OLAM\/BRIGHTFIELD COTTON)$/.test(value))
    return { code: "OLAMRITX", ids: ["OLAMRITX", "OLAMRIT1"], negotiatedFuel: false };
  if (/^ED\s*&\s*F\s+MAN COTTON(?:\s+LLC\.?)?$/.test(value))
    return terminal === "HOU"
      ? { code: "EDFMLOTX", ids: ["EDFMLOTX"], negotiatedFuel: false }
      : { code: "EDFMECTX", ids: ["EDFMECTX", "EDFMHOTX"], negotiatedFuel: false };
  if (terminal === "HOU" && /^(?:TOYO COTTON(?: COMPANY| CO\.?)?|TOYO COTTON \(JAPAN\) CO\.?)$/.test(value))
    return { code: "TOYOLOTX", ids: ["TOYOLOTX"], negotiatedFuel: false };
  return null;
}
