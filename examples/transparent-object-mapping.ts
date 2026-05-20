import {
  Session,
  transparentObject,
  type Oop,
  type TypedOop,
} from "gemstone-js";

interface Booking {
  id: string;
  status: string;
}

interface Customer {
  name: string;
}

type BookingTransparentMethods = {
  updateStatus(status: string, reason: string): Promise<string>;
  customer: PromiseLike<TypedOop<Customer>>;
  rawCustomer: PromiseLike<Oop>;
};

await using session = await Session.connect(Session.configFromEnv());

const bookingHandle = await session
  .classRef<Booking>("BookingRepository")
  .sendObject("find:", "B-1001");

const booking = transparentObject<Booking, BookingTransparentMethods>(bookingHandle, {
  selectors: {
    updateStatus: "status:reason:",
  },
  setters: {
    setStatus: "status:",
  },
  objectSelectors: {
    customer: "customer",
  },
  oopSelectors: {
    rawCustomer: "customer",
  },
  snapshot: {
    id: "id",
    status: "status",
    customer: { selector: "customer", kind: "oop" },
    details: { selector: "details", kind: "dict", maxEntries: 100 },
  },
});

try {
  const before = await booking.status;
  await booking.updateStatus("confirmed", "deposit received");
  await booking.$assign({ status: "confirmed" });
  const customer = await booking.customer;
  const rawCustomer = await booking.rawCustomer;
  const payload = await booking.$snapshot();

  console.log({
    before,
    after: await booking.status.refresh(),
    customerOop: customer.oop.toString(),
    rawCustomer: rawCustomer.toString(),
    payload,
  });

  await customer.release();
  await session.commit();
} catch (error) {
  await session.abort().catch(() => undefined);
  throw error;
} finally {
  await booking.$release();
}
