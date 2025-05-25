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
        console.log(`[Relay] Server started on ws://${this.config.server.host}:${this.config.server.port}`);
    }

    handleConnection(ws, req) {
        const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
        this.clients.set(clientId, ws);
        console.log(`[Relay] New client connected: ${clientId}`);

        ws.on('message', (data) => this.handleIncomingMessage(clientId, data));
        ws.on('close', () => this.handleDisconnect(clientId));
    }

    handleIncomingMessage(clientId, data) {
        try {
            const message = JSON.parse(data.toString());
            if (message.type === 'identify') {
                console.log(`[Relay] Client ${clientId} identified as: ${message.userId}`);
            } else if (message.type === 'osc_tunnel') {
                console.log(`[Relay] Message from ${clientId}: ${message.address} | [${message.args.join(', ')}]`);
            }
            this.handleMessage(clientId, message);
            
            if (message.type === 'osc_tunnel') {
                this.broadcast(message, clientId);
            }
        } catch (err) {
            console.error(`[Relay] Message parse error from ${clientId}:`, err);
        }
    }

    handleMessage(clientId, message) {
        this.messageHandlers.forEach(handler => handler(clientId, message));
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    handleDisconnect(clientId) {
        this.clients.delete(clientId);
        console.log(`[Relay] Client disconnected: ${clientId}`);
    }

    broadcast(message, excludeId = null) {
        this.clients.forEach((ws, clientId) => {
            if (clientId !== excludeId && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(message));
                } catch (err) {
                    console.error(`[Relay] Broadcast error to ${clientId}:`, err);
                }
            }
        });
    }
}

module.exports = RelayManager;
