'use strict';

// Prefer IPv4 for outbound connections (MongoDB Atlas / Discord REST) to
// avoid IPv6 resolution stalls on networks with broken IPv6 routing.
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

// okay so this not is for anybody read this.code is messed up,my cline token ended also i'm
// tired of coding this shit.can do anything with it.

require('dotenv').config();

const mongoose = require('mongoose');

// Surface MongoDB connection lifecycle events for easier diagnosis.
mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err);
});
mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB disconnected');
});

const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, REST, Routes, MessageFlags } = require('discord.js');
const userdata = require('../games/userdata'); // Mongoose profile / progress store
const Guild = require('../models/Guild'); // Server config (role shop + allowed channels)

// --- Configuration (check here if you gonna beat my code's ass up)

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional: for fast guild-scoped registration

/**
 * Detects the obvious "I haven't filled this in yet" placeholder values.
 * @param {string|undefined} value
 * @returns {boolean}
 */
function isPlaceholder(value) {
    if (!value) return false;
    const v = String(value).trim().toLowerCase();
    return (
        v === 'your_bot_token_here' ||
        v === 'your_application_id_here' ||
        v === 'your_server_id_here' ||
        v === 'changeme' ||
        v === 'xxx' ||
        v === 'insert_here'
    );
}

const missing = [];
if (!TOKEN) missing.push('DISCORD_TOKEN');
if (!CLIENT_ID) missing.push('CLIENT_ID');
if (missing.length > 0) {
    console.error('❌ Missing configuration in .env: ' + missing.join(', '));
    console.error('');
    console.error('   Create your bot at: https://discord.com/developers/applications');
    console.error('   1. New Application → give it a name → Create');
    console.error('   2. "Bot" tab → Reset Token → copy it into DISCORD_TOKEN in .env');
    console.error('   3. "General Information" tab → copy the Application ID into CLIENT_ID.');
    console.error('   Then run: npm start');
    process.exit(1);
}
if (isPlaceholder(TOKEN) || isPlaceholder(CLIENT_ID)) {
    console.error('❌ .env still contains placeholder values. Fill them in with your real bot credentials:');
    console.error('');
    console.error('   DISCORD_TOKEN = your real token from https://discord.com/developers/applications');
    console.error('                   → your app → "Bot" tab → "Reset Token"');
    console.error('   CLIENT_ID    = your real Application ID (General Information tab)');
    console.error('');
    console.error('   Then run: npm start');
    process.exit(1);
}

// --- Command loading hello world---------------------------------------------------------

/**
 * Dynamically loads all command files from the src/commands/ directory.
 * Each command file must export { data, execute, registerButtonHandler? }.
 * @returns {Collection<string, Object>}
 */
function loadCommands() {
    const commands = new Collection();

    // Scan src/commands/ for top-level command files.
    const commandsDir = path.join(__dirname, 'commands');
    if (fs.existsSync(commandsDir)) {
        const topFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
        for (const file of topFiles) {
            const filePath = path.join(commandsDir, file);
            const command = require(filePath);
            if (command.data && command.execute) {
                commands.set(command.data.name, command);
                console.log(`✅ Loaded command: /${command.data.name}`);
            } else {
                console.warn(`⚠️  Skipping ${file}: missing data or execute export.`);
            }
        }
    }

    // Also scan src/commands/games/ for standalone game commands.
    const gamesPath = path.join(__dirname, 'commands', 'games');
    if (fs.existsSync(gamesPath)) {
        const gameFiles = fs.readdirSync(gamesPath).filter(file => file.endsWith('.js'));
        for (const file of gameFiles) {
            const filePath = path.join(gamesPath, file);
            const command = require(filePath);
            if (command.data && command.execute) {
                commands.set(command.data.name, command);
                console.log(`✅ Loaded command: /${command.data.name}`);
            } else {
                console.warn(`⚠️  Skipping ${file}: missing data or execute export.`);
            }
        }
    }

    return commands;
}

const commands = loadCommands();

// --- Bot client --------------------------------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = commands;

// Register button handlers from commands that support them.
for (const command of commands.values()) {
    if (typeof command.registerButtonHandler === 'function') {
        command.registerButtonHandler(client);
    }
}

// Register standalone game button handlers.
try {
    require('./events/minesweeperButtons')(client);
    console.log('🎮 Registered Minesweeper button handler.');
} catch (_) {
    // src/events/minesweeperButtons.js may not exist yet — non-fatal.
}

// --- Event handlers ----------------------------------------------------------

