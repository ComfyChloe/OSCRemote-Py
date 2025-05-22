const WebSocket = require('ws');
const logger = require('./logger');
const readline = require('readline'); // Add this at the top

const WS_PORT = 4953;

class OSCRelay {
    constructor() {
        this.connectedClients = new Map();
        this.clientIds = new Map();
        this.RelayServer();
        this.Shutdown();
        this.setupKeyboardControls();
    }

    RelayServer() {
        this.wsServer = new WebSocket.Server({ port: WS_PORT });

        this.wsServer.on('connection', (ws, req) => {
            const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
            this.connectedClients.set(clientId, ws);
            console.log(`[Server] Client connected: ${clientId}`); 

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    const timestamp = new Date().toISOString();

                    if (message.type === 'identify') {
                        this.clientIds.set(clientId, message.userId);
                        console.log(`[Server] | ${timestamp} | Client ${clientId} identified as: ${message.userId}`);
                        return;
                    }

                    const userId = message.userId || this.clientIds.get(clientId) || 'unknown';
                    if (message.type === 'osc_tunnel') {
                        console.log(`[Server] | ${timestamp} | User ${userId} | Address: ${message.address} | Args: ${JSON.stringify(message.args)}`);
                        message.userId = userId;
                        this.broadcastToClients(message, clientId, timestamp);
                    }
                } catch (err) {
                    console.error(`[Server] Parse error from ${clientId}:`, err);
                }
            });

            ws.on('close', () => {
                this.clientIds.delete(clientId);
                this.connectedClients.delete(clientId);
                logger.log(`Client disconnected: ${clientId}`);
            });
        });
    }

    Shutdown() {
        process.on('SIGINT', () => {
            logger.log('Shutting down server...', 'SHUTDOWN');

            this.connectedClients.forEach((ws, clientId) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                    logger.log(`Closed connection to ${clientId}`, 'SHUTDOWN');
                }
            });

            this.wsServer.close(() => {
                logger.log('Server shutdown complete', 'SHUTDOWN');
                process.exit(0);
            });
        });
    }

    setupKeyboardControls() {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);

        process.stdin.on('keypress', (str, key) => {
            if (key.ctrl && key.name === 'c') {
                process.exit();
            } else if (key.name === 'u') {
                this.sendTestToAllUsers();
            }
        });

        console.log('[Server] Keyboard controls enabled:');
        console.log('  Press "u" to send test message to all clients');
        console.log('  Press Ctrl+C to exit');
    }

    sendTestToAllUsers() {
        const testMessage = {
            type: 'osc_tunnel',
            address: '/test/server',
            args: [Math.random()],
            userId: 'SERVER',
            source: 'server'
        };

        this.connectedClients.forEach((ws, clientId) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(testMessage));
                console.log(`[Server] Sent test to client: ${this.clientIds.get(clientId) || clientId}`);
            }
        });
    }

    broadcastToClients(message, senderId, timestamp) {
        this.connectedClients.forEach((ws, clientId) => {
            if (clientId !== senderId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
                if (message.type === 'osc_tunnel') {
                    console.log(`[Server ${timestamp}] Broadcast | From: ${message.userId} | To: ${clientId} | Address: ${message.address} | Args: ${JSON.stringify(message.args)}`);
                }
            }
        });
    }
}
new OSCRelay();
logger.log(`Relay started on ws://localhost:${WS_PORT}`, 'START');
