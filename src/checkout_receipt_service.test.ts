import test from "node:test";
import assert from "node:assert/strict";
import { buildFormFields, checkoutRequest } from "./checkout_receipt_service.ts";

test("checkout data becomes the flattened receipt fields", () => {
  const order = checkoutRequest.parse({
    orderId: "order-1042",
    customerEmail: "buyer@example.com",
    customerName: "Lin Wei",
    totalCents: 4599,
    currency: "USD",
    shippingAddress: { line1: "8 Market Street", city: "Austin", postalCode: "78701", country: "US" }
  });
  assert.deepEqual(buildFormFields(order), {
    order_id: "order-1042",
    customer_name: "Lin Wei",
    customer_email: "buyer@example.com",
    total: "45.99 USD",
    address: "8 Market Street, Austin, 78701, US"
  });
});
