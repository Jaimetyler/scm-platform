export type DriverLanguage = "en" | "es";

export const driverSpanish: Record<string, string> = {
  "Loading check-in…": "Cargando el registro…",
  "Check-In Unavailable": "Registro no disponible",
  "You’re in line": "Está en la fila",
  "You’re checked in": "Su registro está completo",
  "Your": "Su",
  "current place in the container line at": "posición actual en la fila de contenedores en",
  "This phone cannot check in another container driver until warehouse staff completes or removes this entry.": "Este teléfono no puede registrar a otro conductor de contenedores hasta que el personal complete o elimine este registro.",
  "Your arrival was sent to": "Su llegada fue registrada en",
  ". Warehouse staff can now see your load.": ". El personal del almacén ya puede ver su carga.",
  "Your load is": "A su carga le faltan",
  "bale": "paca",
  "short": "",
  "Expected": "Esperadas",
  "· Reported": "· Declaradas",
  "Your check-in was saved. Please speak with warehouse staff about the shortage.": "Su registro se guardó. Hable con el personal del almacén sobre las pacas faltantes.",
  "Your paperwork photo was attached.": "Se adjuntó la foto de sus documentos.",
  "Your check-in was saved, but the photo did not upload. Keep your paper BOL ready for warehouse staff.": "Su registro se guardó, pero la foto no se cargó. Tenga a mano el conocimiento de embarque (BOL) para el personal.",
  "Please follow the yard’s instructions and wait for direction.": "Siga las instrucciones del patio y espere indicaciones.",
  "SCM DRIVER CHECK-IN": "REGISTRO DE CONDUCTORES SCM",
  "Choose why you are here. For freight, choose pickup or delivery, then enter your pickup / delivery reference or SCM order number.": "Seleccione el motivo de su visita. Para una carga, elija recolección o entrega e ingrese la referencia o el número de orden SCM.",
  "Container / Drayage": "Contenedor / Acarreo",
  "Join the driver line": "Entrar en la fila de conductores",
  "Domestic Freight": "Carga nacional",
  "Pickup or delivery": "Recolección o entrega",
  "Pickup or delivery? *": "¿Recolección o entrega? *",
  "Select": "Seleccione",
  "Delivery": "Entrega",
  "Pickup": "Recolección",
  "Pickup / delivery reference or SCM order number": "Referencia de recolección / entrega o número de orden SCM",
  "Find my load": "Buscar mi carga",
  "Finding your load…": "Buscando su carga…",
  "Driver name *": "Nombre del conductor *",
  "Mobile number *": "Número de celular *",
  "Trucking company *": "Empresa de transporte *",
  "Material *": "Tipo de carga *",
  "Cotton": "Algodón",
  "Lumber": "Madera",
  "Other / FAK": "Otra / FAK",
  "Order commodity:": "Mercancía de la orden:",
  ". Confirm the material matches your paperwork.": ". Confirme que coincida con sus documentos.",
  "Destination *": "Destino *",
  "Mark *": "Marca *",
  "Bale count on BOL *": "Cantidad de pacas en el BOL *",
  "Bales on truck (if different from BOL)": "Pacas en el camión (si difiere del BOL)",
  "Check in only yourself. Each phone may hold one active place in the container line.": "Regístrese solo usted. Cada teléfono puede tener una sola posición activa en la fila de contenedores.",
  "Paperwork photo (optional)": "Foto de los documentos (opcional)",
  "Take a clear photo of the BOL, pickup order, or other paperwork.": "Tome una foto clara del BOL, la orden de recolección u otros documentos.",
  "Your location is used to confirm this check-in at the yard and is saved with the arrival record.": "Su ubicación se utiliza para confirmar que está en el patio y se guarda con el registro de llegada.",
  "Confirm your trucking company and driver": "Confirme su empresa de transporte y conductor",
  "More than one load matches. Select your company and driver details.": "Hay más de una carga coincidente. Seleccione su empresa y los datos del conductor.",
  "Some loads have the same or missing company and driver details. Please speak with warehouse staff to confirm those loads.": "Algunas cargas tienen datos de empresa o conductor iguales o incompletos. Hable con el personal del almacén para confirmarlas.",
  "Go back / speak with warehouse staff": "Volver / hablar con el personal",
  "Verifying location…": "Verificando ubicación…",
  "Verify location & join line": "Verificar ubicación y entrar en la fila",
  "Verify location & check in": "Verificar ubicación y registrarse",
  "Trucking company not listed": "Empresa de transporte no indicada",
  "Driver not listed": "Conductor no indicado",
  "This load is already closed in McLeod. Please speak with warehouse staff.": "Esta carga ya está cerrada en McLeod. Hable con el personal del almacén.",
  "This order is already closed in McLeod. Please speak with warehouse staff.": "Esta orden ya está cerrada en McLeod. Hable con el personal del almacén.",
  "Find your load and confirm any match before checking in. If the search cannot finish, speak with warehouse staff.": "Busque su carga y confirme la coincidencia antes de registrarse. Si la búsqueda no termina, hable con el personal.",
  "McLeod lookup is temporarily unavailable. You can check in now; warehouse staff will verify your load.": "La búsqueda en McLeod no está disponible temporalmente. Puede registrarse; el personal verificará su carga.",
  "No SCM order found. Continue with the details from your paperwork.": "No se encontró una orden SCM. Continúe con los datos de sus documentos.",
  "Check your reference or speak with warehouse staff to confirm your load.": "Revise su referencia o hable con el personal para confirmar su carga.",
  "More than one load now matches. Select Find my load and confirm your trucking company and driver.": "Ahora hay más de una carga coincidente. Seleccione Buscar mi carga y confirme su empresa y conductor.",
  "The load details changed. Find your load again or speak with warehouse staff.": "Los datos de la carga cambiaron. Vuelva a buscarla o hable con el personal.",
  "The load search is incomplete. Try again or speak with warehouse staff.": "La búsqueda de la carga está incompleta. Intente de nuevo o hable con el personal.",
  "Could not confirm the load search. Try again or speak with warehouse staff.": "No se pudo confirmar la búsqueda. Intente de nuevo o hable con el personal.",
  "Could not search for your load. Try again or speak with warehouse staff.": "No se pudo buscar su carga. Intente de nuevo o hable con el personal.",
  "Check-in could not be confirmed yet. Try again without changing the details; the same check-in identifier will be reused.": "Aún no se pudo confirmar el registro. Intente de nuevo sin cambiar los datos; se reutilizará el mismo identificador para evitar duplicados.",
  "Location permission is required. Allow location access for this site and try again.": "Se requiere permiso de ubicación. Permita que este sitio acceda a su ubicación e intente de nuevo.",
  "Your phone could not get an accurate location. Move into an open area and try again.": "Su teléfono no pudo obtener una ubicación precisa. Muévase a un área abierta e intente de nuevo.",
  "Your phone returned an invalid location.": "Su teléfono devolvió una ubicación no válida.",
  "Your location expired. Please try checking in again.": "Su ubicación venció. Intente registrarse de nuevo.",
  "Your GPS signal is not accurate enough. Move into an open area and try again.": "La señal GPS no es suficientemente precisa. Muévase a un área abierta e intente de nuevo.",
  "You must be at the SCM yard to check in.": "Debe estar en el patio SCM para registrarse.",
  "This phone does not support location services.": "Este teléfono no admite servicios de ubicación.",
  "This check-in link is unavailable": "Este enlace de registro no está disponible",
  "Check-in failed": "No se pudo completar el registro",
  "Pickup already completed in McLeod": "La recolección ya se completó en McLeod",
  "Delivery already completed in McLeod": "La entrega ya se completó en McLeod",
  "Order already completed in McLeod": "La orden ya se completó en McLeod",
  "Order already closed out in McLeod": "La orden ya está cerrada en McLeod",
  "not listed": "no indicada",
  "Order cancelled in McLeod": "La orden fue cancelada en McLeod",
  "Completion time unavailable": "Hora de finalización no disponible",
  "Cancellation time unavailable": "Hora de cancelación no disponible",
  "Trucking company unavailable": "Empresa de transporte no disponible",
  "This order cannot be checked in again. Contact warehouse staff if the record needs correction.": "Esta orden no puede registrarse de nuevo. Comuníquese con el personal del almacén si se necesita corregir el registro.",
};

