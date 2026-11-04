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

// Функция форматирования времени в Тбилиси (UTC+4)
function getTbilisiTime(isoString) {
    const date = isoString ? new Date(isoString) : new Date();
    return date.toLocaleString('ru-RU', {
        timeZone: 'Asia/Tbilisi',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
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
        console.log(`[WEBHOOK] ${event.event_type}`, payload);

        // 1. Звонок инициирован
        if (event.event_type === 'call.initiated') {
            history.unshift({
                time: getTbilisiTime(payload.start_time),
                direction: payload.direction || 'outgoing', // 'incoming' или 'outgoing'
                from: payload.from,
                to: payload.to,
                status: 'Инициирован',
                startTime: payload.start_time,
                duration: null,
                recording: null
            });
            saveHistory();
        }

        // 2. Звонок отвечен — запускаем запись
        if (event.event_type === 'call.answered') {
            if (history[0]) {
                history[0].status = 'Отвечен';
                history[0].answeredAt = getTbilisiTime(payload.answered_time);
                saveHistory();
            }
            if (callControlId) {
                try {
                    console.log(`[RECORDING] Запуск для ${callControlId}`);
                    await telnyx.calls.actions.startRecording(callControlId, { channels: 'single', format: 'mp3' });
                    console.log(`[RECORDING] Успешно запущено для ${callControlId}`);
                } catch (recError) {
                    console.error('[RECORDING] Ошибка запуска:', recError.message);
                }
            }
        }

        // 3. Звонок завершен — сохраняем длительность
        if (event.event_type === 'call.hangup') {
            if (history[0]) {
                history[0].status = 'Завершен';
                history[0].endTime = getTbilisiTime(payload.end_time);
                if (payload.start_time && payload.end_time) {
                    const start = new Date(payload.start_time).getTime();
                    const end = new Date(payload.end_time).getTime();
                    history[0].duration = Math.round((end - start) / 1000);
                }
                saveHistory();
            }
        }

        // 4. Запись сохранена — добавляем ссылку
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
        console.error('[WEBHOOK] Ошибка:', e);
        res.sendStatus(500);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Сервер запущен на порту ${PORT}`); });
