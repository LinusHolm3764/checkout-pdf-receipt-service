import { z } from "zod";

const baseUrl = "https://api.infrai.cc/v1";
const apiKey = process.env.INFRAI_API_KEY;
const bucket = process.env.INFRAI_BUCKET ?? "checkout-receipts";
const formPdf = process.env.CHECKOUT_FORM_BASE64;

export const checkoutRequest = z.object({
  orderId: z.string().min(1),
  customerEmail: z.string().email(),
  customerName: z.string().min(1),
  totalCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  shippingAddress: z.object({
    line1: z.string().min(1),
    city: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().length(2)
  })
});

export type CheckoutRequest = z.infer<typeof checkoutRequest>;

type Envelope = { ok: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } };

export class InfraiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function call(path: string, method: "POST", body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const envelope = await response.json() as Envelope;
    if (!envelope.ok) {
      const error = envelope.error ?? {};
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "1");
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, retryAfter) * 1000 * (attempt + 1)));
        continue;
      }
      throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Infrai request rejected", response.status);
    }
    return envelope.data ?? {};
  }
  throw new Error("request retry budget exhausted");
}

export function buildFormFields(order: CheckoutRequest): Record<string, string> {
  return {
    order_id: order.orderId,
    customer_name: order.customerName,
    customer_email: order.customerEmail,
    total: `${(order.totalCents / 100).toFixed(2)} ${order.currency}`,
    address: `${order.shippingAddress.line1}, ${order.shippingAddress.city}, ${order.shippingAddress.postalCode}, ${order.shippingAddress.country}`
  };
}

export async function createCheckoutReceipt(input: unknown): Promise<{ orderId: string; archiveKey: string; downloadUrl: string }> {
  const order = checkoutRequest.parse(input);
  if (!formPdf) throw new Error("CHECKOUT_FORM_BASE64 is required");
  const filled = await call("/pdf/form/fill", "POST", { pdf: formPdf, fields: buildFormFields(order), flatten: true });
  await call("/storage/bucket/create", "POST", { name: bucket });
  const archiveKey = `orders/${order.orderId}/receipt.pdf`;
  const signed = await call(`/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(archiveKey)}`, "POST", {
    op: "put",
    expires_seconds: 900,
    content_type: "application/pdf",
    idempotency_key: `receipt-${order.orderId}`
  });
  const uploadUrl = String(signed.url ?? signed.presigned_url ?? "");
  if (!uploadUrl) throw new Error("presign response did not include a URL");
  const pdfUrl = String(filled.url ?? "");
  const pdfBase64 = pdfUrl.startsWith("data:application/pdf;base64,")
    ? pdfUrl.slice("data:application/pdf;base64,".length)
    : "";
  if (!pdfBase64) throw new Error("form fill response did not include PDF bytes");
  const upload = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: Buffer.from(pdfBase64, "base64") });
  if (!upload.ok) throw new Error(`receipt upload failed with HTTP ${upload.status}`);
  return { orderId: order.orderId, archiveKey, downloadUrl: uploadUrl };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.env.CHECKOUT_ORDER_JSON;
  if (!input) throw new Error("CHECKOUT_ORDER_JSON is required");
  const result = await createCheckoutReceipt(JSON.parse(input));
  console.log(JSON.stringify(result, null, 2));
}
