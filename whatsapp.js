require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const https = require('https');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { db } = require('./firebase-config');
const { collection, doc, setDoc, addDoc, getDocs, query, orderBy, limit, serverTimestamp } = require('firebase/firestore');

const BANCO = fs.readFileSync('banco_conocimiento.txt', 'utf8');

const API_KEY = process.env.OPENROUTER_API_KEY;
const API_URL = 'openrouter.ai';
const MODEL = process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2.6:free';
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `Eres un asistente amigable y util que trabaja para la Municipalidad Provincial de Puno. Usa la siguiente informacion institucional para responder de forma breve y clara. Si no sabes algo, di que no tienes esa informacion.\n\n--- BANCO DE CONOCIMIENTO ---\n${BANCO}`;

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
  chats: {}, // { chatId: { number, name, messages: [{role, text, time}] } }
  mesaPartes: []
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

function sanitizeId(value) {
  return value.replace(/[/.#[\]]/g, '_');
}

async function saveUser(chatId, number, name) {
  const userId = sanitizeId(chatId);
  await setDoc(doc(db, 'usuarios', userId), {
    chatId,
    number,
    name,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function saveMessage(chatId, number, name, role, text) {
  const userId = sanitizeId(chatId);
  await saveUser(chatId, number, name);
  await addDoc(collection(db, 'usuarios', userId, 'historial_conversacion'), {
    chatId,
    number,
    name,
    role,
    text,
    createdAt: serverTimestamp()
  });
}

function addMesaPartesEntry(entry) {
  botState.mesaPartes.unshift(entry);
  if (botState.mesaPartes.length > 100) botState.mesaPartes.pop();
  broadcast({ type: 'mesa_partes', payload: entry });
}

async function saveMesaPartes(entry) {
  const ref = await addDoc(collection(db, 'mesa_de_partes'), {
    ...entry,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const saved = { ...entry, id: ref.id };
  addMesaPartesEntry(saved);
  return saved;
}

async function loadMesaPartes() {
  const q = query(collection(db, 'mesa_de_partes'), orderBy('createdAt', 'desc'), limit(50));
  const snapshot = await getDocs(q);
  botState.mesaPartes = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

async function analyzeMesaPartes(userMessage, messages, number, name, chatId) {
  const recent = messages
    .filter(m => m.role !== 'system')
    .slice(-8)
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');
  const analysisMessages = [{
    role: 'system',
    content: 'Analiza si el usuario quiere presentar, registrar, ingresar o consultar el ingreso de un documento para mesa de partes municipal. Responde solo JSON valido con esta forma: {\"es_mesa_de_partes\":boolean,\"estado\":\"pendiente|completo|no_aplica\",\"tipo_documento\":\"\",\"asunto\":\"\",\"solicitante\":\"\",\"dni_ruc\":\"\",\"telefono\":\"\",\"correo\":\"\",\"direccion\":\"\",\"area_destino\":\"\",\"resumen\":\"\",\"datos_faltantes\":[],\"prioridad\":\"normal|alta\"}. Si no hay intencion de mesa de partes, usa es_mesa_de_partes false.'
  }];
  const analysis = await callKimi(`Conversacion reciente:\n${recent}\n\nUltimo mensaje: ${userMessage}`, analysisMessages);
  const data = extractJson(analysis);
  if (!data || !data.es_mesa_de_partes) return null;
  return {
    chatId,
    number,
    name,
    estado: data.estado || 'pendiente',
    tipoDocumento: data.tipo_documento || '',
    asunto: data.asunto || '',
    solicitante: data.solicitante || name,
    dniRuc: data.dni_ruc || '',
    telefono: data.telefono || number,
    correo: data.correo || '',
    direccion: data.direccion || '',
    areaDestino: data.area_destino || '',
    resumen: data.resumen || userMessage,
    datosFaltantes: Array.isArray(data.datos_faltantes) ? data.datos_faltantes : [],
    prioridad: data.prioridad || 'normal'
  };
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
  loadMesaPartes()
    .then(() => addLog(`Mesa de partes cargada desde Firebase: ${botState.mesaPartes.length} registros`))
    .catch(err => addLog(`Firebase mesa de partes: ${err.message}`));
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

// Guarda el historial de cada chat en formato OpenAI: [{ role, content }]
const kimiChats = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeSendMessage(chatId, text, name = chatId) {
  try {
    await client.sendMessage(chatId, text);
    return true;
  } catch (err) {
    console.error(`[${chatId}] Error enviando WhatsApp:`, err.message);
    addLog(`WhatsApp no pudo enviar a ${name}: ${err.message}`);
    return false;
  }
}

function callKimi(userMessage, messages, attempt = 1) {
  return new Promise((resolve, reject) => {
    messages.push({ role: 'user', content: userMessage });

    const data = JSON.stringify({
      model: MODEL,
      messages: messages
    });

    const options = {
      hostname: API_URL,
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'Chatbot MPP',
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
            const status = json.error.status || json.error.code || res.statusCode;
            addLog(`Kimi error [${status}]: ${json.error.message || JSON.stringify(json.error)}`);
            const isRetryable = status === 429 || status === 502 || status === 503;
            if (isRetryable && attempt < MAX_RETRIES) {
              const delay = attempt * 2000;
              addLog(`Kimi reintentando (${attempt + 1}/${MAX_RETRIES})`);
              await sleep(delay);
              messages.pop();
              resolve(await callKimi(userMessage, messages, attempt + 1));
              return;
            }
            reject(new Error(json.error.message || JSON.stringify(json.error)));
            return;
          }
          const reply = json.choices[0].message.content;
          messages.push({ role: 'assistant', content: reply });
          resolve(reply);
        } catch (err) {
          addLog(`Kimi respuesta no-JSON (${res.statusCode}): ${body.substring(0, 200)}`);
          const isHtml = body.startsWith('<!DOCTYPE');
          if (isHtml && attempt < MAX_RETRIES) {
            const delay = attempt * 2000;
            addLog(`Error servidor Kimi, reintentando (${attempt + 1}/${MAX_RETRIES})`);
            await sleep(delay);
            messages.pop();
            resolve(await callKimi(userMessage, messages, attempt + 1));
            return;
          }
          reject(new Error('Error del servidor. Intenta de nuevo en unos segundos.'));
        }
      });
    });

    req.on('error', async (err) => {
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 2000;
        addLog(`Error red Kimi, reintentando (${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        messages.pop();
        resolve(await callKimi(userMessage, messages, attempt + 1));
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
  if (msg.from === 'status@broadcast') return;
  if (msg.to === 'status@broadcast') return;
  if (msg.from.endsWith('@broadcast')) return;
  if (msg.from.endsWith('@g.us')) return;
  if (!isAllowed(msg.from)) return;
  if (msg.type !== 'chat') return;

  const userText = (msg.body || '').trim();
  if (!userText) return;

  let contact;
  try {
    contact = await msg.getContact();
  } catch (e) {
    contact = null;
  }
  const number = msg.from.split('@')[0];
  const name = contact?.pushname || contact?.name || number;

  console.log(`[${msg.from}] ${userText}`);
  addLog(`Mensaje de ${name}: ${userText.substring(0, 60)}${userText.length > 60 ? '...' : ''}`);
  addMessage(msg.from, number, name, 'user', userText);
  saveMessage(msg.from, number, name, 'user', userText).catch(err => addLog(`Firebase mensaje usuario: ${err.message}`));

  if (!kimiChats.has(msg.from)) {
    kimiChats.set(msg.from, [{ role: 'system', content: SYSTEM_PROMPT }]);
  }
  const messages = kimiChats.get(msg.from);

  try {
    const mesaPartes = await analyzeMesaPartes(userText, messages, number, name, msg.from);
    const reply = await callKimi(userText, messages);
    if (mesaPartes) {
      const savedMesaPartes = await saveMesaPartes(mesaPartes);
      addLog(`Mesa de partes registrada: ${savedMesaPartes.asunto || savedMesaPartes.tipoDocumento || savedMesaPartes.id}`);
    }
    const sent = await safeSendMessage(msg.from, reply, name);
    if (sent) {
      addMessage(msg.from, number, name, 'bot', reply);
      saveMessage(msg.from, number, name, 'bot', reply).catch(err => addLog(`Firebase respuesta bot: ${err.message}`));
      addLog(`Respuesta enviada a ${name}`);
    }
  } catch (err) {
    console.error(`[${msg.from}] Error:`, err.message);
    addLog(`Error respondiendo a ${name}: ${err.message}`);
    const fallback = 'Ups, tuve un problema para responder. Intenta de nuevo en un momento.';
    const sent = await safeSendMessage(msg.from, fallback, name);
    if (sent) {
      addMessage(msg.from, number, name, 'bot', fallback);
      saveMessage(msg.from, number, name, 'bot', fallback).catch(error => addLog(`Firebase error bot: ${error.message}`));
    }
  }
});

client.initialize();
