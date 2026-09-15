import express from "express";
import http from "http";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static("."));

let payments = [];

function getStats() {
  const usd = payments.filter((p) => p.currency === "USD");
  return {
    total: usd.reduce((sum, p) => sum + p.amount, 0),
    count: usd.length
  };
}

app.get("/api/stats", (req, res) => {
  res.json(getStats());
});

function paypalBaseUrl() {
  return process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getAccessToken() {
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("Missing PayPal credentials.");
  }

  const auth = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!response.ok) {
    throw new Error(
      `PayPal OAuth error ${response.status}: ${await response.text()}`
    );
  }

  return (await response.json()).access_token;
}

app.get("/api/paypal-client-id", (req, res) => {
  const clientId = process.env.PAYPAL_CLIENT_ID;

  if (!clientId) {
    return res
      .status(500)
      .json({ error: "PayPal Client ID is not configured." });
  }

  res.json({ clientId });
});

app.post("/api/orders", async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${paypalBaseUrl()}/v2/checkout/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              amount: {
                currency_code: "USD",
                value: "1.00"
              }
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json({ id: data.id });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ error: "Could not create PayPal order." });
  }
});

app.post("/api/orders/:orderId/capture", async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(req.params.orderId)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    if (data.status === "COMPLETED") {
      const capture =
        data.purchase_units?.[0]?.payments?.captures?.[0];

      const captureId = capture?.id;
      const amount = Number(capture?.amount?.value);
      const currency = capture?.amount?.currency_code;

      if (
        captureId &&
        Number.isFinite(amount) &&
        amount > 0 &&
        currency === "USD" &&
        !payments.some((p) => p.captureId === captureId)
      ) {
        payments.push({
          captureId,
          amount,
          currency,
          createdAt: new Date().toISOString()
        });
      }
    }

    res.json(data);
  } catch (error) {
    console.error("Capture order error:", error);
    res.status(500).json({ error: "Could not capture PayPal order." });
  }
});

app.post(
  "/webhooks/paypal",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const event = JSON.parse(req.body.toString("utf8"));
      console.log("PayPal webhook received:", event.event_type);
      res.sendStatus(200);
    } catch (error) {
      console.error("Webhook error:", error);
      res.sendStatus(400);
    }
  }
);

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Running on port ${PORT}`);
});
