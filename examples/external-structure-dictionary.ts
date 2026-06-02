import { Session, objectToDictionaryArgument, type GemStoneArgument } from "gemstone-js";

interface CheckoutLine {
  sku: string;
  quantity: number;
  unitPrice: number;
}

class CheckoutDraft {
  readonly id: string;
  readonly customerName: string;
  readonly currency: string;
  readonly lines: CheckoutLine[] = [];
  discount = 0;

  constructor(id: string, customerName: string, currency: string) {
    this.id = id;
    this.customerName = customerName;
    this.currency = currency;
  }

  addLine(sku: string, quantity: number, unitPrice: number): void {
    this.lines.push({ sku, quantity, unitPrice });
  }

  applyDiscount(amount: number): void {
    this.discount += amount;
  }

  get subtotal(): number {
    return this.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  }

  get total(): number {
    return this.subtotal - this.discount;
  }
}

const key = "ExternalCheckoutExample";

const checkout = new CheckoutDraft("CHK-1001", "Tariq", "GBP");
checkout.addLine("GS-JS-SUPPORT", 2, 45);
checkout.addLine("GS-EXPLORER", 1, 25);
checkout.applyDiscount(15);

const metadata: Record<string, GemStoneArgument> = {
  source: "node",
  status: "ready",
  tags: ["external", "dictionary", "committed"],
};

metadata.reviewed = true;
metadata.note = "Built and manipulated in JavaScript before login.";

const payload = objectToDictionaryArgument({
  id: checkout.id,
  customerName: checkout.customerName,
  currency: checkout.currency,
  lineCount: checkout.lines.length,
  skus: checkout.lines.map((line) => line.sku),
  subtotal: checkout.subtotal,
  discount: checkout.discount,
  total: checkout.total,
  metadata,
});

await Session.withEnv(async (session) => {
  await session.globalSetDict(key, payload);
  await session.commit();
});

const committed = await Session.withEnv(async (session) => {
  const stored = await session.globalRequireDict(key);
  const values = await stored.pick([
    "id",
    "customerName",
    "currency",
    "lineCount",
    "skus",
    "subtotal",
    "discount",
    "total",
  ]);
  const nested = await stored.pickDict(["metadata"]);
  return {
    ...values,
    metadata: nested.metadata ? await nested.metadata.toObject({ maxEntries: 20 }) : null,
  };
});

console.log(committed);
// {
//   id: "CHK-1001",
//   customerName: "Tariq",
//   currency: "GBP",
//   lineCount: 2n,
//   skus: ["GS-JS-SUPPORT", "GS-EXPLORER"],
//   subtotal: 115n,
//   discount: 15n,
//   total: 100n,
//   metadata: {
//     source: "node",
//     status: "ready",
//     tags: ["external", "dictionary", "committed"],
//     reviewed: true,
//     note: "Built and manipulated in JavaScript before login."
//   }
// }