client.once('ready', () => {
    console.log(`🎮 Logged in as ${client.user.tag}!`);
    console.log(`📋 Loaded ${commands.size} command(s).`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        // ── Channel restriction guard ──────────────────────────────────────
        // The `/settings` command is always allowed so admins can configure
        // restrictions from any channel. Every other command is blocked here
        // if the guild has a non-empty `allowedChannels` list and the current
        // channel isn't in it.
        if (interaction.commandName !== 'settings' && interaction.guild) {
            const guildData = await Guild.findOne({ guildId: interaction.guild.id });
            console.log('Allowed Channels in DB:', guildData && guildData.allowedChannels);

            if (guildData &&
                guildData.allowedChannels &&
                guildData.allowedChannels.length > 0 &&
                !guildData.allowedChannels.includes(interaction.channelId)) {
                const channelsList = guildData.allowedChannels.map((id) => '<#' + id + '>').join(', ');
                return interaction.reply({
                    content: '❌ Commands can only be used in: ' + channelsList,
                    ephemeral: true
                });
            }
        }

        await command.execute(interaction);

        // Track usage/progress in the JSON userdata store (best-effort).
        try {
            await userdata.recordUsage(interaction.user.id, interaction.commandName);
        } catch (_) { /* stats must never break the reply */ }
    } catch (error) {
        // 40060 = Interaction has already been acknowledged (double defer/reply).
        // 10062 = Unknown interaction (timed out). Both are non-fatal.
        const code = error && error.code;
        if (code === 40060 || code === 10062) {
            console.warn(`⚠️ Interaction already closed for /${interaction.commandName} (code ${code}) — ignored.`);
            return;
        }

        const errorMessage = 'There was an error while executing that command!';

        // Transient connection-level failures (ECONNRESET / ETIMEDOUT and friends)
        // are normal during temporary Discord REST API hiccups — log them without
        // treating them as a command bug, and never let them crash the process.
        if (isNetworkError(error)) {
            const netCode = error.code || error.errno || '?';
            console.warn(`⚠️ Transient network error while executing /${interaction.commandName} (${netCode}): ${error.message}`);
        } else {
            console.error(`❌ Error executing /${interaction.commandName}:`, error);
        }

        // Never let a failure to respond crash the process. The interaction
        // may already be deferred/replied (in which case we edit the reply so
        // it never hangs), or it may have expired (10062), in which case we log.
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errorMessage });
            } else {
                await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
            }
        } catch (respondError) {
            // Interaction already timed out (10062), already acknowledged (40060),
            // or is otherwise closed. Swallow so it never becomes an unhandled rejection.
            console.error('❌ Failed to send error response:', respondError.message);
        }
    }
});

/**
 * Identifies transient connection- / network-level failures (as opposed to
 * application command bugs). These can be emitted by the Discord REST client on
 * temporary drops and should be handled gracefully rather than crashing the bot.
 * @param {*} error
 * @returns {boolean}
 */
function isNetworkError(error) {
    if (!error) return false;
    const codes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN', 'ECONNABORTED'];
    const code = error.code || (error.error && error.error.code) || error.errno;
    return codes.includes(code);
}

// --- Process-level guards for transient network failures ----------------------
// Even with per-interaction try/catch, the underlying HTTP/ws layer can surface
// an ECONNRESET/ETIMEDOUT as an unhandled rejection or 'error'. Log instead of
// crashing so a temporary Discord REST API drop can't take the bot offline.

process.on('unhandledRejection', reason => {
    if (isNetworkError(reason)) {
        console.warn('⚠️ Ignored unhandled rejection (transient network error):', (reason && reason.message) || reason);
        return;
    }
    console.error('❌ Unhandled promise rejection:', reason);
});

process.on('uncaughtException', error => {
    if (isNetworkError(error)) {
        console.warn('⚠️ Uncaught exception (transient network error):', error.message);
        return;
    }
    console.error('❌ Uncaught exception:', error && error.stack ? error.stack : error);
});

// --- Command (re)registration ------------------------------------------------

/**
 * Registers slash commands with Discord.
 * Uses guild-scoped registration if GUILD_ID is set (fast, for testing),
 * otherwise falls back to global registration (slower, up to 1 hour to propagate).
 */
