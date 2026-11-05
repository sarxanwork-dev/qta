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

function getTbilisiTime(isoString) {
    const date = isoString ? new Date(isoString) : new Date();
    return date.toLocaleString('ru-RU', {
        timeZone: 'Asia/Tbilisi',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

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
        if (!credentialId) return res.status(500).json({ error: 'ID Credential не задан!' });

        const response = await telnyx.telephonyCredentials.createToken(credentialId);
        const token = response?.data?.token || response?.token || response;
        if (!token || typeof token !== 'string') return res.status(500).json({ error: 'Telnyx не вернул токен.' });
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
        
        const payload = event.payload;
        const callControlId = payload.call_control_id;
        
        // Подробный лог для отладки
        console.log(`[WEBHOOK] Тип: ${event.event_type}`);
        console.log(`[WEBHOOK] Call Control ID: ${callControlId}`);
        console.log(`[WEBHOOK] Payload:`, JSON.stringify(payload, null, 2));

        if (event.event_type === 'call.initiated') {
            history.unshift({
                time: getTbilisiTime(payload.start_time),
                direction: payload.direction || 'outgoing',
                from: payload.from,
                to: payload.to,
                status: 'Инициирован',
                duration: null,
                recording: null
            });
            saveHistory();
            console.log('[HISTORY] Звонок добавлен в историю.');
        }

        if (event.event_type === 'call.answered') {
            if (history[0]) {
                history[0].status = 'Отвечен';
                saveHistory();
            }
            
            
        }

        if (event.event_type === 'call.hangup') {
            if (history[0]) {
                history[0].status = 'Завершен';
                if (payload.start_time && payload.end_time) {
                    const start = new Date(payload.start_time).getTime();
                    const end = new Date(payload.end_time).getTime();
                    history[0].duration = Math.round((end - start) / 1000);
                }
                saveHistory();
                console.log('[HISTORY] Звонок завершен, длительность обновлена.');
            }
        }

        if (event.event_type === 'call.recording.saved') {
            const recordingUrl = payload.public_recording_urls?.mp3 || payload.recording_urls?.mp3 || null;
            if (recordingUrl && history[0]) {
                console.log(`[RECORDING] Ссылка получена: ${recordingUrl}`);
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
