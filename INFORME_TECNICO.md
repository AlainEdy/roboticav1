# Informe Técnico del Proyecto Chatbot WhatsApp con IA

## 1. Resumen ejecutivo

Este proyecto implementa un chatbot institucional conectado a WhatsApp, apoyado por un modelo de inteligencia artificial mediante la API de OpenRouter. El sistema está orientado a responder consultas relacionadas con la Municipalidad Provincial de Puno usando una base de conocimiento local almacenada en el archivo `banco_conocimiento.txt`.

Además del bot para WhatsApp, el proyecto incluye una modalidad de chat por consola y un panel web de monitoreo en tiempo real. Este panel permite observar el estado de conexión del bot, los chats recibidos, las respuestas generadas y los logs del sistema.

El proyecto está desarrollado en Node.js y utiliza librerías como `whatsapp-web.js`, `express`, `dotenv` y `qrcode-terminal`.

## 2. Objetivo general

Desarrollar un chatbot automatizado capaz de responder mensajes de usuarios mediante WhatsApp, utilizando inteligencia artificial y una base de conocimiento institucional para entregar respuestas breves, claras y contextualizadas.

## 3. Objetivos específicos

- Integrar WhatsApp Web con una aplicación Node.js.
- Usar OpenRouter como proveedor de acceso a un modelo de lenguaje.
- Cargar información institucional desde un archivo local.
- Mantener historial conversacional por usuario.
- Mostrar un dashboard web para supervisar conversaciones y eventos.
- Permitir una modalidad alternativa de chat por consola.
- Gestionar errores de red, errores del modelo y reintentos automáticos.

## 4. Tecnologías utilizadas

| Tecnología | Uso dentro del proyecto |
|---|---|
| Node.js | Entorno principal de ejecución del backend. |
| JavaScript | Lenguaje de programación usado en todos los módulos. |
| Express | Servidor web para mostrar el dashboard y exponer endpoints internos. |
| whatsapp-web.js | Integración con WhatsApp Web mediante sesión local. |
| qrcode-terminal | Generación de código QR en consola para autenticar WhatsApp. |
| dotenv | Carga de variables de entorno desde el archivo `.env`. |
| HTTPS nativo de Node.js | Envío de solicitudes a la API de OpenRouter. |
| Server-Sent Events | Comunicación en tiempo real entre backend y dashboard web. |
| HTML, CSS y JavaScript | Construcción del panel visual `dashboard.html`. |

## 5. Dependencias del proyecto

El archivo `package.json` define las siguientes dependencias principales:

| Dependencia | Versión configurada | Función |
|---|---:|---|
| `dotenv` | `^17.4.2` | Leer variables de entorno. |
| `express` | `^5.2.1` | Crear servidor HTTP y endpoints. |
| `open` | `^11.0.0` | Dependencia instalada, aunque el código actual usa `exec` para abrir el navegador. |
| `qrcode-terminal` | `^0.12.0` | Mostrar QR de autenticación en terminal. |
| `whatsapp-web.js` | `^1.34.7` | Conectar y controlar WhatsApp Web. |

## 6. Estructura general del proyecto

```text
chatbot-v2/
├── .env
├── .gitignore
├── README.md
├── banco_conocimiento.txt
├── chat.js
├── dashboard.html
├── package-lock.json
├── package.json
├── whatsapp.js
├── .wwebjs_auth/
├── .wwebjs_cache/
└── node_modules/
```

## 7. Descripción de archivos principales

### 7.1 `package.json`

Archivo de configuración del proyecto Node.js. Contiene el nombre del proyecto, versión, descripción, archivo principal, scripts y dependencias.

Actualmente define el script:

```json
"start": "node chat.js"
```

Esto significa que al ejecutar `npm start`, se inicia el chat por consola y no el bot de WhatsApp. Para ejecutar el bot de WhatsApp se debe usar directamente:

```bash
node whatsapp.js
```

### 7.2 `chat.js`

Este archivo implementa una versión del chatbot por consola. Su función principal es permitir una conversación directa desde la terminal usando el mismo modelo de IA y la misma base de conocimiento.

Características principales:

- Carga variables de entorno con `dotenv`.
- Lee el archivo `banco_conocimiento.txt`.
- Construye un prompt de sistema con información institucional.
- Envía mensajes a OpenRouter mediante HTTPS.
- Mantiene historial conversacional en un arreglo llamado `messages`.
- Permite salir escribiendo `salir` o `exit`.
- Aplica reintentos automáticos ante errores temporales.

Flujo básico:

