const WebSocket = require('ws');
const osc = require('node-osc');
const dgram = require('dgram');

const WS_PORT = 9002;
const OSC_TARGET_PORT = 42856;
const OSC_TARGET_HOST = 'localhost'; 

class OSCRelay {
    constructor() {
        this.wsServer = new WebSocket.Server({ port: WS_PORT });
        this.oscClient = new osc.Client(OSC_TARGET_HOST, OSC_TARGET_PORT);
        this.udpServer = dgram.createSocket('udp4');

        this.setupWebSocket();
        this.setupUDPListener();
    }

    setupWebSocket() {
        this.wsServer.on('connection', (ws) => {
            console.log('New WebSocket client connected');

            ws.on('message', (data) => {
                const oscMessage = JSON.parse(data);
                this.oscClient.send(oscMessage.address, ...oscMessage.args);
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
