// What a fallback turn (no reply from the AI) says about the player's orders.
//
// It used to write the order itself as the event — "Soviet Union acts on treaty of
// moscow with finland: … finland cedes the karelian isthmus …" — and mark the order
// done. The following turns read that as history and narrated a cession the map
// never saw. Now the order is quoted as an order, said plainly NOT to have
// happened, and kept queued (fallbackJumpSimulation in gameplay.js).

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const pendingOrderTitle = (country) => `${clean(country)}: order not yet carried out`;

export const pendingOrderDescription = (country, orderTitle) => {
  const order = clean(orderTitle);
  const quoted = order.length > 160 ? `${order.slice(0, 157).trimEnd()}…` : order;
  return `The simulation could not be run for this period (no reply from the AI), so ${clean(country)}'s order "${quoted}" was NOT carried out: nothing it describes has happened. It stays queued for the next turn.`;
};

export const pendingOrdersSummary = (country) =>
  `The simulation could not be run for this period, so ${clean(country)}'s orders were not carried out: nothing they describe has happened yet, and they stay queued for the next turn.`;
