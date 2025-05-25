const yaml = require('yaml');
const fs = require('fs');
const logger = require('./managers/logger');
const OSCManager = require('./managers/OSCManager');
const RelayManager = require('./managers/RelayManager');
const { OSCQueryServer, OSCQAccess, OSCTypeSimple } = require('oscquery');

class OSCRelayClient {
    constructor() {
        this.loadConfig();
        this.ensureUserId();
        this.parameters = new Map();
        this.status = "waiting for input";
        this.oscQueryServer = null;
        this.oscManager = null;
        this.relayManager = null;
        this.setupOSCQueryServer();
    }

    loadConfig() {
        try {
            const file = fs.readFileSync('./Client-Config.yml', 'utf8');
            this.config = yaml.parse(file);
            logger.setLogPath(this.config.logging?.path || 'logs/client');
            logger.log('Loaded client configuration', 'CONFIG');
        } catch (err) {
            console.error('Failed to load Client-Config.yml:', err);
            process.exit(1);
        }
    }

    ensureUserId() {
        if (!this.config.relay.user) {
            this.config.relay.user = { name: "", id: "" };
        }
    }

    async setupOSCQueryServer() {
        // VRChat expects OSCQuery to advertise the port it will send to (receivePort)
        const receivePort = this.config.osc.local.receivePort || 9001;
        const queryPort = this.config.osc.local.queryPort || 9012;
        const ip = this.config.osc.local.ip || '127.0.0.1';

        // Start OSC receiver for VRChat to send to
        this.oscManager = new OSCManager(this.config);
        await this.oscManager.createReceiver(receivePort, ip);

        // Start OSC sender for sending to VRChat (port 9000)
        await this.oscManager.createSender(this.config.osc.local.sendPort, ip);

        // Start OSCQueryServer, advertise receivePort
        this.oscQueryServer = new OSCQueryServer({
            oscPort: receivePort,
            httpPort: queryPort,
            serviceName: "OSCRelayClient"
        });

        // Register a test endpoint (like /foo in the example)
        this.oscQueryServer.addMethod("/foo", {
            description: "demonstrates a read-only OSC node- single float value ranged 0-100",
            access: OSCQAccess.READONLY,
            arguments: [
                {
                    type: OSCTypeSimple.FLOAT,
                    range: { min: 0, max: 100 },
                }
            ]
        });
        this.oscQueryServer.setValue("/foo", 0, 0.5);

        // Register a /status endpoint
        this.oscQueryServer.addMethod("/status", {
            description: "Client status string",
            access: OSCQAccess.READONLY,
            arguments: [
                { type: OSCTypeSimple.STRING }
            ]
        });
        this.oscQueryServer.setValue("/status", 0, this.status);

        await this.oscQueryServer.start();
        console.log(`[Client] OSCQueryServer started on port ${queryPort}, advertising OSC receive port ${receivePort}`);

        this.setupRelay();
        this.broadcastStatus("waiting for input");
        this.setupKeyboardControls();
    }

    setupRelay() {
        this.relayManager = new RelayManager(this.config);

        this.oscManager.onMessage((msg) => {
            const shouldLog = this.ProcessMessage(msg, 'console');
            const shouldTransmit = this.ProcessMessage(msg, 'transmission');
            if (shouldTransmit && !msg.relayed) {
                this.relayManager.handleClientMessage({
                    type: 'osc_tunnel',
                    userId: this.userId,
                    relayed: true,
                    ...msg
                });
            }
            return shouldLog;
        });

        this.relayManager.messageHandlers.add((message) => {
            if (message.type === 'osc_tunnel' && !message.relayed) {
                console.log(`[Client] Received relay message from ${message.userId}: ${message.address}`);
                // Send to VRChat (port 9000)
                this.oscManager.send(
                    this.config.osc.local.sendPort,
                    message.address,
                    ...message.args
                );
            }
        });

        // Start relay connection
        this.relayManager.connect().then(() => {
            console.log('[Client] Connection established, subscribing to OSC');
            this.relayManager.subscribeToOSC();
        }).catch(err => {
            console.error('[Client] Fatal connection error:', err.message);
            console.error('[Client] Shutting down...');
            process.exit(1);
        });
    }

    broadcastStatus(status) {
        this.status = status;
        if (this.oscQueryServer) {
            this.oscQueryServer.setValue("/status", 0, status);
        }
        if (this.config?.logging?.console) {
            console.log(`[Client] Status broadcast: ${status}`);
        }
    }

    ProcessMessage(message, type = 'transmission') {
        if (!message || !message.address) return false;
        if (type === 'console') {
            const consoleBlacklist = this.config.filters.blacklist.console || [];
            const transmissionBlacklist = this.config.filters.blacklist.transmission || [];
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
                    const testValue = Math.random() * 100;
                    console.log(`[Client] Sending test message: /foo ${testValue}`);
                    // Send to VRChat (port 9000)
                    this.oscManager.send(this.config.osc.local.sendPort, '/foo', testValue);
                } else if (key.name === 'r') {
                    const testValue = Math.floor(Math.random() * 100);
                    console.log(`[Client] Sending test message: /avatar/change/${testValue}`);
                    this.oscManager.send(this.config.osc.local.sendPort, '/avatar/change', testValue);
                }
            }
        });
        console.log('[Client] Keyboard controls enabled:');
        console.log('  Press "t" to send a random float test message to /foo');
        console.log('  Press "r" to send a random integer test message to /avatar/change');
        console.log('  Press Ctrl+C to exit');
    }
}

if (require.main === module) {
    new OSCRelayClient();
    console.log('[Client] Starting connection process...');
    process.on('unhandledRejection', (reason, promise) => {
        console.error('[Client] Unhandled Rejection at:', promise);
        console.error('[Client] Reason:', reason);
    });
}

module.exports = OSCRelayClient;
