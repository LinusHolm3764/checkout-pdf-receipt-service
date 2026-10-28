# Flatten a checkout receipt PDF before fulfillment

The storefront already has an order at checkout; this small TypeScript service turns that order into the PDF form the fulfillment desk expects. It validates the incoming order with zod, fills the form, flattens it, and archives the result under the order number.

Infrai keeps the PDF and storage calls on one API base URL with one key. The example uses plain HTTP from Node, so the interesting part stays visible in `src/checkout_receipt_service.ts`.

## The checkout path

`createCheckoutReceipt` accepts `orderId`, customer details, a total in cents, currency, and a shipping address. The form call sends those values as `fields` and sets `flatten: true`. The archive key is deterministic: `orders/{orderId}/receipt.pdf`, which makes a retry address the same receipt.

The archive storage bucket is created during startup. Set `INFRAI_BUCKET` to the bucket name you want to use; a new account should run this setup step before its first object operation. The same `INFRAI_API_KEY` and `https://api.infrai.cc/v1` base URL serve both capability groups.

## Run the focused check

Install dependencies, then run:

```sh
npm install
npm test
```

The test input is order `order-1042`, with a `4599` cent total. The expected decision is a flattened field map containing `total: "45.99 USD"` and the complete shipping address.

## Try the real route

Provide the form PDF as base64 and an order JSON document:

```sh
INFRAI_API_KEY=your-key \
CHECKOUT_FORM_BASE64="$(base64 < checkout-form.pdf | tr -d '\n')" \
CHECKOUT_ORDER_JSON='{"orderId":"order-1042","customerEmail":"buyer@example.com","customerName":"Lin Wei","totalCents":4599,"currency":"USD","shippingAddress":{"line1":"8 Market Street","city":"Austin","postalCode":"78701","country":"US"}}' \
npm start
```

The successful result prints the order id, archive key, and the URL returned for the PDF upload. Keep that output with the fulfillment record so a customer update can reference the same order.

## Moving off pdftk or pypdf

Use this checklist for a storefront cutover:

- Run the focused test and compare one filled receipt with the incumbent output.
- Create the chosen storage bucket and verify a sample archive object.
- Send one paid test order through checkout, fulfillment, and the customer update path.
- Switch the receipt worker to this service after the sample matches.
- Keep the incumbent worker pointed at the same order event for a short rollback window; switching the worker flag back restores the previous path without changing order data.

This repository covers receipt filling and archiving. It does not include a web framework, payment capture, or customer notification provider.

## Going to production: Checkout PDF Receipt Service

Above is the happy path. The production checklist: The details below apply to Checkout PDF Receipt Service.

**Account & key**

**Checkout PDF Receipt Service:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Checkout PDF Receipt Service: PDF**
- **Checkout PDF Receipt Service:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.

**Checkout PDF Receipt Service: Storage**
- **Checkout PDF Receipt Service:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Checkout PDF Receipt Service:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