1. El usuario escribe una pregunta en consola.
2. El mensaje se agrega al historial.
3. Se envía una solicitud POST a OpenRouter.
4. El modelo devuelve una respuesta.
5. La respuesta se muestra en terminal.
6. El ciclo continúa hasta que el usuario escribe `salir` o `exit`.

### 7.3 `whatsapp.js`

Es el archivo principal para la integración con WhatsApp. Combina tres responsabilidades importantes:

- Servidor web con Express.
- Dashboard en tiempo real.
- Cliente de WhatsApp conectado a IA.

Funciones principales:

- Inicia un servidor en el puerto definido por `PORT` o en `3000` por defecto.
- Sirve el archivo `dashboard.html` en la ruta `/`.
- Expone el estado del bot en `/api/state`.
- Envía eventos en tiempo real mediante `/events` usando Server-Sent Events.
- Crea un cliente de WhatsApp con `whatsapp-web.js`.
- Genera QR para autenticación.
- Recibe mensajes individuales de WhatsApp.
- Ignora mensajes enviados por el propio bot.
- Ignora grupos de WhatsApp.
- Permite modo restringido por números autorizados.
- Envía la consulta al modelo de IA.
- Responde automáticamente al usuario.
- Registra mensajes y logs en el dashboard.

### 7.4 `dashboard.html`

Archivo frontend del panel de monitoreo. Está construido con HTML, CSS y JavaScript puro.

Elementos principales del dashboard:

- Lista lateral de chats.
- Indicador de estado del bot.
- Panel central de conversación.
- Panel derecho de logs del sistema.
- Conexión en tiempo real mediante `EventSource`.

Estados visuales manejados:

| Estado | Significado |
|---|---|
| `connecting` | El bot está intentando conectar. |
| `qr` | Se generó un QR y espera ser escaneado. |
| `ready` | WhatsApp está conectado y listo. |
| `disconnected` | El cliente se desconectó. |
| `auth_failure` | Ocurrió un fallo de autenticación. |

### 7.5 `banco_conocimiento.txt`

Contiene la información usada por el chatbot como contexto institucional. Incluye datos de la Municipalidad Provincial de Puno, información sobre OTI, áreas municipales, documentos institucionales, necesidades frecuentes y posibles proyectos tecnológicos.

Este archivo es importante porque alimenta el prompt de sistema. El bot no consulta una base de datos externa; toma su contexto principal desde este archivo de texto.

### 7.6 `.env`

Archivo local de configuración sensible. No debe subirse al repositorio.

Debe contener como mínimo la clave de API:

```env
OPENROUTER_API_KEY=tu_clave_aqui
```

También puede definir configuraciones como:

```env
PORT=3000
WHATSAPP_MODE=restricted
WHATSAPP_ALLOWED_NUMBERS=51999999999,51888888888
```

### 7.7 `.gitignore`

Evita subir archivos sensibles o pesados al repositorio. Actualmente ignora:

```text
node_modules/
.env
.env.local
.env.*
```

Esto es correcto porque protege las variables de entorno y evita versionar dependencias instaladas.

## 8. Arquitectura del sistema

La arquitectura puede entenderse en cuatro capas principales:

### 8.1 Capa de entrada

Recibe mensajes desde dos posibles interfaces:

- Consola, mediante `chat.js`.
- WhatsApp, mediante `whatsapp.js`.

### 8.2 Capa de procesamiento

Construye el historial de conversación y prepara la solicitud para el modelo. El prompt de sistema se forma combinando instrucciones del asistente con el contenido de `banco_conocimiento.txt`.

### 8.3 Capa de inteligencia artificial

La aplicación llama a OpenRouter usando el modelo:

```text
moonshotai/kimi-k2.6:free
```

La solicitud se envía al endpoint:

```text
https://openrouter.ai/api/v1/chat/completions
```

### 8.4 Capa de salida

La respuesta del modelo se entrega al usuario:

- En consola, si se usa `chat.js`.
- Por WhatsApp, si se usa `whatsapp.js`.
- En el dashboard, como registro visual de conversación.

## 9. Flujo de funcionamiento por WhatsApp

1. Se ejecuta `node whatsapp.js`.
2. Express inicia el dashboard en `http://localhost:3000`.
3. Se crea el cliente de WhatsApp con `LocalAuth`.
4. Si no hay sesión activa, se genera un QR.
5. El usuario escanea el QR con WhatsApp.
6. El bot cambia su estado a `ready`.
7. Cuando llega un mensaje privado, el sistema valida si debe responder.
8. Si el modo es restringido, verifica que el número esté autorizado.
9. El mensaje se agrega al dashboard como mensaje de usuario.
10. Se recupera o crea el historial conversacional del remitente.
11. Se envía la consulta a OpenRouter.
12. El modelo genera una respuesta.
13. El bot responde por WhatsApp.
14. La respuesta se registra en el dashboard.
15. Los logs se emiten en tiempo real mediante Server-Sent Events.

