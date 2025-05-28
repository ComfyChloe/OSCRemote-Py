const yaml = require('yaml');
const fs = require('fs');
const logger = require('./managers/logger');
const OSCManager = require('./managers/OSCManager');
const RelayManager = require('./managers/RelayManager');
const OSCQueryManager = require('./managers/OSCQueryManager');

class OSCRelayClient {
    constructor() {
        this.loadConfig();
        this.ensureUserId();
        this.status = "waiting for input";
        this.oscManager = null;
        this.relayManager = null;
        this.oscQueryManager = null;
        this.setup();
    }

    loadConfig() {
        try {
            let configPath = './client/Client-Config.yml';
            if (!fs.existsSync(configPath)) {
                configPath = './Client-Config.yml';
            }
            
            const file = fs.readFileSync(configPath, 'utf8');
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

    async setup() {
        const ip = this.config.osc.local.ip || '127.0.0.1';
        
        this.oscManager = new OSCManager(this.config);
        await this.oscManager.createSender(this.config.osc.local.sendPort, ip);

        this.oscQueryManager = new OSCQueryManager(this.config);
        this.oscQueryManager.onMessage((message, rinfo) => {
            const shouldLog = this.ProcessMessage(message, 'console');
            const shouldTransmit = this.ProcessMessage(message, 'transmission');

            if (shouldLog && this.config?.logging?.osc?.incoming) {
                console.log(`[Client] | Local IP: ${rinfo.address} | Received OSC: ${message.address} | [${message.args.join(', ')}]`);
            }

            if (shouldTransmit) {
                this.relayManager?.handleClientMessage({
                    type: 'osc_tunnel',
                    userId: this.config.relay.user.id,
                    relayed: true,
                    ...message
                });
            }
        });

        await this.oscQueryManager.start();
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
                this.oscManager.send(
                    this.config.osc.local.sendPort,
                    message.address,
                    ...message.args
                );
            }
        });

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
        this.oscQueryManager?.setStatus(status);
        if (this.config?.logging?.console) {
            console.log(`[Client] Status broadcast: ${status}`);
        }
    }

    ProcessMessage(message, type = 'transmission') {
        if (!message?.address || !this.config?.filters?.blacklist) {
            return true;
        }
        const blacklist = this.config.filters.blacklist[type] || [];
        return !blacklist.some(pattern => {
            try {
                const regex = new RegExp(pattern.replace('*', '.*'));
                return regex.test(message.address);
            } catch (err) {
                console.warn(`[Client] Invalid blacklist pattern: ${pattern}`);
                return false;
            }
        });
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
                    const testValue = (Math.random() * 2) - 1;
                    console.log(`[Client] Sending test float: /Float/Test ${testValue}`);
                    this.oscManager.send(this.config.osc.local.sendPort, '/foo', testValue);
                } else if (key.name === 'r') {
                    const testValue = Math.round(Math.random());
                    console.log(`[Client] Sending test int: /Init/Test ${testValue}`);
                    this.oscManager.send(this.config.osc.local.sendPort, '/avatar/change', testValue);
                } else if (key.name === 'b') {
                    const testValue = Math.random() > 0.5 ? 255 : 0;
                    console.log(`[Client] Sending test bool: /Bool/Test ${testValue}`);
                    this.oscManager.send(this.config.osc.local.sendPort, '/Bool/Test', testValue);
                }
            }
        });
        console.log('[Client] Keyboard controls enabled:');
        console.log('  Press "t" to send a random float (-1 to 1) to /foo');
        console.log('  Press "r" to send a random int (0 or 1) to /avatar/change');
        console.log('  Press "b" to send a random bool (0 or 255) to /avatar/parameters/IsLocalPlayer');
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
