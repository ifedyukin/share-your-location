const https = require('https');
const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');

const {
    OCG_TOKEN,
    DYNO = null,
    PORT = 8000,
    MONGODB_URI,
    WEBHOOK_URI,
    MONGODB_NAME,
    TELEGRAM_USER_ID,
    TELEGRAM_BOT_HOOK,
    TELEGRAM_BOT_TOKEN
} = process.env;

const getLocationData = async ({ latitude, longitude }) => {
    const res = await fetch(`https://api.opencagedata.com/geocode/v1/json?q=${latitude}+${longitude}&key=${OCG_TOKEN}`);
    const { results } = await res.json();
    const { city, town, country } = results[0].components;
    return { city: city || town || '', country };
};

const getLastDoc = async (collection) => {
    const [lastDoc = null] = await collection.find().sort({ date: -1 }).limit(1).toArray();
    return lastDoc;
};

const app = express();
app.use(bodyParser.json());
const botUrl = `/bot${TELEGRAM_BOT_TOKEN}`;
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { onlyFirstMatch: true, polling: !DYNO });
const mongoClient = new MongoClient(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

mongoClient.connect((err, client) => {
    if (err) return console.log(err);
    const db = client.db(MONGODB_NAME);
    const location = db.collection('location');

    bot.on('polling_error', err => console.log(err));

    bot.on('location', async (msg) => {
        const { chat: { id: uid } } = msg;
        if (`${uid}` !== TELEGRAM_USER_ID) return;
        const { city, country } = await getLocationData(msg.location);

        const lastLocation = await getLastDoc(location);
        if (lastLocation && lastLocation.city === city && lastLocation.country === country) {
            bot.sendMessage(uid, 'Your location wasn\'t changed');
            return;
        }

        try {
            await location.insertOne({ country, city, date: new Date() });
            bot.sendMessage(uid, `Location successfully updated - "${country}, ${city}"`);
            if (WEBHOOK_URI) {
                await fetch(WEBHOOK_URI, { method: 'POST' });
                bot.sendMessage(uid, 'Webhook successfully called');
            }
        } catch (err) {
            bot.sendMessage(uid, 'Hm... Something went wrong');
            console.log(err);
        }
    });

    bot.onText(/\/start/, (msg) => {
        const { chat: { id: uid } } = msg;
        if (`${uid}` !== TELEGRAM_USER_ID) return;
        bot.sendMessage(uid, 'Share your location, I\'m listening', {
            reply_markup: JSON.stringify({
                keyboard: [[{ text: '🗺 Share location', request_location: true }]],
                resize_keyboard: true,
                one_time_keyboard: false
            })
        });
    });

    app.post(botUrl, (req, res) => {
        if (req.body.message.chat.type === 'private') bot.processUpdate(req.body);
        res.sendStatus(200);
    });

    app.get('/location', async (req, res) => res.send(await getLastDoc(location)));

    app.listen(PORT, () => {
        console.log(`Express server is listening on ${PORT}`);
        if (DYNO) bot.setWebHook(`${TELEGRAM_BOT_HOOK}${botUrl}`);
    });

    process.on('exit', () => client.close());
});
