const WebSocket = require('ws');
const logger = require('./logger');
const readline = require('readline');
const RelayManager = require('./managers/RelayManager');
const OSCManager = require('./managers/OSCManager');
const OSCQueryManager = require('./managers/OSCQueryManager');

class OSCRelay {
    constructor(config = {}) {
        this.config = config;
        this.relayManager = new RelayManager(config);
        this.oscManager = new OSCManager(config);
        this.oscQueryManager = new OSCQueryManager(config);
        
        this.setupManagers();
        this.setupKeyboardControls();
    }

    async setupManagers() {
        await this.oscManager.createReceiver(this.config.client.port);
        this.relayManager.startServer();

        this.oscManager.onMessage((msg) => {
            this.relayManager.broadcast({
                type: 'osc_tunnel',
                ...msg
            });
        });

        this.relayManager.messageHandlers.add((clientId, message) => {
            if (message.type === 'osc_tunnel') {
                this.oscManager.send(this.config.client.port, message.address, ...message.args);
            }
        });
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

        this.relayManager.broadcast(testMessage);
        console.log('[Server] Sent test message to all clients');
    }
}

// Only run if this is the main module
if (require.main === module) {
    const config = {
        server: {
            port: 4953,
            host: '57.128.188.155',
            allowLocalMessages: true
        },
        client: {
            port: 9001,
            host: '127.0.0.1'
        },
        osc: {
            local: {
                sendPort: 9000,
                receivePort: 9001,
                queryPort: 9012,
                ip: '127.0.0.1'
            }
        }
    };

    const relay = new OSCRelay(config);
    logger.log(`Relay system started`, 'START');
}

module.exports = OSCRelay;
