export const sparkProducts = [
  {
    id: "mobile-connector",
    name: "Mobile Connector",
    description: "A portable charging cable for standard household outlets.",
    priceCents: 30000,
    icon: "bolt",
  },
  {
    id: "all-weather-mats",
    name: "All-Weather Interior Mats",
    description: "Recycled rubber mats fitted for the Spark One cabin.",
    priceCents: 22500,
    icon: "grid",
  },
  {
    id: "console-organizer",
    name: "Center Console Organizer",
    description: "A modular tray for the Spark One center console.",
    priceCents: 3500,
    icon: "tray",
  },
] as const;

export const sparkScenarios = [
  { id: "everyday", label: "Everyday account", description: "Charging works and recent orders are healthy." },
  { id: "duplicate_order", label: "Duplicate order", description: "Two matching accessory orders are still processing and one can be canceled." },
  { id: "faulty_charger", label: "Faulty Home Connector", description: "Charging disconnects and the connector is return eligible." },
  { id: "delayed_replacement", label: "Delayed replacement", description: "A replacement connector is delayed in fulfillment." },
  { id: "refund_pending", label: "Missing refund", description: "A returned connector has not been credited back." },
] as const;

export type SparkScenario = typeof sparkScenarios[number]["id"];

export function formatCredits(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}
