const WebSocket = require('ws');
const osc = require('node-osc');
const dgram = require('dgram');
const http = require('http');
const fetch = require('node-fetch');

const WS_PORT = 9002;
const VRCHAT_OSC_PORT = 9000;
const LOCAL_OSC_PORT = 9100;

class OSCRelay {
    constructor() {
        this.oscSchema = {};
        this.connectedClients = new Map();
        this.parameterValues = new Map();
        
        // Setup OSC client to VRChat
        this.vrchatClient = new osc.Client('127.0.0.1', VRCHAT_OSC_PORT);
        
        // Create server components
        this.setupRelayServer();
        this.setupOSCListener();
        
        // Initial VRChat schema fetch
        this.fetchVRChatSchema();
    }

    async fetchVRChatSchema() {
        try {
            console.log('[Server] Fetching VRChat OSC schema...');
            const response = await fetch(`http://127.0.0.1:${VRCHAT_OSC_PORT}/avatar/parameters`);
            this.oscSchema = await response.json();
            console.log('[Server] Loaded', Object.keys(this.oscSchema).length, 'parameters');
            
            // Broadcast schema update to all clients
            this.broadcastToClients({
                type: 'schema_update',
                schema: this.oscSchema
            });
        } catch (err) {
            console.warn('[Server] VRChat OSC schema fetch failed:', err.message);
            // Retry after delay
            setTimeout(() => this.fetchVRChatSchema(), 5000);
        }
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
        // Update stored value
        this.parameterValues.set(address, value);

        // Send to VRChat
        this.vrchatClient.send(address, value);
        console.log(`[Server] Parameter ${address} set to ${value}`);

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
