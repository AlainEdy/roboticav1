const readline = require('readline');
const https = require('https');

const API_KEY = process.env.GEMINI_API_KEY;
const API_URL = 'generativelanguage.googleapis.com';
const MODEL = 'gemini-2.5-flash';
const MAX_RETRIES = 3;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const contents = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function callGemini(userMessage, attempt = 1) {
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
            const isRetryable = status === 429 || status === 502 || status === 503;
            if (isRetryable && attempt < MAX_RETRIES) {
              const delay = attempt * 2000;
              console.log(`\n[Reintentando en ${delay / 1000}s... intento ${attempt + 1}/${MAX_RETRIES}]`);
              await sleep(delay);
              contents.pop(); // quitar el user message que acabamos de agregar
              resolve(await callGemini(userMessage, attempt + 1));
              return;
            }
            reject(new Error(json.error.message));
            return;
          }
          const reply = json.candidates[0].content.parts[0].text;
          contents.push({ role: 'model', parts: [{ text: reply }] });
          resolve(reply);
        } catch (err) {
          const isHtml = body.startsWith('<!DOCTYPE');
          if (isHtml && attempt < MAX_RETRIES) {
            const delay = attempt * 2000;
            console.log(`\n[Error del servidor, reintentando en ${delay / 1000}s...]`);
            await sleep(delay);
            contents.pop();
            resolve(await callGemini(userMessage, attempt + 1));
            return;
          }
          reject(new Error('Error del servidor. Intenta de nuevo en unos segundos.'));
        }
      });
    });

    req.on('error', async (err) => {
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 2000;
        console.log(`\n[Error de red, reintentando en ${delay / 1000}s...]`);
        await sleep(delay);
        contents.pop();
        resolve(await callGemini(userMessage, attempt + 1));
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
      process.stdout.write('\nGemini: ');
      const reply = await callGemini(text);
      console.log(reply);
    } catch (err) {
      console.log('\nError:', err.message);
    }

    prompt();
  });
}

console.log('=== Chat con Gemini ===');
console.log('Escribe tu mensaje y presiona Enter.');
console.log('Escribe "salir" para terminar.\n');
prompt();
