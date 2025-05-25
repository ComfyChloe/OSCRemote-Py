const logger = require('./logger');
const readline = require('readline');
const WebSocketManager = require('./managers/WebSocketManager');
const OSCManager = require('./managers/OSCManager');
const OSCQueryManager = require('./managers/OSCQueryManager');
const yaml = require('yaml');
const fs = require('fs');

class OSCRelay {
    constructor() {
        this.loadConfig();
        this.initializeManagers();
        this.setupKeyboardControls();
    }

    loadConfig() {
        try {
            const file = fs.readFileSync('./Server-Config.yml', 'utf8');
            this.config = yaml.parse(file);
            logger.setLogPath(this.config.logging?.path || 'logs/server');
            logger.log('Loaded server configuration', 'CONFIG');
        } catch (err) {
            console.error('Failed to load Server-Config.yml:', err);
            process.exit(1);
        }
    }

    initializeManagers() {
        this.wsManager = new WebSocketManager(this.config);
        this.oscManager = new OSCManager(this.config);
        this.oscQueryManager = new OSCQueryManager(this.config);
        this.setupManagers();
    }

    async setupManagers() {
        await this.oscManager.createReceiver(this.config.client.port);
        this.wsManager.startServer();

        this.oscManager.onMessage((msg) => {
            if (this.ProcessMessage(msg) && !msg.relayed) {
                const relayMessage = {
                    type: 'osc_tunnel',
                    ...msg,
                    userId: 'SERVER',
                    relayed: true
                };
                console.log(`[Server] Relaying OSC to clients: ${msg.address}`);
                this.wsManager.broadcast(relayMessage);
            }
        });

        this.wsManager.onMessage((clientId, message) => {
            if (message.type === 'osc_tunnel' && this.ProcessMessage(message) && !message.relayed) {
                const clientInfo = this.wsManager.clientInfo.get(clientId);
                console.log(`[Server] Relaying OSC from ${clientInfo?.userId || clientId}: ${message.address}`);
                this.oscManager.send(this.config.client.port, message.address, ...message.args);
            }
        });
    }

    ProcessMessage(message) {
        if (!message || !message.address) return false;

        const blacklist = this.config.filters?.blacklist?.transmission || [];
        if (blacklist.length > 0) {
            for (const pattern of blacklist) {
                try {
                    if (new RegExp(pattern.replace('*', '.*')).test(message.address)) {
                        return false; // Silently filter blacklisted messages
                    }
                } catch (err) {
                    console.warn(`[Server] Invalid blacklist pattern: ${pattern}`);
                }
            }
        }
        return true;
    }

    setupKeyboardControls() {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);

        process.stdin.on('keypress', (str, key) => {
            if (key.ctrl && key.name === 'c') {
                process.exit();
            } else if (key.name === 'u') {
                this.sendTestToAllUsers();
            }
        });

        console.log('[Server] Keyboard controls enabled:');
        console.log('  Press "u" to send test message to all clients');
        console.log('  Press Ctrl+C to exit');
    }

    sendTestToAllUsers() {
        const testMessage = {
            type: 'osc_tunnel',
            address: '/test/server',
            args: [Math.random()],
            userId: 'SERVER',
            source: 'server'
        };

        console.log(`[Server] Broadcasting test message: ${testMessage.address} | [${testMessage.args.join(', ')}]`);
        this.wsManager.broadcast(testMessage);
    }
}

if (require.main === module) {
    const relay = new OSCRelay();
    logger.log('Relay system started', 'START');
}

module.exports = OSCRelay;
