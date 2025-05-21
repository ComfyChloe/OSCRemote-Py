const WebSocket = require('ws');
const osc = require('node-osc');
const dgram = require('dgram');
const http = require('http');

const WS_PORT = 9002;
const OSC_TARGET_PORT = 9100;  // Changed to 9100
const OSC_TARGET_HOST = '127.0.0.1';
const OSC_QUERY_PORT = 9050;

class OSCRelay {
    constructor() {
        this.oscSchema = this.getDefaultSchema();
        this.wsServer = new WebSocket.Server({ port: WS_PORT });
        this.oscClient = new osc.Client(OSC_TARGET_HOST, OSC_TARGET_PORT);
        this.udpServer = dgram.createSocket('udp4');
        this.connectedClients = new Map(); // Track client connections
        this.activeOSCStreams = new Set(); // Track active OSC streams

        this.setupOSCQuery();
        this.setupWebSocket();
        this.setupUDPListener();
    }

    getDefaultSchema() {
        return {
            '/avatar/parameters/VRCFaceBlendH': { type: 'float', range: [0, 1] },
            '/avatar/parameters/VRCFaceBlendV': { type: 'float', range: [0, 1] },
            '/avatar/parameters/VRCEmote': { type: 'int', range: [0, 12] },
            '/avatar/parameters/IsLocal': { type: 'bool' },
            '/avatar/parameters/Voice': { type: 'float', range: [0, 1] },
        };
    }

    setupOSCQuery() {
        const server = http.createServer((req, res) => {
            if (req.url === '/') {
                // OSC Query host info response
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    DESCRIPTION: "VRChat OSC Relay",
                    HOST_NAME: OSC_TARGET_HOST,
                    NAME: "VRChat",
                    OSC_PORT: OSC_TARGET_PORT,
                    OSC_TRANSPORT: "UDP",
                    EXTENSIONS: {
                        ACCESS: true,
                        VALUE: true,
                        RANGE: true,
                        TYPE: true
                    }
                }));
            } else if (req.url === '/avatar') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this.oscSchema));
            }
        });

        server.listen(OSC_QUERY_PORT, () => {
            console.log(`OSC Query server listening on port ${OSC_QUERY_PORT}`);
            console.log('Available parameters:', Object.keys(this.oscSchema).join(', '));
        });
    }

    validateOSCMessage(message) {
        if (!this.oscSchema[message.address]) {
            console.warn(`Unknown OSC address: ${message.address}`);
            return true; // Allow unknown addresses to pass through
        }

        const schema = this.oscSchema[message.address];
        if (schema.type && !this.validateType(message.args[0], schema.type)) {
            console.warn(`Invalid type for ${message.address}: expected ${schema.type}`);
            return false;
        }

        if (schema.range) {
            const [min, max] = schema.range;
            if (message.args[0] < min || message.args[0] > max) {
                console.warn(`Value out of range for ${message.address}: ${message.args[0]}`);
                return false;
            }
        }

        return true;
    }

    validateType(value, type) {
        switch (type) {
            case 'float': return typeof value === 'number';
            case 'bool': return typeof value === 'boolean';
            case 'int': return Number.isInteger(value);
            default: return true;
        }
    }

    setupWebSocket() {
        this.wsServer.on('connection', (ws, req) => {
            const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
            this.connectedClients.set(clientId, ws);
            
            console.log(`[Server] New client connected: ${clientId}`);
            console.log(`[Server] Total connected clients: ${this.connectedClients.size}`);

            ws.on('message', async (data) => {
                const message = JSON.parse(data);
                
                if (message.type === 'osc_tunnel') {
                    // Handle tunneled OSC data
                    console.log(`[Server] Received tunneled OSC from ${clientId}:`, message.address);
                    if (this.validateOSCMessage(message)) {
                        await this.forwardOSCToTarget(message, clientId);
                    }
                } else if (message.type === 'osc_subscribe') {
                    // Handle OSC stream subscription
                    this.activeOSCStreams.add(clientId);
                    console.log(`[Server] Client ${clientId} subscribed to OSC stream`);
                }
            });

            ws.on('close', () => {
                this.connectedClients.delete(clientId);
                this.activeOSCStreams.delete(clientId);
                console.log(`[Server] Client disconnected: ${clientId}`);
            });
        });
    }

    async forwardOSCToTarget(message, senderId) {
        try {
            // Forward to external OSC server
            this.oscClient.send(message.address, ...message.args);
            console.log(`[Server] Forwarded OSC to ${OSC_TARGET_HOST}:${OSC_TARGET_PORT}`);

            // Broadcast to other connected clients
            this.connectedClients.forEach((ws, clientId) => {
                if (clientId !== senderId && this.activeOSCStreams.has(clientId)) {
                    ws.send(JSON.stringify({
                        type: 'osc_tunnel',
                        address: message.address,
                        args: message.args,
                        source: senderId
                    }));
                }
            });
        } catch (error) {
            console.error(`[Server] Failed to forward OSC:`, error);
        }
    }

    setupUDPListener() {
        this.udpServer.bind(OSC_TARGET_PORT + 1);
        
        this.udpServer.on('listening', () => {
            console.log(`[Server] UDP listener active on port ${OSC_TARGET_PORT + 1}`);
        });
        
        this.udpServer.on('message', (msg, rinfo) => {
            const oscMsg = osc.fromBuffer(msg);
            console.log(`[Server] Received UDP OSC from ${rinfo.address}:${rinfo.port} -> ${oscMsg.address}`);

            // Broadcast to all subscribed WebSocket clients
            this.connectedClients.forEach((ws, clientId) => {
                if (this.activeOSCStreams.has(clientId) && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'osc_tunnel',
                        address: oscMsg.address,
                        args: oscMsg.args,
                        source: `${rinfo.address}:${rinfo.port}`
                    }));
                }
            });
        });
    }
}

new OSCRelay();
console.log(`OSC Relay started on ws://localhost:${WS_PORT}`);
