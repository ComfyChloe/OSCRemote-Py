const WebSocket = require('ws');

class RelayManager {
    constructor(config) {
        this.config = config;
        this.clients = new Map();
        this.messageHandlers = new Set();
    }

    startServer() {
        this.server = new WebSocket.Server({ 
            port: this.config.server.port,
            host: this.config.server.host 
        });

        this.server.on('connection', this.handleConnection.bind(this));
    }

    handleConnection(ws, req) {
        const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
        this.clients.set(clientId, ws);

        ws.on('message', (data) => this.handleMessage(clientId, data));
        ws.on('close', () => this.handleDisconnect(clientId));
    }

    broadcast(message, excludeId = null) {
        this.clients.forEach((ws, clientId) => {
            if (clientId !== excludeId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        });
    }
}

module.exports = RelayManager;