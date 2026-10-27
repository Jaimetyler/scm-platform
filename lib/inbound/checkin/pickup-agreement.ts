// Versioned transcription of SCM's supplied paper form; do not edit a published version.
export const PICKUP_AGREEMENT_VERSION = "scm-pickup-2026-10-27-v1";
export const PICKUP_TERMS = {
  en: {
    title: "PICK UP ONLY — Driver agreement",
    introduction: "Please read the below carefully. You must sign that you have read and understand these parameters in order to proceed with loading by Supply Chain Management.",
    clauses: [
      "Lumber loads require 8’ DROP TARPS. If you DO NOT have 8’ TARPS please let us know NOW. We may be able to assist with your load. If SCM loads the trailer and you then notify us, the trucking company will be liable for the charge of $400 associated with handling and re-handling of the cargo.",
      "Supply Chain Management DOES NOT PROVIDE and is NOT liable for any weight given. This may only be an estimate and it is the trucking company’s responsibility to scale and legal out the load.",
      "Supply Chain Management loads per the driver’s request and direction. Ultimately it is the responsibility of the driver to ensure the load is properly loaded for safe transport. Please be sure to discuss loading with the operator who is loading your trailer/flat bed.",
      "Driver MUST CHOCK HIS WHEELS IN ORDER TO BE LOADED or UNLOADED. Supply Chain Management forklift operators WILL NOT begin loading until your tires are chocked and YOUR TRUCK IS SHUT DOWN.",
    ],
    acknowledgment: "I have read the above information and understand these parameters and responsibilities.",
    consent: "I agree to sign this pickup agreement electronically using my signature below.",
  },
  es: {
    title: "SOLO RECOLECCIONES — Acuerdo del conductor",
    introduction: "Lea atentamente lo siguiente. Debe firmar para confirmar que ha leído y comprende estas condiciones antes de que Supply Chain Management proceda con la carga.",
    clauses: [
      "Las cargas de madera requieren LONAS CON CAÍDA DE 8 PIES. Si NO tiene estas lonas, avísenos AHORA. Es posible que podamos ayudarle con su carga. Si SCM carga el remolque y usted nos avisa después, la empresa de transporte será responsable del cargo de $400 por la manipulación y la nueva manipulación de la mercancía.",
      "Supply Chain Management NO PROPORCIONA pesos ni es responsable de ningún peso indicado. El peso puede ser solo una estimación y es responsabilidad de la empresa de transporte pesar el vehículo en una báscula y asegurarse de que la carga cumpla los límites legales de peso.",
      "Supply Chain Management carga según la solicitud y las instrucciones del conductor. En última instancia, el conductor es responsable de asegurarse de que la carga esté correctamente cargada para su transporte seguro. Hable sobre la carga con el operador que esté cargando su remolque o plataforma.",
      "El conductor DEBE COLOCAR CALZOS EN LAS RUEDAS PARA QUE SE CARGUE O DESCARGUE EL VEHÍCULO. Los operadores de montacargas de Supply Chain Management NO comenzarán a cargar hasta que las ruedas estén calzadas y EL CAMIÓN ESTÉ APAGADO.",
    ],
    acknowledgment: "He leído la información anterior y comprendo estas condiciones y responsabilidades.",
    consent: "Acepto firmar electrónicamente este acuerdo de recolección con mi firma a continuación.",
  },
} as const;
export type SignatureStroke = [number, number][];
export type PickupAcceptance = { version: string; language: "en" | "es"; acknowledged: boolean; electronicConsent: boolean; strokes: SignatureStroke[] };
export function validatePickupAcceptance(value: unknown): PickupAcceptance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Read and sign the pickup agreement before checking in.");
  const a = value as PickupAcceptance;
  if (a.version !== PICKUP_AGREEMENT_VERSION || !["en", "es"].includes(a.language) || a.acknowledged !== true || a.electronicConsent !== true)
    throw new Error("Read and sign the current pickup agreement before checking in.");
  if (!Array.isArray(a.strokes) || a.strokes.length < 1 || a.strokes.length > 100) throw new Error("Draw your signature before checking in.");
  let points = 0, distance = 0;
  for (const stroke of a.strokes) {
    if (!Array.isArray(stroke) || !stroke.length) throw new Error("Invalid signature.");
    points += stroke.length;
    for (let i = 0; i < stroke.length; i++) {
      const point = stroke[i];
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1)) throw new Error("Invalid signature.");
      if (i) distance += Math.hypot(point[0] - stroke[i-1][0], point[1] - stroke[i-1][1]);
    }
  }
  if (points > 4000 || points < 3 || distance < .05) throw new Error("Draw your signature before checking in.");
  return { version: a.version, language: a.language, acknowledged: true, electronicConsent: true, strokes: a.strokes };
}
