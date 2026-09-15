import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = await open({filename:'challenge.db',driver:sqlite3.Database});
await db.exec(`CREATE TABLE IF NOT EXISTS payments (capture_id TEXT PRIMARY KEY, amount REAL NOT NULL, currency TEXT NOT NULL, created_at TEXT NOT NULL)`);

app.use(express.json({type:'application/json'}));
app.use(express.static('.'));

async function stats(){
  const row = await db.get("SELECT COALESCE(SUM(amount),0) total, COUNT(*) count FROM payments WHERE currency='USD'");
  return {total:Number(row.total||0),count:Number(row.count||0)};
}
app.get('/api/stats', async (req,res)=>res.json(await stats()));

// PayPal should POST verified webhook events here.
// IMPORTANT: In production, verify the PayPal webhook signature before calling processCapture().
async function processCapture(payload){
  const id = payload?.resource?.id;
  const value = Number(payload?.resource?.amount?.value);
  const currency = payload?.resource?.amount?.currency_code;
  if(!id || !Number.isFinite(value) || value<=0 || !currency) return false;
  try{
    await db.run('INSERT INTO payments(capture_id,amount,currency,created_at) VALUES(?,?,?,?)',id,value,currency,new Date().toISOString());
  }catch(e){ if(!String(e).includes('UNIQUE')) throw e; }
  io.emit('stats:update', await stats());
  return true;
}

app.post('/webhooks/paypal', async (req,res)=>{
  try{
    // TODO: verify with PayPal's verify-webhook-signature endpoint before processing.
    if(req.body?.event_type==='PAYMENT.CAPTURE.COMPLETED') await processCapture(req.body);
    res.sendStatus(200);
  }catch(e){console.error(e);res.sendStatus(500);}
});

io.on('connection', socket=> socket.emit('stats:update', stats()));

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Running on http://localhost:${PORT}`));
