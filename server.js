require('dotenv').config();
const express = require('express');
const Telnyx = require('telnyx');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const telnyx = new Telnyx(process.env.TELNYX_API_KEY);

const DB_FILE = 'db.json';
let history = [];
try { history = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { history = []; }
function saveHistory() { fs.writeFileSync(DB_FILE, JSON.stringify(history, null, 2)); }

app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    if (login === process.env.ADMIN_LOGIN && password === process.env.ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Неверные данные' });
    }
});

app.get('/api/numbers', (req, res) => {
    res.json([{ number: '+995500333310', label: 'Основной' }]);
});

app.get('/api/token', async (req, res) => {
    try {
        const credentialId = process.env.TELNYX_CREDENTIAL_ID;
        if (!credentialId) {
            return res.status(500).json({ error: 'ID Credential не задан в Render!' });
        }

        const response = await telnyx.telephonyCredentials.createToken(credentialId);
        const token = response?.data?.token || response?.token || response;

        if (!token || typeof token !== 'string') {
            console.error('Неизвестный ответ от Telnyx:', response);
            return res.status(500).json({ error: 'Telnyx не вернул токен. Проверьте Credential ID.' });
        }
        
        res.json({ token: token });
    } catch (error) {
        console.error('Ошибка получения токена:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/history', (req, res) => {
    res.json(history);
});

app.post('/api/webhooks/voice', async (req, res) => {
    try {
        const event = req.body.data;
        if (!event || !event.payload) return res.sendStatus(200);

        const callControlId = event.payload.call_control_id;
        console.log(`[WEBHOOK] Получено событие: ${event.event_type}`);

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
            
            if (callControlId) {
                try {
                    console.log(`[RECORDING] Попытка запуска записи для: ${callControlId}`);
                    await telnyx.calls.actions.startRecording(callControlId, {
                        channels: 'single',
                        format: 'mp3'
                    });
                    console.log(`[RECORDING] Успешно запущено для: ${callControlId}`);
                } catch (recError) {
                    console.error('[RECORDING] Ошибка запуска записи:', recError.message);
                }
            }
        }

        if (event.event_type === 'call.hangup' && history[0]) { 
            history[0].status = 'Завершен'; 
            saveHistory(); 
        }

        if (event.event_type === 'call.recording.saved' && history[0]) { 
            const recordingUrl = event.payload.public_recording_urls?.mp3 || event.payload.recording_urls?.mp3 || null;
            if (recordingUrl) {
                console.log(`[RECORDING] Получена ссылка на запись: ${recordingUrl}`);
                history[0].recording = recordingUrl; 
                saveHistory(); 
            }
        }

        res.sendStatus(200);
    } catch (e) { 
        console.error('[WEBHOOK] Критическая ошибка:', e);
        res.sendStatus(500); 
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Сервер запущен на порту ${PORT}`); });