Object.assign(driverSpanish, {
  "Enter the bale quantity, not the cotton mark.": "Ingrese la cantidad de pacas, no la marca del algodón.",
  "Trailer number *": "Número de remolque *",
  "Trailer number (optional)": "Número de remolque (opcional)",
  "Enter the trailer number before checking in.": "Ingrese el número de remolque antes de registrarse.",
  "Trailer number must be 80 characters or fewer.": "El número de remolque debe tener 80 caracteres o menos.",
  "Read and sign the pickup agreement before checking in.": "Lea y firme el acuerdo de recolección antes de registrarse.",
  "Read and sign the current pickup agreement before checking in.": "Lea y firme la versión actual del acuerdo de recolección antes de registrarse.",
  "Complete every pickup agreement field before checking in.": "Complete todos los campos del acuerdo de recolección antes de registrarse.",
  "Draw your signature before checking in.": "Dibuje su firma antes de registrarse.",
  "The signature printed name must match the driver name.": "El nombre en la firma debe coincidir con el nombre del conductor.",
  "Invalid signature.": "La firma no es válida. Bórrela y firme de nuevo.",
});

export function translateDriverText(text: string, language: DriverLanguage): string {
  if (language === "en") return text;
  if (Object.hasOwn(driverSpanish, text)) return driverSpanish[text];
  const found = text.match(/^SCM order found: (pickup|delivery)\. Please verify your trucking company and driver details below\.$/);
  if (found) return `Se encontró la orden SCM: ${found[1] === "pickup" ? "recolección" : "entrega"}. Verifique los datos de su empresa y conductor a continuación.`;
  const phone = text.match(/^ · Phone ending (\d{1,4})$/);
  if (phone) return ` · Teléfono terminado en ${phone[1]}`;
  if (text.endsWith(", this is your")) return `${text.slice(0, -14)}, esta es su`;
  if (text === "COTTON") return "ALGODÓN";
  if (text === "LUMBER") return "MADERA";
  return text;
}

export function translateDriverError(text: string, language: DriverLanguage): string {
  const translated = translateDriverText(text, language);
  return language === "en" || translated !== text || !text ? translated :
    "No se pudo completar la solicitud. Intente de nuevo sin cambiar los datos o hable con el personal del almacén.";
}