## 10. Flujo de funcionamiento por consola

1. Se ejecuta `npm start` o `node chat.js`.
2. El sistema carga la clave de API y el banco de conocimiento.
3. Se muestra el mensaje inicial del chat.
4. El usuario escribe una consulta.
5. El sistema llama al modelo de IA.
6. La respuesta aparece en la consola.
7. El historial se mantiene mientras el proceso siga activo.
8. El usuario puede finalizar con `salir` o `exit`.

## 11. Endpoints del servidor web

El archivo `whatsapp.js` define los siguientes endpoints:

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Devuelve el dashboard web. |
| GET | `/api/state` | Devuelve el estado actual del bot, logs y chats. |
| GET | `/events` | Abre una conexión SSE para eventos en tiempo real. |

## 12. Estado interno del dashboard

El backend mantiene un objeto llamado `botState` con esta estructura conceptual:

```js
{
  status: 'connecting',
  qr: null,
  logs: [],
  chats: {}
}
```

Cada chat contiene:

- Número del usuario.
- Nombre del contacto, si está disponible.
- Lista de mensajes.
- Rol de cada mensaje: usuario o bot.
- Hora de cada mensaje.

El sistema limita:

- Logs a un máximo de 200 entradas.
- Mensajes por chat a un máximo de 100 entradas.

## 13. Manejo de historial conversacional

En `chat.js`, el historial se mantiene en un arreglo global llamado `messages`.

En `whatsapp.js`, el historial se mantiene por chat usando un `Map` llamado `kimiChats`.

Esto permite que cada usuario de WhatsApp tenga una conversación independiente. El historial de un usuario no se mezcla con el historial de otro.

## 14. Prompt de sistema

El prompt de sistema define la personalidad y alcance del asistente. Indica que debe actuar como un asistente amigable y útil para la Municipalidad Provincial de Puno.

También le indica que:

- Use la información institucional disponible.
- Responda de forma breve y clara.
- Diga que no tiene información si no sabe algo.

Este diseño reduce respuestas inventadas y concentra el comportamiento del bot en el contenido del banco de conocimiento.

## 15. Manejo de errores y reintentos

El proyecto incluye lógica de reintentos cuando ocurren errores temporales.

Casos considerados:

- Error 429: demasiadas solicitudes.
- Error 502: error de puerta de enlace.
- Error 503: servicio no disponible.
- Respuestas HTML inesperadas del proveedor.
- Errores de red.

El sistema intenta hasta `MAX_RETRIES`, configurado actualmente en `3`.

En WhatsApp, si no se puede generar una respuesta, el usuario recibe el mensaje:

```text
Ups, tuve un problema para responder. Intenta de nuevo en un momento.
```

## 16. Seguridad y privacidad

### 16.1 Clave de API

La clave `OPENROUTER_API_KEY` se obtiene desde variables de entorno. Esto es una práctica correcta porque evita escribir secretos directamente en el código.

### 16.2 Archivo `.env`

El archivo `.env` está incluido en `.gitignore`, por lo que no debería subirse al repositorio.

### 16.3 Sesión de WhatsApp

`whatsapp-web.js` usa autenticación local mediante `LocalAuth`. Esto genera archivos de sesión en carpetas como `.wwebjs_auth` y `.wwebjs_cache`.

Estas carpetas pueden contener información sensible de sesión y deben manejarse con cuidado.

### 16.4 Modo restringido

El sistema permite controlar quién puede usar el bot mediante estas variables:

```env
WHATSAPP_MODE=restricted
WHATSAPP_ALLOWED_NUMBERS=51999999999,51888888888
```

Si `WHATSAPP_MODE` no es `restricted`, el bot responde a todos los contactos privados que le escriban.

## 17. Instalación y ejecución

### 17.1 Instalar dependencias

```bash
npm install
```

### 17.2 Configurar variables de entorno

Crear o editar el archivo `.env`:

```env
OPENROUTER_API_KEY=tu_clave_de_openrouter
PORT=3000
```

### 17.3 Ejecutar chat por consola

```bash
npm start
```

O también:

```bash
node chat.js
```

### 17.4 Ejecutar bot de WhatsApp con dashboard

```bash
node whatsapp.js
```

Luego abrir:

```text
http://localhost:3000
```

