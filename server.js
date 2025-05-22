const WebSocket = require('ws');
const logger = require('./logger');

const WS_PORT = 4953;

class OSCRelay {
    constructor() {
        this.connectedClients = new Map();
        this.RelayServer();
        this.Shutdown();
    }
    RelayServer() {
        this.wsServer = new WebSocket.Server({ port: WS_PORT });

        this.wsServer.on('connection', (ws, req) => {
            const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
            this.connectedClients.set(clientId, ws);
            logger.log(`Client connected: ${clientId}`);
            console.log(`[Server] Client connected: ${clientId}`);

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    
                    console.log('[Server] Raw message received:', data.toString());
                    
                    if (message.type === 'osc_tunnel') {
                        console.log('\n[Server] OSC Message:');
                        console.log(`From: ${clientId}`);
                        console.log(`Address: ${message.address}`);
                        console.log(`Args: ${JSON.stringify(message.args)}`);
                        console.log(`Source: ${message.source}\n`);
                        
                        // Broadcast only OSC messages
                        this.broadcastToClients(message, clientId);
                    }
                } catch (err) {
                    logger.log(`Message processing error from ${clientId}: ${err}`, 'ERROR');
                    console.error('[Server] Parse error:', err);
                }
            });

            ws.on('close', () => {
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

    broadcastToClients(message, senderId) {
        let broadcastCount = 0;
        this.connectedClients.forEach((ws, clientId) => {
            if (clientId !== senderId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
                logger.log(`Broadcast from ${senderId} to ${clientId}: ${JSON.stringify(message)}`, 'BROADCAST');
                console.log(`[Server] Broadcasted OSC to ${clientId}`);
                broadcastCount++;
            }
        });
        console.log(`[Server] Message broadcasted to ${broadcastCount} clients\n`);
    }
}

new OSCRelay();
logger.log(`Relay started on ws://localhost:${WS_PORT}`, 'START');
