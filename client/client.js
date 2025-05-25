const yaml = require('yaml');
const fs = require('fs');
const logger = require('../logger');
const OSCManager = require('./managers/OSCManager');
const RelayManager = require('./managers/RelayManager');
const { OSCQueryDiscovery, OSCQueryServer, OSCQAccess, OSCTypeSimple } = require('oscquery');

class OSCRelayClient {
    constructor() {
        this.loadConfig();
        this.ensureUserId();
        this.parameters = new Map();
        this.status = "waiting for input";
        this.oscServerInfo = null;
        this.oscQueryServer = null; // will hold OSCQueryServer instance
        this.initializeDiscovery();
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

    initializeDiscovery() {
        // Discover OSCQuery servers on the network
        this.discovery = new OSCQueryDiscovery();
        this.discovery.on("up", (service) => {
            console.log(`[Client] Discovered OSCQuery service at ${service.address}:${service.port}`);
            this.oscServerInfo = {
                ip: service.address,
                oscPort: service.hostInfo.OSC_PORT,
                queryPort: service.port
            };
            this.initializeManagers();
        });
        this.discovery.start();

        // If no OSCQuery server is found after timeout, fallback to local server
        setTimeout(() => {
            if (!this.oscServerInfo) {
                console.warn('[Client] No OSCQuery server found, starting local OSC/OSCQuery servers.');
                this.oscServerInfo = {
                    ip: '127.0.0.1',
                    oscPort: 9000,
                    queryPort: 9012
                };
                this.initializeManagers(true);
            }
        }, 3000);
    }

    initializeManagers(startLocal = false) {
        // Use VRChat's default ports unless overridden
        const sendPort = 9000;    // to VRChat
        const receivePort = 9001; // from VRChat
        const queryPort = this.oscServerInfo.queryPort;
        const ip = this.oscServerInfo.ip;

        this.config.osc = this.config.osc || {};
        this.config.osc.local = {
            sendPort,
            receivePort,
            queryPort,
            ip
        };

        this.oscManager = new OSCManager(this.config);
        this.relayManager = new RelayManager(this.config);

        this.setupManagers(startLocal);
    }

    async setupManagers(startLocal) {
        if (startLocal) {
            // Listen for OSC from VRChat on 9001
            await this.oscManager.createReceiver(this.config.osc.local.receivePort);
            // Send OSC to VRChat on 9000
            await this.oscManager.createSender(this.config.osc.local.sendPort);

            // Start OSCQueryServer, advertise OSC_PORT as 9001 (the receive port)
            this.oscQueryServer = new OSCQueryServer({
                oscPort: this.config.osc.local.receivePort, // <-- VRChat will see this as the port to send to
                httpPort: this.config.osc.local.queryPort,
                serviceName: "OSCRelayClient"
            });
            this.oscQueryServer.addMethod("/status", {
                description: "Client status string",
                access: OSCQAccess.READONLY,
                arguments: [
                    { type: OSCTypeSimple.STRING }
                ]
            });
            this.oscQueryServer.setValue("/status", 0, this.status);
            await this.oscQueryServer.start();
            console.log(`[Client] OSCQueryServer started on port ${this.config.osc.local.queryPort}`);
        }

        this.broadcastStatus("waiting for input");

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
    }

    broadcastStatus(status) {
        this.status = status;
        // Update OSCQueryServer /status endpoint if running
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
                    const testValue = Math.random();
                    console.log(`[Client] Sending test message: /avatar/change/${testValue}`);
                    // Send to VRChat (port 9000)
                    this.oscManager.send(this.config.osc.local.sendPort, '/avatar/change', testValue);
                } else if (key.name === 'r') {
                    const testValue = Math.floor(Math.random() * 100);
                    console.log(`[Client] Sending test message: /avatar/change/${testValue}`);
                    // Send to VRChat (port 9000)
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
    client.setupKeyboardControls();
    console.log('[Client] Starting connection process...');
    // Wait for relayManager to be initialized after discovery
    const waitForRelay = () => {
        if (!client.relayManager) {
            setTimeout(waitForRelay, 100);
            return;
        }
        client.relayManager.connect().then(() => {
            console.log('[Client] Connection established, subscribing to OSC');
            client.relayManager.subscribeToOSC();
        }).catch(err => {
            console.error('[Client] Fatal connection error:', err.message);
            console.error('[Client] Shutting down...');
            process.exit(1);
        });
    };
    waitForRelay();

    process.on('unhandledRejection', (reason, promise) => {
        console.error('[Client] Unhandled Rejection at:', promise);
        console.error('[Client] Reason:', reason);
    });
}

module.exports = OSCRelayClient;
