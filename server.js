const WebSocket = require('ws');
const logger = require('./logger');

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
            
            logger.log(`Client connected: ${clientId}`);

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    logger.log(`Received from ${clientId}: ${JSON.stringify(message)}`, 'MESSAGE');
                    this.broadcastToClients(message, clientId);
                } catch (err) {
                    logger.log(`Message processing error from ${clientId}: ${err}`, 'ERROR');
                }
            });

            ws.on('close', () => {
                this.connectedClients.delete(clientId);
                logger.log(`Client disconnected: ${clientId}`);
            });
        });
    }

    broadcastToClients(message, senderId) {
        this.connectedClients.forEach((ws, clientId) => {
            if (clientId !== senderId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
                logger.log(`Broadcast from ${senderId} to ${clientId}: ${JSON.stringify(message)}`, 'BROADCAST');
            }
        });
    }
}

new OSCRelay();
logger.log(`Relay started on ws://localhost:${WS_PORT}`, 'START');
