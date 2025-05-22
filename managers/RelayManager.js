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
        console.log(`[Relay] New client connected: ${clientId}`);

        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'identify') {
                    console.log(`[Relay] Client ${clientId} identified as: ${message.userId}`);
                }
                this.handleMessage(clientId, data);
            } catch (err) {
                console.error(`[Relay] Message parse error from ${clientId}:`, err);
            }
        });

        ws.on('close', () => this.handleDisconnect(clientId));
    }

    handleMessage(clientId, data) {
        try {
            const message = JSON.parse(data.toString());
            this.messageHandlers.forEach(handler => handler(clientId, message));
        } catch (err) {
            console.error(`[Relay] Message parse error from ${clientId}:`, err);
        }
    }

    handleDisconnect(clientId) {
        this.clients.delete(clientId);
        console.log(`[Relay] Client disconnected: ${clientId}`);
    }

    handleClientMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
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

    connect() {
        return new Promise((resolve, reject) => {
            try {
                const url = `ws://${this.config.relay.host}:${this.config.relay.port}`;
                this.ws = new WebSocket(url);

                this.ws.on('open', () => {
                    console.log('[Relay] Connected to server');
                    resolve();
                });

                this.ws.on('message', (data) => {
                    const message = JSON.parse(data);
                    this.messageHandlers.forEach(handler => handler(message));
                });

                this.ws.on('error', reject);
                this.ws.on('close', () => {
                    console.log('[Relay] Disconnected from server');
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    subscribeToOSC() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'osc_subscribe' }));
        }
    }
}

module.exports = RelayManager;