require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const expressEjsLayouts = require('express-ejs-layouts');

const botLogic = require('./bot_index');
const startCron = require('./helpers/cron');
const adminRoutes = require('./routes/admin');
const miniAppRoutes = require('./routes/miniapp');

const app = express();
const PORT = process.env.PORT || 8000;

// Database Connection
mongoose.connect(process.env.MONGO_URL)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// EJS Setup
app.use(expressEjsLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'public/views'));
app.set('layout', 'layout');

// Initialize Bots
const bot = require('./helpers/bot');
const chatBot = require('./helpers/chat_bot_instance');
const chatBotLogic = require('./chat_bot_index');

botLogic(bot);
chatBotLogic(chatBot);

// Bot Webhook / Long Polling
if (process.env.PROJECT_NODE_ENV === 'production') {
    app.post('/telegram-webhook', bot.webhookCallback('/telegram-webhook'));
    bot.telegram.setWebhook(`${process.env.GLOBAL_DOMAIN}/telegram-webhook`);
    
    app.post('/chat-bot-webhook', chatBot.webhookCallback('/chat-bot-webhook'));
    chatBot.telegram.setWebhook(`${process.env.GLOBAL_DOMAIN}/chat-bot-webhook`);
    
    console.log(`✅ Bots webhooks set.`);
} else {
    bot.launch();
    chatBot.launch();
    console.log('✅ Bots started in polling mode');
}

// Routes
app.use('/admin', adminRoutes);
app.use('/open-app', miniAppRoutes);

// Catch-all route for unmatched paths (including root)
app.use((req, res) => {
    res.send('✅ Bot is alive! but param not found');
});

// Cron Jobs
startCron();

// Error Handlers
process.on('uncaughtException', (err) => console.error('🔥 Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('⚠ Unhandled Rejection:', reason));

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});