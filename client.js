const yaml = require('yaml');
const fs = require('fs');
const OSCManager = require('./managers/OSCManager');
const OSCQueryManager = require('./managers/OSCQueryManager');
const RelayManager = require('./managers/RelayManager');

class OSCRelayClient {
    constructor() {
        this.loadConfig();
        this.ensureUserId();
        
        this.oscManager = new OSCManager(this.config);
        this.oscQueryManager = new OSCQueryManager(this.config);
        this.relayManager = new RelayManager(this.config);

        this.setupManagers();
        this.setupKeyboardControls();
    }

    async setupManagers() {
        await this.oscManager.createReceiver(this.config.osc.local.receivePort);
        await this.oscManager.createSender(this.config.osc.local.sendPort);
        await this.oscQueryManager.start();
        this.oscManager.onMessage((msg) => {
            // Check both console and transmission blacklists
            const shouldLog = this.ProcessMessage(msg, 'console');
            const shouldTransmit = this.ProcessMessage(msg, 'transmission');
            
            // Only forward to relay if it passes transmission filter
            if (shouldTransmit && !msg.relayed) {
                this.relayManager.handleClientMessage({
                    type: 'osc_tunnel',
                    userId: this.userId,
                    relayed: true, // Mark as relayed to prevent loops
                    ...msg
                });
            }

            // Let the OSC manager know if it should log
            return shouldLog;
        });

        this.relayManager.messageHandlers.add((message) => {
            if (message.type === 'osc_tunnel' && !message.relayed) {
                console.log(`[Client] Received relay message from ${message.userId}: ${message.address}`);
                this.oscManager.send(
                    this.config.osc.local.sendPort,
                    message.address,
                    ...message.args
                );
            }
        });
    }

    loadConfig() {
        try {
            const file = fs.readFileSync('./config.yml', 'utf8');
            this.config = yaml.parse(file);
            console.log('[Client] Loaded configuration');
            
            this.config.relay = this.config.relay || {};
            this.config.relay.host = this.config.relay.host || '57.128.188.155';
            this.config.relay.port = this.config.relay.port || 4953;
            this.config.relay.maxRetries = this.config.relay.maxRetries || 5;

            this.config.osc = this.config.osc || {};
            this.config.osc.local = this.config.osc.local || {};
            this.config.osc.local.sendPort = this.config.osc.local.sendPort || 9000;
            this.config.osc.local.receivePort = this.config.osc.local.receivePort || 9001;
            this.config.osc.local.queryPort = this.config.osc.local.queryPort || 9012;
            this.config.osc.local.ip = this.config.osc.local.ip || '127.0.0.1';

            this.config.filters = this.config.filters || {};
            this.config.filters.blacklist = this.config.filters.blacklist || [];

        } catch (err) {
            console.warn('[Client] No config.yml found, using defaults');
            this.config = {
                relay: {
                    host: '57.128.188.155',
                    port: 4953,
                    maxRetries: 5
                },
                osc: {
                    local: {
                        sendPort: 9000,
                        receivePort: 9001,
                        queryPort: 9012,
                        ip: '127.0.0.1'
                    }
                },
                filters: {
                    blacklist: []
                }
            };
        }
    }

    ensureUserId() {
        if (!this.config.relay.user) {
            this.config.relay.user = { name: "", id: "" };
        }
        
        if (!this.config.relay.user.id) {
            const randomId = Math.random().toString(36).substring(2, 10);
            this.config.relay.user.id = randomId;
            this.saveConfig();
        }

        this.userId = this.config.relay.user.name || `default-${this.config.relay.user.id}`;
        console.log(`[Client] User ID: ${this.userId}`);
    }

    saveConfig() {
        try {
            fs.writeFileSync('./config.yml', yaml.stringify(this.config));
        } catch (err) {
            console.error('[Client] Failed to save config:', err);
        }
    }

    ProcessMessage(message, type = 'transmission') {
        if (!message || !message.address) return false;

        // Check both console and transmission blacklists if we're checking console
        if (type === 'console') {
            const consoleBlacklist = this.config.filters.blacklist.console || [];
            const transmissionBlacklist = this.config.filters.blacklist.transmission || [];
            
            // If message is in either blacklist, don't log it
            for (const pattern of [...consoleBlacklist, ...transmissionBlacklist]) {
                try {
                    if (new RegExp(pattern.replace('*', '.*')).test(message.address)) {
                        return false;
                    }
                } catch (err) {
                    console.warn(`[Client] Invalid blacklist pattern: ${pattern}`);
                }
            }
        } else {
            // Just check transmission blacklist for normal processing
            const blacklist = this.config.filters.blacklist[type] || [];
            for (const pattern of blacklist) {
                try {
                    if (new RegExp(pattern.replace('*', '.*')).test(message.address)) {
                        return false;
                    }
                } catch (err) {
                    console.warn(`[Client] Invalid blacklist pattern: ${pattern}`);
                }
            }
        }
        
        return true;
    }

    setupKeyboardControls() {
        const readline = require('readline');
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);

        process.stdin.on('keypress', (str, key) => {
            if (key.sequence === str) {
                if (key.ctrl && key.name === 'c') {
                    process.exit();
                } else if (key.name === 't') {
                    const testValue = Math.random();
                    console.log(`[Client] Sending test message: /avatar/change/${testValue}`);
                    this.oscManager.send(this.config.osc.local.sendPort, '/avatar/change', testValue);
                } else if (key.name === 'r') {
                    const testValue = Math.floor(Math.random() * 100);
                    console.log(`[Client] Sending test message: /avatar/change/${testValue}`);
                    this.oscManager.send(this.config.osc.local.sendPort, '/avatar/change', testValue);
                }
            }
        });
        console.log('[Client] Keyboard controls enabled:');
        console.log('  Press "t" to send a random float test message');
        console.log('  Press "r" to send a random integer test message');
        console.log('  Press Ctrl+C to exit');
    }
}

if (require.main === module) {
    const client = new OSCRelayClient();
    console.log('[Client] Starting connection process...');
    client.relayManager.connect().then(() => {
        console.log('[Client] Connection established, subscribing to OSC');
        client.relayManager.subscribeToOSC(); 
    }).catch(err => {
        console.error('[Client] Fatal connection error:', err.message);
        console.error('[Client] Shutting down...');
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('[Client] Unhandled Rejection at:', promise);
        console.error('[Client] Reason:', reason);
    });
}

module.exports = OSCRelayClient;
