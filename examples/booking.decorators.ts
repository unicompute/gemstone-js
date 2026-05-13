import { GemStoneClass, GemStoneSelector, type Session, type TypedOop } from "gemstone-js";
import type { Booking } from "./booking.ts";

@GemStoneClass("Booking")
class BookingModel {
  @GemStoneSelector("currentStatus")
  currentBookingStatus(session: Session): Promise<string> {
    throw new Error("Decorator source is scanned for codegen only.");
  }

  @GemStoneSelector("find:")
  static findBookingObject(session: Session, id: string): Promise<TypedOop<Booking>> {
    throw new Error("Decorator source is scanned for codegen only.");
  }
}
