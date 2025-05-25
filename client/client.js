const yaml = require('yaml');
const fs = require('fs');
const logger = require('../logger');
const OSCManager = require('../managers/OSCManager');
const OSCQueryManager = require('../managers/OSCQueryManager');
const RelayManager = require('../managers/RelayManager');

class OSCRelayClient {
    constructor() {
        this.loadConfig();
        this.ensureUserId();
        this.initializeManagers();
        this.setupKeyboardControls();
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
        if (this.queryPort === 0) {
            this.queryPort = 9012; 
        }
    }

    initializeManagers() {
        this.oscManager = new OSCManager(this.config);
        this.oscQueryManager = new OSCQueryManager(this.config);
        this.relayManager = new RelayManager(this.config);

        this.setupManagers();
    }

    async setupManagers() {
        await this.oscManager.createReceiver(this.config.osc.local.receivePort);
        await this.oscManager.createSender(this.config.osc.local.sendPort);
        await this.oscQueryManager.start();
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
    }

    OSCReceiver() {
        const createServer = (port) => {
            try {
                const server = new osc.Server(port, this.config.osc.local.ip);
                
                server.on('listening', () => {
                    console.log(`[Client] Listening for OSC on port ${port}`);
                    this.vrchatReceiver = server;
                    this.config.osc.local.receivePort = port;
                    this.saveConfig();
                });

                server.on('error', (err) => {
                    console.error('[Client] OSC server error:', err);
                });

                server.on('message', (msg, rinfo) => {
                    const [address, ...args] = msg;
                    if (this.ProcessMessage({ address })) {
                        console.log(`[Client] | Local IP: ${rinfo.address} | Received OSC:`, address, args);
                        
                        if (this.connected) {
                            this.ws.send(JSON.stringify({
                                type: 'osc_tunnel',
                                address,
                                args,
                                source: rinfo.address,
                                userId: this.userId
                            }));
                        }
                    }
                });

            } catch (err) {
                console.error('[Client] Failed to create OSC server:', err);
            }
        };

        createServer(this.config.osc.local.receivePort);
    }

    startOSCQuery() {
        const tryPort = (port) => {
            try {
                this.oscQueryServer = http.createServer(this.handleOSCQuery.bind(this));
                
                this.oscQueryServer.on('error', (err) => {
                    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                        console.log(`[Client] Query port ${port} in use, trying next port...`);
                        tryPort(port + 1);
                    } else {
                        console.warn('[Client] OSCQuery server error:', err.message);
                    }
                });

                this.oscQueryServer.listen(port, '127.0.0.1', () => {                       
                    console.log(`[Client] OSCQuery server listening on port ${port}`);
                    this.config.osc.local.queryPort = port;
                    this.saveConfig();          
                });
            } catch (err) {
                if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                    tryPort(port + 1);              
                } else {
                    console.warn('[Client] Could not start OSCQuery server:', err.message);
                }
            }
        };

        tryPort(this.queryPort);
    }

    handleOSCQuery(req, res) {
        const oscQueryResponse = {
            DESCRIPTION: "OSC Relay Client",
            HOST_INFO: {
                NAME: "OSCRelay",
                OSC_PORT: this.vrchatSendPort,                  
                OSC_TRANSPORT: "UDP",
                OSC_IP: "127.0.0.1"
            },
            EXTENSIONS: {
                ACCESS: true,
                VALUE: true,
                TYPE: true,
                RANGE: true
            }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(oscQueryResponse));
    }

    async discoverVRChatParameters() {
        try {
            console.log('[Client] Discovering VRChat parameters...');
            const response = await fetch('http://127.0.0.1:9000/avatar/parameters');
            const parameters = await response.json();
            
            for (const [address, data] of Object.entries(parameters)) {
                this.parameters.set(address, {
                    value: data.value,
                    type: data.type,
                    access: data.access
                });
            }

            console.log(`[Client] Discovered ${this.parameters.size} parameters`);
            this.setupParameterListeners();
        } catch (err) {
            console.warn('[Client] VRChat parameter discovery failed:', err.message);
            setTimeout(() => this.discoverVRChatParameters(), 5000);
        }
    }

    setupParameterListeners() {
        this.parameters.forEach((data, address) => {
            const accessType = data.access || 'readwrite';
            if (accessType.includes('read')) {
                this.vrchatReceiver.on(address, (value) => {
                    this.handleParameterUpdate(address, value);
                });
            }
        });
    }

    handleParameterUpdate(address, value) {
        if (!this.parameters.has(address)) {
            console.log(`[Client] New parameter discovered: ${address}`);
        }
        this.parameters.set(address, { value, type: typeof value });
        
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
            fs.writeFileSync('./Client-Config.yml', yaml.stringify(this.config));
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
