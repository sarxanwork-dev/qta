require('dotenv').config();
const express = require('express');
const Telnyx = require('telnyx');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const telnyx = new Telnyx(process.env.TELNYX_API_KEY);

// Простейшая база данных в файле (история звонков)
const DB_FILE = 'db.json';
let history = [];
try { history = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { history = []; }

function saveHistory() {
    fs.writeFileSync(DB_FILE, JSON.stringify(history, null, 2));
}

// 1. Вход
app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    if (login === process.env.ADMIN_LOGIN && password === process.env.ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Неверные данные' });
    }
});

// 2. Список номеров
app.get('/api/numbers', (req, res) => {
    res.json([
        { number: '+995500333310', label: 'Основной' }
    ]);
});

// 3. Совершение звонка
app.post('/api/call', async (req, res) => {
    try {
        const { to, from } = req.body;
        const response = await telnyx.calls.dial({
            connection_id: process.env.TELNYX_CONNECTION_ID,
            to: to,
            from: from,
        });
        res.json({ success: true, id: response.data.call_control_id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// 4. История звонков
app.get('/api/history', (req, res) => {
    res.json(history);
});

// 5. Webhook от Telnyx (Запись и события)
app.post('/api/webhooks/voice', (req, res) => {
    try {
        const event = req.body.data;
        console.log('Событие:', event.event_type);

        if (event.event_type === 'call.initiated') {
            history.unshift({
                time: new Date().toLocaleTimeString(),
                direction: event.payload.direction,
                from: event.payload.from,
                to: event.payload.to,
                status: 'Инициирован',
                recording: null
            });
            saveHistory();
        }

        if (event.event_type === 'call.answered') {
            if (history[0]) { history[0].status = 'Отвечен'; saveHistory(); }
        }

        if (event.event_type === 'call.hangup') {
            if (history[0]) { history[0].status = 'Завершен'; saveHistory(); }
        }

        if (event.event_type === 'call.recording.saved') {
            if (history[0]) {
                history[0].recording = event.payload.public_url;
                saveHistory();
            }
        }

        res.sendStatus(200);
    } catch (e) {
        console.error(e);
        res.sendStatus(500);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
