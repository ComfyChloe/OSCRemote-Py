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
        await this.oscQueryManager.start();

        this.oscManager.onMessage((msg) => {
            if (this.ProcessMessage(msg)) {
                this.relayManager.broadcast({
                    type: 'osc_tunnel',
                    userId: this.userId,
                    ...msg
                });
            }
        });

        this.relayManager.messageHandlers.add((message) => {
            if (message.type === 'osc_tunnel' && this.ProcessMessage(message)) {
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

    ProcessMessage(message) {
        if (this.config.filters.blacklist.length > 0) {
            for (const pattern of this.config.filters.blacklist) {
                try {
                    if (message.address.match(new RegExp(pattern))) {
                        return false;
                    }
                } catch (err) {
                    console.warn(`[Client] Invalid blacklist pattern: ${pattern}`);
                }
            }
        }
        
        // Custom filters
        if (!this.filters || this.filters.size === 0) return true;
        return Array.from(this.filters).some(pattern => 
            message.address.match(new RegExp(pattern)));
    }

    setupKeyboardControls() {
        const readline = require('readline');
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);

        process.stdin.on('keypress', (str, key) => {
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
        });
        console.log('[Client] Keyboard controls enabled:');
        console.log('  Press "t" to send a random float test message');
        console.log('  Press "r" to send a random integer test message');
        console.log('  Press Ctrl+C to exit');
    }
}

if (require.main === module) {
    const client = new OSCRelayClient();
    client.relayManager.connect().then(() => {
        console.log('[Client] Successfully connected to relay server');
        client.relayManager.subscribeToOSC(); 
    }).catch(err => {
        console.error('[Client] Failed to connect:', err);
        process.exit(1);
    });
}

module.exports = OSCRelayClient;
