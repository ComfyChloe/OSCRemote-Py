const WebSocket = require('ws');
const logger = require('./logger');

const WS_PORT = 4953;

class OSCRelay {
    constructor() {
        this.connectedClients = new Map();
        this.setupRelayServer();
        this.setupShutdown();
    }

    setupRelayServer() {
        this.wsServer = new WebSocket.Server({ port: WS_PORT });

        this.wsServer.on('connection', (ws, req) => {
            const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
            this.connectedClients.set(clientId, ws);
            logger.log(`Client connected: ${clientId}`);
            console.log(`[Server] Client connected: ${clientId}`);

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    logger.log(`Received from ${clientId}: ${JSON.stringify(message)}`, 'MESSAGE');
                    // Add direct console output for OSC messages
                    console.log(`\n[Server] Received message from ${clientId}:`);
                    console.log(JSON.stringify(message, null, 2));
                    this.broadcastToClients(message, clientId);
                } catch (err) {
                    logger.log(`Message processing error from ${clientId}: ${err}`, 'ERROR');
                    console.error(`[Server] Error processing message: ${err}`);
                }
            });

            ws.on('close', () => {
                this.connectedClients.delete(clientId);
                logger.log(`Client disconnected: ${clientId}`);
            });
        });
    }

    setupShutdown() {
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

    broadcastToClients(message, senderId) {
        this.connectedClients.forEach((ws, clientId) => {
            if (clientId !== senderId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
                logger.log(`Broadcast from ${senderId} to ${clientId}: ${JSON.stringify(message)}`, 'BROADCAST');
                console.log(`\n[Server] Broadcasting from ${senderId} to ${clientId}:`);
                console.log(JSON.stringify(message, null, 2));
            }
        });
    }
}

new OSCRelay();
logger.log(`Relay started on ws://localhost:${WS_PORT}`, 'START');
