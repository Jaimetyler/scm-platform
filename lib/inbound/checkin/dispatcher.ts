type McLeodUser = { id?: unknown; name?: unknown };
type McLeodMovement = {
  dispatcher_user_id?: unknown;
  dispatcherUser?: McLeodUser | null;
};
type McLeodOrder = {
  movements?: McLeodMovement[];
  operationsUser?: McLeodUser | null;
  enteredUser?: McLeodUser | null;
};

export function getOrderDispatcher(order: McLeodOrder): { id: string | null; name: string | null } {
  // The movement owns the dispatcher assignment. Other order users may be
  // different people, so only use their names when their IDs match.
  const movement = order.movements?.find((item) => item.dispatcher_user_id) ?? order.movements?.[0];
  const id = String(movement?.dispatcher_user_id ?? movement?.dispatcherUser?.id ?? "").trim();
  if (!id) return { id: null, name: null };

  const user = [movement?.dispatcherUser, order.operationsUser, order.enteredUser]
    .find((candidate) => String(candidate?.id ?? "").trim().toLowerCase() === id.toLowerCase());
  return { id, name: String(user?.name ?? "").trim() || null };
}
