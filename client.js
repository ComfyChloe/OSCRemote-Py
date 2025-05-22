const WebSocket = require('ws');
const osc = require('node-osc');
const dgram = require('dgram');
const http = require('http');
const readline = require('readline');
const yaml = require('yaml');
const fs = require('fs');

class OSCRelayClient {
    constructor(serverUrl) {
        this.loadConfig();
        this.ensureUserId();
        this.serverUrl = serverUrl || `ws://${this.config.relay.host}:${this.config.relay.port}`;
        this.ws = null;
        this.messageHandlers = new Set();
        this.filters = new Set();
        this.connected = false;
        this.connectionAttempts = 0;
        this.parameters = new Map();

        this.findAvailablePorts();
        this.maxRetries = this.config.relay.maxRetries;

        this.vrchatSender = new osc.Client('127.0.0.1', this.vrchatSendPort);
        this.OSCReceiver();

        this.startOSCQuery();
        this.KeyboardInput();

        this.isTestMode = process.argv.includes('--test');
        if (this.isTestMode) {
            this.TestMode();
        }

        this.loadBlacklist();
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

    loadBlacklist() {
        this.blacklist = new Set(this.config.filters.blacklist);
        console.log('[Client] Loaded blacklist patterns:', this.blacklist.size);
    }

    findAvailablePorts() {
        this.localOscPort = this.config.osc.local.receivePort;
        this.vrchatSendPort = this.config.osc.local.sendPort;
        this.vrchatReceivePort = this.config.osc.local.receivePort;
        this.queryPort = this.config.osc.local.queryPort;

        if (this.localOscPort === 0) { // 0 lets it auto search
            this.localOscPort = 9001; 
        }
        if (this.queryPort === 0) {
            this.queryPort = 9012; 
        }
    }

    OSCReceiver() {
        const createServer = (port) => {
            try {
                const server = new osc.Server(port, '127.0.0.1');
                
                server.on('listening', () => {
                    console.log(`[Client] Listening for OSC on port ${port}`);
                    this.vrchatReceiver = server;
                    this.config.osc.local.receivePort = port;
                    this.saveConfig();
                });

                server.on('error', (err) => {
                    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                        console.log(`[Client] Port ${port} not available, trying ${port + 1}...`);
                        server.close();
                        createServer(port + 1);
                    } else {
                        console.error('[Client] OSC server error:', err);
                    }
                });

                server.on('message', (msg, rinfo) => {
                    const [address, ...args] = msg;
                    if (this.ProcessMessage({ address })) {
                        console.log(`[Client] Local IP: ${rinfo.address} Received OSC:`, address, args);
                        
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
                if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                    console.log(`[Client] Port ${port} failed, trying ${port + 1}...`);
                    createServer(port + 1);
                } else {
                    console.error('[Client] Failed to create OSC server:', err);
                }
            }
        };

        // Start with configured port or default
        createServer(this.localOscPort || 9001);
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
        
        try {
            this.vrchatSender.send(address, value);
        } catch (err) {
            console.warn(`[Client] Failed to send to VRChat: ${err.message}`);
        }

        if (this.connected) {
            this.send(address, value);
        }
    }

    async connect() {
        try {
            return new Promise((resolve, reject) => {
                this.ws = new WebSocket(this.serverUrl);
                this.relayId = null;

                this.ws.on('open', () => {
                    console.log('[Client] Connected to OSC relay');
                    this.ws.send(JSON.stringify({
                        type: 'identify',
                        userId: this.userId
                    }));
                    this.connected = true;
                    this.connectionAttempts = 0;
                    resolve();
                });

                this.ws.on('message', (data) => {
                    const message = JSON.parse(data);
                    if (message.type === 'osc_tunnel') {
                        console.log(`[Client] User ${message.userId} IP: ${message.source} Received OSC:`, message.address, message.args);
                        this.vrchatSender.send(message.address, ...message.args);
                        this.parameters.set(message.address, message.args[0]);
                    }
                    if (this.ProcessMessage(message)) {
                        this.messageHandlers.forEach(handler => handler(message));
                    }
                });

                this.ws.on('error', (error) => {
                    console.error('[Client] WebSocket error:', error.message);
                    if (!this.connected && this.connectionAttempts >= this.maxRetries) {
                        reject(new Error(`Failed to connect after ${this.maxRetries} attempts`));
                    }
                });

                this.ws.on('close', () => {
                    console.log('[Client] Disconnected from OSC relay');
                    this.connected = false;
                    if (this.connectionAttempts < this.maxRetries) {
                        console.log(`[Client] Retrying connection (${this.connectionAttempts}/${this.maxRetries})...`);
                        setTimeout(() => this.connect(), 2000);
                    }
                });
            });
        } catch (err) {
            console.error('[Client] Connection failed:', err.message);
            throw err;
        }
    }

    subscribeToOSC() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'osc_subscribe' }));
            console.log('[Client] Subscribed to OSC stream');
        }
    }

    send(address, ...args) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = {
                type: 'osc_tunnel',
                address,
                args,
                userId: this.userId // Always include userId in messages
            };
            if (this.ProcessMessage(message)) {
                this.ws.send(JSON.stringify(message));
                console.log('[Client] Sent OSC message:', address);
            }
        }
    }

    updateParameter(address, value) {
        if (this.connected) {
            this.ws.send(JSON.stringify({
                type: 'parameter_update',
                address,
                value
            }));
        }
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    addFilter(pattern) {
        this.filters.add(pattern);
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
        if (this.filters.size === 0) return true;
        return Array.from(this.filters).some(pattern => 
            message.address.match(new RegExp(pattern)));
    }

    handleInit(message) {
        console.log('[Client] Received init message:', message);
    }

    getParameter(address) {
        return this.parameters.get(address);
    }

    getAllParameters() {
        return Object.fromEntries(this.parameters);
    }

    KeyboardInput() {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);

        process.stdin.on('keypress', (str, key) => {
            if (key.ctrl && key.name === 'c') {
                process.exit();
            } else if (key.name === 't') {
                const testValue = Math.random();
                console.log(`[Client] Sending test message: /avatar/change/${testValue}`);
                this.send('/avatar/change', testValue);
            } else if (key.name === 'r') {
                const testValue = Math.floor(Math.random() * 100);
                console.log(`[Client] Sending test message: /avatar/change/${testValue}`);
                this.send('/avatar/change', testValue);
            }
        });
        console.log('[Client] Keyboard controls enabled:');
        console.log('  Press "t" to send a random float test message');
        console.log('  Press "r" to send a random integer test message');
        console.log('  Press Ctrl+C to exit');
    }

    async TestMode() {
        try {
            console.log('[Test Mode] Setting up OSC and WebSocket...');
            await this.connect();

            console.log('[Test Mode] Testing parameter discovery...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            const params = this.getAllParameters();
            console.log('[Test Mode] Available parameters:', Object.keys(params).length);

            this.onMessage(message => {
                console.log('[Test Mode] Received OSC Message:', {
                    timestamp: new Date().toISOString(),
                    source: message.source || 'unknown',
                    address: message.address,
                    args: message.args
                });
            });

            if (this.connected) {
                const testCases = [
                    { path: '/avatar/parameters/Voice', value: 0.75 },
                    { path: '/avatar/parameters/VRCEmote', value: 1 },
                ];

                console.log('[Test Mode] Running test cases...');
                for (const test of testCases) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    this.send(test.path, test.value);
                    console.log(`[Test Mode] Sent: ${test.path} = ${test.value}`);
                }
            }
        } catch (error) {
            console.error('[Test Mode] Error:', error.message);
            process.exit(1);
        }
    }
}

if (require.main === module) {
    const client = new OSCRelayClient();
    client.connect().then(() => {
        console.log('[Client] Successfully connected to relay server');
        client.subscribeToOSC(); 
    }).catch(err => {
        console.error('[Client] Failed to connect:', err);
        process.exit(1);
    });
}

module.exports = OSCRelayClient;