async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const commandData = commands.map(cmd => cmd.data.toJSON());

    try {
        if (GUILD_ID) {
            console.log(`🔄 Refreshing ${commandData.length} guild command(s) for guild ${GUILD_ID}...`);
            await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commandData });
            console.log('✅ Successfully reloaded guild commands.');
        } else {
            console.log(`🔄 Refreshing ${commandData.length} global command(s)...`);
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commandData });
            console.log('✅ Successfully reloaded global commands.');
        }
    } catch (error) {
        const status = error && error.status;
        const message = error && (error.message || error.rawError?.message);

        if (status === 401) {
            console.error('❌ Discord rejected your credentials (401 Unauthorized).');
            console.error('   Check DISCORD_TOKEN / CLIENT_ID in .env.');
            console.error('   ➜ Regenerate the token: https://discord.com/developers/applications → your app → Bot → Reset Token');
        } else {
            console.error('❌ Failed to register commands:', message || error);
        }
    }
}

// --- Start the bot -----------------------------------------------------------

(async () => {
    // Connect to MongoDB Atlas before anything else.
    try {
        await mongoose.connect(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 5000 });
        console.log('✅ Connected to MongoDB Atlas');
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB:', error.message);
        process.exit(1);
    }

    // Mongoose-backed stores are ready once the connection is open.
    try {
        const balanceManager = require('../games/balance');
        const blackjackStore = require('../games/blackjackstore');
        await Promise.all([balanceManager.ready, blackjackStore.ready, userdata.ready]);
    } catch (error) {
        console.error('Failed to initialize data stores:', error);
        process.exit(1);
    }

    await registerCommands();

    try {
        await client.login(TOKEN);
    } catch (error) {
        const code = error && (error.code || error.rawError?.code);

        if (code === 'TokenInvalid') {
            console.error('❌ Invalid Discord bot token. The bot cannot connect.');
            console.error('   ➜ Regenerate a fresh token: https://discord.com/developers/applications');
            console.error('     → your app → "Bot" tab → "Reset Token", then paste it into DISCORD_TOKEN in .env');
        } else if (error && error.status === 401) {
            console.error('❌ Discord rejected the token (401 Unauthorized). Check DISCORD_TOKEN in .env.');
        } else {
            console.error('❌ Failed to log in:', error.message || error);
        }
        process.exit(1);
    }
})();


const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;

// Absolute path to the `docs` folder (project root/docs), independent of cwd.
const docsDir = path.join(__dirname, '..', 'docs');

// --- Discord OAuth2 (Passport) -------------------------------------------
const SESSION_SECRET = process.env.SESSION_SECRET || 'jusgamble-dev-secret-change-me';
if (!process.env.SESSION_SECRET) {
    console.warn('⚠️ SESSION_SECRET is not set — using an insecure dev fallback.');
}

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

// Store a compact session object (never the whole profile).
passport.serializeUser((user, done) => {
    done(null, { id: user.id, username: user.username, avatar: user.avatar });
});
passport.deserializeUser((obj, done) => {
    done(null, obj);
});

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const oauthEnabled = Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI);

if (oauthEnabled) {
    passport.use(new DiscordStrategy({
        clientID: DISCORD_CLIENT_ID,
        clientSecret: DISCORD_CLIENT_SECRET,
        callbackURL: DISCORD_REDIRECT_URI,
        scope: ['identify']
    }, (accessToken, refreshToken, profile, done) => {
        done(null, {
            id: profile.id,
            username: profile.username,
            avatar: profile.avatar
        });
    }));
    console.log('🔐 Discord OAuth2 enabled (client ' + DISCORD_CLIENT_ID + ').');
} else {
    console.warn('⚠️ Discord OAuth2 disabled — set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and DISCORD_REDIRECT_URI in .env.');
}

// --- Authentication routes -------------------------------------------------
app.get('/auth/discord', (req, res, next) => {
    if (!oauthEnabled) {
        return res.status(503).send('Discord OAuth2 is not configured on this server.');
    }
    passport.authenticate('discord', { scope: ['identify'] })(req, res, next);
});

app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) { console.warn('⚠️ logout error:', err.message || err); }
        req.session.destroy(() => {
            res.redirect('/');
        });
    });
});

app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) {
        return res.json({ loggedIn: true, user: req.user });
    }
    return res.json({ loggedIn: false });
});

// --- Static docs + friendly routes ----------------------------------------
app.get('/', (req, res) => res.sendFile(path.join(docsDir, 'index.html')));
app.get(['/terms', '/tos'], (req, res) => res.sendFile(path.join(docsDir, 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(docsDir, 'privacy.html')));

app.use(express.static(docsDir));

app.listen(PORT, () => {
    console.log(`🌐 Web sunucusu ${PORT} portunda başlatıldı.`);
});