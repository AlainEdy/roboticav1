require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const https = require('https');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = 'generativelanguage.googleapis.com';
const MODEL = 'gemini-2.5-flash';
const MAX_RETRIES = 3;

const MODE = process.env.WHATSAPP_MODE || 'all';
const ALLOWED_NUMBERS = (process.env.WHATSAPP_ALLOWED_NUMBERS || '')
  .split(',')
  .map(n => n.trim())
  .filter(Boolean);

function isAllowed(sender) {
  if (MODE !== 'restricted') return true;
  const numberOnly = sender.split('@')[0];
  return ALLOWED_NUMBERS.includes(numberOnly);
}

// ============ ESTADO DEL DASHBOARD ============
const botState = {
  status: 'connecting',
  qr: null,
  logs: [],
  chats: {} // { chatId: { number, name, messages: [{role, text, time}] } }
};

function addLog(text) {
  const entry = { time: new Date().toLocaleTimeString(), text };
  botState.logs.push(entry);
  if (botState.logs.length > 200) botState.logs.shift();
  broadcast({ type: 'log', payload: entry });
}

function setStatus(status, extra = {}) {
  botState.status = status;
  Object.assign(botState, extra);
  broadcast({ type: 'status', payload: { status, ...extra } });
}

function addMessage(chatId, number, name, role, text) {
  if (!botState.chats[chatId]) {
    botState.chats[chatId] = { number, name, messages: [] };
  }
  const msg = { role, text, time: new Date().toLocaleTimeString() };
  botState.chats[chatId].messages.push(msg);
  if (botState.chats[chatId].messages.length > 100) botState.chats[chatId].messages.shift();
  broadcast({ type: 'message', payload: { chatId, number, name, msg } });
}

// ============ SSE (Server-Sent Events) ============
const sseClients = [];
function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res, i) => {
    try {
      res.write(payload);
    } catch (e) {
      sseClients.splice(i, 1);
    }
  });
}

// ============ EXPRESS SERVER ============
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/api/state', (req, res) => {
  res.json(botState);
});

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'init', payload: botState })}\n\n`);
  sseClients.push(res);
  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

const server = app.listen(PORT, () => {
  console.log(`Dashboard en http://localhost:${PORT}`);
  addLog(`Servidor web iniciado en puerto ${PORT}`);
  // Abre navegador automaticamente
  exec(`start http://localhost:${PORT}`);
});

// ============ WHATSAPP CLIENT ============
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

const geminiChats = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function callGemini(userMessage, contents, attempt = 1) {
  return new Promise((resolve, reject) => {
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    const data = JSON.stringify({
      systemInstruction: {
        role: 'user',
        parts: [{ text: 'Eres un asistente amigable y util. Responde de forma breve y clara.' }]
      },
      contents: contents
    });

    const options = {
      hostname: API_URL,
      path: `/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, async (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', async () => {
        try {
          const json = JSON.parse(body);
          if (json.error) {
            const status = json.error.code;
            addLog(`Gemini error [${status}]: ${json.error.message}`);
            const isRetryable = status === 429 || status === 502 || status === 503;
            if (isRetryable && attempt < MAX_RETRIES) {
              const delay = attempt * 2000;
              addLog(`Gemini reintentando (${attempt + 1}/${MAX_RETRIES})`);
              await sleep(delay);
              contents.pop();
              resolve(await callGemini(userMessage, contents, attempt + 1));
              return;
            }
            reject(new Error(json.error.message));
            return;
          }
          const reply = json.candidates[0].content.parts[0].text;
          contents.push({ role: 'model', parts: [{ text: reply }] });
          resolve(reply);
        } catch (err) {
          addLog(`Gemini respuesta no-JSON (${res.statusCode}): ${body.substring(0, 200)}`);
          const isHtml = body.startsWith('<!DOCTYPE');
          if (isHtml && attempt < MAX_RETRIES) {
            const delay = attempt * 2000;
            addLog(`Error servidor Gemini, reintentando (${attempt + 1}/${MAX_RETRIES})`);
            await sleep(delay);
            contents.pop();
            resolve(await callGemini(userMessage, contents, attempt + 1));
            return;
          }
          reject(new Error('Error del servidor. Intenta de nuevo en unos segundos.'));
        }
      });
    });

    req.on('error', async (err) => {
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 2000;
        addLog(`Error red Gemini, reintentando (${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        contents.pop();
        resolve(await callGemini(userMessage, contents, attempt + 1));
        return;
      }
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

client.on('qr', (qr) => {
  console.log('Escanea este QR con WhatsApp en tu celular:\n');
  qrcode.generate(qr, { small: true });
  setStatus('qr', { qr });
  addLog('QR generado. Esperando escaneo...');
});

client.on('ready', () => {
  console.log('Bot de WhatsApp conectado y listo!');
  setStatus('ready');
  addLog('WhatsApp conectado y listo');
});

client.on('authenticated', () => {
  addLog('Sesion autenticada');
});

client.on('auth_failure', (msg) => {
  addLog(`Fallo de autenticacion: ${msg}`);
  setStatus('auth_failure');
});

client.on('disconnected', (reason) => {
  addLog(`Desconectado: ${reason}`);
  setStatus('disconnected');
});

client.on('message_create', async (msg) => {
  if (msg.fromMe) return;
  if (msg.from.endsWith('@g.us')) return;
  if (!isAllowed(msg.from)) return;

  let contact;
  try {
    contact = await msg.getContact();
  } catch (e) {
    contact = null;
  }
  const number = msg.from.split('@')[0];
  const name = contact?.pushname || contact?.name || number;

  console.log(`[${msg.from}] ${msg.body}`);
  addLog(`Mensaje de ${name}: ${msg.body.substring(0, 60)}${msg.body.length > 60 ? '...' : ''}`);
  addMessage(msg.from, number, name, 'user', msg.body);

  if (!geminiChats.has(msg.from)) {
    geminiChats.set(msg.from, []);
  }
  const contents = geminiChats.get(msg.from);

  try {
    const reply = await callGemini(msg.body, contents);
    await client.sendMessage(msg.from, reply);
    addMessage(msg.from, number, name, 'bot', reply);
    addLog(`Respuesta enviada a ${name}`);
  } catch (err) {
    console.error(`[${msg.from}] Error:`, err.message);
    addLog(`Error respondiendo a ${name}: ${err.message}`);
    await client.sendMessage(msg.from, 'Ups, tuve un problema para responder. Intenta de nuevo en un momento.');
    addMessage(msg.from, number, name, 'bot', 'Ups, tuve un problema para responder. Intenta de nuevo en un momento.');
  }
});

client.initialize();
