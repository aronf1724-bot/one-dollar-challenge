# $1 Challenge — real-time PayPal counter

## What is included
- Public page with total collected and contributor count.
- $1 PayPal.Me button using `paypal.me/Aron1724/1`.
- Node/Express backend with SQLite storage.
- PayPal webhook endpoint that accepts `PAYMENT.CAPTURE.COMPLETED` events.
- Frontend refreshes every 3 seconds; Socket.IO is also included for live updates.

## Important
The PayPal balance cannot safely be read directly from browser JavaScript. The reliable design is: PayPal payment -> PayPal webhook -> server verifies event -> server stores capture -> public page updates.

Before putting this online, you must:
1. Create/configure a PayPal REST app.
2. Create a webhook URL such as `https://your-domain.example/webhooks/paypal` and subscribe to `PAYMENT.CAPTURE.COMPLETED`.
3. Implement PayPal webhook signature verification in `server.js` using PayPal's verification endpoint.
4. Deploy the Node server over HTTPS.
5. Replace the demo PayPal link if your final payment page differs.

Run locally:
```bash
npm install
npm start
```
Then open `http://localhost:3000`.
