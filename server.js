import express from 'express';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'payments.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/*
  PayPal webhook:
  IMPORTANTISSIMO:
  il webhook usa express.raw() per conservare il body originale.
*/
app.post(
  '/webhooks/paypal',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const rawBody = req.body.toString('utf8');
      const event = JSON.parse(rawBody);

      const verified = await verifyPayPalWebhook(req.headers, event);

      if (!verified) {
        console.log('Invalid PayPal webhook signature');
        return res.sendStatus(400);
      }

      if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        await processCapture(event);
      }

      return res.sendStatus(200);
    } catch (error) {
      console.error('Webhook error:', error);
      return res.sendStatus(500);
    }
  }
);

// Tutte le altre richieste JSON
app.use(express.json());
app.use(express.static(__dirname));

async function readPayments() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function savePayments(payments) {
  await fs.writeFile(DATA_FILE, JSON.stringify(payments, null, 2));
}

async function stats() {
  const payments = await readPayments();

  const usdPayments = payments.filter(
    (p) => p.currency === 'USD'
  );

  const total = usdPayments.reduce(
    (sum, p) => sum + Number(p.amount),
    0
  );

  return {
    total,
    count: usdPayments.length
  };
}

app.get('/api/stats', async (req, res) => {
  res.json(await stats());
});

async function getPayPalAccessToken() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(
    'https://api-m.sandbox.paypal.com/v1/oauth2/token',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    }
  );

  if (!response.ok) {
    throw new Error(
      `PayPal token error: ${response.status} ${await response.text()}`
    );
  }

  const data = await response.json();
  return data.access_token;
}

async function verifyPayPalWebhook(headers, event) {
  const requiredHeaders = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: event
  };

  if (
    !requiredHeaders.auth_algo ||
    !requiredHeaders.cert_url ||
    !requiredHeaders.transmission_id ||
    !requiredHeaders.transmission_sig ||
    !requiredHeaders.transmission_time ||
    !requiredHeaders.webhook_id
  ) {
    return false;
  }

  const accessToken = await getPayPalAccessToken();

  const response = await fetch(
    'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requiredHeaders)
    }
  );

  if (!response.ok) {
    console.error(
      'Webhook verification request failed:',
      response.status,
      await response.text()
    );
    return false;
  }

  const result = await response.json();

  return result.verification_status === 'SUCCESS';
}

async function processCapture(payload) {
  const id = payload?.resource?.id;
  const value = Number(payload?.resource?.amount?.value);
  const currency = payload?.resource?.amount?.currency_code;

  if (!id || !Number.isFinite(value) || value <= 0 || !currency) {
    return false;
  }

  const payments = await readPayments();

  // Evita di contare due volte lo stesso pagamento
  if (payments.some((p) => p.capture_id === id)) {
    return true;
  }

  payments.push({
    capture_id: id,
    amount: value,
    currency,
    created_at: new Date().toISOString()
  });

  await savePayments(payments);

  io.emit('stats:update', await stats());

  console.log(
    `Payment recorded: ${value} ${currency} (${id})`
  );

  return true;
}

io.on('connection', async (socket) => {
  socket.emit('stats:update', await stats());
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Running on port ${PORT}`);
});
