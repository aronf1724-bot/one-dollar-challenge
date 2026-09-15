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
    p => p.currency === 'USD'
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

async function processCapture(payload) {
  const id = payload?.resource?.id;
  const value = Number(payload?.resource?.amount?.value);
  const currency = payload?.resource?.amount?.currency_code;

  if (!id || !Number.isFinite(value) || value <= 0 || !currency) {
    return false;
  }

  const payments = await readPayments();

  if (payments.some(p => p.capture_id === id)) {
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

  return true;
}

app.post('/webhooks/paypal', async (req, res) => {
  try {
    /*
      IMPORTANTE:
      Prima di usare questo endpoint con denaro reale,
      bisogna verificare la firma del webhook PayPal.
    */

    if (req.body?.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      await processCapture(req.body);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});

io.on('connection', async socket => {
  socket.emit('stats:update', await stats());
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Running on port ${PORT}`);
});
