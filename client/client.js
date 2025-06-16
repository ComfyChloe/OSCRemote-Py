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
            
            if (this.config.logging?.verbose === false) {
                logger.setVerbose(false);
            }
            
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

        try {
            this.oscQueryManager = new OSCQueryManager(this.config);
            this.oscQueryManager.onMessage((message, rinfo) => {
                if (message.type === 'oscquery_discovery') {
                    logger.discovery(message.action, message.service);
                    return;
                }
                
                const shouldLog = this.ProcessMessage(message, 'console');
                const shouldTransmit = this.ProcessMessage(message, 'transmission');

                if (shouldTransmit) {
                    this.relayManager?.handleClientMessage({
                        type: 'osc_tunnel',
                        userId: this.config.relay.user.id,
                        relayed: true,
                        ...message
                    });
                }
                
                return shouldLog;
            });

            await this.oscQueryManager.start();
            logger.info('Client', 'OSCQuery started successfully');
        } catch (error) {
            logger.error('Client', `OSCQuery initialization failed: ${error.message}`);
            logger.info('Client', 'Continuing without OSCQuery support...');
        }

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
                logger.info('Client', `Received relay message from ${message.userId}: ${message.address}`);
                this.oscManager.send(
                    this.config.osc.local.sendPort,
                    message.address,
                    ...message.args
                );
            }
        });

        this.relayManager.connect().then(() => {
            logger.info('Client', 'Connection established, subscribing to OSC');
            this.relayManager.subscribeToOSC();
        }).catch(err => {
            logger.error('Client', `Fatal connection error: ${err.message}`);
            logger.error('Client', 'Shutting down...');
            process.exit(1);
        });
    }

    broadcastStatus(status) {
        this.status = status;
        this.oscQueryManager?.setStatus(status);
        if (this.config?.logging?.console) {
            logger.info('Client', `Status broadcast: ${status}`);
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
                logger.warn('Client', `Invalid blacklist pattern: ${pattern}`);
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
                    logger.info('Client', 'Shutting down...');
                    this.cleanup();
                    process.exit();
                } else if (key.name === 't') {
                    const testValue = (Math.random() * 2) - 1;
                    logger.info('Client', `Sending test float: /avatar/parameters/Float ${testValue}`);
                    this.oscManager.send(this.config.osc.local.sendPort, '/avatar/parameters/Float', testValue);
                } else if (key.name === 'r') {
                    const testValue = Math.round(Math.random());
                    logger.info('Client', `Sending test int: /avatar/parameters/Int ${testValue}`);
                    this.oscManager.send(this.config.osc.local.sendPort, '/avatar/parameters/Int', testValue);
                } else if (key.name === 'b') {
                    const testValue = Math.random() > 0.5 ? 1 : 0;
                    logger.info('Client', `Sending test bool: /avatar/parameters/IsLocal ${testValue}`);
                    this.oscManager.send(this.config.osc.local.sendPort, '/avatar/parameters/IsLocal', testValue);
                } else if (key.name === 'v') {
                    // Test VRChat specific parameters that should trigger responses
                    logger.info('Client', 'Sending VRChat parameter test');
                    this.oscManager.send(this.config.osc.local.sendPort, '/avatar/parameters/VelocityX', 0.5);
                    this.oscManager.send(this.config.osc.local.sendPort, '/avatar/parameters/MuteSelf', 0);
                } else if (key.name === 'd') {
                    // Output debug info about current configuration
                    logger.info('Client', 'Debug Info:');
                    logger.info('Client', `  - OSC Send Port: ${this.config.osc.local.sendPort}`);
                    logger.info('Client', `  - OSC Receive Port: ${this.config.osc.local.receivePort}`);
                    logger.info('Client', `  - OSC Query Port: ${this.config.osc.local.queryPort}`);
                    logger.info('Client', `  - Local IP: ${this.config.osc.local.ip}`);
                } else if (key.name === 'q') {
                    // List discovered OSCQuery services
                    const services = this.oscQueryManager?.getDiscoveredServices() || [];
                    logger.info('Client', `Discovered OSCQuery services (${services.length}):`);
                    services.forEach((service, index) => {
                        logger.info('Client', `  ${index + 1}. ${service.name} at ${service.host}:${service.port} (OSC port: ${service.oscPort || 'unknown'})`);
                    });
                } else if (key.name === 'p') {
                    // Send ping to VRChat
                    logger.info('Client', 'Sending ping to VRChat');
                    this.oscQueryManager?.sendInitialPingToVRChat();
                }
            }
        });
        logger.info('Client', 'Keyboard controls enabled:');
        logger.info('Client', '  Press "t" to send a random float (-1 to 1) to /avatar/parameters/Float');
        logger.info('Client', '  Press "r" to send a random int (0 or 1) to /avatar/parameters/Int');
        logger.info('Client', '  Press "b" to send a random bool (0 or 1) to /avatar/parameters/IsLocal');
        logger.info('Client', '  Press "v" to send VRChat-specific parameter tests');
        logger.info('Client', '  Press "d" to display debug information');
        logger.info('Client', '  Press "q" to list discovered OSCQuery services');
        logger.info('Client', '  Press "p" to send a ping to VRChat');
        logger.info('Client', '  Press Ctrl+C to exit');
    }

    cleanup() {
        logger.info('Client', 'Running cleanup...');
        
        if (this.oscQueryManager) {
            try {
                this.oscQueryManager.close();
            } catch (error) {
                logger.error('Client', `Error during OSCQueryManager cleanup: ${error.message}`);
            }
        }
        
        logger.info('Client', 'Cleanup completed');
    }
}

if (require.main === module) {
    const client = new OSCRelayClient();
    logger.info('Client', 'Starting connection process...');
    
    process.on('SIGINT', () => {
        logger.info('Client', 'Received SIGINT, shutting down gracefully...');
        client.cleanup();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        logger.info('Client', 'Received SIGTERM, shutting down gracefully...');
        client.cleanup();
        process.exit(0);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Client', 'Unhandled Rejection at: ' + JSON.stringify(promise));
        logger.error('Client', 'Reason: ' + reason);
    });
}

module.exports = OSCRelayClient;
