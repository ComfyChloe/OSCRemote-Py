const WebSocket = require('ws');

class WebSocketManager {
    constructor(config) {
        this.config = config;
        this.clients = new Map();
        this.messageHandlers = new Set();
        this.clientInfo = new Map();
    }

    startServer() {
        this.server = new WebSocket.Server({ 
            port: this.config.server.port,
            host: this.config.server.host 
        });

        console.log(`[WebSocket] Server starting on ws://${this.config.server.host}:${this.config.server.port}`);
        this.server.on('connection', this.handleConnection.bind(this));
    }

    handleConnection(ws, req) {
        const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
        const clientInfo = {
            id: clientId,
            ip: req.socket.remoteAddress,
            port: req.socket.remotePort,
            connectedAt: new Date(),
            userId: null,
            messageCount: 0
        };

        this.clients.set(clientId, ws);
        this.clientInfo.set(clientId, clientInfo);
        console.log(`[WebSocket] New connection from ${clientId}`);

        ws.on('message', (data) => this.handleMessage(clientId, data));
        ws.on('close', () => this.handleDisconnect(clientId));
        ws.on('error', (error) => this.handleError(clientId, error));
    }

    handleMessage(clientId, data) {
        try {
            const message = JSON.parse(data.toString());
            const clientInfo = this.clientInfo.get(clientId);
            clientInfo.messageCount++;

            if (message.type === 'identify') {
                clientInfo.userId = message.userId;
                console.log(`[WebSocket] Client ${clientId} identified as: ${message.userId}`);
            } else if (message.type === 'osc_tunnel') {
                const userId = clientInfo.userId || clientId;
                console.log(`[WebSocket] OSC from ${userId}: ${message.address} | [${message.args.join(', ')}]`);
            }

            this.messageHandlers.forEach(handler => handler(clientId, message));
        } catch (err) {
            console.error(`[WebSocket] Message parse error from ${clientId}:`, err);
        }
    }

    handleDisconnect(clientId) {
        const clientInfo = this.clientInfo.get(clientId);
        if (clientInfo) {
            console.log(`[WebSocket] Client disconnected: ${clientInfo.userId || clientId}`);
            console.log(`[WebSocket] Stats: Messages processed: ${clientInfo.messageCount}, Connected for: ${(new Date() - clientInfo.connectedAt) / 1000}s`);
        }
        this.clients.delete(clientId);
        this.clientInfo.delete(clientId);
    }

    handleError(clientId, error) {
        console.error(`[WebSocket] Error for client ${clientId}:`, error.message);
    }

    broadcast(message, excludeId = null) {
        this.clients.forEach((ws, clientId) => {
            if (clientId !== excludeId && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(message));
                } catch (err) {
                    console.error(`[WebSocket] Broadcast error to ${clientId}:`, err);
                }
            }
        });
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    getConnectedClients() {
        return Array.from(this.clientInfo.values());
    }
}

module.exports = WebSocketManager;
