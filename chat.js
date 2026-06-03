require('dotenv').config();
const readline = require('readline');
const https = require('https');
const fs = require('fs');

const BANCO = fs.readFileSync('banco_conocimiento.txt', 'utf8');

const API_KEY = process.env.OPENROUTER_API_KEY;
const API_URL = 'openrouter.ai';
const MODEL = process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2.6:free';
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `Eres un asistente amigable y util que trabaja para la Municipalidad Provincial de Puno. Usa la siguiente informacion institucional para responder de forma breve y clara. Si no sabes algo, di que no tienes esa informacion.\n\n--- BANCO DE CONOCIMIENTO ---\n${BANCO}`;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Historial en formato OpenAI
const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function callKimi(userMessage, attempt = 1) {
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
            const isRetryable = status === 429 || status === 502 || status === 503;
            const errorMessage = json.error.message || JSON.stringify(json.error);
            if (isRetryable && attempt < MAX_RETRIES) {
              const delay = attempt * 2000;
              console.log(`\n[OpenRouter ${status}: ${errorMessage}]`);
              console.log(`[Reintentando en ${delay / 1000}s... intento ${attempt + 1}/${MAX_RETRIES}]`);
              await sleep(delay);
              messages.pop();
              resolve(await callKimi(userMessage, attempt + 1));
              return;
            }
            reject(new Error(`OpenRouter ${status}: ${errorMessage}`));
            return;
          }
          const reply = json.choices[0].message.content;
          messages.push({ role: 'assistant', content: reply });
          resolve(reply);
        } catch (err) {
          const isHtml = body.startsWith('<!DOCTYPE');
          if (isHtml && attempt < MAX_RETRIES) {
            const delay = attempt * 2000;
            console.log(`\n[OpenRouter devolvio HTML con status ${res.statusCode}]`);
            console.log(`[Reintentando en ${delay / 1000}s...]`);
            await sleep(delay);
            messages.pop();
            resolve(await callKimi(userMessage, attempt + 1));
            return;
          }
          reject(new Error(`Respuesta invalida de OpenRouter (${res.statusCode}): ${body.substring(0, 300)}`));
        }
      });
    });

    req.on('error', async (err) => {
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 2000;
        console.log(`\n[Error de red, reintentando en ${delay / 1000}s...]`);
        await sleep(delay);
        messages.pop();
        resolve(await callKimi(userMessage, attempt + 1));
        return;
      }
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

function prompt() {
  rl.question('\nTu: ', async (input) => {
    const text = input.trim();
    if (text.toLowerCase() === 'salir' || text.toLowerCase() === 'exit') {
      console.log('\nAdios!');
      rl.close();
      return;
    }

    try {
      process.stdout.write('\nKimi: ');
      const reply = await callKimi(text);
      console.log(reply);
    } catch (err) {
      console.log('\nError:', err.message);
    }

    prompt();
  });
}

console.log('=== Chat con Kimi (OpenRouter) ===');
console.log('Escribe tu mensaje y presiona Enter.');
console.log('Escribe "salir" para terminar.\n');
prompt();
