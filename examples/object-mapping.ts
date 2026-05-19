import { Session, mappedObject, type TypedOop } from "gemstone-js";

interface Booking {
  id: string;
  status: string;
}

interface Customer {
  name: string;
}

type BookingMapping = {
  setStatus(status: string): Promise<unknown>;
  customer(): Promise<TypedOop<Customer>>;
};

await using session = await Session.connect(Session.configFromEnv());

const bookingHandle = await session
  .classRef<Booking>("BookingRepository")
  .sendObject("find:", "B-1001");

const booking = mappedObject<Booking, BookingMapping>(bookingHandle, {
  selectors: {
    id: "id",
    status: "status",
  },
  setters: {
    setStatus: "status:",
  },
  objectSelectors: {
    customer: "customer",
  },
  snapshot: ["id", "status"],
});

try {
  const before = await booking.status();
  await booking.setStatus("confirmed");
  const customer = await booking.customer();
  const payload = await booking.$snapshot();

  console.log({
    before,
    after: await booking.status(),
    customerOop: customer.oop.toString(),
    payload,
  });

  await customer.release();
} finally {
  await booking.$release();
  await session.abort().catch(() => undefined);
}

