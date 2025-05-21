const WebSocket = require('ws');

const WS_PORT = 4953;

class OSCRelay {
    constructor() {
        this.connectedClients = new Map();
        this.setupRelayServer();
    }

    setupRelayServer() {
        this.wsServer = new WebSocket.Server({ port: WS_PORT });

        this.wsServer.on('connection', (ws, req) => {
            const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
            this.connectedClients.set(clientId, ws);
            
            console.log(`[Server] Client connected: ${clientId}`);

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    // Broadcast to other clients
                    this.broadcastToClients(message, clientId);
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

    broadcastToClients(message, senderId) {
        this.connectedClients.forEach((ws, clientId) => {
            if (clientId !== senderId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        });
    }
}

new OSCRelay();
console.log(`[Server] Relay started on ws://localhost:${WS_PORT}`);
