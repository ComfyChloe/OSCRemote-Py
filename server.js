const WebSocket = require('ws');
const osc = require('node-osc');
const dgram = require('dgram');
const http = require('http');

const WS_PORT = 9002;
const VRCHAT_OSC_PORT = 9000;
const LOCAL_OSC_PORT = 9100;

class OSCRelay {
    constructor() {
        this.oscSchema = {};
        this.connectedClients = new Map();
        this.parameterValues = new Map();
        
        // Setup VRChat OSC client
        this.vrchatClient = new osc.Client('127.0.0.1', VRCHAT_OSC_PORT);
        
        this.setupRelayServer();
        this.setupOSCListener();
        this.startVRChatMonitoring();
    }

    startVRChatMonitoring() {
        const testOSC = () => {
            try {
                const testSocket = dgram.createSocket('udp4');
                testSocket.send('', 0, 0, VRCHAT_OSC_PORT, '127.0.0.1', (err) => {
                    if (!err) {
                        console.log('[Server] VRChat OSC port detected');
                        this.broadcastStatus(true);
                    }
                    testSocket.close();
                });
            } catch (err) {
                console.warn('[Server] VRChat OSC not available');
                this.broadcastStatus(false);
            }
        };

        // Check VRChat availability periodically
        setInterval(testOSC, 5000);
        testOSC(); // Initial check
    }

    broadcastStatus(isAvailable) {
        this.broadcastToClients({
            type: 'status',
            vrchatAvailable: isAvailable,
            timestamp: new Date().toISOString()
        });
    }

    setupRelayServer() {
        // Create WebSocket server
        this.wsServer = new WebSocket.Server({ port: WS_PORT });

        this.wsServer.on('connection', (ws, req) => {
            const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
            this.connectedClients.set(clientId, ws);
            
            console.log(`[Server] Client connected: ${clientId}`);

            // Send current schema and values
            ws.send(JSON.stringify({
                type: 'init',
                schema: this.oscSchema,
                values: Object.fromEntries(this.parameterValues)
            }));

            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data);
                    
                    if (message.type === 'parameter_update') {
                        // Handle parameter value updates
                        this.handleParameterUpdate(message.address, message.value);
                    }
                } catch (err) {
                    console.error('[Server] Message processing error:', err);
                }
            });

            ws.on('close', () => {
                this.connectedClients.delete(clientId);
                console.log(`[Server] Client disconnected: ${clientId}`);
            });
        });
    }

    handleParameterUpdate(address, value) {
        // Store parameter value
        this.parameterValues.set(address, value);

        // Forward to VRChat
        this.vrchatClient.send(address, value);
        console.log(`[Server] Parameter ${address} = ${value}`);

        // Broadcast to other clients
        this.broadcastToClients({
            type: 'parameter_update',
            address,
            value
        });
    }

    setupOSCListener() {
        // Listen for OSC messages from VRChat
        this.oscServer = new osc.Server(LOCAL_OSC_PORT, '127.0.0.1');

        this.oscServer.on('message', (msg) => {
            const [address, ...args] = msg;
            console.log(`[Server] Received OSC: ${address} ${args.join(' ')}`);

            // Store and broadcast parameter updates
            this.parameterValues.set(address, args[0]);
            this.broadcastToClients({
                type: 'parameter_update',
                address,
                value: args[0]
            });
        });
    }

    broadcastToClients(message) {
        const data = JSON.stringify(message);
        this.connectedClients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });
    }
}

// Start server
new OSCRelay();
console.log(`[Server] OSC Relay started on port ${WS_PORT}`);
