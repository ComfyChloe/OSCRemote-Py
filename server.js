const WebSocket = require('ws');
const osc = require('node-osc');
const dgram = require('dgram');

const WS_PORT = 4953;
const VRCHAT_OSC_PORT = 9000;  // VRChat's default OSC port
const VRCHAT_OSC_RECEIVE_PORT = 9001;  // Port where VRChat sends data
const LOCAL_OSC_PORT = 9100;

class OSCRelay {
    constructor() {
        this.connectedClients = new Map();
        this.parameterValues = new Map();
        this.vrchatClient = new osc.Client('127.0.0.1', VRCHAT_OSC_PORT);
        this.oscServer = new osc.Server(VRCHAT_OSC_RECEIVE_PORT, '127.0.0.1');
        
        console.log(`[Server] VRChat OSC Setup:`);
        console.log(`[Server] - Listening for VRChat on port ${VRCHAT_OSC_RECEIVE_PORT}`);
        console.log(`[Server] - Sending to VRChat on port ${VRCHAT_OSC_PORT}`);
        console.log(`[Server] WebSocket server running on port ${WS_PORT}`);

        this.setupRelayServer();
        this.setupOSCListener();
    }

    setupRelayServer() {
        this.wsServer = new WebSocket.Server({ port: WS_PORT });

        this.wsServer.on('connection', (ws, req) => {
            const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
            this.connectedClients.set(clientId, ws);
            
            console.log(`[Server] Client connected: ${clientId}`);

            ws.send(JSON.stringify({
                type: 'init',
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
        this.oscServer.on('message', (msg, rinfo) => {
            const [address, ...args] = msg;
            console.log(`[Server] Received from VRChat: ${address} = ${args.join(', ')}`);

            // Relay to all WebSocket clients
            this.broadcastToClients({
                type: 'osc_message',
                address,
                args,
                source: 'vrchat'
            });
        });

        const localOscServer = new osc.Server(LOCAL_OSC_PORT, '127.0.0.1');
        console.log(`[Server] Listening for VRChat OSC on port ${LOCAL_OSC_PORT}`);

        localOscServer.on('message', (msg) => {
            const [address, ...args] = msg;
            console.log(`[Server] Received OSC: ${address} ${args.join(' ')}`);

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

new OSCRelay();
console.log(`[Server] OSC Relay started on ws://localhost:${WS_PORT}`);
