const WebSocket = require('ws');
const osc = require('node-osc');
const dgram = require('dgram');
const http = require('http');
const readline = require('readline');

class OSCRelayClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.ws = null;
        this.messageHandlers = new Set();
        this.filters = new Set();
        this.connected = false;
        this.connectionAttempts = 0;
        this.maxRetries = 5;
        this.parameters = new Map();

        this.localOscPort = 9000;
        this.vrchatSendPort = 9001;
        this.vrchatReceivePort = 9000;

        this.vrchatSender = new osc.Client('127.0.0.1', this.vrchatSendPort);
        this.setupOSCReceiver();

        this.startOSCQuery();
        this.setupKeyboardInput();

        this.isTestMode = process.argv.includes('--test');
        if (this.isTestMode) {
            this.runTestMode();
        }
    }

    setupOSCReceiver() {
        try {
            this.vrchatReceiver = new osc.Server(this.localOscPort, '127.0.0.1');
            console.log(`[Client] Listening for OSC on port ${this.localOscPort}`);
            
            this.vrchatReceiver.on('message', (msg, rinfo) => {
                const [address, ...args] = msg;
                console.log('[Client] Received OSC:', address, args);
                
                if (this.connected) {
                    this.ws.send(JSON.stringify({
                        type: 'osc_tunnel',
                        address,
                        args,
                        source: '127.0.0.1'
                    }));
                }
            });
        } catch (err) {
            console.error('[Client] Failed to setup OSC receiver:', err);
            this.localOscPort++;
            if (this.localOscPort < 9020) {
                this.setupOSCReceiver();
            }
        }
    }

    startOSCQuery() {
        const queryPort = 9012;
        this.oscQueryServer = http.createServer(this.handleOSCQuery.bind(this));
        
        this.oscQueryServer.on('error', (err) => {
            console.warn('[Client] OSCQuery server error:', err.message);
        });

        try {
            this.oscQueryServer.listen(queryPort, '127.0.0.1', () => {
                console.log(`[Client] OSCQuery server listening on port ${queryPort}`);
            });
        } catch (err) {
            console.warn('[Client] Could not start OSCQuery server:', err.message);
        }
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
            // Retry after delay
            setTimeout(() => this.discoverVRChatParameters(), 5000);
        }
    }

    setupParameterListeners() {
        // Setup listeners for each discovered parameter
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
        
        // Forward to VRChat
        try {
            this.vrchatSender.send(address, value);
        } catch (err) {
            console.warn(`[Client] Failed to send to VRChat: ${err.message}`);
        }

        // Forward to relay if connected
        if (this.connected) {
            this.send(address, value);
        }
    }

    async connect() {
        try {
            return new Promise((resolve, reject) => {
                this.ws = new WebSocket(this.serverUrl);

                this.ws.on('open', () => {
                    console.log('[Client] Connected to OSC relay');
                    this.connected = true;
                    this.connectionAttempts = 0;
                    resolve();
                });

                this.ws.on('message', (data) => {
                    const message = JSON.parse(data);
                    if (message.type === 'osc_tunnel') {
                        // Forward remote OSC messages to local VRChat
                        this.vrchatSender.send(message.address, ...message.args);
                        this.parameters.set(message.address, message.args[0]);
                    }
                    if (this.shouldProcessMessage(message)) {
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
                args
            };
            if (this.shouldProcessMessage(message)) {
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

    shouldProcessMessage(message) {
        if (this.filters.size === 0) return true;
        return Array.from(this.filters).some(pattern => 
            message.address.match(new RegExp(pattern)));
    }

    handleInit(message) {
        console.log('[Client] Received init message:', message);
    }

    // Method to get stored parameter value
    getParameter(address) {
        return this.parameters.get(address);
    }

    // Method to get all parameters
    getAllParameters() {
        return Object.fromEntries(this.parameters);
    }

    setupKeyboardInput() {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);

        process.stdin.on('keypress', (str, key) => {
            if (key.ctrl && key.name === 'c') {
                process.exit();
            } else if (key.name === 't') {
                const testValue = Math.random();
                console.log('\n=================================');
                console.log('>> TEST MESSAGE SENT');
                console.log(`>> Address: /avatar/change`);
                console.log(`>> Value: ${testValue}`);
                console.log('=================================\n');
                this.send('/avatar/change', testValue);
            } else if (key.name === 'r') {
                const testValue = Math.floor(Math.random() * 100);
                console.log('\n=================================');
                console.log('>> TEST MESSAGE SENT');
                console.log(`>> Address: /avatar/change`);
                console.log(`>> Value: ${testValue}`);
                console.log('=================================\n');
                this.send('/avatar/change', testValue);
            }
        });

        console.clear();
        console.log('\n===============================');
        console.log('        KEYBOARD CONTROLS       ');
        console.log('===============================');
        console.log('  [T] Send random float (0-1)');
        console.log('  [R] Send random integer (0-100)');
        console.log('  [Ctrl+C] Exit application');
        console.log('===============================\n');
    }

    async runTestMode() {
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

// Add direct execution support
if (require.main === module) {
    const SERVER_HOST = '57.128.188.155';
    const SERVER_PORT = 4953;
    
    const client = new OSCRelayClient(`ws://${SERVER_HOST}:${SERVER_PORT}`);
}

module.exports = OSCRelayClient;
