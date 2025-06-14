const { OSCQueryServer, OSCQAccess, OSCTypeSimple } = require('oscquery');
const osc = require('node-osc');

class OSCQueryManager {
    constructor(config) {
        this.config = config;
        this.status = "waiting for input";
        this.parameters = new Map();
        this.messageHandlers = new Set();
        this.oscServer = null;
    }

    async start() {
        try {
            const receivePort = this.config.osc.local.receivePort || 9001;
            const queryPort = this.config.osc.local.queryPort || 9012;
            const ip = this.config.osc.local.ip || '127.0.0.1';

            console.log(`[Client] Setting up OSCQuery with HTTP on port ${queryPort} and OSC on port ${receivePort}`);

            this.oscQueryServer = new OSCQueryServer({
                oscPort: receivePort,
                httpPort: queryPort,
                serviceName: "Chloes-OSCRelay",
                oscTransport: "UDP"
            });

            const oscServerPort = receivePort + 100; 
            this.createOSCServer(oscServerPort, ip);

            this.addVRChatEndpoints();

            this.oscQueryServer.addMethod("/status", {
                description: "Client status string",
                access: OSCQAccess.READONLY,
                arguments: [{ type: OSCTypeSimple.STRING }]
            });
            this.oscQueryServer.setValue("/status", 0, this.status);

            await this.oscQueryServer.start();
            console.log(`[Client] OSCQuery server started successfully`);
            console.log(`[Client] HTTP discovery available on port ${queryPort}`);
            console.log(`[Client] OSC messages should be sent to port ${receivePort}`);
            console.log(`[Client] Additional OSC server listening on port ${oscServerPort}`);
        } catch (error) {
            console.error(`[Client] Failed to start OSCQuery server: ${error.message}`);
            if (error.code === 'EACCES') {
                console.error(`[Client] Permission denied for port binding. Port may already be in use.`);
                console.error(`[Client] Try changing the receivePort in your configuration or running with admin privileges.`);
            }
            throw error;
        }
    }

    createOSCServer(port, ip) {
        try {
            console.log(`[Client] Setting up additional OSC server on port ${port}`);
            this.oscServer = new osc.Server(port, ip);
            this.oscServer.on('message', this.handleMessage.bind(this));
        } catch (error) {
            console.error(`[Client] Failed to create additional OSC server: ${error.message}`);
        }
    }

    handleMessage(msg, rinfo) {
        const [address, ...args] = msg;
        const message = { address, args, source: rinfo.address, port: rinfo.port };
        this.messageHandlers.forEach(handler => handler(message, rinfo));
    }

    addVRChatEndpoints() {
        // Add general avatar parameter endpoint with wildcard
        this.oscQueryServer.addMethod("/avatar/parameters/*", {
            description: "Avatar parameter changes",
            access: OSCQAccess.READWRITE,
            arguments: [{ 
                type: OSCTypeSimple.FLOAT,
                range: { min: 0, max: 1 }
            }]
        });

        // Add specific VRChat endpoints for better discovery
        const commonEndpoints = [
            "/avatar/change",
            "/avatar/parameters/IsLocal",
            "/avatar/parameters/AFK",
            "/avatar/parameters/VRMode",
            "/avatar/parameters/MuteSelf",
            "/avatar/parameters/Seated",
            "/avatar/parameters/TrackingType",
            "/input/Jump",
            "/input/Voice"
        ];

        commonEndpoints.forEach(endpoint => {
            this.oscQueryServer.addMethod(endpoint, {
                description: `VRChat ${endpoint.split('/').pop()} parameter`,
                access: OSCQAccess.READWRITE,
                arguments: [{ 
                    type: OSCTypeSimple.FLOAT,
                    range: { min: 0, max: 1 }
                }]
            });
        });
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    setStatus(status) {
        this.status = status;
        if (this.oscQueryServer) {
            this.oscQueryServer.setValue("/status", 0, status);
        }
    }

    send(address, ...args) {
        if (this.oscQueryServer) {
            try {
                this.oscQueryServer.send(address, ...args);
            } catch (error) {
                console.error(`[Client] Failed to send message via OSCQuery: ${error.message}`);
            }
        }
    }

    close() {
        if (this.oscServer) {
            try {
                this.oscServer.close();
                console.log('[Client] Additional OSC server closed');
            } catch (error) {
                console.error(`[Client] Error closing additional OSC server: ${error.message}`);
            }
        }
        
        if (this.oscQueryServer) {
            try {
                if (typeof this.oscQueryServer.stop === 'function') {
                    this.oscQueryServer.stop();
                    console.log('[Client] OSCQuery server stopped');
                } 
                else if (typeof this.oscQueryServer.shutdown === 'function') {
                    this.oscQueryServer.shutdown();
                    console.log('[Client] OSCQuery server shutdown');
                }
                else if (typeof this.oscQueryServer.dispose === 'function') {
                    this.oscQueryServer.dispose();
                    console.log('[Client] OSCQuery server disposed');
                }
                else {
                    console.log('[Client] No shutdown method found for OSCQuery server');
                }
            } catch (error) {
                console.error(`[Client] Error closing OSCQuery server: ${error.message}`);
            }
        }
    }
}

module.exports = OSCQueryManager;