Si no hay sesión activa, se debe escanear el QR desde WhatsApp.

## 18. Casos de uso

### 18.1 Atención informativa institucional

El bot puede responder preguntas sobre datos de la Municipalidad Provincial de Puno, como dirección, central telefónica, información de OTI y áreas municipales.

### 18.2 Apoyo a propuestas tecnológicas

El banco de conocimiento incluye información sobre áreas con necesidades tecnológicas, documentos importantes y fuentes de contratación pública.

### 18.3 Monitoreo de conversaciones

El dashboard permite ver mensajes recibidos, respuestas enviadas y logs operativos del bot.

### 18.4 Pruebas rápidas por consola

`chat.js` permite probar el comportamiento del modelo sin necesidad de conectar WhatsApp.

## 19. Fortalezas del proyecto

- Integra WhatsApp con inteligencia artificial.
- Tiene una base de conocimiento local editable.
- Incluye dashboard web en tiempo real.
- Maneja historiales separados por usuario.
- Tiene reintentos ante fallas temporales.
- Usa variables de entorno para proteger la API key.
- Ignora grupos para evitar respuestas no deseadas.
- Puede restringir el uso a números autorizados.

## 20. Limitaciones actuales

- El script `npm start` ejecuta `chat.js`, no el bot de WhatsApp.
- El dashboard muestra en el título `WhatsApp + Gemini`, aunque el modelo configurado es Kimi mediante OpenRouter.
- No existe persistencia permanente de conversaciones; los chats se pierden al reiniciar el proceso.
- No hay autenticación para acceder al dashboard web.
- No hay base de datos formal.
- La base de conocimiento es un archivo de texto plano.
- No se observa un sistema de pruebas automatizadas.
- No hay separación por carpetas como `src`, `services`, `routes` o `public`.
- La llamada a OpenRouter se hace con `https` nativo, lo que funciona, pero puede ser más verboso de mantener.

## 21. Recomendaciones de mejora

### 21.1 Mejorar scripts de ejecución

Agregar scripts separados en `package.json`:

```json
"scripts": {
  "start": "node chat.js",
  "whatsapp": "node whatsapp.js"
}
```

Así se podría ejecutar el bot con:

```bash
npm run whatsapp
```

### 21.2 Corregir el título del dashboard

El dashboard indica `WhatsApp + Gemini`, pero el código usa Kimi por OpenRouter. Se recomienda cambiarlo a:

```text
Dashboard Chatbot WhatsApp + Kimi
```

### 21.3 Agregar autenticación al dashboard

El panel muestra conversaciones y logs, por lo que debería protegerse con contraseña, token o al menos restringirse a red local.

### 21.4 Persistir conversaciones

Se recomienda guardar chats y logs en una base de datos o archivo estructurado para auditoría y análisis posterior.

Opciones posibles:

- SQLite.
- PostgreSQL.
- MongoDB.
- Archivos JSON rotativos.

### 21.5 Separar responsabilidades

Actualmente `whatsapp.js` concentra servidor, WhatsApp, IA y estado. Se recomienda separar en módulos:

```text
src/
├── config/
├── services/
├── routes/
├── whatsapp/
├── ai/
└── public/
```

### 21.6 Mejorar la base de conocimiento

El archivo `banco_conocimiento.txt` podría estructurarse mejor usando Markdown, JSON o una base vectorial para consultas más precisas.

### 21.7 Validar configuración al iniciar

Si falta `OPENROUTER_API_KEY`, el sistema debería mostrar un error claro antes de iniciar el bot.

### 21.8 Controlar tamaño del historial enviado al modelo

El historial crece durante la sesión. Aunque hay límites visuales para el dashboard, el historial enviado al modelo puede crecer y aumentar costos o provocar errores de contexto. Se recomienda resumir o limitar los últimos mensajes enviados.

## 22. Conclusión

El proyecto es una solución funcional de chatbot institucional con integración a WhatsApp, inteligencia artificial mediante OpenRouter y un dashboard web en tiempo real. Su diseño permite atender consultas de usuarios usando una base de conocimiento local, manteniendo conversaciones separadas por contacto y mostrando actividad operativa en una interfaz visual.

La implementación actual es adecuada como prototipo avanzado o primera versión funcional. Para un entorno de producción, se recomienda mejorar la seguridad del dashboard, persistir conversaciones, modularizar el código, agregar pruebas automatizadas y reforzar el manejo de configuración.

En conjunto, el sistema demuestra una integración práctica entre mensajería instantánea, modelos de lenguaje y monitoreo web, con potencial para convertirse en una herramienta de atención automatizada institucional más robusta.
