const WebSocket = require('ws');
const osc = require('node-osc');
const dgram = require('dgram');
const http = require('http');

const WS_PORT = 9002;
const OSC_TARGET_PORT = 42856;
const OSC_TARGET_HOST = 'localhost';
const OSC_QUERY_PORT = 9000;

class OSCRelay {
    constructor() {
        this.oscSchema = this.getDefaultSchema();
        this.wsServer = new WebSocket.Server({ port: WS_PORT });
        this.oscClient = new osc.Client(OSC_TARGET_HOST, OSC_TARGET_PORT);
        this.udpServer = dgram.createSocket('udp4');

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
            // Add more default parameters as needed
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
        this.wsServer.on('connection', (ws) => {
            console.log('New WebSocket client connected');

            ws.on('message', (data) => {
                const oscMessage = JSON.parse(data);
                if (this.validateOSCMessage(oscMessage)) {
                    this.oscClient.send(oscMessage.address, ...oscMessage.args);
                }
            });

            ws.on('close', () => {
                console.log('Client disconnected');
            });
        });
    }

    setupUDPListener() {
        this.udpServer.bind(OSC_TARGET_PORT + 1);
        
        this.udpServer.on('message', (msg, rinfo) => {
            const oscMsg = osc.fromBuffer(msg);
            this.wsServer.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        address: oscMsg.address,
                        args: oscMsg.args
                    }));
                }
            });
        });
    }
}

new OSCRelay();
console.log(`OSC Relay started on ws://localhost:${WS_PORT}`);
